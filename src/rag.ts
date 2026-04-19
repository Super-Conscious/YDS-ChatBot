/**
 * RAG pipeline: embed question → vector search → Gemini answer.
 */
import { sb } from './supabase.js'
import { embedSingle } from './embeddings.js'

const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_API = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

interface ChunkMatch {
  id: number
  title: string
  url: string
  category: string
  content: string
  similarity: number
}

const SYSTEM_PROMPT = `You are a helpful support assistant for Yellow Dog Software, an inventory management platform. Answer questions using ONLY the knowledge base context provided below. If the context doesn't contain enough information to answer, say so honestly — do not make up answers.

When referencing specific features or steps, be precise. If multiple articles are relevant, synthesize the information. Include the source article title when citing specific instructions.

Keep answers concise and actionable.`

export async function ask(question: string): Promise<{ answer: string; sources: { title: string; url: string }[] }> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not set')

  const questionVec = await embedSingle(question)

  const { data: chunks, error } = await sb.rpc('match_chunks', {
    query_embedding: questionVec,
    match_count: 5,
    match_threshold: 0.3,
  })

  if (error) throw new Error(`Vector search failed: ${error.message}`)

  const matches = (chunks ?? []) as ChunkMatch[]

  if (matches.length === 0) {
    return {
      answer: "I couldn't find relevant information in the knowledge base for that question. Could you try rephrasing, or contact Yellow Dog support directly?",
      sources: [],
    }
  }

  const context = matches
    .map((m, i) => `[Source ${i + 1}: "${m.title}"]\n${m.content}`)
    .join('\n\n---\n\n')

  const userMessage = `Context from the Yellow Dog knowledge base:\n\n${context}\n\n---\n\nQuestion: ${question}`

  const res = await fetch(`${GEMINI_API}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: 1024, temperature: 0.2 },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini generation failed: ${res.status} ${err}`)
  }

  const json = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const answer = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

  const seen = new Set<string>()
  const sources = matches
    .filter(m => {
      if (seen.has(m.url)) return false
      seen.add(m.url)
      return true
    })
    .map(m => ({ title: m.title, url: m.url }))

  return { answer, sources }
}
