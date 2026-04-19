/**
 * Fetch all KB articles from the YDS Zoho Desk portal and write articles.json.
 *
 * Auth: uses session cookies (YDS_COOKIES) — bridge approach until OAuth creds
 * land Monday. Cookies expire with the browser session; refresh by grabbing a
 * new cURL from the logged-in portal and updating YDS_COOKIES in .env.
 *
 * Resumable: skips articles already present in the output file (by URL).
 * Rate-limit handling: exponential backoff on HTTP 429.
 *
 * Usage: npx tsx src/ingest/fetch-yds.ts [output.json]
 */
import 'dotenv/config'
import { writeFileSync, existsSync, readFileSync } from 'fs'

const BASE = 'https://portal.yellowdogsoftware.com/portal/api'
const PAGE_SIZE = 100
const REQUEST_DELAY_MS = 500
const MAX_RETRIES = 5
const CHECKPOINT_EVERY = 25

interface ArticleListItem {
  id: string
  title: string
  permalink: string
  webUrl: string
  category?: { name: string }
  summary?: string
}

interface ArticleDetail {
  id: string
  title: string
  answer: string
  webUrl: string
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

function headers(cookies: string): HeadersInit {
  return {
    'Accept': '*/*',
    'Cookie': cookies,
    'Referer': 'https://portal.yellowdogsoftware.com/portal/en/home',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'X-Requested-With': 'XMLHttpRequest',
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

async function fetchWithBackoff<T>(url: string, cookies: string): Promise<T> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetch(url, { headers: headers(cookies) })
    if (res.ok) return res.json() as Promise<T>

    if (res.status === 429) {
      const waitMs = Math.min(60000, 5000 * Math.pow(2, attempt)) // 5s, 10s, 20s, 40s, 60s
      console.log(`    429 rate-limited. Sleeping ${waitMs / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`)
      await sleep(waitMs)
      continue
    }

    if (res.status === 401 || res.status === 403) {
      throw new Error(`Auth failed (${res.status}) — session cookies probably expired. Refresh YDS_COOKIES in .env`)
    }

    throw new Error(`${res.status} ${res.statusText} — ${url}`)
  }
  throw new Error(`Gave up after ${MAX_RETRIES} retries: ${url}`)
}

async function listAllArticles(portalId: string, cookies: string): Promise<ArticleListItem[]> {
  const all: ArticleListItem[] = []
  let from = 1
  while (true) {
    const url = `${BASE}/kbArticles?portalId=${portalId}&from=${from}&limit=${PAGE_SIZE}&locale=en`
    const { data } = await fetchWithBackoff<{ data: ArticleListItem[] }>(url, cookies)
    if (!data || data.length === 0) break
    all.push(...data)
    console.log(`  page from=${from}: +${data.length} (total ${all.length})`)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
    await sleep(REQUEST_DELAY_MS)
  }
  return all
}

async function fetchArticle(id: string, portalId: string, cookies: string): Promise<ArticleDetail> {
  return fetchWithBackoff<ArticleDetail>(`${BASE}/kbArticles/${id}/locale/en?portalId=${portalId}`, cookies)
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
  const portalId = requireEnv('YDS_PORTAL_ID')
  const cookies = requireEnv('YDS_COOKIES')
  const outPath = process.argv[2] ?? 'articles.json'

  const existing = loadExisting(outPath)
  const existingUrls = new Set(existing.map(a => a.url))
  console.log(`Loaded ${existing.length} existing articles from ${outPath}`)

  console.log('Listing articles…')
  const list = await listAllArticles(portalId, cookies)
  console.log(`Found ${list.length} articles (${list.length - existingUrls.size} new)\n`)

  const output: OutputArticle[] = [...existing]
  let fetched = 0
  let skipped = 0
  let existing_count = 0

  for (let i = 0; i < list.length; i++) {
    const item = list[i]!
    if (existingUrls.has(item.webUrl)) {
      existing_count++
      continue
    }
    try {
      const detail = await fetchArticle(item.id, portalId, cookies)
      const body = stripHtml(detail.answer ?? '')
      if (!body || body.length < 20) {
        console.log(`  [${i + 1}/${list.length}] SKIP (empty): ${detail.title}`)
        skipped++
        continue
      }
      output.push({
        title: detail.title,
        url: detail.webUrl,
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
      // Save progress even on fatal error so we can resume
      writeFileSync(outPath, JSON.stringify(output, null, 2))
      if ((err as Error).message.includes('session cookies')) {
        console.error('Auth dead — stopping. Refresh cookies and re-run to resume.')
        process.exit(1)
      }
    }
    await sleep(REQUEST_DELAY_MS)
  }

  writeFileSync(outPath, JSON.stringify(output, null, 2))
  console.log(`\nDone. ${output.length} total (${fetched} new, ${existing_count} already had, ${skipped} skipped)`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
