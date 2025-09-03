const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
const PORT = process.env.PORT || 7000;

// 🔹 Enhanced axios configuration with proper headers
const createAxiosConfig = () => ({
  timeout: 30000, // 30 second timeout
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'max-age=0',
  }
});

// 🔹 Helper to add delay between requests
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 🔹 Enhanced scraping function with better error handling
async function scrapeTablesWithPagination(baseUrl, tableSelector, maxPages = 10) {
  let allRows = [];
  let visited = new Set();
  let nextUrl = baseUrl;
  let pageCount = 0;

  while (nextUrl && pageCount < maxPages) {
    if (visited.has(nextUrl)) break;
    visited.add(nextUrl);
    pageCount++;

    try {
      // Add delay between requests to avoid rate limiting
      if (pageCount > 1) {
        await delay(2000); // 2 second delay between pages
      }

      console.log(`Fetching page ${pageCount}: ${nextUrl}`);
      
      const response = await axios.get(nextUrl, createAxiosConfig());
      const $ = cheerio.load(response.data);

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

      console.log(`Page ${pageCount} processed. Found ${allRows.length} total rows so far.`);

    } catch (error) {
      console.error(`Error fetching page ${pageCount}:`, error.message);
      // Don't break the loop, continue with what we have
      break;
    }
  }

  return allRows;
}

// 🔹 Route 1: Providers list on root "/"
app.get("/", async (req, res) => {
  try {
    const url = "https://opennpi.com/provider";
    console.log("Fetching main provider page...");
    
    const response = await axios.get(url, createAxiosConfig());
    const $ = cheerio.load(response.data);

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

    // 🔹 Scrape #search-result table from main provider page with pagination
    console.log("Starting to scrape provider details...");
    const providerDetailRows = await scrapeTablesWithPagination(url, "#search-result table", 5); // Limit to 5 pages for performance

    // Build HTML with number column and CSV download
    let html = `
      <html>
      <head>
        <title>Providers</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.6; }
          .header { background: #08326B; color: white; padding: 20px; margin: -20px -20px 20px -20px; }
          .header h1 { margin: 0; }
          .status { background: #e8f4fd; padding: 10px; border-left: 4px solid #08326B; margin: 10px 0; }
          h2 { color: #08326B; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 20px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background: #08326B; color: #fff; }
          tr:nth-child(even) { background: #f9f9f9; }
          a { color: #08326B; text-decoration: none; }
          a:hover { text-decoration: underline; }
          button { margin-bottom: 15px; padding: 8px 12px; font-size: 14px; cursor: pointer; background: #08326B; color: white; border: none; border-radius: 4px; }
          button:hover { background: #0a4a8a; }
          .loading { text-align: center; padding: 20px; color: #666; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Healthcare Providers Directory</h1>
          <p>Data scraped from OpenNPI.com</p>
        </div>
    `;

    // Add status information
    html += `<div class="status">Successfully loaded ${providerDetailRows.length} provider records</div>`;

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

    // Render provider details tables at the end
    if (providerDetailRows.length) {
      html += `<h2>All Providers (${providerDetailRows.length} records)</h2>`;
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

      // Add CSV download script
      html += `
        <script>
          function downloadCSV() {
            const rows = document.querySelectorAll("#provider-details-table tr");
            let csvContent = "";
            rows.forEach(row => {
              const cols = row.querySelectorAll("th, td");
              const rowData = Array.from(cols).map(col => {
                const text = col.innerText.replace(/"/g, '""');
                return '"' + text + '"';
              });
              csvContent += rowData.join(",") + "\\n";
            });
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "providers_details.csv";
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }
        </script>
      `;
    } else {
      html += `<div class="status">No provider details were found. This might be due to website protection measures.</div>`;
    }

    html += `</body></html>`;
    res.send(html);

  } catch (err) {
    console.error("Error scraping providers:", err.message);
    const errorHtml = `
      <html>
      <head><title>Error</title></head>
      <body>
        <h1>Scraping Error</h1>
        <p><strong>Error:</strong> ${err.message}</p>
        <p>This error might be due to:</p>
        <ul>
          <li>Website blocking automated requests (403 Forbidden)</li>
          <li>Network connectivity issues</li>
          <li>Website structure changes</li>
          <li>Rate limiting</li>
        </ul>
        <p>Try refreshing the page in a few minutes.</p>
      </body>
      </html>
    `;
    res.status(500).send(errorHtml);
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

    console.log(`Fetching provider details from: ${fullUrl}`);
    const rows = await scrapeTablesWithPagination(fullUrl, "#search-result table", 5);

    let html = `
      <html>
      <head>
        <title>Provider Details</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.6; }
          .header { background: #08326B; color: white; padding: 20px; margin: -20px -20px 20px -20px; }
          .header h1 { margin: 0; }
          .nav { margin: 10px 0; }
          .nav a { color: #08326B; text-decoration: none; margin-right: 15px; }
          .nav a:hover { text-decoration: underline; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; margin-bottom: 20px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background: #08326B; color: #fff; }
          tr:nth-child(even) { background: #f9f9f9; }
          a { color: #08326B; text-decoration: none; }
          a:hover { text-decoration: underline; }
          button { margin-bottom: 15px; padding: 8px 12px; font-size: 14px; cursor: pointer; background: #08326B; color: white; border: none; border-radius: 4px; }
          button:hover { background: #0a4a8a; }
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
              const rowData = Array.from(cols).map(col => {
                const text = col.innerText.replace(/"/g, '""');
                return '"' + text + '"';
              });
              csvContent += rowData.join(",") + "\\n";
            });
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "provider_details.csv";
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }
        </script>
      </head>
      <body>
        <div class="header">
          <h1>Provider Details</h1>
          <p>Total Records Found: ${rows.length}</p>
        </div>
        <div class="nav">
          <a href="#" onclick="backToProviders()">⬅ Back to Providers</a>
          <button onclick="downloadCSV()">⬇ Download CSV</button>
        </div>
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
    const errorHtml = `
      <html>
      <head><title>Error</title></head>
      <body>
        <h1>Provider Details Error</h1>
        <p><strong>Error:</strong> ${err.message}</p>
        <p><a href="/">⬅ Back to Providers</a></p>
      </body>
      </html>
    `;
    res.status(500).send(errorHtml);
  }
});

// 🔹 Health check route for Vercel
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// For Vercel deployment
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;