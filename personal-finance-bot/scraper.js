const { createScraper } = require("israeli-bank-scrapers");
const puppeteerRegular = require("puppeteer");
const puppeteerExtra = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const ProxyChain = require("proxy-chain");
puppeteerExtra.use(StealthPlugin());

// Only use stealth for sites that have anti-bot protection
const STEALTH_COMPANIES = new Set(["leumi", "visaCal", "discount", "mercantile"]);

// Only route through residential proxy for banks that block datacenter IPs
const PROXY_COMPANIES = new Set(["leumi", "discount", "mercantile", "visaCal"]);

const PROXY_HOST = (process.env.PROXY_HOST || '').trim();
const PROXY_PORT = (process.env.PROXY_PORT || '').trim();
const PROXY_USER = (process.env.PROXY_USER || '').trim();
const PROXY_PASS = (process.env.PROXY_PASS || '').trim();
const USE_PROXY = !!(PROXY_HOST && PROXY_PORT && PROXY_USER && PROXY_PASS);

if (USE_PROXY) {
  console.log(`[proxy] Enabled: ${PROXY_HOST}:${PROXY_PORT} user=${PROXY_USER}`);
} else {
  console.log('[proxy] Disabled (env vars missing)');
}

const BASE_LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--window-size=1366,768",
];

const REALISTIC_VIEWPORT = { width: 1366, height: 768 };

async function scrapeAccount(companyId, credentials, startDate) {
  let localProxyUrl = null;
  if (USE_PROXY && PROXY_COMPANIES.has(companyId)) {
    try {
      console.log(`[proxy-debug] host="${PROXY_HOST}" len=${PROXY_HOST.length}`);
      console.log(`[proxy-debug] port="${PROXY_PORT}" len=${PROXY_PORT.length}`);
      console.log(`[proxy-debug] user len=${PROXY_USER.length}`);
      console.log(`[proxy-debug] pass len=${PROXY_PASS.length}`);
      const upstreamUrl = `http://${encodeURIComponent(PROXY_USER)}:${encodeURIComponent(PROXY_PASS)}@${PROXY_HOST}:${PROXY_PORT}`;
      console.log(`[proxy-debug] url=http://***:***@${PROXY_HOST}:${PROXY_PORT}`);
      localProxyUrl = await ProxyChain.anonymizeProxy(upstreamUrl);
      console.log(`[${companyId}] proxy tunnel: ${localProxyUrl}`);
    } catch (e) {
      console.error(`[${companyId}] proxy-chain FAILED: ${e.message}`);
      throw e;
    }
  }

  const proxyArg = localProxyUrl ? localProxyUrl.replace(/^https?:\/\//, '') : null;

  // --single-process conflicts with --proxy-server in Chromium
  const launchArgs = [
    ...BASE_LAUNCH_ARGS,
    ...(proxyArg ? [] : ["--single-process", "--no-zygote"]),
    ...(proxyArg ? [`--proxy-server=${proxyArg}`, "--ignore-certificate-errors"] : []),
  ];
  console.log(`[${companyId}] args: ${launchArgs.join(' ')}`);

  const puppeteer = STEALTH_COMPANIES.has(companyId) ? puppeteerExtra : puppeteerRegular;
  console.log(`[${companyId}] launching browser, proxy=${proxyArg || 'none'}`);
  const useNewHeadless = STEALTH_COMPANIES.has(companyId);
  const browser = await puppeteer.launch({
    args: launchArgs,
    headless: useNewHeadless ? 'new' : true,
    defaultViewport: REALISTIC_VIEWPORT,
    timeout: 90000,
  });
  console.log(`[${companyId}] browser ws: ${browser.wsEndpoint()}`);

  // Warm-up visit for banks with aggressive bot detection.
  // Opening the main page lets the anti-fraud JavaScript (Akamai/Imperva)
  // run and set its cookies before we navigate to the login form.
  // Use domcontentloaded (not networkidle2) to avoid a 30s wait.
  if (companyId === 'discount' || companyId === 'mercantile') {
    try {
      const warmupPage = await browser.newPage();
      await warmupPage.goto('https://start.telebank.co.il/', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      }).catch(() => {});
      await new Promise(r => setTimeout(r, 2500));
      await warmupPage.close().catch(() => {});
      console.log(`[${companyId}] warm-up visit complete`);
    } catch (e) {
      console.log(`[${companyId}] warm-up failed (non-fatal): ${e.message}`);
    }
  }

  try {
    const scraper = createScraper({
      companyId,
      startDate: startDate || new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1),
      combineInstallments: false,
      showBrowser: false,
      browser,
      timeout: 90000,
      defaultTimeout: 90000,
      preparePage: async (page) => {
        page.on('framenavigated', (frame) => {
          if (frame === page.mainFrame()) {
            console.log(`[${companyId}] → ${frame.url()}`);
          }
        });
      },
    });

    let result;
    try {
      result = await scraper.scrape(credentials);
    } catch (scrapeErr) {
      if (scrapeErr.message && scrapeErr.message.includes("Unknown transaction type")) {
        return [];
      }
      throw scrapeErr;
    }
    if (!result.success) {
      if (result.errorMessage && result.errorMessage.includes("Unknown transaction type")) {
        return result.accounts || [];
      }
      throw new Error(result.errorMessage || "Scraping failed");
    }
    return result.accounts || [];
  } finally {
    await browser.close().catch(() => {});
    if (localProxyUrl) {
      await ProxyChain.closeAnonymizedProxy(localProxyUrl, true).catch(() => {});
    }
  }
}

module.exports = { scrapeAccount };
