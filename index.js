import express from 'express';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const extractFinalRef = (narration) => {
    if (!narration) return null;
    const parts = narration.split('~').map(p => p.trim());
    if (parts[0].toUpperCase().startsWith('POS') && parts[1]) return parts[1];
    return parts[0];
};

const authenticateIPN = (req, res, next) => {
    // Check Basic Auth
    const authHeader = req.headers.authorization;
    let basicUser, basicPass;
    if (authHeader) {
        const credentials = Buffer.from(authHeader.split(' ')[1], 'base64').toString('ascii');
        [basicUser, basicPass] = credentials.split(':');
    }

    // Check Custom Headers (from their Postman collection)
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

app.get('/', (req, res) => res.status(200).send('Relay Active'));

app.post('/ipn', authenticateIPN, async (req, res) => {
    const payload = req.body;
    if (!payload?.TransactionId) return res.status(400).json({ Status: "Error" });

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
                final_payment_ref: finalRef,
                event_type: payload.EventType,
                cust_memo_line1: payload.CustMemoLine1,
                cust_memo_line2: payload.CustMemoLine2,
                cust_memo_line3: payload.CustMemoLine3,
                received_at: new Date().toISOString()
            }, { onConflict: 'transaction_id', ignoreDuplicates: true });

        if (error) throw error;

        // PRECISION: Extremely simple JSON response to avoid XSLT failures
        return res.status(200).json({
            Status: "Success",
            Message: "Received",
            TransactionId: payload.TransactionId
        });

    } catch (err) {
        console.error("DB Error:", err.message);
        return res.status(500).json({ Status: "Error" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Precision IPN Port: ${PORT}`));
