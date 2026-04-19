import 'dotenv/config'
import { sb } from './supabase.js'
import { embedSingle } from './embeddings.js'

const q = process.argv[2] ?? 'How do I find out what version of Yellow Dog I am on?'
const vec = await embedSingle(q)
console.log(`Query: "${q}"`)
console.log(`Embedded (${vec.length} dims)\n`)

const { data, error } = await sb.rpc('match_chunks', {
  query_embedding: vec,
  match_count: 10,
  match_threshold: 0.0,
})
if (error) { console.error(error); process.exit(1) }
console.log('Top 10 by similarity:')
for (const m of (data as { title: string; similarity: number }[]) ?? []) {
  console.log(`  ${m.similarity.toFixed(4)}  ${m.title}`)
}
