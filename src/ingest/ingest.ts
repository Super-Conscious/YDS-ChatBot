/**
 * Ingest pipeline: reads articles → chunks → embeds → stores in Supabase.
 *
 * Usage: npx tsx src/ingest/ingest.ts articles.json
 *
 * articles.json format:
 * [
 *   { "title": "...", "url": "...", "category": "...", "body": "..." },
 *   ...
 * ]
 *
 * This is populated by the scraper (Phase 1) or Zoho Desk API.
 */
import { readFileSync } from 'fs'
import { sb } from '../supabase.js'
import { embed } from '../embeddings.js'
import { chunkArticle, type Chunk } from './chunker.js'

interface Article {
  title: string
  url: string
  category: string
  body: string
}

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('Usage: npx tsx src/ingest/ingest.ts <articles.json>')
    process.exit(1)
  }

  const articles: Article[] = JSON.parse(readFileSync(file, 'utf-8'))
  console.log(`Loaded ${articles.length} articles`)

  // Chunk all articles
  const allChunks: Chunk[] = []
  for (const article of articles) {
    const chunks = chunkArticle(article.title, article.url, article.category, article.body)
    allChunks.push(...chunks)
  }
  console.log(`Created ${allChunks.length} chunks`)

  // Embed in batches of 100
  const BATCH = 100
  for (let i = 0; i < allChunks.length; i += BATCH) {
    const batch = allChunks.slice(i, i + BATCH)
    const texts = batch.map(c => `${c.title}\n\n${c.content}`)

    console.log(`Embedding batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(allChunks.length / BATCH)}...`)
    const vectors = await embed(texts)

    // Insert into Supabase
    const rows = batch.map((c, j) => ({
      title: c.title,
      url: c.url,
      category: c.category,
      content: c.content,
      embedding: vectors[j],
    }))

    const { error } = await sb.from('kb_chunks').insert(rows)
    if (error) {
      console.error(`Insert failed at batch ${i}:`, error.message)
      process.exit(1)
    }

    console.log(`  Inserted ${batch.length} chunks`)
  }

  console.log(`Done. ${allChunks.length} chunks ingested.`)
}

main().catch(console.error)
