const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const router = express.Router();

router.get('/search', async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: 'Query parameter q is required' });
  }

  try {
    // We scrape DuckDuckGo Lite for the core index (no tracking, pure HTML)
    const response = await axios.post('https://lite.duckduckgo.com/lite/', `q=${encodeURIComponent(query)}`, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 RemoteShieldX/2.2'
      }
    });

    const $ = cheerio.load(response.data);
    const results = [];

    // DuckDuckGo Lite uses simple tables for results
    // The link is usually on the first TR (class result-url or just an anchor)
    // The snippet is on the next TR.
    $('table tr').each((i, el) => {
      const snippetEl = $(el).find('.result-snippet');

      if (snippetEl.length) {
        // Since we iterate through all rows, we match the row containing the snippet
        // and fetch data from the previous row
        const titleRow = $(el).prev();
        
        let url = titleRow.find('a').last().attr('href') || titleRow.find('.result-url').attr('href');
        const title = titleRow.find('.result-title').text().trim() || titleRow.find('a').first().text().trim();
        const snippet = snippetEl.text().trim();

        if (title && url && url.startsWith('http')) {
          results.push({
            title,
            url,
            snippet
          });
        }
      }
    });

    // Send the structured data
    res.json({
      meta: {
        provider: 'Laila Core v1.0',
        query,
        count: results.length
      },
      results
    });
  } catch (error) {
    console.error('Laila Search Engine Error:', error.message);
    res.status(500).json({ error: 'Failed to access the Laila upstream meta-index.' });
  }
});

module.exports = router;
