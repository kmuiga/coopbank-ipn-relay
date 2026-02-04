import express from 'express';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(express.json());

// 1. Initialize Supabase
// Render injects SUPABASE_URL and SUPABASE_KEY directly into the environment
const supabase = createClient(
    process.env.SUPABASE_URL, 
    process.env.SUPABASE_KEY
);

/**
 * HELPER: Extracts the core reference ID from Coop Bank's tilde narration.
 * Example: TI28ZF3AQY~631412 -> TI28ZF3AQY
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
 * MIDDLEWARE: Validates the bank's Basic Auth using Env Variables
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

// 1. Health Check (Required for Render's zero-downtime deploys)
app.get('/', (req, res) => res.status(200).send('Coop IPN Relay is Online'));

// 2. The Bank Webhook Endpoint
app.post('/ipn', authenticateIPN, async (req, res) => {
    const payload = req.body;

    // Validate payload existence (prevents crashing on empty pings)
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
                final_payment_ref: finalRef, // Our extracted M-Pesa/Ref code
                event_type: payload.EventType,
                cust_memo_line1: payload.CustMemoLine1,
                cust_memo_line2: payload.CustMemoLine2,
                cust_memo_line3: payload.CustMemoLine3,
                received_at: new Date().toISOString()
            }, { 
                onConflict: 'transaction_id', // Prevents double-counting if the bank retries
                ignoreDuplicates: true 
            });

        if (error) throw error;

        // Return 200/OK so the bank stops retrying the IPN
        return res.status(200).json({ 
            status: "Success", 
            message: "IPN Accepted",
            extracted_id: finalRef 
        });

    } catch (err) {
        console.error("Supabase Error:", err.message);
        // Returning 500 tells the bank to try sending the IPN again later
        return res.status(500).json({ status: "Error", message: "Server busy" });
    }
});

/**
 * SERVER START
 * '0.0.0.0' is required for Render to discover your app's port.
 */
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server live on port ${PORT}`);
});
