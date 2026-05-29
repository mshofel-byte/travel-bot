const fs = require('fs');
const f = 'node_modules/israeli-bank-scrapers/lib/scrapers/discount.js';
let c = fs.readFileSync(f, 'utf8');

// Replace exact URL array with a regex so any post-login apollo URL counts as success.
// Telebank sometimes redirects to a URL variant not in the hardcoded list.
const OLD = "urls[_baseScraperWithBrowser.LoginResults.Success] = [`${BASE_URL}/apollo/retail/#/MY_ACCOUNT_HOMEPAGE`, `${BASE_URL}/apollo/retail2/#/MY_ACCOUNT_HOMEPAGE`, `${BASE_URL}/apollo/retail2/`];";
const NEW = "urls[_baseScraperWithBrowser.LoginResults.Success] = [/start\\.telebank\\.co\\.il\\/apollo\\//i];";

const patched = c.replace(OLD, NEW);

if (patched === c) {
  console.warn('WARNING: discount patch did not match - skipping (version mismatch?)');
} else {
  fs.writeFileSync(f, patched);
  console.log('Discount patch applied: flexible regex URL matching for success');
}
