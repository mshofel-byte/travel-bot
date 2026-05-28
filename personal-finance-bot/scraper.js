const { createScraper } = require("israeli-bank-scrapers");

async function scrapeAccount(companyId, credentials, startDate) {
  const scraper = createScraper({
    companyId,
    startDate: startDate || new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1),
    combineInstallments: false,
    showBrowser: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const result = await scraper.scrape(credentials);

  if (!result.success) {
    throw new Error(result.errorMessage || "Scraping failed");
  }

  return result.accounts || [];
}

module.exports = { scrapeAccount };
