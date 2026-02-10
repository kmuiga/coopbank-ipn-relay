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
 */
const extractFinalRef = (memoLine, narration) => {
    const source = memoLine || narration;
    if (!source) return null;
    const parts = source.split('~').map(p => p.trim());
    if (parts.length === 0) return null;

    if (parts[0].toUpperCase().startsWith('POS')) {
        return parts[1] ? parts[1].split(' ')[0] : parts[0];
    }
    return parts[0];
};

/**
 * MIDDLEWARE: Dual Auth Validation
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
        res.status(401).json({ Status: "Error", Message: "Unauthorized" });
    }
};

/**
 * ROUTES
 * We now use the root '/' to match the Bank's current configuration.
 */
app.route('/')
    .get((req, res) => {
        // Keeps UptimeRobot happy
        res.status(200).send('Coop IPN Relay is Online');
    })
    .post(authenticateIPN, async (req, res) => {
        const payload = req.body;

        if (!payload || !payload.TransactionId) {
            return res.status(400).json({ Status: "Error", Message: "Missing TransactionId" });
        }

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
                    final_payment_ref: finalRef,
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

            // BANK REQUIREMENT: Only Status and Message
            return res.status(200).json({ 
                "Status": "Success", 
                "Message": "Received"
            });

        } catch (err) {
            console.error("Supabase Error:", err.message);
            return res.status(500).json({ "Status": "Error", "Message": "Internal Server Error" });
        }
    });

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server live on port ${PORT}`);
});
