const express = require("express");
const twilio = require("twilio");
const Anthropic = require("@anthropic-ai/sdk");
const { Pool } = require("pg");

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const PORT = process.env.PORT || 3001;

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      phone TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
      amount NUMERIC(10,2) NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      date DATE DEFAULT CURRENT_DATE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS budgets (
      id SERIAL PRIMARY KEY,
      phone TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'total',
      amount NUMERIC(10,2) NOT NULL,
      month INT NOT NULL,
      year INT NOT NULL,
      UNIQUE(phone, category, month, year)
    )
  `);
  console.log("Database ready!");
}

// --- Tools ---

async function addTransaction(phone, type, amount, category, description, date) {
  const d = date || new Date().toISOString().split("T")[0];
  await pool.query(
    "INSERT INTO transactions (phone, type, amount, category, description, date) VALUES ($1,$2,$3,$4,$5,$6)",
    [phone, type, amount, category, description || "", d]
  );
  return { success: true };
}

async function getSummary(phone, month, year) {
  const m = month || new Date().getMonth() + 1;
  const y = year || new Date().getFullYear();

  const expenses = await pool.query(
    `SELECT category, SUM(amount) as total FROM transactions
     WHERE phone=$1 AND type='expense' AND EXTRACT(MONTH FROM date)=$2 AND EXTRACT(YEAR FROM date)=$3
     GROUP BY category ORDER BY total DESC`,
    [phone, m, y]
  );
  const income = await pool.query(
    `SELECT SUM(amount) as total FROM transactions
     WHERE phone=$1 AND type='income' AND EXTRACT(MONTH FROM date)=$2 AND EXTRACT(YEAR FROM date)=$3`,
    [phone, m, y]
  );
  const budget = await pool.query(
    "SELECT amount FROM budgets WHERE phone=$1 AND category='total' AND month=$2 AND year=$3",
    [phone, m, y]
  );

  const totalExpenses = expenses.rows.reduce((s, r) => s + parseFloat(r.total), 0);
  const totalIncome = parseFloat(income.rows[0]?.total || 0);
  const budgetAmount = parseFloat(budget.rows[0]?.amount || 0);

  return {
    month: m,
    year: y,
    total_income: totalIncome,
    total_expenses: totalExpenses,
    balance: totalIncome - totalExpenses,
    budget: budgetAmount,
    budget_remaining: budgetAmount ? budgetAmount - totalExpenses : null,
    expenses_by_category: expenses.rows.map((r) => ({ category: r.category, total: parseFloat(r.total) })),
  };
}

async function setBudget(phone, amount, month, year) {
  const m = month || new Date().getMonth() + 1;
  const y = year || new Date().getFullYear();
  await pool.query(
    `INSERT INTO budgets (phone, category, amount, month, year) VALUES ($1,'total',$2,$3,$4)
     ON CONFLICT (phone, category, month, year) DO UPDATE SET amount=$2`,
    [phone, amount, m, y]
  );
  return { success: true, month: m, year: y };
}

async function getTransactions(phone, month, year, type, category) {
  const m = month || new Date().getMonth() + 1;
  const y = year || new Date().getFullYear();
  let q = `SELECT type, amount, category, description, date FROM transactions
           WHERE phone=$1 AND EXTRACT(MONTH FROM date)=$2 AND EXTRACT(YEAR FROM date)=$3`;
  const params = [phone, m, y];
  if (type) { q += ` AND type=$${params.length + 1}`; params.push(type); }
  if (category) { q += ` AND category=$${params.length + 1}`; params.push(category); }
  q += " ORDER BY date DESC LIMIT 20";
  const res = await pool.query(q, params);
  return res.rows;
}

// --- Tool definitions for Claude ---

const tools = [
  {
    name: "add_transaction",
    description: "Add an income or expense transaction",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["income", "expense"], description: "Type of transaction" },
        amount: { type: "number", description: "Amount in ILS" },
        category: { type: "string", description: "Category e.g. אוכל, תחבורה, שכר, בידור, חשבונות, בריאות, קניות, אחר" },
        description: { type: "string", description: "Short description" },
        date: { type: "string", description: "Date in YYYY-MM-DD format, defaults to today" },
      },
      required: ["type", "amount", "category"],
    },
  },
  {
    name: "get_summary",
    description: "Get financial summary for a given month",
    input_schema: {
      type: "object",
      properties: {
        month: { type: "integer", description: "Month number 1-12" },
        year: { type: "integer", description: "Year e.g. 2025" },
      },
    },
  },
  {
    name: "set_budget",
    description: "Set monthly budget",
    input_schema: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Budget amount in ILS" },
        month: { type: "integer" },
        year: { type: "integer" },
      },
      required: ["amount"],
    },
  },
  {
    name: "get_transactions",
    description: "Get list of recent transactions",
    input_schema: {
      type: "object",
      properties: {
        month: { type: "integer" },
        year: { type: "integer" },
        type: { type: "string", enum: ["income", "expense"] },
        category: { type: "string" },
      },
    },
  },
];

const SYSTEM_PROMPT = `אתה עוזר פיננסי אישי בשם כספי. תמיד עני בעברית. אתה עוזר לעקוב אחר הוצאות, הכנסות, תקציב ומספק דוחות פיננסיים.

כשמשתמש מזכיר קנייה, תשלום, הוצאה, קבלת כסף, משכורת וכדומה — השתמש בכלים המתאימים כדי לרשום ולדווח.
תמיד אשר את הרישום בצורה ידידותית עם סיכום קצר.
השתמש באימוג'י במידה.
עגל מספרים לשתי ספרות עשרוניות.`;

async function processMessage(phone, text) {
  const messages = [{ role: "user", content: text }];
  let finalReply = "";

  while (true) {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });

      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        let result;
        const i = block.input;
        if (block.name === "add_transaction") result = await addTransaction(phone, i.type, i.amount, i.category, i.description, i.date);
        else if (block.name === "get_summary") result = await getSummary(phone, i.month, i.year);
        else if (block.name === "set_budget") result = await setBudget(phone, i.amount, i.month, i.year);
        else if (block.name === "get_transactions") result = await getTransactions(phone, i.month, i.year, i.type, i.category);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
      }
      messages.push({ role: "user", content: toolResults });
    } else {
      finalReply = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("") || "מצטער, נסה שוב.";
      break;
    }
  }

  return finalReply;
}

app.post("/webhook", async (req, res) => {
  const from = req.body.From;
  const text = req.body.Body;

  if (!from || !text) return res.status(200).send("<Response/>");

  if (text.trim() === "/start") {
    await twilioClient.messages.create({
      from: TWILIO_WHATSAPP_NUMBER,
      to: from,
      body: "שלום! אני כספי 💰 הבוט הפיננסי שלך.\n\nאני יכול לעזור לך לעקוב אחר הוצאות והכנסות, לנהל תקציב ולהציג דוחות.\n\nדוגמאות:\n• \"שילמתי 150 על דלק\"\n• \"קיבלתי משכורת 12000\"\n• \"תקציב חודשי 8000\"\n• \"כמה הוצאתי החודש?\"\n• \"הצג דוח חודש מאי\"",
    });
    return res.status(200).send("<Response/>");
  }

  try {
    const reply = await processMessage(from, text);
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
  app.listen(PORT, () => console.log(`Finance bot running on port ${PORT}`));
});
