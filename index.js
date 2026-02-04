const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// Initialize Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 1. Basic Auth Middleware
const authenticateIPN = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({ status: "Error", message: "Missing Authorization" });
    }

    // "Basic Y29vcGJhbmtfaXBuOlhoNzJwITkwc0UzQFZxTGdUNT=="
    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
    const [username, password] = credentials.split(':');

    // Use environment variables for these!
    if (username === process.env.IPN_USER && password === process.env.IPN_PASS) {
        next();
    } else {
        res.status(401).json({ status: "Error", message: "Invalid Credentials" });
    }
};

// 2. IPN Route
app.post('/ipn', authenticateIPN, async (req, res) => {
    const payload = req.body;

    // 3. Health Check / Empty Payload Guard
    if (!payload || !payload.TransactionId) {
        return res.status(400).json({ 
            status: "Error", 
            message: "Invalid payload: TransactionId missing" 
        });
    }

    try {
        // 4. Idempotent Insert into Supabase
        // We use .select() to check if insertion happened or if it's a retry
        const { data, error } = await supabase
            .from('bank_transactions')
            .upsert({
                transaction_id: payload.TransactionId, // Set as PRIMARY KEY in DB
                amount: parseFloat(payload.Amount),
                account_no: payload.AcctNo,
                currency: payload.Currency,
                narration: payload.Narration,
                payment_ref: payload.PaymentRef,
                raw_payload: payload,
                created_at: new Date()
            }, { 
                onConflict: 'transaction_id',
                ignoreDuplicates: true 
            });

        if (error) throw error;

        // 5. Success Response (Bank Compliant)
        return res.status(200).json({
            status: "Success",
            message: "IPN Received",
            transactionId: payload.TransactionId
        });

    } catch (err) {
        console.error("IPN Processing Error:", err.message);
        
        // Return 500 so the bank knows to retry later
        return res.status(500).json({
            status: "Error",
            message: "Internal Server Error"
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`IPN Handler running on port ${PORT}`));
