const express = require("express");
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

const app = express();
const PORT = process.env.PORT || 7000;

// 🔹 Puppeteer configuration optimized for Vercel
const getPuppeteerConfig = async () => {
  if (process.env.NODE_ENV === 'production') {
    // Production/Vercel configuration
    return {
      args: [
        ...chromium.args,
        '--hide-scrollbars',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    };
  } else {
    // Local development configuration
    return {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ],
      ignoreHTTPSErrors: true,
    };
  }
};

// 🔹 Smart delay function to avoid rate limiting
const smartDelay = async (pageNumber) => {
  const baseDelay = Math.min(1000 + (pageNumber * 500), 4000);
  const jitter = Math.random() * 1000;
  const totalDelay = baseDelay + jitter;
  console.log(`⏳ Waiting ${Math.round(totalDelay)}ms before next request...`);
  await new Promise(resolve => setTimeout(resolve, totalDelay));
};

// 🔹 Enhanced scraper with Puppeteer pagination
async function scrapeTablesWithPuppeteer(baseUrl, maxPages = 50) {
  let allRows = [];
  let pageCount = 0;
  let browser;

  try {
    console.log(`🚀 Starting Puppeteer browser...`);
    const config = await getPuppeteerConfig();
    browser = await puppeteer.launch(config);
    
    const page = await browser.newPage();
    
    // Set user agent and other headers to appear more like a real browser
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    });

    // Set viewport
    await page.setViewport({ width: 1920, height: 1080 });

    let currentUrl = baseUrl;
    let visited = new Set();

    console.log(`📄 Starting pagination scrape from: ${baseUrl}`);

    while (currentUrl && pageCount < maxPages) {
      if (visited.has(currentUrl)) {
        console.log(`Already visited: ${currentUrl}, breaking loop`);
        break;
      }
      
      visited.add(currentUrl);
      pageCount++;

      try {
        if (pageCount > 1) {
          await smartDelay(pageCount);
        }

        console.log(`📄 Loading page ${pageCount}: ${currentUrl}`);
        
        // Navigate with extended timeout
        await page.goto(currentUrl, { 
          waitUntil: 'networkidle2', 
          timeout: 45000 
        });

        // Wait for the table to load
        await page.waitForSelector('#search-result table, table', { timeout: 10000 });

        // Extract data from the page
        const pageRows = await page.evaluate(() => {
          const rows = [];
          const tableRows = document.querySelectorAll('#search-result table tbody tr, #search-result table tr, table tbody tr, table tr');
          
          tableRows.forEach(tr => {
            const tds = tr.querySelectorAll('td');
            if (tds.length >= 4) {
              const linkElement = tds[0].querySelector('a');
              const providerName = linkElement ? linkElement.textContent.trim() : tds[0].textContent.trim();
              
              // Skip header rows
              if (!providerName || providerName.toLowerCase() === 'provider name') {
                return;
              }

              const providerLink = linkElement ? linkElement.href : '#';
              const address = tds[1].textContent.trim();
              const taxonomy = tds[2].textContent.trim();
              const enumerationDate = tds[3].textContent.trim();

              rows.push({
                providerName,
                providerLink: providerLink.startsWith('http') ? providerLink : `https://opennpi.com${providerLink}`,
                address,
                taxonomy,
                enumerationDate
              });
            }
          });
          
          return rows;
        });

        console.log(`✅ Page ${pageCount}: Found ${pageRows.length} rows (Total: ${allRows.length + pageRows.length})`);
        allRows = allRows.concat(pageRows);

        // Look for next page link
        const nextUrl = await page.evaluate(() => {
          // Try different selectors for pagination
          const selectors = [
            '.page-item.mx-auto a.page-link',
            '.pagination .page-item a',
            'a[aria-label="Next"]',
            '.next-page',
            'a:contains("Next")',
            'a:contains(">")'
          ];

          for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
              const text = el.textContent.trim().toLowerCase();
              const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';
              
              if (text === 'next page' || text === 'next' || text === '>' || 
                  ariaLabel.includes('next')) {
                return el.href;
              }
            }
          }

          // Alternative: look for numeric pagination
          const pageLinks = document.querySelectorAll('a[href*="page="], a[href*="p="]');
          let maxPageNum = 0;
          let nextPageLink = null;
          
          pageLinks.forEach(link => {
            const href = link.href;
            const pageMatch = href.match(/(?:page=|p=)(\d+)/);
            if (pageMatch) {
              const pageNum = parseInt(pageMatch[1]);
              if (pageNum > maxPageNum) {
                maxPageNum = pageNum;
                nextPageLink = href;
              }
            }
          });

          return nextPageLink;
        });

        if (nextUrl && !visited.has(nextUrl)) {
          currentUrl = nextUrl;
          console.log(`🔗 Next page found: ${currentUrl}`);
        } else {
          console.log(`🏁 No more pages found. Pagination complete.`);
          currentUrl = null;
        }

        // Break if no new rows found
        if (pageRows.length === 0 && pageCount > 1) {
          console.log(`⚠️ No rows found on page ${pageCount}, assuming end of data`);
          break;
        }

      } catch (error) {
        console.error(`❌ Error on page ${pageCount}:`, error.message);
        
        // Take screenshot for debugging if possible
        try {
          await page.screenshot({ path: `error-page-${pageCount}.png` });
        } catch (screenshotError) {
          console.log('Could not take screenshot');
        }

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

  } catch (error) {
    console.error('❌ Browser error:', error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  console.log(`🎉 Scraping complete! Total records: ${allRows.length} from ${pageCount} pages`);
  return allRows;
}

// 🔹 Function to scrape summary tables from main page
async function scrapeSummaryTables(url) {
  let browser;
  
  try {
    const config = await getPuppeteerConfig();
    browser = await puppeteer.launch(config);
    const page = await browser.newPage();
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    const summaryData = await page.evaluate(() => {
      const results = [];
      const sections = document.querySelectorAll('.px-1 .col-12');
      
      sections.forEach(section => {
        const heading = section.querySelector('h3')?.textContent?.trim();
        if (!heading || heading === "Providers by Year") return;

        const tables = [];
        section.querySelectorAll('table').forEach(table => {
          const tableRows = [];
          table.querySelectorAll('tr').forEach(tr => {
            const tds = tr.querySelectorAll('td');
            if (tds.length >= 3) {
              const linkEl = tds[0].querySelector('a');
              const text = tds[0].textContent.trim();
              const link = linkEl ? linkEl.getAttribute('href') : '#';
              const providers = tds[1].textContent.trim();
              const percent = tds[2].textContent.trim();
              tableRows.push({ text, link, providers, percent });
            }
          });
          if (tableRows.length) tables.push(tableRows);
        });

        if (tables.length) results.push({ heading, tables });
      });

      return results;
    });

    return summaryData;
  } finally {
    if (browser) await browser.close();
  }
}

// 🔹 Route 1: Main providers page
app.get("/", async (req, res) => {
  try {
    const startTime = Date.now();
    const url = "https://opennpi.com/provider";
    
    console.log("🚀 Starting Puppeteer scraper...");
    
    // Scrape summary tables
    console.log("📊 Scraping summary tables...");
    const summaryResults = await scrapeSummaryTables(url);
    
    // Scrape all provider details with pagination
    console.log("📋 Scraping all provider details...");
    const providerDetailRows = await scrapeTablesWithPuppeteer(url, 100);

    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);

    // Generate HTML response
    let html = `
      <html>
      <head>
        <title>Complete Providers Directory (Puppeteer)</title>
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
          .success { background: #f0fff4; border-left: 4px solid #68d391; padding: 15px; margin: 15px 0; border-radius: 4px; }
          .puppeteer-badge { background: linear-gradient(45deg, #ff6b6b, #4ecdc4); color: white; padding: 5px 12px; border-radius: 20px; font-size: 0.8em; font-weight: 600; display: inline-block; margin-left: 10px; }
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
            <h1>🏥 Complete Healthcare Providers Directory <span class="puppeteer-badge">🤖 Puppeteer Powered</span></h1>
            <p>Comprehensive data scraped with headless Chrome from OpenNPI.com</p>
            <p>Scraped in ${duration} seconds • Last updated: ${new Date().toLocaleString()}</p>
          </div>
          
          <div class="stats">
            <div class="stat-card">
              <div class="stat-number">${providerDetailRows.length.toLocaleString()}</div>
              <div class="stat-label">Total Providers</div>
            </div>
            <div class="stat-card">
              <div class="stat-number">${summaryResults.length}</div>
              <div class="stat-label">Categories</div>
            </div>
            <div class="stat-card">
              <div class="stat-number">${duration}s</div>
              <div class="stat-label">Scrape Time</div>
            </div>
            <div class="stat-card">
              <div class="stat-number">Chrome</div>
              <div class="stat-label">Headless Browser</div>
            </div>
          </div>
    `;

    if (providerDetailRows.length > 0) {
      html += `<div class="success">✅ Successfully loaded ${providerDetailRows.length.toLocaleString()} provider records using Puppeteer headless browser!</div>`;
    }

    // Render summary tables
    summaryResults.forEach(section => {
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

    // Render provider details table
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
            const button = event.target;
            button.disabled = true;
            button.textContent = '⏳ Preparing CSV...';
            
            setTimeout(() => {
              const rows = document.querySelectorAll("#provider-details-table tr");
              let csvContent = "\\ufeff";
              
              rows.forEach((row, index) => {
                const cols = row.querySelectorAll("th, td");
                const rowData = Array.from(cols).map(col => {
                  const text = col.innerText.replace(/"/g, '""').replace(/\\n/g, ' ').trim();
                  return '"' + text + '"';
                });
                csvContent += rowData.join(",") + "\\n";
                
                if (index % 1000 === 0) {
                  button.textContent = \`⏳ Processing \${index.toLocaleString()} rows...\`;
                }
              });
              
              const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = \`providers_complete_puppeteer_\${new Date().toISOString().split('T')[0]}.csv\`;
              a.style.display = 'none';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
              
              button.disabled = false;
              button.textContent = '✅ Download Complete!';
              setTimeout(() => {
                button.textContent = '📥 Download Complete CSV (${providerDetailRows.length.toLocaleString()} records)';
              }, 3000);
            }, 100);
          }
        </script>
      `;
    }

    html += `</div></body></html>`;
    res.send(html);

  } catch (err) {
    console.error("❌ Puppeteer scraping error:", err.message);
    const errorHtml = `
      <html>
      <head><title>Puppeteer Scraping Error</title>
      <style>body{font-family:Arial,sans-serif;margin:40px;background:#f5f5f5;}.error{background:white;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1);}</style>
      </head>
      <body>
        <div class="error">
          <h1>🚨 Puppeteer Scraping Error</h1>
          <p><strong>Error:</strong> ${err.message}</p>
          <h3>Possible causes:</h3>
          <ul>
            <li>Puppeteer/Chromium initialization failure</li>
            <li>Memory limits exceeded</li>
            <li>Network connectivity issues</li>
            <li>Website structure changes</li>
            <li>Timeout errors</li>
          </ul>
          <p><a href="/" style="color:#08326B;">🔄 Try Again</a></p>
        </div>
      </body>
      </html>
    `;
    res.status(500).send(errorHtml);
  }
});

// 🔹 Route 2: Provider details with Puppeteer
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
    
    console.log(`🔍 Fetching provider details with Puppeteer: ${fullUrl}`);
    const startTime = Date.now();
    
    const rows = await scrapeTablesWithPuppeteer(fullUrl, 50);
    
    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);

    // Generate HTML response
    let html = `
      <html>
      <head>
        <title>Provider Category Details (Puppeteer)</title>
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
          .puppeteer-badge { background: linear-gradient(45deg, #ff6b6b, #4ecdc4); color: white; padding: 5px 12px; border-radius: 20px; font-size: 0.8em; font-weight: 600; display: inline-block; margin-left: 10px; }
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
              a.download = \`provider_category_puppeteer_\${new Date().toISOString().split('T')[0]}.csv\`;
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
            <h1>📊 Provider Category Details <span class="puppeteer-badge">🤖 Puppeteer</span></h1>
            <p>Found ${rows.length.toLocaleString()} providers • Loaded in ${duration}s</p>
          </div>
          
          <div class="nav">
            <a href="#" onclick="backToProviders()">← Back to Main Directory</a>
            <button class="btn" onclick="downloadCSV()">📥 Download CSV</button>
          </div>
          
          <div class="stats">
            <h3>Total Records: ${rows.length.toLocaleString()}</h3>
            <p>Scraped using headless Chrome browser</p>
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
          <td><a href="${row.providerLink}" target="_blank">${row.providerName}</a></td>
          <td>${row.address}</td>
          <td>${row.taxonomy}</td>
          <td>${row.enumerationDate}</td>
        </tr>
      `;
    });

    html += `</table></div></body></html>`;
    res.send(html);

  } catch (err) {
    console.error("❌ Puppeteer provider details error:", err.message);
    const errorHtml = `
      <html>
      <head><title>Error Loading Details</title>
      <style>body{font-family:Arial,sans-serif;margin:40px;background:#f5f5f5;}.error{background:white;padding:30px;border-radius:8px;}</style>
      </head>
      <body>
        <div class="error">
          <h1>❌ Error Loading Provider Details</h1>
          <p><strong>Error:</strong> ${err.message}</p>
          <h3>Possible causes:</h3>
          <ul>
            <li>Invalid or malformed URL</li>
            <li>Puppeteer browser failed to load</li>
            <li>Target page is unreachable</li>
            <li>Memory or timeout limits exceeded</li>
            <li>Website structure changes</li>
          </ul>
          <p><a href="/" style="color:#08326B;">← Back to Main Directory</a></p>
        </div>
      </body>
      </html>
    `;
    res.status(500).send(errorHtml);
  }
});

// 🔹 Route 3: Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: "2.0.0-puppeteer",
    engine: "Puppeteer + Chromium"
  });
});

// 🔹 Route 4: API endpoint for raw JSON data
app.get("/api/providers", async (req, res) => {
  try {
    const maxPages = parseInt(req.query.maxPages) || 10;
    const url = req.query.url || "https://opennpi.com/provider";
    
    console.log(`🔌 API request: Scraping ${url} with max ${maxPages} pages`);
    
    const startTime = Date.now();
    const rows = await scrapeTablesWithPuppeteer(url, maxPages);
    const endTime = Date.now();
    
    res.json({
      success: true,
      totalRecords: rows.length,
      scrapeDuration: Math.round((endTime - startTime) / 1000),
      timestamp: new Date().toISOString(),
      engine: "Puppeteer",
      data: rows,
      metadata: {
        source: url,
        maxPagesRequested: maxPages,
        actualPagesScraped: rows.length > 0 ? Math.ceil(rows.length / 20) : 0
      }
    });
  } catch (error) {
    console.error("❌ API error:", error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      engine: "Puppeteer"
    });
  }
});

// 🔹 Route 5: Search functionality
app.get("/search", async (req, res) => {
  const searchTerm = req.query.q;
  const searchType = req.query.type || 'name'; // name, taxonomy, address
  
  if (!searchTerm) {
    return res.status(400).json({
      error: "Missing search query parameter 'q'"
    });
  }

  try {
    console.log(`🔍 Search request: "${searchTerm}" in ${searchType}`);
    
    // Build search URL based on OpenNPI search functionality
    let searchUrl = `https://opennpi.com/provider?q=${encodeURIComponent(searchTerm)}`;
    if (searchType === 'taxonomy') {
      searchUrl = `https://opennpi.com/provider?taxonomy=${encodeURIComponent(searchTerm)}`;
    } else if (searchType === 'address') {
      searchUrl = `https://opennpi.com/provider?address=${encodeURIComponent(searchTerm)}`;
    }

    const startTime = Date.now();
    const results = await scrapeTablesWithPuppeteer(searchUrl, 20);
    const endTime = Date.now();

    // Filter results further if needed (client-side filtering)
    const filteredResults = results.filter(row => {
      const searchLower = searchTerm.toLowerCase();
      switch (searchType) {
        case 'name':
          return row.providerName.toLowerCase().includes(searchLower);
        case 'taxonomy':
          return row.taxonomy.toLowerCase().includes(searchLower);
        case 'address':
          return row.address.toLowerCase().includes(searchLower);
        default:
          return row.providerName.toLowerCase().includes(searchLower) ||
                 row.taxonomy.toLowerCase().includes(searchLower) ||
                 row.address.toLowerCase().includes(searchLower);
      }
    });

    res.json({
      success: true,
      query: searchTerm,
      searchType: searchType,
      totalResults: filteredResults.length,
      scrapeDuration: Math.round((endTime - startTime) / 1000),
      timestamp: new Date().toISOString(),
      results: filteredResults
    });

  } catch (error) {
    console.error("❌ Search error:", error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      query: searchTerm
    });
  }
});

// 🔹 Route 6: Statistics and analytics
app.get("/stats", async (req, res) => {
  try {
    console.log("📊 Generating statistics...");
    const url = "https://opennpi.com/provider";
    
    // Get summary data
    const summaryData = await scrapeSummaryTables(url);
    
    // Get sample of providers for analysis
    const sampleProviders = await scrapeTablesWithPuppeteer(url, 5);
    
    // Analyze the data
    const taxonomyCount = {};
    const stateCount = {};
    const yearCount = {};
    
    sampleProviders.forEach(provider => {
      // Count taxonomies
      if (provider.taxonomy) {
        taxonomyCount[provider.taxonomy] = (taxonomyCount[provider.taxonomy] || 0) + 1;
      }
      
      // Extract state from address
      const addressParts = provider.address.split(',');
      if (addressParts.length >= 2) {
        const state = addressParts[addressParts.length - 1].trim().split(' ')[0];
        stateCount[state] = (stateCount[state] || 0) + 1;
      }
      
      // Extract year from enumeration date
      if (provider.enumerationDate) {
        const year = provider.enumerationDate.split('/')[2] || provider.enumerationDate.split('-')[0];
        if (year && year.length === 4) {
          yearCount[year] = (yearCount[year] || 0) + 1;
        }
      }
    });

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      sampleSize: sampleProviders.length,
      summaryCategories: summaryData.length,
      analytics: {
        topTaxonomies: Object.entries(taxonomyCount)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 10)
          .map(([name, count]) => ({ name, count })),
        topStates: Object.entries(stateCount)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 10)
          .map(([state, count]) => ({ state, count })),
        enumerationYears: Object.entries(yearCount)
          .sort(([,a], [,b]) => b - a)
          .map(([year, count]) => ({ year, count }))
      },
      summaryData: summaryData
    });

  } catch (error) {
    console.error("❌ Stats error:", error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 🔹 Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Global error:', err.stack);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    timestamp: new Date().toISOString()
  });
});

// 🔹 404 handler
app.use((req, res) => {
  res.status(404).send(`
    <html>
    <head>
      <title>404 - Page Not Found</title>
      <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f7fa; }
        .container { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 500px; margin: 0 auto; }
        h1 { color: #08326B; margin-bottom: 20px; }
        a { color: #08326B; text-decoration: none; font-weight: bold; }
        a:hover { text-decoration: underline; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🔍 404 - Page Not Found</h1>
        <p>The requested page could not be found.</p>
        <h3>Available endpoints:</h3>
        <ul style="text-align: left;">
          <li><a href="/">/ - Main providers directory</a></li>
          <li><a href="/provider-details?url=/provider">/provider-details - Category details</a></li>
          <li><a href="/api/providers">/api/providers - JSON API</a></li>
          <li><a href="/search?q=doctor">/search - Search providers</a></li>
          <li><a href="/stats">/stats - Statistics</a></li>
          <li><a href="/health">/health - Health check</a></li>
        </ul>
        <p><a href="/">← Go to Home</a></p>
      </div>
    </body>
    </html>
  `);
});

// 🔹 Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  process.exit(0);
});

// 🔹 Start server
app.listen(PORT, () => {
  console.log(`🚀 Puppeteer Healthcare Providers Scraper Server`);
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🌐 Access at: http://localhost:${PORT}`);
  console.log(`🤖 Engine: Puppeteer + Chromium`);
  console.log(`📊 Available endpoints:`);
  console.log(`   • / - Main directory`);
  console.log(`   • /provider-details?url=<url> - Category details`);
  console.log(`   • /api/providers - JSON API`);
  console.log(`   • /search?q=<term> - Search functionality`);
  console.log(`   • /stats - Analytics`);
  console.log(`   • /health - Health check`);
  console.log(`⚡ Ready for requests!`);
});

// 🔹 Export for serverless environments
module.exports = app;