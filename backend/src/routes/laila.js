const express = require('express');
const axios = require('axios');
const { Joi,validate }=require('../services/validation');

const router = express.Router();

router.get('/search', async (req, res,next) => {
  try {
    const query=validate(Joi.string().min(1).max(500).required(),req.query.q);
    const results = [];
    
    // Fire concurrent fetches to native JSON nodes to bypass HTML Captchas
    const [ddgRes, wikiRes] = await Promise.allSettled([
      axios.get(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`,{ timeout:5000,maxContentLength:1024*1024,maxRedirects:0 }),
      axios.get(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json`,{ timeout:5000,maxContentLength:1024*1024,maxRedirects:0 })
    ]);
    if (ddgRes.status==='rejected' && wikiRes.status==='rejected') throw Object.assign(new Error('Upstream unavailable'),{ status:503,code:'UPSTREAM_UNAVAILABLE' });

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
        provider: 'Laila Search',
        query,
        count: uniqueResults.length
      },
      results: uniqueResults
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
