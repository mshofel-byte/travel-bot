const { createScraper } = require("israeli-bank-scrapers");
const puppeteer = require("puppeteer");

async function scrapeAccount(companyId, credentials, startDate) {
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    headless: true,
  });

  try {
    const scraper = createScraper({
      companyId,
      startDate: startDate || new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1),
      combineInstallments: false,
      showBrowser: false,
      browser,
    });

    const result = await scraper.scrape(credentials);
    if (!result.success) throw new Error(result.errorMessage || "Scraping failed");
    return result.accounts || [];
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { scrapeAccount };
