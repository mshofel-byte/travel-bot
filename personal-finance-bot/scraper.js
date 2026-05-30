const { createScraper } = require("israeli-bank-scrapers");
const puppeteerRegular = require("puppeteer");
const puppeteerExtra = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const ProxyChain = require("proxy-chain");
puppeteerExtra.use(StealthPlugin());

// Only use stealth for sites that have anti-bot protection
const STEALTH_COMPANIES = new Set(["leumi", "visaCal", "discount", "mercantile"]);

const PROXY_HOST = process.env.PROXY_HOST;
const PROXY_PORT = process.env.PROXY_PORT;
const PROXY_USER = process.env.PROXY_USER;
const PROXY_PASS = process.env.PROXY_PASS;
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
  "--single-process",
  "--no-zygote",
];

async function scrapeAccount(companyId, credentials, startDate) {
  let localProxyUrl = null;
  if (USE_PROXY) {
    const upstreamUrl = `http://${PROXY_USER}:${PROXY_PASS}@${PROXY_HOST}:${PROXY_PORT}`;
    localProxyUrl = await ProxyChain.anonymizeProxy(upstreamUrl);
    console.log(`[proxy] Local tunnel: ${localProxyUrl}`);
  }

  const launchArgs = [
    ...BASE_LAUNCH_ARGS,
    ...(localProxyUrl ? [`--proxy-server=${localProxyUrl}`] : []),
  ];

  const puppeteer = STEALTH_COMPANIES.has(companyId) ? puppeteerExtra : puppeteerRegular;
  const browser = await puppeteer.launch({
    args: launchArgs,
    headless: true,
    timeout: 60000,
  });

  try {
    const scraper = createScraper({
      companyId,
      startDate: startDate || new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1),
      combineInstallments: false,
      showBrowser: false,
      browser,
      timeout: 60000,
      defaultTimeout: 60000,
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
