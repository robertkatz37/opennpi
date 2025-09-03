const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();

// 🔹 Helper to scrape tables with pagination
async function scrapeTablesWithPagination(baseUrl, tableSelector) {
  let allRows = [];
  let visited = new Set();
  let nextUrl = baseUrl;

  while (nextUrl) {
    if (visited.has(nextUrl)) break;
    visited.add(nextUrl);

    const { data } = await axios.get(nextUrl);
    const $ = cheerio.load(data);

    $(`${tableSelector} tbody tr`).each((i, tr) => {
      const tds = $(tr).find("td");
      if (tds.length >= 4) {
        const linkTag = $(tds[0]).find("a");
        const providerName = linkTag.text().trim();
        const providerLink = linkTag.attr("href") || "#";
        const address = $(tds[1]).text().trim();
        const taxonomy = $(tds[2]).text().trim();
        const enumerationDate = $(tds[3]).text().trim();

        allRows.push({
          providerName,
          providerLink: providerLink.startsWith("http")
            ? providerLink
            : `https://opennpi.com${providerLink}`,
          address,
          taxonomy,
          enumerationDate,
        });
      }
    });

    const nextLink = $(".page-item.mx-auto a.page-link")
      .filter((i, el) => $(el).text().trim() === "Next Page")
      .attr("href");

    nextUrl = nextLink
      ? nextLink.startsWith("http")
        ? nextLink
        : `https://opennpi.com${nextLink}`
      : null;
  }

  return allRows;
}

// 🔹 Route 1: Providers list on root "/"
app.get("/", async (req, res) => {
  try {
    res.send("<h1>Hello from Vercel!</h1>");
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).send(`<p>Error: ${err.message}</p>`);
  }
});

// 🔹 Route 2: Provider details
app.get("/provider-details", async (req, res) => {
  res.send("<p>Provider details route (will implement scraping here later)</p>");
});

// 🔹 Export Vercel serverless handler
module.exports = app;
