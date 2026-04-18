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
    const results = [];
    
    // Fire concurrent fetches to native JSON nodes to bypass HTML Captchas
    const [ddgRes, wikiRes] = await Promise.allSettled([
      axios.get(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`),
      axios.get(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json`)
    ]);

    // Parse DuckDuckGo Instant Answers & Deep Links
    if (ddgRes.status === 'fulfilled' && ddgRes.value.data) {
      const data = ddgRes.value.data;
      if (data.AbstractText) {
        results.push({
          title: data.Heading || `${query} (Instant Answer)`,
          url: data.AbstractURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
          snippet: data.AbstractText
        });
      }
      
      if (Array.isArray(data.RelatedTopics)) {
        data.RelatedTopics.forEach(topic => {
          if (topic.FirstURL && topic.Text) {
            // Text is often "Topic - Description", let's split it nicely
            const parts = topic.Text.split(' - ');
            results.push({
              title: parts[0] || query,
              url: topic.FirstURL,
              snippet: parts.slice(1).join(' - ') || topic.Text
            });
          }
        });
      }
    }

    // Parse Wikipedia Semantic Search
    if (wikiRes.status === 'fulfilled' && wikiRes.value.data?.query?.search) {
      wikiRes.value.data.query.search.forEach(item => {
        results.push({
          title: `${item.title} - Wikipedia`,
          url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title)}`,
          // Strip HTML tags from wikipedia snippet
          snippet: item.snippet.replace(/<[^>]*>?/gm, '') + '...'
        });
      });
    }

    // De-duplicate URLs securely
    const uniqueResults = [];
    const seenUrls = new Set();
    for (const r of results) {
      if (!seenUrls.has(r.url)) {
        seenUrls.add(r.url);
        uniqueResults.push(r);
      }
    }

    // Send the structured data safely to the Laila Frontend UI
    res.json({
      meta: {
        provider: 'Laila Neural Net',
        query,
        count: uniqueResults.length
      },
      results: uniqueResults
    });
  } catch (error) {
    console.error('Laila Search Engine Error:', error.message);
    res.status(500).json({ error: 'Failed to access the Laila upstream meta-index.' });
  }
});

module.exports = router;
