import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(express.json());

// 1. Initialize Supabase
// Ensure these variables are in your Render "Environment" tab
const supabase = createClient(
    process.env.SUPABASE_URL, 
    process.env.SUPABASE_KEY
);

/**
 * HELPER: Extracts the core reference ID from Coop Bank's tilde narration.
 */
const extractFinalRef = (narration) => {
    if (!narration) return null;
    const parts = narration.split('~').map(p => p.trim());

    // Logic for POS: "POSAG033732~524417002625" -> returns 524417002625
    if (parts[0].startsWith('POS') && parts[1]) {
        return parts[1];
    }
    // Logic for Mobile/M-Pesa: "TI28ZF3AQY~631412" -> returns TI28ZF3AQY
    return parts[0];
};

/**
 * MIDDLEWARE: Validates the bank's Basic Auth
 */
const authenticateIPN = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ status: "Error", message: "Unauthorized" });

    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
    const [username, password] = credentials.split(':');

    if (username === process.env.IPN_USER && password === process.env.IPN_PASS) {
        next();
    } else {
        res.status(401).json({ status: "Error", message: "Invalid credentials" });
    }
};

/**
 * ROUTES
 */

// Health Check for Render
app.get('/', (req, res) => res.status(200).send('IPN Relay Active'));

// Bank Webhook Endpoint
app.post('/ipn', authenticateIPN, async (req, res) => {
    const payload = req.body;

    // Safety: Ignore empty/health check pings from the bank
    if (!payload || !payload.TransactionId) {
        return res.status(400).json({ status: "Error", message: "Missing TransactionId" });
    }

    const finalRef = extractFinalRef(payload.Narration);

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
                final_payment_ref: finalRef, // The extracted ID
                event_type: payload.EventType,
                cust_memo_line1: payload.CustMemoLine1,
                cust_memo_line2: payload.CustMemoLine2,
                cust_memo_line3: payload.CustMemoLine3,
                received_at: new Date().toISOString()
            }, { 
                onConflict: 'transaction_id', // Prevents duplicates on retry
                ignoreDuplicates: true 
            });

        if (error) throw error;

        // Return 200/201 to the bank so they stop retrying
        return res.status(200).json({ 
            status: "Success", 
            message: "IPN Accepted",
            extracted_id: finalRef 
        });

    } catch (err) {
        console.error("Supabase Error:", err.message);
        return res.status(500).json({ status: "Error", message: "Retry Later" });
    }
});

// Port Binding for Render
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
});
