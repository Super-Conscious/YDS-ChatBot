/**
 * Split article text into overlapping chunks for embedding.
 * ~500 tokens per chunk with 50-token overlap for context continuity.
 */

const CHUNK_SIZE = 500   // approximate tokens (chars / 4)
const CHUNK_OVERLAP = 50

export interface Chunk {
  title: string
  url: string
  category: string
  content: string
}

export function chunkArticle(
  title: string,
  url: string,
  category: string,
  body: string
): Chunk[] {
  const words = body.split(/\s+/)
  if (words.length === 0) return []

  // If article is short enough, return as single chunk
  if (words.length <= CHUNK_SIZE) {
    return [{ title, url, category, content: body.trim() }]
  }

  const chunks: Chunk[] = []
  let start = 0

  while (start < words.length) {
    const end = Math.min(start + CHUNK_SIZE, words.length)
    const content = words.slice(start, end).join(' ')
    chunks.push({ title, url, category, content })

    if (end >= words.length) break
    start = end - CHUNK_OVERLAP
  }

  return chunks
}
