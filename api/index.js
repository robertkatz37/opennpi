import chromium from "chrome-aws-lambda";
import puppeteer from "puppeteer-core";

export default async function handler(req, res) {
  let browser = null;

  try {
    // Launch headless browser
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    // Go to the first page
    await page.goto("https://opennpi.com/provider", {
      waitUntil: "networkidle2",
    });

    let results = [];
    let visitedPages = new Set();

    while (true) {
      // Avoid infinite loops
      const url = page.url();
      if (visitedPages.has(url)) break;
      visitedPages.add(url);

      // Wait for table to load
      await page.waitForSelector("#search-result table");

      // Scrape table data
      const tableData = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll("#search-result table tbody tr"));
        return rows.map((row, index) => {
          const cells = row.querySelectorAll("td");
          return {
            No: index + 1,
            Name: cells[0]?.innerText || "",
            NPI: cells[1]?.innerText || "",
            Type: cells[2]?.innerText || "",
            State: cells[3]?.innerText || "",
          };
        });
      });

      results.push(...tableData);

      // Check if "next page" exists
      const nextPageLink = await page.$(".mx-auto a[rel='next']");
      if (!nextPageLink) break;

      // Go to next page
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle2" }),
        nextPageLink.click(),
      ]);
    }

    res.status(200).json({ success: true, data: results });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (browser) await browser.close();
  }
}
