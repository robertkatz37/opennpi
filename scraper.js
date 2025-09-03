const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
const PORT = 3000;

// Route 1: Show providers headings and tables
app.get("/providers", async (req, res) => {
  try {
    const url = "https://opennpi.com/provider";
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    // Collect all sections
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
        </style>
      </head>
      <body>
    `;

    results.forEach(section => {
      html += `<h2>${section.heading}</h2>`;
      section.tables.forEach(tableRows => {
        html += `<table><tr><th>Name / Link</th><th>Providers</th><th>Percent</th></tr>`;
        tableRows.forEach(row => {
          // Update link to go to internal provider-details route
          const internalLink = `/provider-details?url=${encodeURIComponent(row.link)}`;
          html += `
            <tr>
              <td><a href="${internalLink}" target="_blank">${row.text}</a></td>
              <td>${row.providers}</td>
              <td>${row.percent}</td>
            </tr>
          `;
        });
        html += `</table>`;
      });
    });

    html += `</body></html>`;
    res.send(html);

  } catch (err) {
    console.error("Error scraping providers:", err.message);
    res.status(500).send(`<p>Error: ${err.message}</p>`);
  }
});

// Route 2: Fetch provider details table
app.get("/provider-details", async (req, res) => {
  try {
    const pageUrl = req.query.url;
    if (!pageUrl) return res.status(400).send("Missing URL parameter");

    const { data } = await axios.get(pageUrl.startsWith("http") ? pageUrl : `https://opennpi.com${pageUrl}`);
    const $ = cheerio.load(data);

    let rows = [];

    $("#search-result table tbody tr").each((i, tr) => {
      const tds = $(tr).find("td");
      if (tds.length >= 4) {
        const linkTag = $(tds[0]).find("a");
        const providerName = linkTag.text().trim();
        const providerLink = linkTag.attr("href") || "#";
        const address = $(tds[1]).text().trim();
        const taxonomy = $(tds[2]).text().trim();
        const enumerationDate = $(tds[3]).text().trim();

        rows.push({
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
        </style>
      </head>
      <body>
        <h2>Provider Details</h2>
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
