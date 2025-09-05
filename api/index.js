const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
const PORT = process.env.PORT || 7000;

// 🔹 Enhanced axios configuration with proper headers to avoid 403
const createAxiosConfig = () => ({
  timeout: 45000, // 45 second timeout for Vercel
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
    'DNT': '1',
    'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"'
  }
});

// 🔹 Smart delay function to avoid rate limiting
/*const smartDelay = async (pageNumber) => {
  // Exponential backoff with jitter
  const baseDelay = Math.min(1000 + (pageNumber * 200), 3000);
  const jitter = Math.random() * 1000;
  const totalDelay = baseDelay + jitter;
  await new Promise(resolve => setTimeout(resolve, totalDelay));
};*/

// 🔹 Retry mechanism for failed requests
async function fetchWithRetry(url, maxRetries = 30) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempt ${attempt} for: ${url}`);
      const response = await axios.get(url, createAxiosConfig());
      return response;
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error.message);
      
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Wait longer between retries
      await new Promise(resolve => setTimeout(resolve, attempt * 2000));
    }
  }
}

// 🔹 Enhanced scraper to get ALL records with better pagination handling
async function scrapeTablesWithPagination(baseUrl, tableSelector, maxPages = 15) {
  let allRows = [];
  let visited = new Set();
  let nextUrl = baseUrl;
  let pageCount = 0;

  console.log(`Starting pagination scrape from: ${baseUrl}`);

  while (nextUrl && pageCount < maxPages) {
    if (visited.has(nextUrl)) {
      console.log(`Already visited: ${nextUrl}, breaking loop`);
      break;
    }
    if (nextUrl == "https://opennpi.com/provider?") {
      console.log(`ok visited: ${nextUrl}, breaking loop`);
      break;
    }
    
    visited.add(nextUrl);
    pageCount++;

    try {
      // Add smart delay between requests
    /*  if (pageCount > 1) {
        console.log(`Adding delay before page ${pageCount}...`);
        await smartDelay(pageCount);
      }*/

      console.log(`📄 Fetching page ${pageCount}: ${nextUrl}`);
      
      const response = await fetchWithRetry(nextUrl);
      const $ = cheerio.load(response.data);

      let pageRows = 0;
      
      // Scrape table rows with better selector handling
      const tableRows = $(`${tableSelector} tbody tr, ${tableSelector} tr`).filter((i, tr) => {
        const tds = $(tr).find("td");
        return tds.length >= 4; // Only rows with enough columns
      });

      tableRows.each((i, tr) => {
        const tds = $(tr).find("td");
        
        const linkTag = $(tds[0]).find("a");
        const providerName = linkTag.text().trim();
        
        // Skip header rows or empty rows
        if (!providerName || providerName.toLowerCase() === 'provider name') {
          return;
        }

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
        
        pageRows++;
      });

      console.log(`✅ Page ${pageCount}: Found ${pageRows} rows (Total: ${allRows.length})`);

      // Look for next page link with multiple selectors
      let nextLink = null;
      
      // Try different pagination selectors
      const paginationSelectors = [
        ".page-item.mx-auto a.page-link",
        ".pagination .page-item a",
        "a[aria-label='Next']",
        ".next-page",
        "a:contains('Next')",
        "a:contains('>')"
      ];

      for (const selector of paginationSelectors) {
        const links = $(selector);
        links.each((i, el) => {
          const linkText = $(el).text().trim().toLowerCase();
          const ariaLabel = $(el).attr('aria-label')?.toLowerCase() || '';
          
          if (linkText === 'next page' || linkText === 'next' || linkText === '>' || 
              ariaLabel.includes('next')) {
            nextLink = $(el).attr("href");
            return false; // Break the each loop
          }
        });
        
        if (nextLink) break;
      }

      // Construct full URL for next page
      if (nextLink) {
        nextUrl = nextLink.startsWith("http") 
          ? nextLink 
          : `https://opennpi.com${nextLink}`;
        console.log(`🔗 Next page found: ${nextUrl}`);
      } else {
        console.log(`🏁 No more pages found. Pagination complete.`);
        nextUrl = null;
      }

      // Break if no new rows found (might indicate end of data)
      if (pageRows === 0 && pageCount > 1) {
        console.log(`⚠️ No rows found on page ${pageCount}, assuming end of data`);
        break;
      }

    } catch (error) {
      console.error(`❌ Error on page ${pageCount}:`, error.message);
      
      // For 403 errors, try to continue with what we have
      if (error.response?.status === 403) {
        console.log(`🚫 Got 403 on page ${pageCount}, stopping pagination`);
        break;
      }
      
      // For other errors, retry a few times then continue
      if (pageCount <= 3) {
        console.log(`🔄 Retrying page ${pageCount} after error...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      } else {
        console.log(`⏭️ Skipping page ${pageCount} and continuing...`);
        break;
      }
    }
  }

  console.log(`🎉 Pagination complete! Total records: ${allRows.length} from ${pageCount} pages`);
  return allRows;
}

// 🔹 Route 1: Providers list on root "/"
app.get("/", async (req, res) => {
  try {
    const startTime = Date.now();
    const url = "https://opennpi.com/provider";
    
    console.log("🚀 Starting main provider page scrape...");
    
    const response = await fetchWithRetry(url);
    const $ = cheerio.load(response.data);

    let results = [];
    
    // Scrape summary tables
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

    // 🔹 Scrape ALL provider details with enhanced pagination
    console.log("📊 Starting comprehensive provider details scrape...");
    const providerDetailRows = await scrapeTablesWithPagination(url, "#search-result table", 100); // Allow up to 100 pages

    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);

    // Build enhanced HTML response
    let html = `
      <html>
      <head>
        <title>Complete Providers Directory</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; line-height: 1.6; background: #f5f7fa; }
          .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #08326B, #0a4a8a); color: white; padding: 30px; margin: -20px -20px 30px -20px; border-radius: 10px; text-align: center; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
          .header h1 { margin: 0 0 10px 0; font-size: 2.5em; }
          .header p { margin: 5px 0; opacity: 0.9; }
          .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
          .stat-card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center; }
          .stat-number { font-size: 2em; font-weight: bold; color: #08326B; margin-bottom: 5px; }
          .stat-label { color: #666; font-size: 0.9em; }
          .section { background: white; margin: 20px 0; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          h2 { color: #08326B; margin-top: 0; padding-bottom: 10px; border-bottom: 2px solid #e0e7ff; }
          table { width: 100%; border-collapse: collapse; margin: 15px 0; }
          th, td { border: 1px solid #e1e5e9; padding: 12px 8px; text-align: left; }
          th { background: linear-gradient(135deg, #08326B, #0a4a8a); color: #fff; font-weight: 600; }
          tr:nth-child(even) { background: #f8fafc; }
          tr:hover { background: #e8f4fd; }
          a { color: #08326B; text-decoration: none; font-weight: 500; }
          a:hover { text-decoration: underline; color: #0a4a8a; }
          .btn { display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #08326B, #0a4a8a); color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600; text-decoration: none; transition: all 0.3s ease; margin: 10px 5px 10px 0; }
          .btn:hover { background: linear-gradient(135deg, #0a4a8a, #08326B); transform: translateY(-2px); box-shadow: 0 4px 8px rgba(0,0,0,0.2); }
          .loading { text-align: center; padding: 40px; color: #666; }
          .error { background: #fee; border-left: 4px solid #f56565; padding: 15px; margin: 15px 0; border-radius: 4px; }
          .success { background: #f0fff4; border-left: 4px solid #68d391; padding: 15px; margin: 15px 0; border-radius: 4px; }
          @media (max-width: 768px) {
            .container { padding: 10px; }
            .header { padding: 20px; margin: -10px -10px 20px -10px; }
            .header h1 { font-size: 2em; }
            .stats { grid-template-columns: 1fr 1fr; }
            table { font-size: 14px; }
            th, td { padding: 8px 4px; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🏥 Complete Healthcare Providers Directory</h1>
            <p>Comprehensive data from OpenNPI.com</p>
            <p>Scraped in ${duration} seconds • Last updated: ${new Date().toLocaleString()}</p>
          </div>
          
          <div class="stats">
            <div class="stat-card">
              <div class="stat-number">${providerDetailRows.length.toLocaleString()}</div>
              <div class="stat-label">Total Providers</div>
            </div>
            <div class="stat-card">
              <div class="stat-number">${results.length}</div>
              <div class="stat-label">Categories</div>
            </div>
            <div class="stat-card">
              <div class="stat-number">${duration}s</div>
              <div class="stat-label">Scrape Time</div>
            </div>
          </div>
    `;

    // Add success message
    if (providerDetailRows.length > 0) {
      html += `<div class="success">✅ Successfully loaded ${providerDetailRows.length.toLocaleString()} provider records from multiple pages!</div>`;
    }

    // Render provider summary tables
    if (results.length > 0) {
      results.forEach(section => {
        html += `<div class="section">`;
        html += `<h2>${section.heading}</h2>`;
        section.tables.forEach(tableRows => {
          html += `<table><tr><th>#</th><th>Category</th><th>Providers</th><th>Percentage</th></tr>`;
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
    }

    // Render ALL provider details
    if (providerDetailRows.length) {
      html += `<div class="section">`;
      html += `<h2>📋 Complete Provider Database (${providerDetailRows.length.toLocaleString()} Records)</h2>`;
      html += `<button class="btn" onclick="downloadCSV()">📥 Download Complete CSV (${providerDetailRows.length.toLocaleString()} records)</button>`;
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
            <td>${(index + 1).toLocaleString()}</td>
            <td><a href="${row.providerLink}" target="_blank" title="View provider details">${row.providerName}</a></td>
            <td>${row.address}</td>
            <td>${row.taxonomy}</td>
            <td>${row.enumerationDate}</td>
          </tr>
        `;
      });
      html += `</table>`;
      html += `</div>`;

      // Enhanced CSV download script
      html += `
        <script>
          function downloadCSV() {
            const button = event.target;
            button.disabled = true;
            button.textContent = '⏳ Preparing CSV...';
            
            setTimeout(() => {
              const rows = document.querySelectorAll("#provider-details-table tr");
              let csvContent = "\\ufeff"; // UTF-8 BOM for proper Excel display
              
              rows.forEach((row, index) => {
                const cols = row.querySelectorAll("th, td");
                const rowData = Array.from(cols).map(col => {
                  const text = col.innerText.replace(/"/g, '""').replace(/\\n/g, ' ').trim();
                  return '"' + text + '"';
                });
                csvContent += rowData.join(",") + "\\n";
                
                // Show progress for large datasets
                if (index % 1000 === 0) {
                  button.textContent = \`⏳ Processing \${index.toLocaleString()} rows...\`;
                }
              });
              
              const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = \`providers_complete_\${new Date().toISOString().split('T')[0]}.csv\`;
              a.style.display = 'none';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
              
              button.disabled = false;
              button.textContent = '✅ Download Complete CSV';
              setTimeout(() => {
                button.textContent = '📥 Download Complete CSV (${providerDetailRows.length.toLocaleString()} records)';
              }, 3000);
            }, 100);
          }
        </script>
      `;
    } else {
      html += `<div class="error">⚠️ No provider details were retrieved. This might be due to website protection measures or temporary issues.</div>`;
    }

    html += `</div></body></html>`;
    res.send(html);

  } catch (err) {
    console.error("❌ Main scraping error:", err.message);
    const errorHtml = `
      <html>
      <head><title>Scraping Error</title>
      <style>body{font-family:Arial,sans-serif;margin:40px;background:#f5f5f5;}.error{background:white;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1);}</style>
      </head>
      <body>
        <div class="error">
          <h1>🚨 Scraping Error</h1>
          <p><strong>Error:</strong> ${err.message}</p>
          <p><strong>Status:</strong> ${err.response?.status || 'Unknown'}</p>
          <h3>Possible causes:</h3>
          <ul>
            <li>Website blocking automated requests (403 Forbidden)</li>
            <li>Network connectivity issues</li>
            <li>Website structure changes</li>
            <li>Rate limiting or IP blocking</li>
            <li>Server timeout (Vercel 60s limit)</li>
          </ul>
          <p><a href="/" style="color:#08326B;">🔄 Try Again</a></p>
        </div>
      </body>
      </html>
    `;
    res.status(500).send(errorHtml);
  }
});

// 🔹 Route 2: Provider details with enhanced functionality
app.get("/provider-details", async (req, res) => {
  try {
    const pageUrl = req.query.url;
    if (!pageUrl) {
      return res.status(400).send(`
        <html><head><title>Missing Parameter</title></head>
        <body style="font-family:Arial,sans-serif;margin:40px;">
          <h1>❌ Missing URL Parameter</h1>
          <p><a href="/">← Back to Providers</a></p>
        </body></html>
      `);
    }

    const fullUrl = pageUrl.startsWith("http") ? pageUrl : `https://opennpi.com${pageUrl}`;
    
    console.log(`🔍 Fetching specific provider details from: ${fullUrl}`);
    const startTime = Date.now();
    
    const rows = await scrapeTablesWithPagination(fullUrl, "#search-result table", 50);
    
    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);

    let html = `
      <html>
      <head>
        <title>Provider Category Details</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; background: #f5f7fa; }
          .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #08326B, #0a4a8a); color: white; padding: 30px; margin: -20px -20px 30px -20px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
          .nav { margin: 15px 0; }
          .nav a, .btn { display: inline-block; padding: 10px 20px; background: #08326B; color: white; text-decoration: none; border-radius: 6px; margin-right: 10px; font-weight: 500; transition: all 0.3s ease; }
          .nav a:hover, .btn:hover { background: #0a4a8a; transform: translateY(-2px); }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          th, td { border: 1px solid #e1e5e9; padding: 12px 8px; text-align: left; }
          th { background: linear-gradient(135deg, #08326B, #0a4a8a); color: #fff; font-weight: 600; }
          tr:nth-child(even) { background: #f8fafc; }
          tr:hover { background: #e8f4fd; }
          a { color: #08326B; text-decoration: none; font-weight: 500; }
          a:hover { text-decoration: underline; }
          .stats { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center; }
        </style>
        <script>
          function backToProviders() { window.location.href = "/"; }
          function downloadCSV() {
            const button = event.target;
            button.disabled = true;
            button.textContent = '⏳ Generating CSV...';
            
            setTimeout(() => {
              const rows = document.querySelectorAll("#provider-details-table tr");
              let csvContent = "\\ufeff";
              
              rows.forEach(row => {
                const cols = row.querySelectorAll("th, td");
                const rowData = Array.from(cols).map(col => {
                  const text = col.innerText.replace(/"/g, '""').replace(/\\n/g, ' ').trim();
                  return '"' + text + '"';
                });
                csvContent += rowData.join(",") + "\\n";
              });
              
              const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = \`provider_category_\${new Date().toISOString().split('T')[0]}.csv\`;
              a.style.display = 'none';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
              
              button.disabled = false;
              button.textContent = '✅ Downloaded!';
              setTimeout(() => button.textContent = '📥 Download CSV', 2000);
            }, 100);
          }
        </script>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📊 Provider Category Details</h1>
            <p>Found ${rows.length.toLocaleString()} providers • Loaded in ${duration}s</p>
          </div>
          
          <div class="nav">
            <a href="#" onclick="backToProviders()">← Back to Main Directory</a>
            <button class="btn" onclick="downloadCSV()">📥 Download CSV</button>
          </div>
          
          <div class="stats">
            <h3>Total Records: ${rows.length.toLocaleString()}</h3>
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
          <td>${(index + 1).toLocaleString()}</td>
          <td><a href="${row.providerLink}" target="_blank" title="View full provider profile">${row.providerName}</a></td>
          <td>${row.address}</td>
          <td>${row.taxonomy}</td>
          <td>${row.enumerationDate}</td>
        </tr>
      `;
    });

    html += `</table></div></body></html>`;
    res.send(html);

  } catch (err) {
    console.error("❌ Provider details error:", err.message);
    const errorHtml = `
      <html>
      <head><title>Error Loading Details</title>
      <style>body{font-family:Arial,sans-serif;margin:40px;background:#f5f5f5;}.error{background:white;padding:30px;border-radius:8px;}</style>
      </head>
      <body>
        <div class="error">
          <h1>❌ Error Loading Provider Details</h1>
          <p><strong>Error:</strong> ${err.message}</p>
          <p><a href="/" style="color:#08326B;">← Back to Main Directory</a></p>
        </div>
      </body>
      </html>
    `;
    res.status(500).send(errorHtml);
  }
});

// 🔹 Health check for Vercel
app.get("/health", (req, res) => {
  res.json({ 
    status: "OK", 
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development'
  });
});

// 🔹 Vercel-optimized server setup
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}/`);
  });
}

module.exports = app;