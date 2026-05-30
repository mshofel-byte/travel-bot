const fs = require('fs');
const f = 'node_modules/israeli-bank-scrapers/lib/scrapers/discount.js';
let c = fs.readFileSync(f, 'utf8');

// Fix 1: Broaden success URL + log actual URL.
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

// Fix 2: Replace getLoginOptions to use click+type (simulates real user input
// and triggers React state updates better than native setter alone).
const OLD_LOGIN = /getLoginOptions\(credentials\) \{\s*return \{[\s\S]*?possibleResults: getPossibleLoginResults\(\)\s*\};\s*\}/;

const NEW_LOGIN = `getLoginOptions(credentials) {
    const _self = this;
    return {
      loginUrl: \`\${BASE_URL}/login/#/LOGIN_PAGE\`,
      fields: [],
      submitButtonSelector: null,
      checkReadiness: async () => {
        const pg = _self.page;
        await pg.waitForSelector('#tzId', { timeout: 60000 });
        // Triple-click to select all existing text, then type to replace
        await pg.click('#tzId', { clickCount: 3 });
        await pg.type('#tzId', credentials.id, { delay: 60 });
        await new Promise(r => setTimeout(r, 300));
        await pg.click('#tzPassword', { clickCount: 3 });
        await pg.type('#tzPassword', credentials.password, { delay: 60 });
        await new Promise(r => setTimeout(r, 300));
        await pg.click('#aidnum', { clickCount: 3 });
        await pg.type('#aidnum', credentials.num, { delay: 60 });
        // Wait for React to process inputs and enable submit
        await new Promise(r => setTimeout(r, 1500));
        // Submit by pressing Enter
        await pg.keyboard.press('Enter');
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
  console.log('Discount patch 2 applied: click+type form fill');
}

fs.writeFileSync(f, c);
