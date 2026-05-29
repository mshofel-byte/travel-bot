const fs = require('fs');
const f = 'node_modules/israeli-bank-scrapers/lib/scrapers/leumi.js';
let c = fs.readFileSync(f, 'utf8');

// Fix 1: skip the broken homepage button — navigate directly to the login page
c = c.replace(
  /const loginButtonSelector = '\.enter_account';[\s\S]*?waitUntil: 'networkidle2'\s*\}\);/,
  "await page.goto('https://hb2.bankleumi.co.il/H/Login.html', {waitUntil:'networkidle2',timeout:60000});"
);

// Fix 2: update login field selectors (Leumi redesigned their login form)
c = c.replace(
  `selector: 'input[placeholder="שם משתמש"]'`,
  `selector: 'input[name="uid"], input[id="uid"]'`
);
c = c.replace(
  `selector: 'input[placeholder="סיסמה"]'`,
  `selector: 'input[name="password"], input[type="password"]'`
);

// Fix 3: update the waitForLogin readiness check to match new selectors
c = c.replace(
  `await Promise.all([(0, _elementsInteractions.waitUntilElementFound)(page, 'input[placeholder="שם משתמש"]', true), (0, _elementsInteractions.waitUntilElementFound)(page, 'input[placeholder="סיסמה"]', true), (0, _elementsInteractions.waitUntilElementFound)(page, 'button[type="submit"]', true)]);`,
  `await Promise.all([(0, _elementsInteractions.waitUntilElementFound)(page, 'input[name="uid"], input[id="uid"]', true, 60000), (0, _elementsInteractions.waitUntilElementFound)(page, 'input[name="password"], input[type="password"]', true, 60000)]);`
);

fs.writeFileSync(f, c);
console.log('Leumi patch applied: new login URL + updated selectors');
