/**
 * Fetch all KB articles from Yellow Dog Software's Zoho Desk using the
 * official OAuth API.
 *
 * Auth: Zoho Desk OAuth access token (Desk.articles.READ scope). The
 * access token lives for ~1 hour. For scheduled re-crawls we'll need a
 * refresh token flow — not implemented here (YDS hasn't provided
 * client_id + client_secret + refresh_token yet).
 *
 * Resumable: skips articles already present in articles.json (by URL).
 * Rate-limit handling: exponential backoff on 429 and 5xx.
 *
 * Usage: npx tsx src/ingest/fetch-yds.ts [output.json]
 */
import 'dotenv/config'
import { writeFileSync, existsSync, readFileSync } from 'fs'

const PAGE_SIZE = 50  // Zoho Desk API caps at 50 per page
const REQUEST_DELAY_MS = 500
const MAX_RETRIES = 5
const CHECKPOINT_EVERY = 25

interface ArticleListItem {
  id: string
  title: string
  permalink: string
  portalUrl: string
  category?: { name: string }
  summary?: string
  availableLocaleTranslations?: { locale: string }[]
}

interface ArticleDetail {
  id: string
  title: string
  answer?: string
  portalUrl: string
  category?: { name: string }
  summary?: string
}

interface OutputArticle {
  title: string
  url: string
  category: string
  body: string
}

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) { console.error(`Missing ${name} in .env`); process.exit(1) }
  return v
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function headers(token: string, orgId: string): HeadersInit {
  return {
    'Authorization': `Zoho-oauthtoken ${token}`,
    'orgId': orgId,
    'Accept': 'application/json',
  }
}

async function fetchWithBackoff<T>(url: string, token: string, orgId: string): Promise<T> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetch(url, { headers: headers(token, orgId) })
    if (res.ok) return res.json() as Promise<T>

    if (res.status === 429 || res.status >= 500) {
      const waitMs = Math.min(60000, 2000 * Math.pow(2, attempt))
      console.log(`    ${res.status} — waiting ${waitMs / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`)
      await sleep(waitMs)
      continue
    }

    if (res.status === 401 || res.status === 403) {
      throw new Error(`Auth failed (${res.status}) — token expired or scope insufficient. Get a fresh ZOHO_ACCESS_TOKEN.`)
    }

    throw new Error(`${res.status} ${res.statusText} — ${url}`)
  }
  throw new Error(`Gave up after ${MAX_RETRIES} retries: ${url}`)
}

async function listAllArticles(base: string, token: string, orgId: string): Promise<ArticleListItem[]> {
  const all: ArticleListItem[] = []
  let from = 1
  while (true) {
    const url = `${base}/articles?from=${from}&limit=${PAGE_SIZE}&status=Published`
    const { data } = await fetchWithBackoff<{ data: ArticleListItem[] }>(url, token, orgId)
    if (!data || data.length === 0) break
    all.push(...data)
    console.log(`  page from=${from}: +${data.length} (total ${all.length})`)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
    await sleep(REQUEST_DELAY_MS)
  }
  return all
}

async function fetchArticle(base: string, id: string, locale: string, token: string, orgId: string): Promise<ArticleDetail> {
  return fetchWithBackoff<ArticleDetail>(`${base}/articles/${id}/translations/${locale}`, token, orgId)
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function loadExisting(path: string): OutputArticle[] {
  if (!existsSync(path)) return []
  try { return JSON.parse(readFileSync(path, 'utf-8')) } catch { return [] }
}

async function main() {
  const token = requireEnv('ZOHO_ACCESS_TOKEN')
  const orgId = requireEnv('ZOHO_ORG_ID')
  const base = process.env.ZOHO_DESK_BASE || 'https://desk.zoho.com/api/v1'
  const outPath = process.argv[2] ?? 'articles.json'

  const existing = loadExisting(outPath)
  const existingUrls = new Set(existing.map(a => a.url))
  console.log(`Loaded ${existing.length} existing articles from ${outPath}`)

  console.log('Listing articles via Zoho Desk API…')
  const list = await listAllArticles(base, token, orgId)
  console.log(`Found ${list.length} published articles (${list.length - existingUrls.size} new)\n`)

  const output: OutputArticle[] = [...existing]
  let fetched = 0
  let skipped = 0
  let alreadyHad = 0

  for (let i = 0; i < list.length; i++) {
    const item = list[i]!
    if (existingUrls.has(item.portalUrl)) { alreadyHad++; continue }

    const locale = item.availableLocaleTranslations?.[0]?.locale ?? 'en'
    try {
      const detail = await fetchArticle(base, item.id, locale, token, orgId)
      const body = stripHtml(detail.answer ?? '')
      if (!body || body.length < 20) {
        console.log(`  [${i + 1}/${list.length}] SKIP (empty): ${detail.title}`)
        skipped++
        continue
      }
      output.push({
        title: detail.title,
        url: detail.portalUrl,
        category: detail.category?.name?.trim() ?? 'General',
        body,
      })
      fetched++
      console.log(`  [${i + 1}/${list.length}] ${detail.title} (${body.length} chars)`)

      if (fetched % CHECKPOINT_EVERY === 0) {
        writeFileSync(outPath, JSON.stringify(output, null, 2))
        console.log(`    [checkpoint: ${output.length} articles saved]`)
      }
    } catch (err) {
      console.error(`  [${i + 1}/${list.length}] FAIL ${item.id}:`, (err as Error).message)
      skipped++
      writeFileSync(outPath, JSON.stringify(output, null, 2))
      if ((err as Error).message.includes('Auth failed')) {
        console.error('Token dead — stopping. Refresh ZOHO_ACCESS_TOKEN and re-run to resume.')
        process.exit(1)
      }
    }
    await sleep(REQUEST_DELAY_MS)
  }

  writeFileSync(outPath, JSON.stringify(output, null, 2))
  console.log(`\nDone. ${output.length} total (${fetched} new, ${alreadyHad} already had, ${skipped} skipped)`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
