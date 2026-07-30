// Vercel serverless function — proxies AI summary requests to Anthropic.
// Avoids CORS issues with direct browser → Anthropic API calls.
// API key: from request body (Settings → AI in-app), falling back to ANTHROPIC_API_KEY env var.
//
// SECURITY (standing, see docs/AGENTIC_VISION.md §4.1 + REVIEW_RESPONSE #C4):
// this endpoint has NO auth and NO rate limiting, so setting ANTHROPIC_API_KEY
// in the environment would turn the public deployment into an open proxy for
// that key. The variable is therefore kept UNSET — verified against production
// 2026-07-29 (an unauthenticated POST with no apiKey returns 400, proving no
// server key is in play). It stays unset until Agent 0 ships auth + budgets.
// Do not set it to "test something".

// Server-side deadline for the upstream call, a little under the client's 15s
// (js/agent/policy.js) so the browser receives a real error response instead of
// hitting its own abort — the client timeout is the backstop, not the primary
// path. Without this the function can sit on a hung upstream until Vercel's own
// 300s limit, burning wall-clock for a request nobody is waiting on any more.
const UPSTREAM_TIMEOUT_MS = 13000;

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
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
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

  } catch (err) {
    // A deadline we imposed is reported as such — 504, not a blanket 500 — so
    // the client can say "took too long" rather than blaming the connection.
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      return res.status(504).json({ error: 'The model took too long to respond. Try again in a moment.' });
    }
    return res.status(500).json({ error: 'Failed to reach Anthropic API.' });
  }
};
