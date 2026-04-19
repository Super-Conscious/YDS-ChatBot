/**
 * Generate embeddings via Google Gemini embedding-001.
 *
 * Model natively outputs 3072 dims; we truncate to 768 via outputDimensionality
 * (Matryoshka representation — pgvector ivfflat caps at 2000 dims per vector).
 */

const MODEL = 'models/gemini-embedding-001'
const OUTPUT_DIMS = 768
const BATCH_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/${MODEL}:batchEmbedContents`

interface EmbedResponse {
  embeddings: { values: number[] }[]
}

export async function embed(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not set')

  const requests = texts.map(text => ({
    model: MODEL,
    content: { parts: [{ text }] },
    outputDimensionality: OUTPUT_DIMS,
  }))

  const MAX_RETRIES = 6
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetch(`${BATCH_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    })

    if (res.ok) {
      const json = (await res.json()) as EmbedResponse
      return json.embeddings.map(e => e.values)
    }

    const errText = await res.text()

    if (res.status === 429) {
      const retryMatch = errText.match(/"retryDelay":\s*"(\d+)s"/)
      const waitS = retryMatch ? parseInt(retryMatch[1]!, 10) + 2 : 60
      console.log(`    429 rate-limited. Waiting ${waitS}s (attempt ${attempt + 1}/${MAX_RETRIES})`)
      await new Promise(r => setTimeout(r, waitS * 1000))
      continue
    }

    throw new Error(`Gemini embedding failed: ${res.status} ${errText}`)
  }
  throw new Error(`Gemini embedding gave up after ${MAX_RETRIES} retries`)
}

export async function embedSingle(text: string): Promise<number[]> {
  const [vec] = await embed([text])
  return vec!
}
