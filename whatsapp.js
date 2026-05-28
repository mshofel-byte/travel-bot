const express = require("express");
const twilio = require("twilio");
const Anthropic = require("@anthropic-ai/sdk");
const { Pool } = require("pg");

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_conversations (
      phone TEXT PRIMARY KEY,
      messages JSONB DEFAULT '[]',
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  console.log("Database ready!");
}

async function getMessages(phone) {
  const res = await pool.query("SELECT messages FROM whatsapp_conversations WHERE phone = $1", [phone]);
  return res.rows.length > 0 ? res.rows[0].messages : [];
}

async function saveMessages(phone, messages) {
  await pool.query(
    `INSERT INTO whatsapp_conversations (phone, messages, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (phone) DO UPDATE SET messages = $2, updated_at = NOW()`,
    [phone, JSON.stringify(messages)]
  );
}

const SYSTEM_PROMPT = "You are a travel planning expert named Tayyli. Always respond in Hebrew. You have real-time internet access - use web search to find current flight prices, hotels, and attractions. Help with: flights, hotels, car rentals, attractions, daily itineraries, travel tips. Remember everything the user tells you across all conversations. If the user did not mention a destination, ask where they want to fly. Use emojis moderately. Organize long answers with headers and bullet points.";

app.post("/webhook", async (req, res) => {
  const from = req.body.From;
  const text = req.body.Body;

  if (!from || !text) {
    return res.status(200).send("<Response/>");
  }

  if (text.trim() === "/reset") {
    await saveMessages(from, []);
    await twilioClient.messages.create({
      from: TWILIO_WHATSAPP_NUMBER,
      to: from,
      body: "השיחה אופסה! לאן רוצה לטוס? ✈️",
    });
    return res.status(200).send("<Response/>");
  }

  try {
    const messages = await getMessages(from);
    messages.push({ role: "user", content: text });

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: messages,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    });

    const reply = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("") || "מצטער, נסה שוב.";

    messages.push({ role: "assistant", content: reply });

    if (messages.length > 40) {
      messages.splice(0, messages.length - 40);
    }

    await saveMessages(from, messages);

    await twilioClient.messages.create({
      from: TWILIO_WHATSAPP_NUMBER,
      to: from,
      body: reply,
    });

  } catch (err) {
    console.error("Error:", err.message);
    await twilioClient.messages.create({
      from: TWILIO_WHATSAPP_NUMBER,
      to: from,
      body: "אופס, משהו השתבש. נסה שוב.",
    });
  }

  res.status(200).send("<Response/>");
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`WhatsApp bot running on port ${PORT}`);
  });
});
