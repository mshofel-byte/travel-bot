const fs = require('fs');
const f = 'node_modules/israeli-bank-scrapers/lib/scrapers/leumi.js';
let c = fs.readFileSync(f, 'utf8');

// Replace the entire navigateToLogin function.
// Old code navigated to the Leumi homepage and looked for a button with selector
// '.enter_account' (formerly '.enter-account a[originaltitle="כניסה לחשבונך"]').
// That button no longer exists after Leumi's site redesign.
// New code navigates directly to the online banking login page.
// Fix LOGIN_URL to skip the homepage entirely
c = c.replace(
  "const LOGIN_URL = 'https://www.leumi.co.il/he';",
  "const LOGIN_URL = 'https://hb2.bankleumi.co.il/H/Login.html';"
);

const OLD_NAVIGATE_FN = /async function navigateToLogin\(page\) \{[\s\S]*?\n\}/;

const NEW_NAVIGATE_FN = `async function navigateToLogin(page) {
  await Promise.all([
    (0, _elementsInteractions.waitUntilElementFound)(page, 'input[autocomplete="username"], input[type="text"]:first-of-type, #uid', true, 60000),
    (0, _elementsInteractions.waitUntilElementFound)(page, 'input[name="password"], input[type="password"]', true, 60000),
  ]);
}`;

const patched = c.replace(OLD_NAVIGATE_FN, NEW_NAVIGATE_FN);

if (patched === c) {
  console.error('ERROR: Leumi navigateToLogin patch did not match');
  process.exit(1);
}

// Also update createLoginFields to use the new input selectors
const patched2 = patched
  .replace(`selector: 'input[placeholder="שם משתמש"]'`, `selector: 'input[autocomplete="username"], input[type="text"]:first-of-type, #uid'`)
  .replace(`selector: 'input[placeholder="סיסמה"]'`, `selector: 'input[name="password"], input[type="password"]'`);

fs.writeFileSync(f, patched2);
console.log('Leumi patch applied successfully');
