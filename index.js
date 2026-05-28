const TelegramBot = require("node-telegram-bot-api");
const Anthropic = require("@anthropic-ai/sdk");
const { Pool } = require("pg");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function initDB() {
  await pool.query(`CREATE TABLE IF NOT EXISTS conversations ( chat_id BIGINT PRIMARY KEY, messages JSONB DEFAULT '[]', updated_at TIMESTAMP DEFAULT NOW() )`);
  console.log("Database ready!");
}

async function getMessages(chatId) {
  const res = await pool.query("SELECT messages FROM conversations WHERE chat_id = $1", [chatId]);
  return res.rows.length > 0 ? res.rows[0].messages : [];
}

async function saveMessages(chatId, messages) {
  await pool.query(
    `INSERT INTO conversations (chat_id, messages, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (chat_id) DO UPDATE SET messages = $2, updated_at = NOW()`,
    [chatId, JSON.stringify(messages)]
  );
}

const SYSTEM_PROMPT = "You are a travel planning expert named Tayyli. Always respond in Hebrew. You have real-time internet access - use web search to find current flight prices, hotels, and attractions. Help with: flights, hotels, car rentals, attractions, daily itineraries, travel tips. Remember everything the user tells you across all conversations. If the user did not mention a destination, ask where they want to fly. Use emojis moderately. Organize long answers with headers and bullet points.";

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await saveMessages(chatId, []);
  bot.sendMessage(chatId, "שלום! אני טיילי בוט הטיולים. אזכור הכל! לאן רוצה לטוס?");
});

bot.onText(/\/reset/, async (msg) => {
  const chatId = msg.chat.id;
  await saveMessages(chatId, []);
  bot.sendMessage(chatId, "השיחה אופסה! לאן רוצה לטוס?");
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith("/")) return;

  bot.sendChatAction(chatId, "typing");

  try {
    const messages = await getMessages(chatId);
    messages.push({ role: "user", content: text });

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: messages,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    });

    const reply = response.content
      .filter(function(block) { return block.type === "text"; })
      .map(function(block) { return block.text; })
      .join("") || "מצטער, נסה שוב.";

    messages.push({ role: "assistant", content: reply });

    if (messages.length > 40) {
      messages.splice(0, messages.length - 40);
    }

    await saveMessages(chatId, messages);

    bot.sendMessage(chatId, reply, { parse_mode: "Markdown" });

  } catch (err) {
    console.error("Error:", err.message);
    bot.sendMessage(chatId, "אופס, משהו השתבש. נסה שוב.");
  }
});

initDB().then(() => {
  console.log("Bot is running with memory!");
});
