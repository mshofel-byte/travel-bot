const TelegramBot = require("node-telegram-bot-api");
const Anthropic = require("@anthropic-ai/sdk");

// ← שים כאן את הטוקנים שלך
const TELEGRAM_TOKEN = "YOUR_TELEGRAM_BOT_TOKEN";
const ANTHROPIC_API_KEY = "YOUR_ANTHROPIC_API_KEY";

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// שמירת היסטוריית שיחה לכל משתמש
const conversations = {};

const SYSTEM_PROMPT = `אתה סוכן תכנון טיולים מומחה בשם "טיולי". המשתמש רוצה לתכנן טיול באוגוסט.
עזור לו עם:
- טיסות (חברות תעופה, מחירים משוערים, טיפים לחיסכון)
- מלונות (המלצות לפי תקציב, אזור, סגנון)
- השכרת רכב (מה כדאי, מה לבדוק)
- אטרקציות ותוכנית יומית
- טיפים כלליים (ביטוח, מטבע, מזג האוויר)

ענה תמיד בעברית. היה ידידותי וממוקד.
אם המשתמש לא ציין יעד — שאל לאן הוא רוצה לטוס.
השתמש באימוג'י בצורה מתונה כדי להפוך את התשובות לנעימות.
ארגן תשובות ארוכות עם כותרות וסעיפים.`;

// הודעת פתיחה
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  conversations[chatId] = []; // איפוס שיחה

  bot.sendMessage(
    chatId,
    `שלום! אני טיולי ✈️🌍\n\nאני סוכן הטיולים החכם שלך — אעזור לך לתכנן את הטיול המושלם לאוגוסט.\n\n🛫 טיסות\n🏨 מלונות\n🚗 השכרת רכב\n🗺️ אטרקציות\n\nלאן אתה חולם לטוס?`,
    { parse_mode: "Markdown" }
  );
});

// איפוס שיחה
bot.onText(/\/reset/, (msg) => {
  const chatId = msg.chat.id;
  conversations[chatId] = [];
  bot.sendMessage(chatId, "השיחה אופסה! בוא נתחיל מחדש — לאן אתה רוצה לטוס? 🌍");
});

// טיפול בכל הודעה רגילה
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // התעלם מפקודות
  if (!text || text.startsWith("/")) return;

  // אתחול היסטוריה אם אין
  if (!conversations[chatId]) conversations[chatId] = [];

  // הוסף הודעת משתמש להיסטוריה
  conversations[chatId].push({ role: "user", content: text });

  // הצג "מקליד..."
  bot.sendChatAction(chatId, "typing");

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: conversations[chatId],
    });

    const reply = response.content[0].text;

    // הוסף תשובה להיסטוריה
    conversations[chatId].push({ role: "assistant", content: reply });

    // שמור מקסימום 20 הודעות אחרונות (לחסוך זיכרון)
    if (conversations[chatId].length > 20) {
      conversations[chatId] = conversations[chatId].slice(-20);
    }

    bot.sendMessage(chatId, reply, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("Error:", err.message);
    bot.sendMessage(chatId, "אופס, נתקלתי בבעיה. נסה שוב בעוד רגע 🙏");
  }
});

console.log("🤖 סוכן הטיולים פועל! שלח /start בטלגרם להתחלה.");
