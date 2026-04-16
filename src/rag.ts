/**
 * RAG pipeline: embed question → vector search → Claude answer.
 */
import Anthropic from '@anthropic-ai/sdk'
import { sb } from './supabase.js'
import { embedSingle } from './embeddings.js'

const anthropic = new Anthropic()

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
  // 1. Embed the question
  const questionVec = await embedSingle(question)

  // 2. Vector similarity search
  const { data: chunks, error } = await sb.rpc('match_chunks', {
    query_embedding: questionVec,
    match_count: 5,
    match_threshold: 0.7,
  })

  if (error) throw new Error(`Vector search failed: ${error.message}`)

  const matches = (chunks ?? []) as ChunkMatch[]

  if (matches.length === 0) {
    return {
      answer: "I couldn't find relevant information in the knowledge base for that question. Could you try rephrasing, or contact Yellow Dog support directly?",
      sources: [],
    }
  }

  // 3. Build context from matched chunks
  const context = matches
    .map((m, i) => `[Source ${i + 1}: "${m.title}"]\n${m.content}`)
    .join('\n\n---\n\n')

  // 4. Ask Claude with context
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Context from the Yellow Dog knowledge base:\n\n${context}\n\n---\n\nQuestion: ${question}`,
      },
    ],
  })

  const answer = msg.content[0]?.type === 'text' ? msg.content[0].text : ''

  // 5. Deduplicate sources
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
