// Vercel serverless function — proxies AI summary requests to Anthropic.
// Avoids CORS issues with direct browser → Anthropic API calls.
// API key: from request body (Settings → AI in-app), falling back to ANTHROPIC_API_KEY env var.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { context, apiKey } = req.body ?? {};
  const key = apiKey || process.env.ANTHROPIC_API_KEY;

  if (!key) {
    return res.status(400).json({
      error: 'No API key configured. Add one in Settings → AI.',
    });
  }

  if (!context) {
    return res.status(400).json({ error: 'No session context provided.' });
  }

  const prompt = `You are a personal trainer reviewing a gym workout. Give a brief, motivating 2-3 sentence summary highlighting key achievements or progressions. Be specific and encouraging.

Today's workout:
${context}`;

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-06-01',
      },
      body: JSON.stringify({
        model: 'claude-fable-5',
        max_tokens: 350,
        fallbacks: [{ model: 'claude-opus-4-8' }],
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!upstream.ok) {
      let msg = `API error (${upstream.status})`;
      try { const e = await upstream.json(); msg = e.error?.message ?? msg; } catch (_) {}
      return res.status(upstream.status).json({ error: msg });
    }

    const data = await upstream.json();
    // Fable 5 content arrays include a thinking block before the text block — find by type.
    const text = data.content?.find(b => b.type === 'text')?.text;
    return res.status(200).json({ text: text || 'Great workout — keep it up!' });

  } catch (_) {
    return res.status(500).json({ error: 'Failed to reach Anthropic API.' });
  }
};
