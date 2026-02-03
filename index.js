import express from "express";
import bodyParser from "body-parser";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(bodyParser.json());

app.post("/ipn", async (req, res) => {
  try {
    // ------------------------
    // Basic Auth
    // ------------------------
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

    // ------------------------
    // Cron ping (empty JSON)
    // ------------------------
    if (!body || Object.keys(body).length === 0) {
      return res.status(200).json({
        MessageCode: "200",
        Message: "Ping received"
      });
    }

    // ------------------------
    // Validate real IPN
    // ------------------------
    if (!body.TransactionId) {
      return res.status(400).json({
        MessageCode: "400",
        Message: "Missing required field TransactionId"
      });
    }

    // ------------------------
    // Create Supabase client ONLY when needed
    // ------------------------
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

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
        transaction_id: body.TransactionId
      });

    if (error) {
      console.error("Supabase error:", error);
      return res.status(500).json({
        MessageCode: "500",
        Message: "Database error"
      });
    }

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`IPN relay running on port ${PORT}`);
});
