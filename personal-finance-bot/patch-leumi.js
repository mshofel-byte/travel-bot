const fs = require('fs');
const f = 'node_modules/israeli-bank-scrapers/lib/scrapers/leumi.js';
let c = fs.readFileSync(f, 'utf8');

// Fix 1: LOGIN_URL → direct login page
c = c.replace(
  "const LOGIN_URL = 'https://www.leumi.co.il/he';",
  "const LOGIN_URL = 'https://hb2.bankleumi.co.il/H/Login.html';"
);

// Fix 2: Broaden Success condition + map login page to InvalidPassword.
const OLD_POSSIBLE = `    [_baseScraperWithBrowser.LoginResults.Success]: [/ebanking\\/SO\\/SPA.aspx/i],`;
const NEW_POSSIBLE = `    [_baseScraperWithBrowser.LoginResults.Success]: [({ value }) => {
      console.log('[leumi] post-login URL:', value);
      return value.includes('hb2.bankleumi.co.il') &&
             !value.includes('/H/Login.html') &&
             !value.includes('/gate-keeper/') &&
             !value.includes('/authenticate');
    }],
    [_baseScraperWithBrowser.LoginResults.InvalidPassword]: [
      async options => {
        if (!options || !options.page) throw new Error('missing page options argument');
        const errorMessage = await (0, _elementsInteractions.pageEvalAll)(options.page, 'svg#Capa_1', '', element => {
          return element[0]?.parentElement?.children[1]?.innerText;
        });
        return !!errorMessage && errorMessage.includes('שגויים');
      },
      ({ value }) => value.includes('/H/Login.html'),
      ({ value }) => value.includes('/gate-keeper/'),
      ({ value }) => value.includes('/authenticate'),
    ],`;

let patched = c.replace(OLD_POSSIBLE, NEW_POSSIBLE);
if (patched === c) {
  console.warn('WARNING: possibleResults patch did not match - skipping');
} else {
  c = patched;
  console.log('Leumi patch 2 applied: broad success URL matching');
}

// Fix 3: Replace waitForPostLogin — poll until URL settles (max 10s).
const OLD_POST_LOGIN = /async function waitForPostLogin\(page\) \{[\s\S]*?\n\}/;
const NEW_POST_LOGIN = `async function waitForPostLogin(page) {
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    const url = page.url();
    if (!url.includes('/H/Login.html') && !url.includes('/gate-keeper/') && !url.includes('/authenticate')) {
      console.log('[leumi] post-login URL:', url);
      return;
    }
  }
  console.log('[leumi] post-login URL (still on auth page):', page.url());
}`;

patched = c.replace(OLD_POST_LOGIN, NEW_POST_LOGIN);
if (patched === c) {
  console.warn('WARNING: waitForPostLogin patch did not match - skipping');
} else {
  c = patched;
  console.log('Leumi patch 3 applied: simple 5s wait for post-login');
}

// Fix 4: Replace getLoginOptions.
// The gate-keeper URL IS the login page — do NOT wait for it to redirect.
// Just wait for inputs to appear on whatever page we land on, then fill them.
const OLD_LOGIN_OPTIONS = /getLoginOptions\(credentials\) \{\s*return \{[\s\S]*?possibleResults: getPossibleLoginResults\(\)\s*\};\s*\}/;

const NEW_LOGIN_OPTIONS = `getLoginOptions(credentials) {
    const _self = this;
    return {
      loginUrl: LOGIN_URL,
      fields: [],
      submitButtonSelector: async () => {},
      checkReadiness: async () => {
        const pg = _self.page;
        console.log('[leumi] checkReadiness start, url:', pg.url());
        // Wait for inputs to appear (works on gate-keeper page which IS the login form)
        await pg.waitForFunction(
          () => document.querySelectorAll('input:not([type="hidden"])').length > 0,
          { timeout: 60000 }
        );
        console.log('[leumi] inputs found, filling username');
        // Fill username via native setter (bypasses React synthetic event system)
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
        await pg.waitForFunction(
          () => document.querySelectorAll('input:not([type="hidden"])').length >= 2,
          { timeout: 30000 }
        );
        console.log('[leumi] filling password');
        // Fill password via native setter
        await pg.evaluate((val) => {
          const inputs = [...document.querySelectorAll('input:not([type="hidden"])')];
          const el = inputs[1];
          const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSet.call(el, val);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, credentials.password);
        await new Promise(r => setTimeout(r, 500));
        // Submit form — click button or press Enter
        const clicked = await pg.evaluate(() => {
          const btn = document.querySelector("button[type='submit']");
          if (btn) { btn.click(); return true; }
          return false;
        });
        console.log('[leumi] submitted via', clicked ? 'button click' : 'Enter key');
        if (!clicked) await pg.keyboard.press('Enter');
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
  console.log('Leumi patch 4 applied: fill on gate-keeper/login page directly');
}

fs.writeFileSync(f, c);
