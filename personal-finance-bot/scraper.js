const { createScraper } = require("israeli-bank-scrapers");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

async function scrapeAccount(companyId, credentials, startDate) {
  const browser = await puppeteer.launch({
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--single-process",
      "--no-zygote",
    ],
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
  }
}

module.exports = { scrapeAccount };
