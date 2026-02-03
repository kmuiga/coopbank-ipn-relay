import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch"; // optional if you forward

const app = express();
app.use(bodyParser.json());

app.post("/ipn", async (req, res) => {
  try {
    // 1. Basic Auth check (already in Postman)
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

    // 2. Validate JSON payload
    const body = req.body;
    if (!body || !body.TransactionId) {
      return res.status(400).json({
        MessageCode: "400",
        Message: "Missing required field TransactionId"
      });
    }

    // 3. Insert into Supabase (pseudo-code)
    // await supabase.from("coop_bank_transactions").insert({ ...body });

    // 4. Return success JSON
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

app.listen(process.env.PORT || 3000, () => {
  console.log("IPN relay running");
});
