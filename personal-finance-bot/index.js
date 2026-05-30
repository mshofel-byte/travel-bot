const express = require("express");
const twilio = require("twilio");
const Anthropic = require("@anthropic-ai/sdk");
const { Pool } = require("pg");
const crypto = require("crypto");
const cron = require("node-cron");
const { scrapeAccount } = require("./scraper");

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY; // generate with: openssl rand -hex 32
const PORT = process.env.PORT || 3002;

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ── Encryption ──────────────────────────────────────────────────────────────

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const key = Buffer.from(ENCRYPTION_KEY, "hex");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("hex"), tag.toString("hex"), encrypted.toString("hex")].join(":");
}

function decrypt(enc) {
  const [ivHex, tagHex, dataHex] = enc.split(":");
  const key = Buffer.from(ENCRYPTION_KEY, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}

// ── DB ───────────────────────────────────────────────────────────────────────

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      phone TEXT PRIMARY KEY,
      name TEXT,
      household_id TEXT,
      state TEXT DEFAULT 'new',
      state_data JSONB DEFAULT '{}'
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS households (
      id TEXT PRIMARY KEY,
      invite_code TEXT UNIQUE
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bank_credentials (
      id SERIAL PRIMARY KEY,
      household_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      company_name TEXT NOT NULL,
      credentials_enc TEXT NOT NULL,
      last_sync TIMESTAMP,
      UNIQUE(household_id, company_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      identifier TEXT NOT NULL,
      household_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      account_number TEXT,
      date DATE NOT NULL,
      processed_date DATE,
      amount NUMERIC(12,2) NOT NULL,
      description TEXT,
      memo TEXT,
      category TEXT DEFAULT 'אחר',
      status TEXT DEFAULT 'completed',
      PRIMARY KEY (identifier, household_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS budgets (
      household_id TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'total',
      amount NUMERIC(10,2) NOT NULL,
      month INT NOT NULL,
      year INT NOT NULL,
      PRIMARY KEY (household_id, category, month, year)
    )
  `);
  console.log("Database ready!");
}

async function getUser(phone) {
  const res = await pool.query("SELECT * FROM users WHERE phone = $1", [phone]);
  return res.rows[0] || null;
}

async function saveUser(phone, data) {
  await pool.query(
    `INSERT INTO users (phone, name, household_id, state, state_data)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (phone) DO UPDATE SET name=$2, household_id=$3, state=$4, state_data=$5`,
    [phone, data.name || null, data.household_id || null, data.state || "new", JSON.stringify(data.state_data || {})]
  );
}

// ── Banks config ─────────────────────────────────────────────────────────────

const COMPANIES = {
  discount:   { name: "בנק דיסקונט",         fields: ["id (תעודת זהות)", "password (סיסמה)", "num (קוד מזהה)"], keys: ["id", "password", "num"] },
  mercantile: { name: "מרכנתיל דיסקונט",     fields: ["id (תעודת זהות)", "password (סיסמה)", "num (קוד מזהה)"], keys: ["id", "password", "num"] },
  leumi:      { name: "בנק לאומי",            fields: ["username (שם משתמש)", "password (סיסמה)"],              keys: ["username", "password"] },
  max:        { name: "מקס",                  fields: ["username (שם משתמש)", "password (סיסמה)"],              keys: ["username", "password"] },
  visaCal:    { name: "ויזה כאל",             fields: ["username (שם משתמש)", "password (סיסמה)"],              keys: ["username", "password"] },
};

const COMPANY_LIST = Object.entries(COMPANIES)
  .map(([id, c], i) => `${i + 1}. ${c.name}`)
  .join("\n");

// ── Sync ─────────────────────────────────────────────────────────────────────

const CATEGORY_RULES = [
  { pattern: /שופרסל|רמי לוי|ויקטורי|מגה|סיטי מרקט|יינות ביתן|AM:PM|פרש מרקט|קרפור|מינימרקט|מכולת|קו.?אופ|שוק ה?עיר|שוק מ|מחסני השוק/i, category: "מזון וסופרמרקט" },
  { pattern: /פז|דלק|סונול|כיבד|אורן|גז סטציה|תחנת דלק/i, category: "דלק ורכב" },
  { pattern: /מסעדה|שווארמה|פיצה|סושי|בורגר|מקדונלד|ארומה|קפה|קפה קפה|גרג|תבלין|שניצל|בית קפה/i, category: "מסעדות וקפה" },
  { pattern: /מכבי|כללית|לאומית|קופת חולים|רפואה|בית מרקחת|סופר פארם|NEW PHARM|פארם|רוקח|שיניים|פיזיו|ד"ר |דר'/i, category: "בריאות ורפואה" },
  { pattern: /זארה|H&M|קסטרו|פוקס|גולברי|רנואר|בגד|נעל|אופנה|ביגוד/i, category: "ביגוד ואופנה" },
  { pattern: /HOT|yes|NETFLIX|SPOTIFY|APPLE|GOOGLE|אמזון|AMAZON|בידור|קולנוע|תיאטרון/i, category: "בידור ומנויים" },
  { pattern: /רב.?קו|אוטובוס|רכבת|מונית|UBER|GETT|גט|תחבורה|חניה|HOPON|הופ.?אן|דן לינקס|אגד|מטרופולין/i, category: "תחבורה" },
  { pattern: /חשמל|מים|גז|בזק|סלקום|פרטנר|HOT MOBILE|019|012|תשתית|ארנונה|שירותי גלישה|אינטרנט בטוח/i, category: "חשבונות ותשתיות" },
  { pattern: /גן |בית ספר|אוניברסיטה|מכללה|לימוד|חינוך|שכר לימוד|סטימצקי|ספרים|תגבור/i, category: "חינוך" },
  { pattern: /ביטוח|מגדל|הראל|כלל|מנורה|הפניקס/i, category: "ביטוח" },
  { pattern: /AMAZON|ALIEXPRESS|אמזון|אלי|שופינג|קניון|KSP|קיי.?אס.?פי|טוילנד|תינוקות|צעצוע|חנות ספר/i, category: "קניות" },
  { pattern: /BIT|ביט|העברה|PayBox|פייבוקס/i, category: "העברות כסף" },
  { pattern: /תרומ|צדקה|מוסדות|בית כנסת|ישיבה|עמותה/i, category: "תרומות" },
];

function autoCategory(description) {
  if (!description) return "אחר";
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(description)) return rule.category;
  }
  return "אחר";
}

async function syncAccount(householdId, companyId, credsEnc) {
  const credentials = JSON.parse(decrypt(credsEnc));
  const startDate = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
  const accounts = await scrapeAccount(companyId, credentials, startDate);

  let count = 0;
  for (const account of accounts) {
    for (const txn of account.txns) {
      const id = `${companyId}_${account.accountNumber}_${txn.identifier || txn.date + "_" + txn.chargedAmount + "_" + (txn.description || "")}`;
      const category = autoCategory(txn.description);
      await pool.query(
        `INSERT INTO transactions
           (identifier, household_id, company_id, account_number, date, processed_date, amount, description, memo, category, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (identifier, household_id) DO NOTHING`,
        [
          id, householdId, companyId, account.accountNumber,
          txn.date.split("T")[0],
          txn.processedDate ? txn.processedDate.split("T")[0] : null,
          txn.chargedAmount,
          txn.description,
          txn.memo || null,
          category,
          txn.status || "completed",
        ]
      );
      count++;
    }
  }

  await pool.query(
    "UPDATE bank_credentials SET last_sync = NOW() WHERE household_id=$1 AND company_id=$2",
    [householdId, companyId]
  );
  return count;
}

async function syncAllHousehold(householdId) {
  const res = await pool.query(
    "SELECT company_id, company_name, credentials_enc FROM bank_credentials WHERE household_id=$1",
    [householdId]
  );
  const results = [];
  for (const row of res.rows) {
    try {
      const count = await syncAccount(householdId, row.company_id, row.credentials_enc);
      results.push({ company: row.company_name, transactions: count, success: true });
    } catch (err) {
      results.push({ company: row.company_name, error: err.message, success: false });
    }
  }
  return results;
}

// ── Finance helpers ───────────────────────────────────────────────────────────

async function getSummary(householdId, month, year) {
  const m = month || new Date().getMonth() + 1;
  const y = year || new Date().getFullYear();

  const byCategory = await pool.query(
    `SELECT category, SUM(amount) AS total FROM transactions
     WHERE household_id=$1 AND amount < 0
       AND EXTRACT(MONTH FROM date)=$2 AND EXTRACT(YEAR FROM date)=$3
     GROUP BY category ORDER BY total ASC`,
    [householdId, m, y]
  );
  const incomeRow = await pool.query(
    `SELECT SUM(amount) AS total FROM transactions
     WHERE household_id=$1 AND amount > 0
       AND EXTRACT(MONTH FROM date)=$2 AND EXTRACT(YEAR FROM date)=$3`,
    [householdId, m, y]
  );
  const budgetRow = await pool.query(
    "SELECT amount FROM budgets WHERE household_id=$1 AND category='total' AND month=$2 AND year=$3",
    [householdId, m, y]
  );

  const totalExpenses = Math.abs(byCategory.rows.reduce((s, r) => s + parseFloat(r.total), 0));
  const totalIncome = parseFloat(incomeRow.rows[0]?.total || 0);
  const budget = parseFloat(budgetRow.rows[0]?.amount || 0);

  return {
    month: m, year: y,
    total_income: totalIncome,
    total_expenses: totalExpenses,
    balance: totalIncome - totalExpenses,
    budget,
    budget_remaining: budget ? budget - totalExpenses : null,
    expenses_by_category: byCategory.rows.map((r) => ({
      category: r.category,
      total: Math.abs(parseFloat(r.total)),
    })),
  };
}

async function getTransactions(householdId, month, year, category, limit) {
  const m = month || new Date().getMonth() + 1;
  const y = year || new Date().getFullYear();
  const params = [householdId, m, y];
  let q = `SELECT date, amount, description, category, company_id FROM transactions
           WHERE household_id=$1 AND EXTRACT(MONTH FROM date)=$2 AND EXTRACT(YEAR FROM date)=$3`;
  if (category) { q += ` AND category=$${params.length + 1}`; params.push(category); }
  q += ` ORDER BY date DESC LIMIT ${limit || 15}`;
  const res = await pool.query(q, params);
  return res.rows;
}

async function setBudget(householdId, amount, category, month, year) {
  const m = month || new Date().getMonth() + 1;
  const y = year || new Date().getFullYear();
  await pool.query(
    `INSERT INTO budgets (household_id, category, amount, month, year) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (household_id, category, month, year) DO UPDATE SET amount=$3`,
    [householdId, category || "total", amount, m, y]
  );
  return { success: true };
}

// ── Claude tools ──────────────────────────────────────────────────────────────

const tools = [
  {
    name: "get_summary",
    description: "Get financial summary for a given month",
    input_schema: {
      type: "object",
      properties: {
        month: { type: "integer", description: "Month 1-12" },
        year: { type: "integer" },
      },
    },
  },
  {
    name: "get_transactions",
    description: "Get list of transactions",
    input_schema: {
      type: "object",
      properties: {
        month: { type: "integer" },
        year: { type: "integer" },
        category: { type: "string" },
        limit: { type: "integer" },
      },
    },
  },
  {
    name: "set_budget",
    description: "Set monthly budget",
    input_schema: {
      type: "object",
      properties: {
        amount: { type: "number" },
        category: { type: "string", description: "Category or 'total'" },
        month: { type: "integer" },
        year: { type: "integer" },
      },
      required: ["amount"],
    },
  },
  {
    name: "sync_accounts",
    description: "Sync bank accounts to get latest transactions",
    input_schema: { type: "object", properties: {} },
  },
];

const now = new Date();
const SYSTEM_PROMPT = `אתה עוזר פיננסי אישי בשם כספי. תמיד עני בעברית.
אתה מנתח נתוני בנק אמיתיים ועוזר לנהל תקציב משפחתי.
הצג סכומים בשקלים (₪).
היה ידידותי, תמציתי ועידוד חיסכון.
השתמש באימוג'י במידה וארגן תשובות עם כותרות ורשימות.
התאריך היום: ${now.getDate()}/${now.getMonth()+1}/${now.getFullYear()}.
כאשר המשתמש אומר "החודש" - השתמש בחודש ${now.getMonth()+1} ושנה ${now.getFullYear()} ישירות ללא שאלות הבהרה.
כאשר המשתמש שואל שאלה - תמיד קרא לכלי המתאים מיד ואל תשאל שאלות מיותרות.`;

async function runClaude(householdId, text) {
  const messages = [{ role: "user", content: text }];
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
      const results = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const i = block.input;
        let result;
        if (block.name === "get_summary")      result = await getSummary(householdId, i.month, i.year);
        else if (block.name === "get_transactions") result = await getTransactions(householdId, i.month, i.year, i.category, i.limit);
        else if (block.name === "set_budget")   result = await setBudget(householdId, i.amount, i.category, i.month, i.year);
        else if (block.name === "sync_accounts") result = await syncAllHousehold(householdId);
        results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
      }
      messages.push({ role: "user", content: results });
    } else {
      return response.content.filter((b) => b.type === "text").map((b) => b.text).join("") || "מצטער, נסה שוב.";
    }
  }
}

// ── Setup flow ────────────────────────────────────────────────────────────────

const GREETING_RE = /^(שלום|היי|הי|מה שלומך|מה נשמע|בוקר טוב|ערב טוב|צהריים טוב|לילה טוב|hi|hello|hey)[\s!?.]*$/i;

async function handleSetupFlow(phone, user, text) {
  const { state, state_data: sd } = user;

  if (state === "awaiting_name") {
    if (GREETING_RE.test(text.trim())) {
      await send(phone, "שלום! 😊\n\nאני כספי, הבוט הפיננסי שלך.\nמה שמך? (שלח רק את שמך)");
      return;
    }
    const name = text.trim();
    user.name = name;
    user.state = "awaiting_household";
    await saveUser(phone, user);
    await send(phone, `שלום ${name}! 👋\n\nרוצה לפתוח בית חדש או להצטרף לבית קיים?\n\n1. בית חדש\n2. הכנס קוד הזמנה`);
    return;
  }

  if (state === "awaiting_household") {
    if (text.trim() === "1") {
      const householdId = crypto.randomUUID();
      const inviteCode = Math.random().toString(36).slice(2, 8).toUpperCase();
      await pool.query("INSERT INTO households (id, invite_code) VALUES ($1,$2)", [householdId, inviteCode]);
      user.household_id = householdId;
      user.state = "active";
      await saveUser(phone, user);
      await send(phone, `✅ הבית נפתח!\n\nקוד הזמנה לבן/בת הזוג: *${inviteCode}*\n\nעכשיו בוא נחבר את החשבונות שלך.\nשלח *הוסף חשבון*`);
    } else {
      const code = text.trim().toUpperCase();
      const res = await pool.query("SELECT id FROM households WHERE invite_code=$1", [code]);
      if (!res.rows.length) {
        await send(phone, "קוד לא נמצא. נסה שוב או שלח *1* לפתיחת בית חדש.");
      } else {
        user.household_id = res.rows[0].id;
        user.state = "active";
        await saveUser(phone, user);
        await send(phone, `✅ הצטרפת לבית!\n\nשלח *הוסף חשבון* כדי להוסיף את החשבונות שלך.`);
      }
    }
    return;
  }

  if (state === "adding_bank_select") {
    const ids = Object.keys(COMPANIES);
    const idx = parseInt(text.trim()) - 1;
    if (isNaN(idx) || idx < 0 || idx >= ids.length) {
      await send(phone, "בחר מספר בין 1 ל-" + ids.length);
      return;
    }
    const companyId = ids[idx];
    user.state = "adding_bank_creds";
    user.state_data = { companyId, credValues: [], credIndex: 0 };
    await saveUser(phone, user);
    await send(phone, `חיבור ל*${COMPANIES[companyId].name}*\n\nשלח: ${COMPANIES[companyId].fields[0]}`);
    return;
  }

  if (state === "adding_bank_creds") {
    const { companyId, credValues, credIndex } = sd;
    const company = COMPANIES[companyId];
    credValues.push(text.trim());

    if (credIndex + 1 < company.fields.length) {
      user.state_data = { companyId, credValues, credIndex: credIndex + 1 };
      await saveUser(phone, user);
      await send(phone, `שלח: ${company.fields[credIndex + 1]}`);
    } else {
      const credentials = {};
      company.keys.forEach((k, i) => { credentials[k] = credValues[i]; });
      const credsEnc = encrypt(JSON.stringify(credentials));

      await pool.query(
        `INSERT INTO bank_credentials (household_id, company_id, company_name, credentials_enc)
         VALUES ($1,$2,$3,$4) ON CONFLICT (household_id, company_id) DO UPDATE SET credentials_enc=$4`,
        [user.household_id, companyId, company.name, credsEnc]
      );
      user.state = "active";
      user.state_data = {};
      await saveUser(phone, user);

      await send(phone, `✅ ${company.name} נשמר! מסנכרן... ⏳`);
      try {
        const count = await syncAccount(user.household_id, companyId, credsEnc);
        await send(phone, `✅ ${count} עסקאות נטענו!\n\nשלח *הוסף חשבון* לחשבון נוסף, או שאל כל שאלה פיננסית.`);
      } catch (err) {
        await send(phone, `⚠️ שגיאה בסנכרון: ${err.message}\n\nבדוק את הפרטים ונסה שוב.`);
      }
    }
    return;
  }
}

// ── Webhook ───────────────────────────────────────────────────────────────────

function send(to, body) {
  return twilioClient.messages.create({ from: TWILIO_WHATSAPP_NUMBER, to, body });
}

app.post("/webhook", async (req, res) => {
  res.status(200).send("<Response/>"); // respond immediately so Twilio doesn't timeout
  const from = req.body.From;
  const text = req.body.Body?.trim();
  if (!from || !text) return;

  try {
    let user = await getUser(from);

    if (!user) {
      await saveUser(from, { state: "awaiting_name" });
      await send(from, "שלום! אני כספי 💰 הבוט הפיננסי שלך.\n\nמה שמך?");
      return;
    }

    if (text === "/sync" || text === "סנכרן") {
      await send(from, "מסנכרן חשבונות... ⏳");
      const results = await syncAllHousehold(user.household_id);
      const lines = results.map((r) => r.success ? `✅ ${r.company}: ${r.transactions} עסקאות` : `❌ ${r.company}: ${r.error}`);
      await send(from, "סנכרון הושלם!\n\n" + lines.join("\n"));
      return;
    }

    if (text === "סווג" || text === "/categorize") {
      const rows = await pool.query(
        "SELECT identifier, description FROM transactions WHERE household_id=$1 AND category='אחר'",
        [user.household_id]
      );
      let updated = 0;
      for (const row of rows.rows) {
        const cat = autoCategory(row.description);
        if (cat !== "אחר") {
          await pool.query(
            "UPDATE transactions SET category=$1 WHERE identifier=$2 AND household_id=$3",
            [cat, row.identifier, user.household_id]
          );
          updated++;
        }
      }
      await send(from, `✅ סווגו מחדש ${updated} עסקאות מתוך ${rows.rows.length}.`);
      return;
    }

    if (text === "הוסף חשבון" || text === "/addbank") {
      user.state = "adding_bank_select";
      await saveUser(from, user);
      await send(from, "איזה חשבון להוסיף?\n\n" + COMPANY_LIST);
      return;
    }

    if (text === "הסר חשבון" || text === "/removebank") {
      const res3 = await pool.query(
        "SELECT company_id, company_name FROM bank_credentials WHERE household_id=$1 ORDER BY company_name",
        [user.household_id]
      );
      if (res3.rows.length === 0) {
        await send(from, "אין חשבונות בנק רשומים.");
        return;
      }
      const list = res3.rows.map((r, i) => `${i + 1}. ${r.company_name}`).join("\n");
      user.state = "removing_bank_select";
      user.state_data = { banks: res3.rows };
      await saveUser(from, user);
      await send(from, `איזה חשבון להסיר?\n\n${list}\n\nשלח מספר:`);
      return;
    }

    if (user.state === "removing_bank_select") {
      const { banks } = sd;
      const idx = parseInt(text) - 1;
      if (isNaN(idx) || idx < 0 || idx >= banks.length) {
        await send(from, "מספר לא תקין. נסה שוב.");
        return;
      }
      const bank = banks[idx];
      await pool.query(
        "DELETE FROM bank_credentials WHERE household_id=$1 AND company_id=$2",
        [user.household_id, bank.company_id]
      );
      user.state = "active";
      user.state_data = {};
      await saveUser(from, user);
      await send(from, `✅ החשבון *${bank.company_name}* הוסר.`);
      return;
    }

    if (text === "/invite") {
      const res2 = await pool.query("SELECT invite_code FROM households WHERE id=$1", [user.household_id]);
      await send(from, `קוד הזמנה: *${res2.rows[0]?.invite_code}*\n\nשלח אותו לבן/בת הזוג.`);
      return;
    }

    if (["awaiting_name", "awaiting_household", "adding_bank_select", "adding_bank_creds"].includes(user.state)) {
      await handleSetupFlow(from, user, text);
      return;
    }

    const reply = await runClaude(user.household_id, text);
    await send(from, reply);

  } catch (err) {
    console.error("Webhook error:", err.message);
    try { await send(from, "אופס, משהו השתבש. נסה שוב."); } catch {}
  }
});

app.get("/webhook", (req, res) => res.status(200).send("<Response/>"));
app.get("/health", (req, res) => res.json({ status: "ok" }));

// Daily sync at 7:00 AM
cron.schedule("0 7 * * *", async () => {
  console.log("Running daily sync...");
  const res = await pool.query("SELECT DISTINCT household_id FROM bank_credentials");
  for (const row of res.rows) {
    try {
      await syncAllHousehold(row.household_id);
      console.log(`Synced ${row.household_id}`);
    } catch (err) {
      console.error(`Sync error ${row.household_id}:`, err.message);
    }
  }
});

initDB()
  .then(() => {
    app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("DB init error:", err.message);
    app.listen(PORT, () => console.log(`Bot running on port ${PORT} (DB error - check DATABASE_URL)`));
  });
