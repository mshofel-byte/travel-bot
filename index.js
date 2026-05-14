const TelegramBot = require("node-telegram-bot-api"); 
const Anthropic = require("@anthropic-ai/sdk");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY; 

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const conversations = {};

const SYSTEM_PROMPT = "You are a travel planning expert named Tayyli. Always respond in Hebrew. You have real-time internet access - use web search to find current flight prices, hotels, and attractions. Help with: flights, hotels, car rentals, attractions, daily itineraries, travel tips. If the user did not mention a destination, ask where they want to fly. Use emojis moderately. Organize long answers with headers and bullet points.";

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  conversations[chatId] = [];
  bot.sendMessage(
    chatId,
    "שלום! אני טיולי ✈️🌍\n\nאני סוכן הטיולים החכם שלך — אעזור לך לתכנן את הטיול המושלם לאוגוסט.\n\n🛫 טיסות\n🏨 מלונות\n🚗 השכרת רכב\n🗺️ אטרקציות\n\nלאן אתה חולם לטוס?",
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/reset/, (msg) => {
  const chatId = msg.chat.id;
  conversations[chatId] = [];
  bot.sendMessage(chatId, "השיחה אופסה! לאן אתה רוצה לטוס? 🌍");
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith("/")) return;

  if (!conversations[chatId]) conversations[chatId] = [];

  conversations[chatId].push({ role: "user", content: text });

  bot.sendChatAction(chatId, "typing");

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: conversations[chatId],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    });

    const reply =
      response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n") || "לא הצלחתי לקבל תשובה, נסה שוב 🙏";

    conversations[chatId].push({ role: "assistant", content: reply });

    if (conversations[chatId].length > 20) {
      conversations[chatId] = conversations[chatId].slice(-20);
    }

    bot.sendMessage(chatId, reply, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("Error:", err.message);
    bot.sendMessage(chatId, "אופס, נתקלתי בבעיה. נסה שוב בעוד רגע 🙏");
  }
});

console.log("Bot is running!");
