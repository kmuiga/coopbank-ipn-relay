import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const BASIC_USER = process.env.BASIC_USER;
const BASIC_PASS = process.env.BASIC_PASS;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

app.post("/ipn", async (req, res) => {
  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith("Basic ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const decoded = Buffer.from(auth.split(" ")[1], "base64").toString();
  const [user, pass] = decoded.split(":");

  if (user !== BASIC_USER || pass !== BASIC_PASS) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/insert_coop_ipn`,
    {
      method: "POST",
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({ payload: req.body })
    }
  );

  if (!response.ok) {
    return res.status(500).json({ message: "Failed to forward IPN" });
  }

  return res.status(204).send();
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Coop IPN relay running on port ${port}`);
});
