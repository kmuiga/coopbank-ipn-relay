import express from 'express';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(express.json());

// 1. Initialize Supabase
const supabase = createClient(
    process.env.SUPABASE_URL, 
    process.env.SUPABASE_KEY
);

/**
 * PRECISION EXTRACTOR: Handles M-Pesa (Format A) and POS (Format B)
 * Primary source is CustMemoLine1 as it is more structured than Narration.
 */
const extractFinalRef = (memoLine, narration) => {
    // Fallback to Narration if CustMemoLine1 is missing
    const source = memoLine || narration;
    if (!source) return null;

    // Split by tilde and clean up whitespace/hidden characters
    const parts = source.split('~').map(p => p.trim());

    if (parts.length === 0) return null;

    // Format B: POS/Card Transaction (POSAG080393 ~ 603316001)
    if (parts[0].toUpperCase().startsWith('POS')) {
        // For POS, we take the part AFTER the tilde
        return parts[1] ? parts[1].split(' ')[0] : parts[0];
    }

    // Format A: Mobile/M-Pesa (UB2EV5L0FL ~ 631412#2045)
    // For M-Pesa, we take the part BEFORE the tilde
    return parts[0];
};

/**
 * MIDDLEWARE: Dual Auth Validation
 * Supports standard Basic Auth and the 'elara_bank' custom headers.
 */
const authenticateIPN = (req, res, next) => {
    const authHeader = req.headers.authorization;
    let basicUser, basicPass;

    if (authHeader) {
        const base64Credentials = authHeader.split(' ')[1];
        const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
        [basicUser, basicPass] = credentials.split(':');
    }

    const customUser = req.headers['username'];
    const customPass = req.headers['password'];

    const isBasicValid = (basicUser === process.env.IPN_USER && basicPass === process.env.IPN_PASS);
    const isCustomValid = (customUser === 'elara_bank' && customPass === 'BankSafe@2024');

    if (isBasicValid || isCustomValid) {
        next();
    } else {
        console.error("Auth Failed. Headers received:", req.headers);
        res.status(401).json({ Status: "Error", Message: "Unauthorized" });
    }
};

/**
 * ROUTES
 */

// Health Check for Render and UptimeRobot
app.get('/', (req, res) => res.status(200).send('Coop IPN Relay is Online'));

// Main Bank Webhook
app.post('/ipn', authenticateIPN, async (req, res) => {
    const payload = req.body;

    if (!payload || !payload.TransactionId) {
        return res.status(400).json({ Status: "Error", Message: "Missing TransactionId" });
    }

    // New extraction logic using CustMemoLine1
    const finalRef = extractFinalRef(payload.CustMemoLine1, payload.Narration);

    try {
        const { error } = await supabase
            .from('coop_bank_transactions')
            .upsert({
                transaction_id: payload.TransactionId,
                acct_no: payload.AcctNo,
                amount: parseFloat(payload.Amount),
                booked_balance: parseFloat(payload.BookedBalance) || 0,
                cleared_balance: parseFloat(payload.ClearedBalance) || 0,
                currency: payload.Currency,
                narration: payload.Narration,
                payment_ref: payload.PaymentRef,
                transaction_date: payload.TransactionDate,
                final_payment_ref: finalRef, // The extracted M-Pesa or POS ID
                event_type: payload.EventType,
                cust_memo_line1: payload.CustMemoLine1,
                cust_memo_line2: payload.CustMemoLine2,
                cust_memo_line3: payload.CustMemoLine3,
                received_at: new Date().toISOString()
            }, { 
                onConflict: 'transaction_id',
                ignoreDuplicates: true 
            });

        if (error) throw error;

        // Simple JSON response to keep the Bank's XSLT parser happy
        return res.status(200).json({ 
            Status: "Success", 
            Message: "Received",
            TransactionId: payload.TransactionId
        });

    } catch (err) {
        console.error("Supabase Error:", err.message);
        return res.status(500).json({ Status: "Error" });
    }
});

// Port Binding for Render
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server live on port ${PORT}`);
});
