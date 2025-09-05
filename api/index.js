const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
const PORT = process.env.PORT || 7000;

// 🔹 Enhanced axios configuration with rotating user agents and better headers
const createAxiosConfig = (isFirstRequest = false) => {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0'
  ];
  
  const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
  
  return {
    timeout: 30000, // Reduced timeout for Vercel
    maxRedirects: 5,
    headers: {
      'User-Agent': randomUA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': isFirstRequest ? 'none' : 'same-origin',
      'Sec-Fetch-User': isFirstRequest ? '?1' : '?0',
      'Cache-Control': 'max-age=0',
      'DNT': '1',
      'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': randomUA.includes('Windows') ? '"Windows"' : randomUA.includes('Mac') ? '"macOS"' : '"Linux"',
      // Add referer for subsequent requests
      ...(isFirstRequest ? {} : { 'Referer': 'https://opennpi.com/provider' })
    }
  };
};

// 🔹 Smart delay with exponential backoff and jitter
const smartDelay = async (pageNumber, hasError = false) => {
  const baseDelay = hasError ? 5000 : Math.min(2000 + (pageNumber * 500), 8000);
  const jitter = Math.random() * 2000;
  const totalDelay = baseDelay + jitter;
  
  console.log(`⏱️ Waiting ${Math.round(totalDelay/1000)}s before next request...`);
  await new Promise(resolve => setTimeout(resolve, totalDelay));
};

// 🔹 Enhanced retry mechanism with better error handling
async function fetchWithRetry(url, maxRetries = 2, isFirstRequest = false) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Attempt ${attempt}/${maxRetries} for: ${url}`);
      
      // Add delay before retry attempts
      if (attempt > 1) {
        await smartDelay(attempt, true);
      }
      
      const response = await axios.get(url, createAxiosConfig(isFirstRequest));
      
      // Check if we got a valid response
      if (response.status === 200 && response.data && response.data.length > 100) {
        console.log(`✅ Success on attempt ${attempt}`);
        return response;
      } else {
        throw new Error(`Invalid response: status ${response.status}, data length ${response.data?.length || 0}`);
      }
      
    } catch (error) {
      console.error(`❌ Attempt ${attempt} failed:`, error.message);
      console.error(`Status: ${error.response?.status}, StatusText: ${error.response?.statusText}`);
      
      // Handle specific error cases
      if (error.response?.status === 403) {
        console.log(`🚫 Got 403 Forbidden - website blocking requests`);
        if (attempt < maxRetries) {
          console.log(`⏳ Waiting longer before retry due to 403...`);
          await smartDelay(attempt * 2, true);
        }
      } else if (error.response?.status === 429) {
        console.log(`⏳ Rate limited - waiting before retry...`);
        await smartDelay(attempt * 3, true);
      }
      
      if (attempt === maxRetries) {
        throw error;
      }
    }
  }
}

// 🔹 Enhanced scraper with better pagination detection and limits
async function scrapeTablesWithPagination(baseUrl, tableSelector, maxPages = 5) {
  let allRows = [];
  let visited = new Set();
  let nextUrl = baseUrl;
  let pageCount = 0;
  let consecutiveEmptyPages = 0;

  console.log(`🚀 Starting pagination scrape from: ${baseUrl}`);

  while (nextUrl && pageCount < maxPages && consecutiveEmptyPages < 2) {
    // Prevent infinite loops
    if (visited.has(nextUrl)) {
      console.log(`🔄 Already visited: ${nextUrl}, breaking loop`);
      break;
    }
    
    // Stop if we hit the empty URL pattern
    if (nextUrl === "https://opennpi.com/provider?") {
      console.log(`🛑 Hit empty URL pattern, stopping`);
      break;
    }
    
    visited.add(nextUrl);
    pageCount++;

    try {
      // Add smart delay between requests (except first)
      if (pageCount > 1) {
        await smartDelay(pageCount);
      }

      console.log(`📄 Fetching page ${pageCount}/${maxPages}: ${nextUrl}`);
      
      const response = await fetchWithRetry(nextUrl, 2, pageCount === 1);
      const $ = cheerio.load(response.data);

      let pageRows = 0;
      
      // Enhanced table row scraping with better selectors
      const tableSelectors = [
        `${tableSelector} tbody tr`,
        `${tableSelector} tr`,
        '.table tbody tr',
        '#search-result tbody tr',
        'table tbody tr'
      ];
      
      let tableRows = $();
      for (const selector of tableSelectors) {
        tableRows = $(selector).filter((i, tr) => {
          const tds = $(tr).find("td");
          return tds.length >= 4; // Only rows with enough columns
        });
        if (tableRows.length > 0) break;
      }

      tableRows.each((i, tr) => {
        const tds = $(tr).find("td");
        
        const linkTag = $(tds[0]).find("a");
        const providerName = linkTag.text().trim();
        
        // Skip header rows or empty rows
        if (!providerName || 
            providerName.toLowerCase() === 'provider name' || 
            providerName.toLowerCase().includes('no records found')) {
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

      // Track consecutive empty pages
      if (pageRows === 0) {
        consecutiveEmptyPages++;
        console.log(`⚠️ Empty page detected (${consecutiveEmptyPages}/2)`);
      } else {
        consecutiveEmptyPages = 0;
      }

      // Enhanced pagination link detection
      let nextLink = null;
      
      const paginationSelectors = [
        ".page-item.mx-auto a.page-link[href*='?']",
        ".pagination .page-item:not(.disabled) a[href*='?']",
        "a[aria-label='Next'][href*='?']",
        "a:contains('Next')[href*='?']",
        "a:contains('>')[href*='?']"
      ];

      for (const selector of paginationSelectors) {
        const links = $(selector);
        links.each((i, el) => {
          const href = $(el).attr("href");
          const linkText = $(el).text().trim().toLowerCase();
          const ariaLabel = $(el).attr('aria-label')?.toLowerCase() || '';
          const isDisabled = $(el).closest('.page-item').hasClass('disabled') || 
                           $(el).hasClass('disabled');
          
          if (!isDisabled && href && href !== '#' && 
              (linkText === 'next' || linkText === '>' || ariaLabel.includes('next'))) {
            nextLink = href;
            return false; // Break the each loop
          }
        });
        
        if (nextLink) break;
      }

      // Construct full URL for next page
      if (nextLink && nextLink !== '#') {
        nextUrl = nextLink.startsWith("http") 
          ? nextLink 
          : `https://opennpi.com${nextLink}`;
        
        // Validate next URL
        if (nextUrl !== baseUrl && !visited.has(nextUrl)) {
          console.log(`🔗 Next page found: ${nextUrl}`);
        } else {
          console.log(`🏁 Invalid or duplicate next URL, stopping`);
          nextUrl = null;
        }
      } else {
        console.log(`🏁 No more pages found. Pagination complete.`);
        nextUrl = null;
      }

      // Early break conditions for Vercel timeout protection
      if (Date.now() - startTime > 45000) { // 45 second safety margin
        console.log(`⏰ Approaching timeout, stopping at ${allRows.length} records`);
        break;
      }

    } catch (error) {
      console.error(`❌ Error on page ${pageCount}:`, error.message);
      
      // Handle different error types
      if (error.response?.status === 403) {
        console.log(`🚫 Got 403 on page ${pageCount}, likely blocked by anti-bot`);
        break; // Stop pagination on 403
      } else if (error.response?.status === 429) {
        console.log(`⏳ Rate limited on page ${pageCount}, stopping`);
        break;
      } else if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
        console.log(`🔌 Connection issue on page ${pageCount}`);
        break;
      }
      
      // For other errors, continue with what we have
      console.log(`⏭️ Continuing with ${allRows.length} records collected so far`);
      break;
    }
  }

  const endTime = Date.now();
  const totalTime = Math.round((endTime - startTime) / 1000);
  console.log(`🎉 Pagination complete! ${allRows.length} records from ${pageCount} pages in ${totalTime}s`);
  
  return allRows;
}

// Add timing tracking
let startTime;

// 🔹 Route 1: Providers list on root "/"
app.get("/", async (req, res) => {
  startTime = Date.now();
  
  try {
    const url = "https://opennpi.com/provider";
    
    console.log("🚀 Starting main provider page scrape...");
    
    const response = await fetchWithRetry(url, 2, true);
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

    // 🔹 Scrape provider details with reduced pagination for Vercel
    console.log("📊 Starting provider details scrape (limited for Vercel)...");
    const maxPagesForVercel = process.env.NODE_ENV === 'production' ? 3 : 10;
    const providerDetailRows = await scrapeTablesWithPagination(url, "#search-result table", maxPagesForVercel);

    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);

    // Build enhanced HTML response with warning for limited data
    let html = `
      <html>
      <head>
        <title>Healthcare Providers Directory</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; line-height: 1.6; background: #f5f7fa; }
          .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #08326B, #0a4a8a); color: white; padding: 30px; margin: -20px -20px 30px -20px; border-radius: 10px; text-align: center; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
          .header h1 { margin: 0 0 10px 0; font-size: 2.5em; }
          .header p { margin: 5px 0; opacity: 0.9; }
          .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 8px; margin: 20px 0; }
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
            <h1>🏥 Healthcare Providers Directory</h1>
            <p>Data from OpenNPI.com</p>
            <p>Scraped in ${duration} seconds • ${new Date().toLocaleString()}</p>
          </div>
    `;

    // Add warning for production environment
    if (process.env.NODE_ENV === 'production') {
      html += `
        <div class="warning">
          ⚠️ <strong>Limited Data Notice:</strong> Due to Vercel's serverless limitations and anti-bot protections, 
          this deployment shows limited results (first ${maxPagesForVercel} pages only). For complete data scraping, 
          run this application locally or use a dedicated server environment.
        </div>
      `;
    }

    html += `
          <div class="stats">
            <div class="stat-card">
              <div class="stat-number">${providerDetailRows.length.toLocaleString()}</div>
              <div class="stat-label">Providers Found</div>
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
      html += `<div class="success">✅ Successfully loaded ${providerDetailRows.length.toLocaleString()} provider records!</div>`;
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

    // Render provider details
    if (providerDetailRows.length) {
      html += `<div class="section">`;
      html += `<h2>📋 Provider Database (${providerDetailRows.length.toLocaleString()} Records)</h2>`;
      html += `<button class="btn" onclick="downloadCSV()">📥 Download CSV</button>`;
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
              
              rows.forEach((row) => {
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
              a.download = \`providers_\${new Date().toISOString().split('T')[0]}.csv\`;
              a.style.display = 'none';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
              
              button.disabled = false;
              button.textContent = '✅ Download Complete';
              setTimeout(() => {
                button.textContent = '📥 Download CSV';
              }, 2000);
            }, 100);
          }
        </script>
      `;
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
          <h3>Common causes on Vercel:</h3>
          <ul>
            <li><strong>403 Forbidden:</strong> Website detected automated requests</li>
            <li><strong>Timeout:</strong> Exceeded Vercel's 60-second limit</li>
            <li><strong>Rate Limiting:</strong> Too many requests too quickly</li>
            <li><strong>Network Issues:</strong> Temporary connectivity problems</li>
          </ul>
          <p><strong>Solution:</strong> Try running locally for complete data scraping.</p>
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
    startTime = Date.now();
    
    const maxPagesForCategory = process.env.NODE_ENV === 'production' ? 2 : 5;
    const rows = await scrapeTablesWithPagination(fullUrl, "#search-result table", maxPagesForCategory);
    
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
          .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 8px; margin: 20px 0; }
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
              a.download = \`category_\${new Date().toISOString().split('T')[0]}.csv\`;
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
    `;

    // Add warning for production environment
    if (process.env.NODE_ENV === 'production') {
      html += `
        <div class="warning">
          ⚠️ <strong>Limited Results:</strong> Showing first ${maxPagesForCategory} pages only due to Vercel limitations. 
          Run locally for complete category data.
        </div>
      `;
    }

    html += `
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
          <p><strong>Status:</strong> ${err.response?.status || 'Unknown'}</p>
          <p>This might be due to anti-bot protections or Vercel timeouts.</p>
          <p><a href="/" style="color:#08326B;">← Back to Main Directory</a></p>
        </div>
      </body>
      </html>
    `;
    res.status(500).send(errorHtml);
  }
});

// 🔹 API endpoint for JSON data (useful for testing)
app.get("/api/providers", async (req, res) => {
  try {
    const maxPages = parseInt(req.query.pages) || 1;
    const url = "https://opennpi.com/provider";
    
    console.log(`🔌 API request for ${maxPages} pages`);
    
    const providerDetailRows = await scrapeTablesWithPagination(url, "#search-result table", Math.min(maxPages, 5));
    
    res.json({
      success: true,
      totalRecords: providerDetailRows.length,
      maxPagesAllowed: process.env.NODE_ENV === 'production' ? 5 : maxPages,
      data: providerDetailRows,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error("❌ API error:", error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      status: error.response?.status || 'Unknown'
    });
  }
});

// 🔹 Health check for Vercel
app.get("/health", (req, res) => {
  res.json({ 
    status: "OK", 
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
    version: "2.0.0"
  });
});

// 🔹 Add route for robots.txt to be nice to the target website
app.get("/robots.txt", (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *
Disallow: 
Crawl-delay: 10`);
});

// 🔹 Vercel-optimized server setup
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}/`);
    console.log(`📊 API endpoint: http://localhost:${PORT}/api/providers`);
    console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  });
}

module.exports = app;