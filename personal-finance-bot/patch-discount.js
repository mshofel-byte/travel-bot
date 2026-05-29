const fs = require('fs');
const f = 'node_modules/israeli-bank-scrapers/lib/scrapers/discount.js';
let c = fs.readFileSync(f, 'utf8');

// Replace exact URL array with a function-based condition that:
// 1. Logs the actual post-login URL (visible in Railway logs for debugging)
// 2. Accepts ANY telebank URL that is not the login page as success
const OLD = "urls[_baseScraperWithBrowser.LoginResults.Success] = [`${BASE_URL}/apollo/retail/#/MY_ACCOUNT_HOMEPAGE`, `${BASE_URL}/apollo/retail2/#/MY_ACCOUNT_HOMEPAGE`, `${BASE_URL}/apollo/retail2/`];";
const NEW = `urls[_baseScraperWithBrowser.LoginResults.Success] = [({ value }) => {
    console.log('[discount] post-login URL:', value);
    return value.includes('telebank.co.il') && !value.toLowerCase().includes('/login');
  }];`;

const patched = c.replace(OLD, NEW);

if (patched === c) {
  console.warn('WARNING: discount patch did not match - skipping (version mismatch?)');
} else {
  fs.writeFileSync(f, patched);
  console.log('Discount patch applied: flexible URL matching with logging');
}
