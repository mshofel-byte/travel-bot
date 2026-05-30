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
      submitButtonSelector: async () => {},
      checkReadiness: async () => {
        const pg = _self.page;
        await pg.waitForSelector('#tzId', { timeout: 60000 }).catch(async (e) => {
          const inputs = await pg.evaluate(() =>
            [...document.querySelectorAll('input')].map(el => ({
              id: el.id, name: el.name, type: el.type, placeholder: el.placeholder
            }))
          );
          console.log('[discount/mercantile] inputs on page:', JSON.stringify(inputs));
          console.log('[discount/mercantile] URL:', pg.url());
          throw e;
        });
        // Ctrl+A selects existing text, type() replaces it with real keyboard events
        // that React's synthetic event system recognizes
        async function fillField(selector, value) {
          await pg.click(selector);
          await pg.keyboard.down('Control');
          await pg.keyboard.press('KeyA');
          await pg.keyboard.up('Control');
          await pg.type(selector, value, { delay: 80 });
          await new Promise(r => setTimeout(r, 200));
        }
        await fillField('#tzId', credentials.id);
        await fillField('#tzPassword', credentials.password);
        await fillField('#aidnum', credentials.num);
        // Log what's actually in the fields before submitting
        const vals = await pg.evaluate(() => ({
          tzId: document.querySelector('#tzId')?.value,
          aidnum: document.querySelector('#aidnum')?.value,
        }));
        console.log('[discount] field values before submit:', JSON.stringify(vals));
        // Click on #aidnum to focus it, then press Enter to submit
        await pg.click('#aidnum');
        await new Promise(r => setTimeout(r, 1500));
        await pg.keyboard.press('Enter');
        console.log('[discount] form submitted via Enter');
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
