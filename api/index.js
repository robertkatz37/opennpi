const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
const PORT = process.env.PORT || 7000;

// 🔹 Optimized axios config for Vercel
const createAxiosConfig = () => ({
  timeout: 25000, // Reduced timeout for Vercel serverless
  maxRedirects: 5,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  }
});

// 🔹 Minimal delay for Vercel
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 🔹 Simplified retry with faster failover
async function fetchWithRetry(url, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(url, createAxiosConfig());
      return response;
    } catch (error) {
      if (attempt === maxRetries) throw error;
      await delay(1000 * attempt);
    }
  }
}

// 🔹 Optimized pagination for Vercel serverless
async function scrapeTablesWithPagination(baseUrl, tableSelector, maxPages = 15) {
  let allRows = [];
  let visited = new Set();
  let nextUrl = baseUrl;
  let pageCount = 0;

  while (nextUrl && pageCount < maxPages) {
    if (visited.has(nextUrl)) break;
    visited.add(nextUrl);
    pageCount++;

    try {
      if (pageCount > 1) {
        await delay(800); // Minimal delay
      }

      const response = await fetchWithRetry(nextUrl);
      const $ = cheerio.load(response.data);

      let pageRows = 0;
      
      $(`${tableSelector} tbody tr`).each((i, tr) => {
        const tds = $(tr).find("td");
        if (tds.length >= 4) {
          const linkTag = $(tds[0]).find("a");
          const providerName = linkTag.text().trim();
          const providerLink = linkTag.attr("href") || "#";
          const address = $(tds[1]).text().trim();
          const taxonomy = $(tds[2]).text().trim();
          const enumerationDate = $(tds[3]).text().trim();

          if (!providerName || providerName.toLowerCase() === 'provider name') return;

          allRows.push({
            providerName,
            providerLink: providerLink.startsWith("http")
              ? providerLink
              : `https://opennpi.com${providerLink}`,
            address,
            taxonomy,
            enumerationDate
          });
          
          pageRows++;
        }
      });

      // Get next page link using original selector
      const nextLink = $(".page-item.mx-auto a.page-link")
        .filter((i, el) => $(el).text().trim() === "Next Page")
        .attr("href");

      nextUrl = nextLink
        ? (nextLink.startsWith("http") ? nextLink : `https://opennpi.com${nextLink}`)
        : null;

      if (pageRows === 0 && pageCount > 1) break;

    } catch (error) {
      if (error.response?.status === 403 || pageCount > 5) {
        break;
      }
      if (pageCount <= 3) {
        await delay(2000);
        continue;
      } else {
        break;
      }
    }
  }

  return allRows;
}

// 🔹 Route 1: Main providers page
app.get("/", async (req, res) => {
  try {
    const url = "https://opennpi.com/provider";
    const response = await fetchWithRetry(url);
    const $ = cheerio.load(response.data);

    let results = [];
    
    // Original selector for categories
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

    // Scrape all provider details with optimized pagination
    const providerDetailRows = await scrapeTablesWithPagination(url, "#search-result table", 20);

    // Build HTML response
    let html = `
      <html>
      <head>
        <title>Providers Directory</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: Arial, sans-serif; margin: 0; background: #f5f7fa; }
          .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #08326B, #0a4a8a); color: white; padding: 25px; margin-bottom: 20px; border-radius: 8px; text-align: center; }
          .header h1 { margin: 0 0 10px 0; font-size: 2.2em; }
          .stats { display: flex; justify-content: center; gap: 30px; margin: 20px 0; }
          .stat { background: white; padding: 15px 25px; border-radius: 6px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .stat-number { font-size: 1.8em; font-weight: bold; color: #08326B; }
          .stat-label { color: #666; font-size: 0.9em; }
          .section { background: white; margin: 15px 0; padding: 20px; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          h2 { color: #08326B; margin-top: 0; padding-bottom: 8px; border-bottom: 2px solid #e0e7ff; }
          table { width: 100%; border-collapse: collapse; margin: 10px 0; }
          th, td { border: 1px solid #ddd; padding: 10px 8px; text-align: left; }
          th { background: #08326B; color: #fff; font-weight: 600; }
          tr:nth-child(even) { background: #f9f9f9; }
          tr:hover { background: #e8f4fd; }
          a { color: #08326B; text-decoration: none; font-weight: 500; }
          a:hover { text-decoration: underline; }
          button { padding: 10px 20px; background: #08326B; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; margin: 10px 5px 10px 0; }
          button:hover { background: #0a4a8a; }
          .success { background: #f0fff4; border-left: 4px solid #68d391; padding: 12px; margin: 12px 0; border-radius: 4px; }
          @media (max-width: 768px) {
            .container { padding: 10px; }
            .stats { flex-direction: column; align-items: center; }
            table { font-size: 13px; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🏥 Healthcare Providers Directory</h1>
            <p>Complete data from OpenNPI.com</p>
          </div>
          
          <div class="stats">
            <div class="stat">
              <div class="stat-number">${providerDetailRows.length.toLocaleString()}</div>
              <div class="stat-label">Total Providers</div>
            </div>
            <div class="stat">
              <div class="stat-number">${results.length}</div>
              <div class="stat-label">Categories</div>
            </div>
          </div>
    `;

    if (providerDetailRows.length > 0) {
      html += `<div class="success">✅ Successfully loaded ${providerDetailRows.length.toLocaleString()} provider records!</div>`;
    }

    // Render category tables
    results.forEach(section => {
      html += `<div class="section">`;
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
      html += `</div>`;
    });

    // Render all providers table
    if (providerDetailRows.length) {
      html += `<div class="section">`;
      html += `<h2>All Providers (${providerDetailRows.length.toLocaleString()} records)</h2>`;
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
      html += `</div>`;

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

    html += `</div></body></html>`;
    res.send(html);

  } catch (err) {
    const errorHtml = `
      <html>
      <head><title>Error</title></head>
      <body style="font-family:Arial,sans-serif;margin:40px;">
        <h1>Error Loading Data</h1>
        <p>Error: ${err.message}</p>
        <p>Status: ${err.response?.status || 'Unknown'}</p>
        <p><a href="/">🔄 Try Again</a></p>
      </body>
      </html>
    `;
    res.status(500).send(errorHtml);
  }
});

// 🔹 Route 2: Provider details - FIXED navigation
app.get("/provider-details", async (req, res) => {
  try {
    const pageUrl = req.query.url;
    if (!pageUrl) return res.status(400).send("Missing URL parameter");

    const fullUrl = pageUrl.startsWith("http")
      ? pageUrl
      : `https://opennpi.com${pageUrl}`;

    const rows = await scrapeTablesWithPagination(fullUrl, "#search-result table", 15);

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
          .nav { margin-bottom: 20px; }
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
        <div class="nav">
          <h2>Provider Details (Total: ${rows.length})</h2>
          <button onclick="backToProviders()">⬅ Back to Providers</button>
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
    const errorHtml = `
      <html>
      <head><title>Error</title></head>
      <body style="font-family:Arial,sans-serif;margin:40px;">
        <h1>Error Loading Provider Details</h1>
        <p>Error: ${err.message}</p>
        <p><a href="/" onclick="history.back()">← Back to Providers</a></p>
      </body>
      </html>
    `;
    res.status(500).send(errorHtml);
  }
});

// 🔹 Health check
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// 🔹 Server setup
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}/`);
  });
}

module.exports = app;