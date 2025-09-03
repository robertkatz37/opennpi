const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
const PORT = 7000;

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

// 🔹 Route 1: Providers list
app.get("/providers", async (req, res) => {
  try {
    const url = "https://opennpi.com/provider";
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    let results = [];
    $(".px-1 .col-12").each((i, el) => {
      const heading = $(el).find("h3").text().trim();
      if (!heading) return;

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
    const providerDetailRows = await scrapeTablesWithPagination(url, "#search-result table");

    // Build HTML with spinner
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
          a { color: #08326B; text-decoration: none; cursor: pointer; }
          a:hover { text-decoration: underline; }

          #overlay {
            display: none;
            position: fixed; top:0; left:0; right:0; bottom:0;
            background: rgba(255,255,255,0.8);
            z-index: 9999;
            display: flex; justify-content: center; align-items: center;
            font-size: 20px; color: #08326B;
          }
        </style>
        <script>
          function showSpinnerAndGo(link) {
            document.getElementById("overlay").style.display = "flex";
            window.location.href = link;
          }

          window.addEventListener("load", () => {
            const overlay = document.getElementById("overlay");
            if (overlay) overlay.style.display = "none";
          });
        </script>
      </head>
      <body>
        <div id="overlay">⏳ Loading... Please wait</div>
    `;

    // Render provider summary tables
    results.forEach(section => {
      html += `<h2>${section.heading}</h2>`;
      section.tables.forEach(tableRows => {
        html += `<table><tr><th>Name / Link</th><th>Providers</th><th>Percent</th></tr>`;
        tableRows.forEach(row => {
          const internalLink = `/provider-details?url=${encodeURIComponent(row.link)}`;
          html += `
            <tr>
              <td><a onclick="showSpinnerAndGo('${internalLink}')">${row.text}</a></td>
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
      html += `<h2>All Providers (from #search-result table)</h2>`;
      html += `<table>
        <tr>
          <th>Provider Name</th>
          <th>Address</th>
          <th>Taxonomy</th>
          <th>Enumeration Date</th>
        </tr>
      `;
      providerDetailRows.forEach(row => {
        html += `
          <tr>
            <td><a href="${row.providerLink}" target="_blank">${row.providerName}</a></td>
            <td>${row.address}</td>
            <td>${row.taxonomy}</td>
            <td>${row.enumerationDate}</td>
          </tr>
        `;
      });
      html += `</table>`;
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
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background: #08326B; color: #fff; }
          tr:nth-child(even) { background: #f9f9f9; }
          a { color: #08326B; text-decoration: none; }
          a:hover { text-decoration: underline; }

          #overlay {
            display: flex; justify-content: center; align-items: center;
            position: fixed; top:0; left:0; right:0; bottom:0;
            background: rgba(255,255,255,0.8); font-size: 20px; color: #08326B;
            z-index: 9999;
          }
        </style>
        <script>
          function hideSpinner() {
            const overlay = document.getElementById("overlay");
            if (overlay) overlay.style.display = "none";
          }
          window.addEventListener("load", hideSpinner);
          function backToProviders() {
            hideSpinner();
            window.location.href = "/providers";
          }
        </script>
      </head>
      <body>
        <div id="overlay">⏳ Loading provider details... Please wait</div>
        <h2>Provider Details (Total: ${rows.length})</h2>
        <a onclick="backToProviders()">⬅ Back to Providers</a>
        <table>
          <tr>
            <th>Provider Name</th>
            <th>Address</th>
            <th>Taxonomy</th>
            <th>Enumeration Date</th>
          </tr>
    `;

    rows.forEach(row => {
      html += `
        <tr>
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

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}/providers`);
});
