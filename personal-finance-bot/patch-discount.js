const fs = require('fs');
const f = 'node_modules/israeli-bank-scrapers/lib/scrapers/discount.js';
let c = fs.readFileSync(f, 'utf8');

// Fix 1: Replace exact success URL array with a function that logs + accepts
// any telebank URL that is not the login page.
const OLD_SUCCESS = "urls[_baseScraperWithBrowser.LoginResults.Success] = [`${BASE_URL}/apollo/retail/#/MY_ACCOUNT_HOMEPAGE`, `${BASE_URL}/apollo/retail2/#/MY_ACCOUNT_HOMEPAGE`, `${BASE_URL}/apollo/retail2/`];";
const NEW_SUCCESS = `urls[_baseScraperWithBrowser.LoginResults.Success] = [({ value }) => {
    console.log('[discount] post-login URL:', value);
    return value.includes('telebank.co.il') && !value.toLowerCase().includes('/login');
  }];`;

let patched = c.replace(OLD_SUCCESS, NEW_SUCCESS);
if (patched === c) {
  console.warn('WARNING: discount success URL patch did not match - skipping');
} else {
  c = patched;
  console.log('Discount patch 1 applied: flexible URL matching with logging');
}

// Fix 2: Replace getLoginOptions to use native setter for React-controlled inputs.
// Standard Puppeteer type() may not trigger React state updates.
const OLD_LOGIN = /getLoginOptions\(credentials\) \{\s*return \{[\s\S]*?possibleResults: getPossibleLoginResults\(\)\s*\};\s*\}/;

const NEW_LOGIN = `getLoginOptions(credentials) {
    const _self = this;
    return {
      loginUrl: \`\${BASE_URL}/login/#/LOGIN_PAGE\`,
      fields: [],
      submitButtonSelector: '.sendBtn',
      checkReadiness: async () => {
        const pg = _self.page;
        await pg.waitForSelector('#tzId', { timeout: 60000 });
        // Use native setter to bypass React's synthetic event system
        await pg.evaluate((id, pwd, num) => {
          function fill(sel, val) {
            const el = document.querySelector(sel);
            if (!el) return;
            const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeSet.call(el, val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          fill('#tzId', id);
          fill('#tzPassword', pwd);
          fill('#aidnum', num);
        }, credentials.id, credentials.password, credentials.num);
      },
      postAction: async () => navigateOrErrorLabel(_self.page),
      possibleResults: getPossibleLoginResults()
    };
  }`;

patched = c.replace(OLD_LOGIN, () => NEW_LOGIN);
if (patched === c) {
  console.warn('WARNING: discount getLoginOptions patch did not match - skipping');
} else {
  c = patched;
  console.log('Discount patch 2 applied: native setter form fill');
}

fs.writeFileSync(f, c);
