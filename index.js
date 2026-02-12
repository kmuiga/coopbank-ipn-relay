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
 * LEAD DEVELOPER PRECISION EXTRACTORS
 */
const extractors = {
    // FIX: Extracts the 12-digit POS ref from Narration (Format B)
    finalRef: (memo1, narration) => {
        if (!memo1 || !narration) return null;
        const isPos = memo1.toUpperCase().startsWith('POS');
        
        if (isPos) {
            // Logic: Find the 12-digit sequence following the first tilde in Narration
            const posMatch = narration.match(/~([0-9]{12})/);
            return posMatch ? posMatch[1] : memo1.split('~')[1]?.trim();
        }
        // M-Pesa format (Format A): Take part before the first tilde
        return memo1.split('~')[0]?.trim();
    },

    // Extract Name: Strips '2~' or '22~' from CustMemoLine3 (Non-POS only)
    tenantName: (memo3, isPos) => {
        if (isPos || !memo3) return null;
        // Removes any leading numbers followed by a tilde (e.g., 2~ or 22~)
        return memo3.replace(/^[0-9]+~/, '').trim();
    },

    // Extract Mobile: Converts 254... to 07... from Narration
    tenantMobile: (narration) => {
        if (!narration) return null;
        // Matches a 12-digit number starting with 254
        const mobileMatch = narration.match(/254([0-9]{9})/);
        return mobileMatch ? `0${mobileMatch[1]}` : null;
    }
};

/**
 * MIDDLEWARE: Dual Auth Validation (Handles both Standard & Custom Bank Headers)
 */
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

/**
 * ROUTES
 * We use the root '/' to match the Bank's current configuration.
 */
app.route('/')
    .get((req, res) => {
        // Keeps UptimeRobot happy and the server "warm"
        res.status(200).send('Coop IPN Relay is Online');
    })
    .post(authenticateIPN, async (req, res) => {
        const payload = req.body;

        // Basic payload validation
        if (!payload || !payload.TransactionId) {
            return res.status(400).json({ "Status": "Error", "Message": "Invalid Payload" });
        }

        // Apply Precision Extraction
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
                }, { 
                    onConflict: 'transaction_id'
                });

            if (error) throw error;

            // BANK REQUIREMENT: Exact Two-Field Response for Tibco XSLT
            return res.status(200).json({ 
                "Status": "Success", 
                "Message": "Received"
            });

        } catch (err) {
            console.error("Supabase Error:", err.message);
            // Even on internal error, we return the structure the bank expects
            return res.status(500).json({ "Status": "Error", "Message": "Internal Server Error" });
        }
    });

// Port binding for Render
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Precision IPN Server live on port ${PORT}`);
});
