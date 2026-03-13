import express from 'express';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(express.json());

app.get('/', (req, res) => res.status(200).send('Coop IPN Relay is Online'));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const authenticateIPN = (req, res, next) => {
    const authHeader = req.headers.authorization;
    let basicUser, basicPass;
    if (authHeader) {
        const credentials = Buffer.from(authHeader.split(' ')[1], 'base64').toString('ascii');
        [basicUser, basicPass] = credentials.split(':');
    }

    const isBasicValid = (basicUser === process.env.IPN_USER && basicPass === process.env.IPN_PASS);
    const isCustomValid = (req.headers['username'] === 'elara_bank' && req.headers['password'] === 'BankSafe@2024');

    if (isBasicValid || isCustomValid) {
        next();
    } else {
        res.status(401).json({ "Status": "Error", "Message": "Unauthorized" });
    }
};

app.post('/', authenticateIPN, async (req, res) => {
    const payload = req.body;
    try {
        const { error } = await supabase.from('coop_bank_transactions').upsert({
            transaction_id: payload.TransactionId,
            acct_no: payload.AcctNo,
            amount: parseFloat(payload.Amount),
            narration: payload.Narration,
            transaction_date: payload.TransactionDate,
            received_at: new Date().toISOString()
        }, { onConflict: 'transaction_id' });

        if (error) throw error;
        res.status(200).json({ "Status": "Success", "Message": "Received" });
    } catch (err) {
        res.status(500).json({ "Status": "Error", "Message": err.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server live on ${PORT}`));
