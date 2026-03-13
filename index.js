const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// 1. Initialize Supabase
const supabase = createClient(
    process.env.SUPABASE_URL, 
    process.env.SUPABASE_KEY
);

// 2. Precision Extractors
const extractors = {
    finalRef: (memo1, narration) => {
        if (!memo1 || !narration) return null;
        const isPos = memo1.toUpperCase().startsWith('POS');
        if (isPos) {
            const posMatch = narration.match(/~([0-9]{12})/);
            return posMatch ? posMatch[1] : memo1.split('~')[1]?.trim();
        }
        return memo1.split('~')[0]?.trim();
    },
    tenantName: (memo3, isPos) => {
        if (isPos || !memo3) return null;
        return memo3.replace(/^[0-9]+~/, '').trim();
    },
    tenantMobile: (narration) => {
        if (!narration) return null;
        const mobileMatch = narration.match(/254([0-9]{9})/);
        return mobileMatch ? `0${mobileMatch[1]}` : null;
    }
};

// 3. Auth Middleware
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

// 4. Routes (Consolidated for speed)
app.get('/', (req, res) => {
    res.status(200).send('Coop IPN Relay is Online');
});

app.post('/', authenticateIPN, async (req, res) => {
    const payload = req.body;
    if (!payload || !payload.TransactionId) {
        return res.status(400).json({ "Status": "Error", "Message": "Invalid Payload" });
    }

    const isPos = payload.CustMemoLine1?.toUpperCase().startsWith('POS');
    const finalRef = extractors.finalRef(payload.CustMemoLine1, payload.Narration);
    const tName = extractors.tenantName(payload.CustMemoLine3, isPos);
    const tMobile = extractors.tenantMobile(payload.Narration);

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
                tenant_name: tName,
                tenant_mobile: tMobile,
                event_type: payload.EventType,
                cust_memo_line1: payload.CustMemoLine1,
                cust_memo_line2: payload.CustMemoLine2,
                cust_memo_line3: payload.CustMemoLine3,
                received_at: new Date().toISOString()
            }, { onConflict: 'transaction_id' });

        if (error) throw error;
        return res.status(200).json({ "Status": "Success", "Message": "Received" });
    } catch (err) {
        console.error("Supabase Error:", err.message);
        return res.status(500).json({ "Status": "Error", "Message": "Internal Server Error" });
    }
});

// 5. Port binding
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Relay active on port ${PORT}`);
});
