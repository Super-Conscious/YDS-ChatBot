/**
 * Cloudflare Pages Function: POST /api/ask
 * Accepts { question }, runs RAG, returns { answer, sources }.
 */

interface Env {
  GEMINI_API_KEY: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_KEY: string
}

interface Body {
  question?: string
}

interface ChunkMatch {
  id: number
  title: string
  url: string
  category: string
  content: string
  similarity: number
}

const EMBED_MODEL = 'models/gemini-embedding-001'
const EMBED_DIMS = 768
const CHAT_MODEL = 'gemini-2.5-flash'

const SYSTEM_PROMPT = `You are a helpful support assistant for Yellow Dog Software, an inventory management platform. Answer questions using ONLY the knowledge base context provided below. If the context doesn't contain enough information to answer, say so honestly — do not make up answers.

When referencing specific features or steps, be precise. If multiple articles are relevant, synthesize the information. Include the source article title when citing specific instructions.

Keep answers concise and actionable.`

async function embed(text: string, apiKey: string): Promise<number[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/${EMBED_MODEL}:embedContent?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: EMBED_MODEL,
      content: { parts: [{ text }] },
      outputDimensionality: EMBED_DIMS,
    }),
  })
  if (!res.ok) throw new Error(`embed failed: ${res.status} ${await res.text()}`)
  const json = await res.json() as { embedding: { values: number[] } }
  return json.embedding.values
}

async function matchChunks(vec: number[], env: Env): Promise<ChunkMatch[]> {
  const url = `${env.SUPABASE_URL}/rest/v1/rpc/match_chunks`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query_embedding: vec,
      match_count: 5,
      match_threshold: 0.3,
    }),
  })
  if (!res.ok) throw new Error(`vector search failed: ${res.status} ${await res.text()}`)
  return res.json() as Promise<ChunkMatch[]>
}

async function generate(context: string, question: string, apiKey: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent?key=${apiKey}`
  const userMessage = `Context from the Yellow Dog knowledge base:\n\n${context}\n\n---\n\nQuestion: ${question}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: 1024, temperature: 0.2 },
    }),
  })
  if (!res.ok) throw new Error(`generate failed: ${res.status} ${await res.text()}`)
  const json = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: Body
  try { body = await request.json() as Body }
  catch { return json({ error: 'invalid JSON' }, 400) }

  const question = body.question?.trim()
  if (!question) return json({ error: 'question is required' }, 400)
  if (question.length > 500) return json({ error: 'question too long (max 500 chars)' }, 400)

  try {
    const vec = await embed(question, env.GEMINI_API_KEY)
    const matches = await matchChunks(vec, env)

    if (matches.length === 0) {
      return json({
        answer: "I couldn't find relevant information in the knowledge base for that question. Try rephrasing, or contact Yellow Dog support directly.",
        sources: [],
      })
    }

    const context = matches
      .map((m, i) => `[Source ${i + 1}: "${m.title}"]\n${m.content}`)
      .join('\n\n---\n\n')
    const answer = await generate(context, question, env.GEMINI_API_KEY)

    const seen = new Set<string>()
    const sources = matches
      .filter(m => { if (seen.has(m.url)) return false; seen.add(m.url); return true })
      .map(m => ({ title: m.title, url: m.url }))

    return json({ answer, sources })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}
