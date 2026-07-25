// Vercel serverless function — turns a natural-language routine description
// ("Matt Damon's Odyssey routine", "4-day upper/lower for hypertrophy") into a
// STRUCTURED plan the user then REVIEWS in the plan editor before saving. This
// only returns a proposal as JSON — it never writes anything.
// API key: from request body (Settings → AI in-app), falling back to the
// ANTHROPIC_API_KEY env var (kept unset in prod → effectively BYOK, same as
// /api/ai-summary).

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, apiKey, exercises } = req.body ?? {};
  const key = apiKey || process.env.ANTHROPIC_API_KEY;

  if (!key) {
    return res.status(400).json({ error: 'No API key configured. Add one in Settings → AI.' });
  }
  if (!prompt || !String(prompt).trim()) {
    return res.status(400).json({ error: 'Describe the routine to import.' });
  }

  const catalogue = Array.isArray(exercises) ? exercises.slice(0, 200) : [];
  const system = `You convert a description of a workout routine into a structured training plan for a gym-logging app.

Return ONLY a single JSON object — no prose, no markdown fences — matching exactly:
{
  "name": string,                    // short plan name
  "duration_weeks": number | null,   // whole weeks, or null if unspecified/ongoing
  "objectives": string[],            // 0-3 short goals
  "days": [
    {
      "name": string,                // e.g. "Push", "Upper A", "Full Body"
      "exercises": [
        { "exercise": string, "sets": number | null, "reps": number | null }
      ]
    }
  ]
}

Rules:
- Prefer exercise names from this catalogue when they match: ${catalogue.join(', ')}.
- If an exercise is not in the catalogue, use a clear common name (it will be added as a custom exercise).
- 1-7 days; each day 1-10 exercises; sets 1-10; reps 1-30 (use null for cardio/timed work).
- If the routine is well known, reflect it faithfully; if the description is vague, build a sensible plan.
- Output valid JSON only.`;

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
        max_tokens: 2500,
        fallbacks: [{ model: 'claude-opus-4-8' }],
        system,
        messages: [{ role: 'user', content: String(prompt).slice(0, 2000) }],
      }),
    });

    if (!upstream.ok) {
      let msg = `API error (${upstream.status})`;
      try { const e = await upstream.json(); msg = e.error?.message ?? msg; } catch (_) {}
      return res.status(upstream.status).json({ error: msg });
    }

    const data = await upstream.json();
    // Fable 5 content arrays include a thinking block before the text block.
    const text = data.content?.find(b => b.type === 'text')?.text ?? '';
    const plan = _extractJSON(text);
    if (!plan) {
      return res.status(502).json({ error: 'Could not read a plan from the AI response. Try rephrasing.' });
    }
    return res.status(200).json({ plan });

  } catch (_) {
    return res.status(500).json({ error: 'Failed to reach Anthropic API.' });
  }
};

// Pull the first well-formed JSON object out of the model text — tolerant of
// stray prose or ```json fences despite the instruction to omit them.
function _extractJSON(text) {
  if (!text) return null;
  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch (_) { return null; }
}
