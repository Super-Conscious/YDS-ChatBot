/**
 * POST /api/escalate
 *
 * Opens a Zoho Desk ticket when a user rates a bot answer as unhelpful and
 * fills out the follow-up form. The ticket body includes the user's original
 * question and the bot's answer so the YDS documentation team can spot gaps
 * in the knowledge base.
 *
 * If Zoho credentials aren't configured yet (pre-handoff), we fall through to
 * a Supabase `escalations` table so nothing is lost. Callers always see the
 * same success shape.
 */

import { createTicket, zohoConfigured, type ZohoEnv } from '../_lib/zoho'

interface Env extends ZohoEnv {
  SUPABASE_URL: string
  SUPABASE_SERVICE_KEY: string
}

interface Body {
  name?: string
  company?: string
  email?: string
  phone?: string
  description?: string
  originalQuestion?: string
  botAnswer?: string
  sources?: { title: string; url: string }[]
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c])
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/)
  if (parts.length === 1) return { firstName: parts[0], lastName: '-' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

function buildSubject(originalQuestion: string): string {
  const trimmed = originalQuestion.replace(/\s+/g, ' ').trim().slice(0, 90)
  return `Help bot escalation: ${trimmed}`
}

function buildDescriptionHtml(body: Required<Pick<Body, 'description' | 'originalQuestion' | 'botAnswer'>> & { sources?: Body['sources']; company?: string }): string {
  const sourcesHtml = (body.sources && body.sources.length > 0)
    ? `<p><strong>Sources the bot cited:</strong></p><ul>${body.sources.map(s => `<li><a href="${escapeHtml(s.url)}">${escapeHtml(s.title)}</a></li>`).join('')}</ul>`
    : ''

  // Include Company in the description body as well. Zoho only routes the
  // `company` value into the proper Company custom field when
  // ZOHO_COMPANY_FIELD_ID is configured; without that field ID, company
  // would be silently dropped. Surfacing it here guarantees YDS staff can
  // see which company submitted the ticket even before the field ID is
  // wired up.
  const companyHtml = body.company
    ? `<p><strong>Company:</strong> ${escapeHtml(body.company)}</p>`
    : ''

  return [
    companyHtml,
    '<p><strong>User description:</strong></p>',
    `<p>${escapeHtml(body.description).replace(/\n/g, '<br>')}</p>`,
    '<hr>',
    '<p><em>The following was generated automatically from the help bot conversation so the documentation team can review knowledge-base gaps.</em></p>',
    '<p><strong>Original question the user asked:</strong></p>',
    `<blockquote>${escapeHtml(body.originalQuestion)}</blockquote>`,
    '<p><strong>Answer the bot provided:</strong></p>',
    `<blockquote>${escapeHtml(body.botAnswer).replace(/\n/g, '<br>')}</blockquote>`,
    sourcesHtml,
  ].join('')
}

async function logToSupabase(payload: Record<string, unknown>, env: Env): Promise<void> {
  const url = `${env.SUPABASE_URL}/rest/v1/escalations`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    throw new Error(`supabase insert failed: ${res.status} ${await res.text()}`)
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: Body
  try { body = await request.json() as Body }
  catch { return json({ error: 'invalid JSON' }, 400) }

  const name = (body.name || '').trim()
  const company = (body.company || '').trim()
  const email = (body.email || '').trim()
  const phone = (body.phone || '').trim()
  const description = (body.description || '').trim()
  const originalQuestion = (body.originalQuestion || '').trim()
  const botAnswer = (body.botAnswer || '').trim()

  if (!name) return json({ error: 'name is required' }, 400)
  if (!email || !isValidEmail(email)) return json({ error: 'valid email is required' }, 400)
  if (!description) return json({ error: 'description is required' }, 400)
  if (description.length > 4000) return json({ error: 'description too long (max 4000 chars)' }, 400)
  if (originalQuestion.length > 1000) return json({ error: 'question too long' }, 400)
  if (botAnswer.length > 8000) return json({ error: 'answer too long' }, 400)

  const { firstName, lastName } = splitName(name)
  const subject = buildSubject(originalQuestion || description)
  const descriptionHtml = buildDescriptionHtml({
    description,
    originalQuestion: originalQuestion || '(not captured)',
    botAnswer: botAnswer || '(not captured)',
    sources: body.sources,
    company,
  })

  // Primary path: create a real Zoho Desk ticket
  if (zohoConfigured(env)) {
    try {
      const result = await createTicket({
        firstName, lastName, email, phone, company,
        subject, descriptionHtml,
      }, env)
      return json({ ok: true, ticketNumber: result.ticketNumber, ticketId: result.ticketId })
    } catch (err) {
      console.error('[yds-escalate] zoho ticket create failed, falling back to supabase:', (err as Error).message)
      // Fall through to Supabase log — we don't want to lose the user's request
    }
  }

  // Fallback: log to Supabase so nothing is lost while Zoho creds are pending
  try {
    await logToSupabase({
      name, company, email, phone, description,
      original_question: originalQuestion,
      bot_answer: botAnswer,
      sources: body.sources || [],
      status: 'pending',
    }, env)
    return json({ ok: true, queued: true })
  } catch (err) {
    console.error('[yds-escalate] supabase fallback also failed:', (err as Error).message)
    return json({ error: 'Unable to submit right now. Please email support@yellowdogsoftware.com directly.' }, 500)
  }
}

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}
