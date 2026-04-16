/**
 * Quick test: ask a question against the knowledge base.
 * Usage: npx tsx src/test-ask.ts "How do I check my Yellow Dog version?"
 */
import 'dotenv/config'
import { ask } from './rag.js'

const question = process.argv[2]
if (!question) {
  console.error('Usage: npx tsx src/test-ask.ts "your question"')
  process.exit(1)
}

console.log(`\nQuestion: ${question}\n`)

const { answer, sources } = await ask(question)

console.log(`Answer:\n${answer}\n`)

if (sources.length > 0) {
  console.log('Sources:')
  sources.forEach(s => console.log(`  - ${s.title}: ${s.url}`))
}
