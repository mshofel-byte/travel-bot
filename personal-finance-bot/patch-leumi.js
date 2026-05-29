const fs = require('fs');
const f = 'node_modules/israeli-bank-scrapers/lib/scrapers/leumi.js';
let c = fs.readFileSync(f, 'utf8');

// Fix 1: LOGIN_URL → direct login page
c = c.replace(
  "const LOGIN_URL = 'https://www.leumi.co.il/he';",
  "const LOGIN_URL = 'https://hb2.bankleumi.co.il/H/Login.html';"
);

// Fix 2: Replace waitForPostLogin — old selectors no longer exist on the page.
// Simply wait for navigation away from the login page; the base scraper checks
// the resulting URL against possibleResults afterwards.
const OLD_POST_LOGIN = /async function waitForPostLogin\(page\) \{[\s\S]*?\n\}/;
const NEW_POST_LOGIN = `async function waitForPostLogin(page) {
  await page.waitForFunction(
    () => !window.location.href.includes('/H/Login.html'),
    { timeout: 60000 }
  ).catch(() => {});
}`;

let patched = c.replace(OLD_POST_LOGIN, NEW_POST_LOGIN);
if (patched === c) {
  console.warn('WARNING: waitForPostLogin patch did not match - skipping');
} else {
  c = patched;
  console.log('Leumi patch 2 applied: simplified waitForPostLogin');
}

// Fix 3: Replace getLoginOptions to handle the full login flow ourselves.
// Leumi's form is dynamic — password field may only appear after username is typed.
// We fill both fields manually in checkReadiness using index-based selection,
// then the base scraper clicks the submit button.
const OLD_LOGIN_OPTIONS = /getLoginOptions\(credentials\) \{\s*return \{[\s\S]*?possibleResults: getPossibleLoginResults\(\)\s*\};\s*\}/;

const NEW_LOGIN_OPTIONS = `getLoginOptions(credentials) {
    const _self = this;
    return {
      loginUrl: LOGIN_URL,
      fields: [],
      submitButtonSelector: "button[type='submit']",
      checkReadiness: async () => {
        const pg = _self.page;
        // Wait for at least one input to appear
        await pg.waitForFunction(() => document.querySelector('input') !== null, { timeout: 60000 });
        // Fill username via JS eval (bypasses React/Angular clickability checks)
        await pg.evaluate((val) => {
          const inputs = [...document.querySelectorAll('input:not([type="hidden"])')];
          const el = inputs[0];
          const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSet.call(el, val);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, credentials.username);
        // Wait for password field (form may be dynamic)
        await new Promise(r => setTimeout(r, 2000));
        await pg.waitForFunction(() => document.querySelectorAll('input:not([type="hidden"])').length >= 2, { timeout: 30000 });
        // Fill password via JS eval
        await pg.evaluate((val) => {
          const inputs = [...document.querySelectorAll('input:not([type="hidden"])')];
          const el = inputs[1];
          const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSet.call(el, val);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, credentials.password);
      },
      postAction: async () => waitForPostLogin(_self.page),
      possibleResults: getPossibleLoginResults()
    };
  }`;

patched = c.replace(OLD_LOGIN_OPTIONS, () => NEW_LOGIN_OPTIONS);
if (patched === c) {
  console.warn('WARNING: getLoginOptions patch did not match - skipping');
} else {
  c = patched;
  console.log('Leumi patch 3 applied: custom login flow with index-based field selection');
}

fs.writeFileSync(f, c);
