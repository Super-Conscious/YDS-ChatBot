/**
 * Generate embeddings via OpenAI text-embedding-3-small.
 * Cheapest option at $0.02/1M tokens — 213 articles costs ~$0.01.
 */

const OPENAI_API = 'https://api.openai.com/v1/embeddings'
const MODEL = 'text-embedding-3-small'

export async function embed(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not set')

  const res = await fetch(OPENAI_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: texts, model: MODEL }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI embedding failed: ${res.status} ${err}`)
  }

  const json = await res.json()
  return json.data.map((d: { embedding: number[] }) => d.embedding)
}

export async function embedSingle(text: string): Promise<number[]> {
  const [vec] = await embed([text])
  return vec!
}
