const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
const PORT = 7000;

// 🔹 List of User-Agents
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0'
];

// 🔹 Pick random User-Agent
function getRandomUserAgent() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// 🔹 Axios wrapper with retry & backoff
async function fetchPage(url, retries = 3, delay = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(url, {
        headers: {
          "User-Agent": getRandomUserAgent(),
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": "https://www.google.com/",
          "Connection": "keep-alive"
        },
        timeout: 45000
      });
      return response.data;
    } catch (err) {
      console.warn(`⚠️ Attempt ${attempt} failed for ${url}: ${err.message}`);
      if (attempt < retries) {
        const backoff = delay * attempt; // exponential backoff
        console.log(`⏳ Retrying in ${backoff / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
      } else {
        throw new Error(`Failed after ${retries} attempts: ${err.message}`);
      }
    }
  }
}

// 🔹 Helper to scrape tables with pagination
async function scrapeTablesWithPagination(baseUrl, tableSelector) {
  let allRows = [];
  let visited = new Set();
  let nextUrl = baseUrl;

  while (nextUrl) {
    if (visited.has(nextUrl)) break;
    if (nextUrl == "https://opennpi.com/provider?") break;
    visited.add(nextUrl);

    const data = await fetchPage(nextUrl);
    const $ = cheerio.load(data);

    // Scrape table rows
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
          enumerationDate
        });
      }
    });

    // Get next page link
    const nextLink = $(".page-item.mx-auto a.page-link")
      .filter((i, el) => $(el).text().trim() === "Next Page")
      .attr("href");

    nextUrl = nextLink
      ? (nextLink.startsWith("http") ? nextLink : `https://opennpi.com${nextLink}`)
      : null;
  }

  return allRows;
}

// 🔹 Route 1: Providers list on root "/"
app.get("/", async (req, res) => {
  try {
    const url = "https://opennpi.com/provider";
    const data = await fetchPage(url);
    const $ = cheerio.load(data);

    let results = [];
    $(".px-1 .col-12").each((i, el) => {
      const heading = $(el).find("h3").text().trim();
      if (!heading || heading === "Providers by Year") return;

      let tables = [];
      $(el).find("table").each((j, table) => {
        let tableRows = [];
        $(table).find("tr").each((k, tr) => {
          const tds = $(tr).find("td");
          if (tds.length >= 3) {
            const text = $(tds[0]).text().trim();
            const link = $(tds[0]).find("a").attr("href") || "#";
            const providers = $(tds[1]).text().trim();
            const percent = $(tds[2]).text().trim();
            tableRows.push({ text, link, providers, percent });
          }
        });
        if (tableRows.length) tables.push(tableRows);
      });

      if (tables.length) results.push({ heading, tables });
    });

    // 🔹 Scrape #search-result table with pagination
    const providerDetailRows = await scrapeTablesWithPagination(url, "#search-result table");

    // Build HTML
    let html = `
      <html>
      <head>
        <title>Providers</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          h2 { color: #08326B; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 20px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background: #08326B; color: #fff; }
          tr:nth-child(even) { background: #f9f9f9; }
          a { color: #08326B; text-decoration: none; }
          a:hover { text-decoration: underline; }
          button { margin-bottom: 15px; padding: 8px 12px; font-size: 14px; cursor: pointer; }
        </style>
      </head>
      <body>
    `;

    // Render provider summary tables
    results.forEach(section => {
      html += `<h2>${section.heading}</h2>`;
      section.tables.forEach(tableRows => {
        html += `<table><tr><th>#</th><th>Name / Link</th><th>Providers</th><th>Percent</th></tr>`;
        tableRows.forEach((row, index) => {
          const internalLink = `/provider-details?url=${encodeURIComponent(row.link)}`;
          html += `
            <tr>
              <td>${index + 1}</td>
              <td><a href="${internalLink}">${row.text}</a></td>
              <td>${row.providers}</td>
              <td>${row.percent}</td>
            </tr>
          `;
        });
        html += `</table>`;
      });
    });

    // Render provider details table
    if (providerDetailRows.length) {
      html += `<h2>All Providers (from #search-result table)</h2>`;
      html += `<button onclick="downloadCSV()">⬇ Download CSV</button>`;
      html += `<table id="provider-details-table">
        <tr>
          <th>#</th>
          <th>Provider Name</th>
          <th>Address</th>
          <th>Taxonomy</th>
          <th>Enumeration Date</th>
        </tr>
      `;
      providerDetailRows.forEach((row, index) => {
        html += `
          <tr>
            <td>${index + 1}</td>
            <td><a href="${row.providerLink}" target="_blank">${row.providerName}</a></td>
            <td>${row.address}</td>
            <td>${row.taxonomy}</td>
            <td>${row.enumerationDate}</td>
          </tr>
        `;
      });
      html += `</table>`;

      // CSV download script
      html += `
        <script>
          function downloadCSV() {
            const rows = document.querySelectorAll("#provider-details-table tr");
            let csvContent = "";
            rows.forEach(row => {
              const cols = row.querySelectorAll("th, td");
              const rowData = Array.from(cols).map(col => '"' + col.innerText.replace(/"/g, '""') + '"');
              csvContent += rowData.join(",") + "\\n";
            });
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "providers_details.csv";
            a.click();
            URL.revokeObjectURL(url);
          }
        </script>
      `;
    }

    html += `</body></html>`;
    res.send(html);

  } catch (err) {
    console.error("Error scraping providers:", err.message);
    res.status(500).send(`<p>Error: ${err.message}</p>`);
  }
});

// 🔹 Route 2: Provider details
app.get("/provider-details", async (req, res) => {
  try {
    const pageUrl = req.query.url;
    if (!pageUrl) return res.status(400).send("Missing URL parameter");

    const fullUrl = pageUrl.startsWith("http")
      ? pageUrl
      : `https://opennpi.com${pageUrl}`;

    const rows = await scrapeTablesWithPagination(fullUrl, "#search-result table");

    let html = `
      <html>
      <head>
        <title>Provider Details</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; margin-bottom: 20px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background: #08326B; color: #fff; }
          tr:nth-child(even) { background: #f9f9f9; }
          a { color: #08326B; text-decoration: none; }
          a:hover { text-decoration: underline; }
          button { margin-bottom: 15px; padding: 8px 12px; font-size: 14px; cursor: pointer; }
        </style>
        <script>
          function backToProviders() {
            window.location.href = "/";
          }
          function downloadCSV() {
            const rows = document.querySelectorAll("#provider-details-table tr");
            let csvContent = "";
            rows.forEach(row => {
              const cols = row.querySelectorAll("th, td");
              const rowData = Array.from(cols).map(col => '"' + col.innerText.replace(/"/g, '""') + '"');
              csvContent += rowData.join(",") + "\\n";
            });
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "provider_details.csv";
            a.click();
            URL.revokeObjectURL(url);
          }
        </script>
      </head>
      <body>
        <h2>Provider Details (Total: ${rows.length})</h2>
        <a onclick="backToProviders()">⬅ Back to Providers</a>
        <button onclick="downloadCSV()">⬇ Download CSV</button>
        <table id="provider-details-table">
          <tr>
            <th>#</th>
            <th>Provider Name</th>
            <th>Address</th>
            <th>Taxonomy</th>
            <th>Enumeration Date</th>
          </tr>
    `;

    rows.forEach((row, index) => {
      html += `
        <tr>
          <td>${index + 1}</td>
          <td><a href="${row.providerLink}" target="_blank">${row.providerName}</a></td>
          <td>${row.address}</td>
          <td>${row.taxonomy}</td>
          <td>${row.enumerationDate}</td>
        </tr>
      `;
    });

    html += `</table></body></html>`;
    res.send(html);

  } catch (err) {
    console.error("Error fetching provider details:", err.message);
    res.status(500).send(`<p>Error: ${err.message}</p>`);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}/`);
});
