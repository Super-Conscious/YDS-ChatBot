/**
 * Zoho Desk OAuth + ticket helpers.
 *
 * Access tokens are 1-hour lived. We exchange the long-lived refresh token for
 * a fresh access token on demand. Callers should cache the returned token
 * within a single request if they make multiple Zoho calls.
 */

export interface ZohoEnv {
  ZOHO_CLIENT_ID?: string
  ZOHO_CLIENT_SECRET?: string
  ZOHO_REFRESH_TOKEN?: string
  ZOHO_ORG_ID?: string
  ZOHO_DESK_BASE?: string
  ZOHO_ACCOUNTS_BASE?: string
  ZOHO_DEPARTMENT_ID?: string
  ZOHO_LAYOUT_ID?: string
  ZOHO_COMPANY_FIELD_ID?: string
}

export interface TicketInput {
  firstName: string
  lastName: string
  email: string
  phone?: string
  company?: string
  subject: string
  descriptionHtml: string
}

export interface TicketResult {
  ticketId: string
  ticketNumber?: string
  webUrl?: string
}

/**
 * True when all required env vars are present. Ticket-creation features should
 * short-circuit to the Supabase-fallback path until this flips to true.
 */
export function zohoConfigured(env: ZohoEnv): boolean {
  return !!(env.ZOHO_CLIENT_ID && env.ZOHO_CLIENT_SECRET && env.ZOHO_REFRESH_TOKEN && env.ZOHO_ORG_ID && env.ZOHO_DEPARTMENT_ID)
}

export async function getAccessToken(env: ZohoEnv): Promise<string> {
  const accountsBase = env.ZOHO_ACCOUNTS_BASE || 'https://accounts.zoho.com'
  const params = new URLSearchParams({
    refresh_token: env.ZOHO_REFRESH_TOKEN || '',
    client_id: env.ZOHO_CLIENT_ID || '',
    client_secret: env.ZOHO_CLIENT_SECRET || '',
    grant_type: 'refresh_token',
  })
  const res = await fetch(`${accountsBase}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  if (!res.ok) {
    throw new Error(`zoho token refresh failed: ${res.status} ${await res.text()}`)
  }
  const json = await res.json() as { access_token?: string; error?: string }
  if (!json.access_token) {
    throw new Error(`zoho token refresh returned no access_token: ${JSON.stringify(json)}`)
  }
  return json.access_token
}

export async function createTicket(input: TicketInput, env: ZohoEnv): Promise<TicketResult> {
  const token = await getAccessToken(env)
  const deskBase = env.ZOHO_DESK_BASE || 'https://desk.zoho.com'

  const body: Record<string, unknown> = {
    subject: input.subject.slice(0, 250),
    departmentId: env.ZOHO_DEPARTMENT_ID,
    contact: {
      firstName: input.firstName,
      lastName: input.lastName || '-',
      email: input.email,
      ...(input.phone ? { phone: input.phone } : {}),
    },
    description: input.descriptionHtml,
    channel: 'Chat',
    priority: 'Medium',
    status: 'Open',
  }

  if (env.ZOHO_LAYOUT_ID) body.layoutId = env.ZOHO_LAYOUT_ID

  if (input.company && env.ZOHO_COMPANY_FIELD_ID) {
    body.customFields = { [env.ZOHO_COMPANY_FIELD_ID]: input.company }
  }

  const res = await fetch(`${deskBase}/api/v1/tickets`, {
    method: 'POST',
    headers: {
      'Authorization': `Zoho-oauthtoken ${token}`,
      'orgId': env.ZOHO_ORG_ID || '',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    throw new Error(`zoho ticket create failed: ${res.status} ${await res.text()}`)
  }

  const json = await res.json() as { id?: string; ticketNumber?: string; webUrl?: string }
  if (!json.id) {
    throw new Error(`zoho ticket create returned no id: ${JSON.stringify(json)}`)
  }
  return { ticketId: json.id, ticketNumber: json.ticketNumber, webUrl: json.webUrl }
}
