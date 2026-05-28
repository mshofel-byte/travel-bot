const { createScraper } = require("israeli-bank-scrapers");
const { execSync } = require("child_process");

function findChromium() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  try {
    return execSync("which chromium 2>/dev/null || which chromium-browser 2>/dev/null", { stdio: "pipe" })
      .toString().trim().split("\n")[0];
  } catch {
    return undefined;
  }
}

async function scrapeAccount(companyId, credentials, startDate) {
  const executablePath = findChromium();
  const scraper = createScraper({
    companyId,
    startDate: startDate || new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1),
    combineInstallments: false,
    showBrowser: false,
    browser: {
      executablePath,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  });

  const result = await scraper.scrape(credentials);
  if (!result.success) throw new Error(result.errorMessage || "Scraping failed");
  return result.accounts || [];
}

module.exports = { scrapeAccount };
