const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
const PORT = process.env.PORT || 7000;

// 🔹 Enhanced axios configuration to avoid 403 errors
const createAxiosInstance = () => {
  return axios.create({
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Cache-Control': 'max-age=0'
    }
  });
};

// 🔹 Add delay function to avoid rate limiting
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 🔹 Helper to scrape tables with pagination and error handling
async function scrapeTablesWithPagination(baseUrl, tableSelector, maxPages = 50) {
  let allRows = [];
  let visited = new Set();
  let nextUrl = baseUrl;
  let pageCount = 0;
  const axiosInstance = createAxiosInstance();

  while (nextUrl && pageCount < maxPages) {
    if (visited.has(nextUrl)) break;
    visited.add(nextUrl);
    pageCount++;

    try {
      console.log(`Scraping page ${pageCount}: ${nextUrl}`);
      
      // Add delay between requests
      if (pageCount > 1) {
        await delay(2000); // 2 second delay between requests
      }

      const { data } = await axiosInstance.get(nextUrl);
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

      console.log(`Page ${pageCount} completed. Found ${allRows.length} total rows.`);
        
    } catch (error) {
      console.error(`Error scraping page ${pageCount}:`, error.message);
      
      // If it's a 403 or similar error, try with different headers
      if (error.response?.status === 403 || error.response?.status === 429) {
        console.log(`Received ${error.response.status}, waiting 5 seconds and trying with different headers...`);
        await delay(5000);
        
        try {
          const retryInstance = axios.create({
            timeout: 30000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
              'Accept': '*/*',
              'Referer': 'https://opennpi.com/',
              'X-Requested-With': 'XMLHttpRequest'
            }
          });
          
          const { data } = await retryInstance.get(nextUrl);
          const $ = cheerio.load(data);
          
          // Process the retry data (same logic as above)
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
          
        } catch (retryError) {
          console.error(`Retry also failed:`, retryError.message);
          break; // Stop pagination on persistent errors
        }
      } else {
        break; // Stop on other types of errors
      }
    }
  }

  console.log(`Scraping completed. Total rows: ${allRows.length}, Pages processed: ${pageCount}`);
  return allRows;
}

// 🔹 Route 1: Providers list on root "/"
app.get("/", async (req, res) => {
  try {
    const url = "https://opennpi.com/provider";
    const axiosInstance = createAxiosInstance();
    
    console.log("Starting to scrape provider list...");
    const { data } = await axiosInstance.get(url);
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

    // 🔹 Scrape #search-result table from main provider page with pagination (limited pages)
    console.log("Starting to scrape provider details...");
    const providerDetailRows = await scrapeTablesWithPagination(url, "#search-result table", 10); // Limit to 10 pages to avoid timeouts

    // Build HTML with number column and CSV download
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
          .loading { color: #666; font-style: italic; }
          .error { color: #d32f2f; background: #ffebee; padding: 10px; border-radius: 4px; margin: 10px 0; }
          .success { color: #2e7d32; background: #e8f5e8; padding: 10px; border-radius: 4px; margin: 10px 0; }
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

    // Render provider details tables at the end
    if (providerDetailRows.length) {
      html += `<div class="success">✅ Successfully loaded ${providerDetailRows.length} provider records (limited to first 10 pages to avoid timeouts)</div>`;
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

      // Add CSV download script
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
    } else {
      html += `<div class="error">⚠️ Unable to load provider details. This might be due to rate limiting or access restrictions.</div>`;
    }

    html += `</body></html>`;
    res.send(html);

  } catch (err) {
    console.error("Error scraping providers:", err.message);
    const errorHtml = `
      <html>
      <head><title>Error</title></head>
      <body>
        <div style="color: #d32f2f; background: #ffebee; padding: 20px; border-radius: 4px; margin: 20px;">
          <h2>Error occurred</h2>
          <p><strong>Error:</strong> ${err.message}</p>
          <p><strong>Status:</strong> ${err.response?.status || 'Unknown'}</p>
          <p>This might be due to:</p>
          <ul>
            <li>Rate limiting from the target website</li>
            <li>IP blocking on Vercel servers</li>
            <li>Website structure changes</li>
          </ul>
          <p><a href="/">Try again</a></p>
        </div>
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

    console.log(`Scraping provider details from: ${fullUrl}`);
    const rows = await scrapeTablesWithPagination(fullUrl, "#search-result table", 5); // Limit to 5 pages for detail pages

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
          .success { color: #2e7d32; background: #e8f5e8; padding: 10px; border-radius: 4px; margin: 10px 0; }
          .back-link { display: inline-block; margin-bottom: 15px; cursor: pointer; color: #08326B; }
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
        <span class="back-link" onclick="backToProviders()">⬅ Back to Providers</span>
        <div class="success">✅ Successfully loaded ${rows.length} provider records</div>
        <h2>Provider Details (Total: ${rows.length})</h2>
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
    const errorHtml = `
      <html>
      <head><title>Error</title></head>
      <body>
        <div style="color: #d32f2f; background: #ffebee; padding: 20px; border-radius: 4px; margin: 20px;">
          <h2>Error loading provider details</h2>
          <p><strong>Error:</strong> ${err.message}</p>
          <p><a href="/">⬅ Back to Providers</a></p>
        </div>
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

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}/`);
});

// For Vercel deployment
module.exports = app;