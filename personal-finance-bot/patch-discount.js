const fs = require('fs');
const f = 'node_modules/israeli-bank-scrapers/lib/scrapers/discount.js';
let c = fs.readFileSync(f, 'utf8');

// Fix 1: Broaden success URL + map the login page itself to InvalidPassword.
// After wrong credentials, telebank.co.il stays on /login/#/LOGIN_PAGE (inline
// React error — no full navigation to masterPage.html). We must handle that URL
// so it returns InvalidPassword instead of UNKNOWN_ERROR.
const OLD_SUCCESS = "urls[_baseScraperWithBrowser.LoginResults.Success] = [`${BASE_URL}/apollo/retail/#/MY_ACCOUNT_HOMEPAGE`, `${BASE_URL}/apollo/retail2/#/MY_ACCOUNT_HOMEPAGE`, `${BASE_URL}/apollo/retail2/`];\n  urls[_baseScraperWithBrowser.LoginResults.InvalidPassword] = [`${BASE_URL}/apollo/core/templates/lobby/masterPage.html#/LOGIN_PAGE`];";
const NEW_SUCCESS = `urls[_baseScraperWithBrowser.LoginResults.Success] = [({ value }) => {
    return value.includes('telebank.co.il') && !value.toLowerCase().includes('/login');
  }];
  urls[_baseScraperWithBrowser.LoginResults.InvalidPassword] = [
    \`\${BASE_URL}/apollo/core/templates/lobby/masterPage.html#/LOGIN_PAGE\`,
    ({ value }) => value.toLowerCase().includes('/login/#/login_page')
  ];`;

let patched = c.replace(OLD_SUCCESS, NEW_SUCCESS);
if (patched === c) {
  console.warn('WARNING: discount success/invalidPassword URL patch did not match - skipping');
} else {
  c = patched;
  console.log('Discount patch 1 applied: flexible URL matching + login page → InvalidPassword');
}

// Fix 2: Replace getLoginOptions to:
//   a) fill form with click+type (triggers React onChange correctly)
//   b) submit via Enter key
//   c) use a polling postAction instead of waitForNavigation — avoids the race
//      condition where navigation from Enter completes before postAction starts,
//      which would cause waitForNavigation to wait 30s+ for the NEXT navigation.
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
        // Wait for Akamai challenge JS to fully initialize before interacting
        await new Promise(r => setTimeout(r, 3000));
        // Simulate human presence with mouse movement before touching the form
        await pg.mouse.move(300 + Math.floor(Math.random() * 200), 200 + Math.floor(Math.random() * 100));
        await new Promise(r => setTimeout(r, 300));
        await pg.mouse.move(400 + Math.floor(Math.random() * 100), 350 + Math.floor(Math.random() * 80));
        await new Promise(r => setTimeout(r, 200));
        await pg.click('#tzId');
        await pg.type('#tzId', credentials.id, { delay: 80 });
        await pg.click('#tzPassword');
        await pg.type('#tzPassword', credentials.password, { delay: 80 });
        await pg.click('#aidnum');
        await pg.type('#aidnum', credentials.num, { delay: 80 });
        const vals = await pg.evaluate(() => ({
          tzId: document.querySelector('#tzId')?.value,
          tzPasswordLen: document.querySelector('#tzPassword')?.value?.length,
          aidnum: document.querySelector('#aidnum')?.value,
        }));
        console.log('[discount] field values before submit:', JSON.stringify(vals));
        await new Promise(r => setTimeout(r, 1000));
        // Try submitting via the button first, fall back to Enter
        const clicked = await pg.evaluate(() => {
          const btn = document.querySelector('.sendBtn');
          if (btn) { btn.click(); return true; }
          return false;
        });
        if (clicked) {
          console.log('[discount] form submitted via .sendBtn DOM click');
        } else {
          await pg.keyboard.press('Enter');
          console.log('[discount] form submitted via Enter (.sendBtn not found)');
        }
      },
      postAction: async () => {
        // Poll until URL leaves the login page (or 15s timeout).
        for (let i = 0; i < 30; i++) {
          const url = await _self.page.evaluate(() => window.location.href);
          if (!url.toLowerCase().includes('/login')) {
            console.log('[discount] post-login URL:', url);
            return;
          }
          await new Promise(r => setTimeout(r, 500));
        }
        // Log error message shown on page to help diagnose wrong-credential vs bot-block
        const errorText = await _self.page.evaluate(() => {
          const el = document.querySelector('.error-message, #general-error, [class*="error"], [class*="Error"]');
          return el ? el.innerText : null;
        });
        if (errorText) console.log('[discount] error on page:', errorText);
        const url = await _self.page.evaluate(() => window.location.href);
        console.log('[discount] post-login URL (still on login page):', url);
      },
      possibleResults: getPossibleLoginResults()
    };
  }`;

patched = c.replace(OLD_LOGIN, () => NEW_LOGIN);
if (patched === c) {
  console.warn('WARNING: discount getLoginOptions patch did not match - skipping');
} else {
  c = patched;
  console.log('Discount patch 2 applied: click+type form fill with polling postAction');
}

fs.writeFileSync(f, c);
