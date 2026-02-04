require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// 1. Initialize Supabase
const supabase = createClient(
    process.env.SUPABASE_URL, 
    process.env.SUPABASE_KEY
);

/**
 * HELPER: Extracts the reference code from Coop Bank's tilde-separated narration
 */
const extractFinalRef = (narration) => {
    if (!narration) return null;
    const parts = narration.split('~').map(p => p.trim());

    // Logic: POS transactions usually have the ID in the 2nd slot
    if (parts[0].startsWith('POS') && parts[1]) {
        return parts[1];
    }
    // Mobile/Standard transactions usually have the ID in the 1st slot
    return parts[0];
};

/**
 * MIDDLEWARE: Validates Basic Auth
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
 * ROUTE: Health check (Prevents Render timeouts/failure during deployment)
 */
app.get('/', (req, res) => res.send('IPN Relay is Active'));

/**
 * ROUTE: The actual Bank Webhook
 */
app.post('/ipn', authenticateIPN, async (req, res) => {
    const payload = req.body;

    // Validate payload existence and TransactionId (Ignores health pings)
    if (!payload || !payload.TransactionId) {
        return res.status(400).json({ status: "Error", message: "Incomplete Payload" });
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
                final_payment_ref: finalRef, // Our extracted ID
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

        // Bank success response
        return res.status(200).json({ 
            status: "Success", 
            message: "Transaction Synchronized",
            extracted_id: finalRef 
        });

    } catch (err) {
        console.error("Database Error:", err.message);
        // Returning 500 tells the bank to retry the IPN later
        return res.status(500).json({ status: "Error", message: "Internal Server Error" });
    }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server live on port ${PORT}`);
});
