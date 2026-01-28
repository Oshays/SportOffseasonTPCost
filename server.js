// server.js — web app version with Express + sortable table

const express = require('express');
const https = require('https');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000; // Vercel uses env PORT

const MAIN_POOL_URL = 'https://api.tenero.io/v1/sportsfun/wallets/0x2EeF466e802Ab2835aB81BE63eEbc55167d35b56/holdings?limit=80';
const MARKET_POOL_URL = 'https://api.tenero.io/v1/sportsfun/wallets/0x4Fdce033b9F30019337dDC5cC028DC023580585e/holdings?limit=80';
const TOTAL_SUPPLY = 25000000;
const CSV_PATH = path.join(__dirname, 'OffSeasonTP.csv'); // CSV must be in repo

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (err) { reject(err); }
      });
    }).on('error', reject);
  });
}

function normalizeName(name) {
  if (!name) return '';
  return name.trim().toLowerCase()
    .replace(/christiian/g, 'christian')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ');
}

// Main logic (same as yours, but returns data instead of saving files)
async function getProcessedData() {
  const mainData = await getJson(MAIN_POOL_URL);
  const mainRows = mainData.data?.rows || [];

  const marketData = await getJson(MARKET_POOL_URL);
  const marketRows = marketData.data?.rows || [];

  const players = {};

  for (const row of mainRows) {
    const addr = row.token_address;
    const token = row.token || {};
    players[addr] = {
      name: token.name || 'Unknown',
      price_usd: Number(token.price_usd) || 0,
      mainBalance: Number(row.balance) || 0,
      marketBalance: 0
    };
  }

  for (const row of marketRows) {
    const addr = row.token_address;
    const token = row.token || {};
    if (!players[addr]) {
      players[addr] = {
        name: token.name || 'Unknown',
        price_usd: Number(token.price_usd) || 0,
        mainBalance: 0,
        marketBalance: Number(row.balance) || 0
      };
    } else {
      players[addr].marketBalance = Number(row.balance) || 0;
    }
  }

  let results = Object.values(players).map(p => ({
    name: p.name,
    price_usd: p.price_usd,
    circulating_balance: TOTAL_SUPPLY - (p.mainBalance + p.marketBalance)
  }));

  // Load CSV TP
  const csvContent = await fs.readFile(CSV_PATH, 'utf8');
  const lines = csvContent.trim().split('\n');
  const tpMap = new Map();

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 2) continue;
    const playerName = parts[0].trim();
    const tp = parseFloat(parts[1]);
    if (!isNaN(tp)) {
      tpMap.set(normalizeName(playerName), tp);
    }
  }

  // Enrich + filter matched
  results = results.map(r => {
    const norm = normalizeName(r.name);
    const tp = tpMap.get(norm);
    const marketCap = r.price_usd * r.circulating_balance;
    return {
      name: r.name,
      price_usd: r.price_usd.toFixed(8),
      circulating_balance: r.circulating_balance.toFixed(2),
      tp_off_season: tp !== undefined ? tp.toFixed(4) : null,
      market_cap: marketCap.toFixed(2),
      price_per_tp: (tp !== undefined && tp > 0) ? (marketCap / tp).toFixed(6) : null
    };
  });

  const matched = results.filter(r => r.price_per_tp !== null);
  matched.sort((a, b) => parseFloat(a.price_per_tp) - parseFloat(b.price_per_tp)); // Lowest price_per_tp first

  return matched;
}

// Routes
app.get('/', async (req, res) => {
  try {
    const data = await getProcessedData();

    // Simple HTML with DataTables for sortable table
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>Player Cost per TP</title>
        <link rel="stylesheet" href="https://cdn.datatables.net/1.13.7/css/jquery.dataTables.min.css">
        <script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
        <script src="https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js"></script>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 8px; text-align: right; border: 1px solid #ddd; }
          th { background: #f2f2f2; cursor: pointer; }
          h1 { text-align: center; }
        </style>
      </head>
      <body>
        <h1>Player Cost per TP (Sorted by Lowest $/TP)</h1>
        <p>Refresh page to update data. Data fetched live from Tenero API + OffSeasonTP.csv.</p>
        <table id="tpTable" class="display">
          <thead>
            <tr>
              <th>Name</th>
              <th>Price (USD)</th>
              <th>Circulating Balance</th>
              <th>TP Off-Season</th>
              <th>Market Cap</th>
              <th>Price per TP</th>
            </tr>
          </thead>
          <tbody>
            ${data.map(row => `
                <tr>
                    <td style="text-align: left;">${row.name}</td>
                    <td style="text-align: right;">$${Number(row.price_usd).toFixed(5)}</td>
                    <td style="text-align: right;">${Number(row.circulating_balance).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                    <td style="text-align: right;">${row.tp_off_season ? Number(row.tp_off_season).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : 'N/A'}</td>
                    <td style="text-align: right;">$${Number(row.market_cap).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                    <td style="text-align: right; font-weight: bold;">$${Number(row.price_per_tp).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })}</td>
                </tr>
            `).join('')}
          </tbody>
        </table>

        <script>
          $(document).ready(function() {
            $('#tpTable').DataTable({
              paging: true,
              searching: true,
              ordering: true,
              order: [[5, 'asc']], // Default sort: price_per_tp ascending (lowest first)
              pageLength: 25
            });
          });
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});