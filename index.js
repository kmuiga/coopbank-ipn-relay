// File: index.js
import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch"; // optional, only if you plan to forward pings

// ------------------------
// Initialize App
// ------------------------
const app = express();
app.use(bodyParser.json());

// ------------------------
// Supabase Setup (if needed)
// ------------------------
import { createClient } from "@supabase/supabase-js";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ------------------------
// POST /ipn Handler
// ------------------------
app.post("/ipn", async (req, res) => {
  try {
    // 1. Basic Auth
    const auth = req.headers.authorization || "";
    const base64 = auth.split(" ")[1] || "";
    const [user, pass] = Buffer.from(base64, "base64")
      .toString()
      .split(":");

    if (user !== "coopbank_ipn" || pass !== "Xh72p!90sE3@VqLgT5") {
      return res.status(401).json({
        MessageCode: "401",
        Message: "Unauthorized"
      });
    }

    const body = req.body;

    // 2. Handle cron ping (empty JSON)
    if (!body || Object.keys(body).length === 0) {
      return res.status(200).json({
        MessageCode: "200",
        Message: "Ping received"
      });
    }

    // 3. Validate real IPN
    if (!body.TransactionId) {
      return res.status(400).json({
        MessageCode: "400",
        Message: "Missing required field TransactionId"
      });
    }

    // 4. Insert into Supabase (only real IPN)
    const { error } = await supabase
      .from("coop_bank_transactions")
      .insert({
        acct_no: body.AcctNo,
        amount: Number(body.Amount),
        booked_balance: body.BookedBalance,
        cleared_balance: body.ClearedBalance,
        currency: body.Currency,
        cust_memo_line1: body.CustMemoLine1,
        cust_memo_line2: body.CustMemoLine2,
        cust_memo_line3: body.CustMemoLine3,
        event_type: body.EventType,
        exchange_rate: body.ExchangeRate,
        narration: body.Narration,
        payment_ref: body.PaymentRef,
        posting_date: body.PostingDate,
        value_date: body.ValueDate,
        transaction_date: body.TransactionDate,
        transaction_id: body.TransactionId,
      });

    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(500).json({
        MessageCode: "500",
        Message: "Database error"
      });
    }

    // 5. Success
    return res.status(200).json({
      MessageCode: "200",
      Message: "Successfully received data"
    });

  } catch (err) {
    console.error("IPN Error:", err);
    return res.status(500).json({
      MessageCode: "500",
      Message: "Internal server error"
    });
  }
});

// ------------------------
// Optional: Self-ping to prevent sleeping
// ------------------------
setInterval(() => {
  fetch("https://coopbank-ipn-relay.onrender.com/ipn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  }).catch(() => {});
}, 10 * 60 * 1000); // every 10 minutes

// ------------------------
// Start Server
// ------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`IPN relay running on port ${PORT}`);
});
