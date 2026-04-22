# YDS Help Bot — Handoff Checklist

This doc lists the final steps to take the Help Bot fully live, including
the embedded widget, automatic knowledge-base re-crawl, and ticket escalation
into Zoho Desk.

Everything in the app is built and tested. The only blocker is credentials
from the Yellow Dog Software team.

---

## 1. What we need from YDS

### 1a. Create a Zoho API OAuth application

Ask the YDS admin to do this once in their Zoho API Console:

1. Go to https://api-console.zoho.com/
2. Click **Add Client → Server-based Applications**
3. Fill in:
   - **Client Name:** `YDS Help Bot`
   - **Homepage URL:** `https://yds-chatbot.pages.dev`
   - **Authorized Redirect URI:** `https://yds-chatbot.pages.dev/oauth/callback`
4. Save. Note down the **Client ID** and **Client Secret**.

### 1b. Grant scopes + generate a refresh token

We need a long-lived refresh token with these scopes:

- `Desk.articles.READ` (for the nightly KB re-crawl)
- `Desk.tickets.CREATE` (for escalation tickets)
- `Desk.contacts.CREATE` (so the ticket endpoint can auto-create contacts when a user's email isn't already in Zoho)

The simplest way to generate this: use Zoho's **Self-Client** flow under the same application. The admin clicks **Generate Code**, selects the three scopes above, and sends us the resulting refresh token.

### 1c. Send us the following

- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REFRESH_TOKEN`

Plus confirm these values that we already believe are correct (both came from the KB crawl work):

- `ZOHO_ORG_ID = 694468789`
- `ZOHO_DESK_BASE = https://desk.zoho.com` (US data center)

### 1d. Ticket layout details

For the escalation form to match the portal's existing "New Ticket" layout (`420950000000074011`), we need one additional detail from YDS:

- **Field ID of the "Company" custom field** on that layout. (Zoho custom-field IDs are opaque — we'll hit the layout API once we have the access token to discover it, so if the admin isn't sure what to send, we can find it ourselves after step 1c.)

---

## 2. What we do with those credentials

Set them as environment variables on the Cloudflare Pages project (`yds-chatbot`):

```
ZOHO_CLIENT_ID=<from step 1c>
ZOHO_CLIENT_SECRET=<from step 1c>
ZOHO_REFRESH_TOKEN=<from step 1c>
ZOHO_ORG_ID=694468789
ZOHO_DESK_BASE=https://desk.zoho.com
ZOHO_ACCOUNTS_BASE=https://accounts.zoho.com
ZOHO_DEPARTMENT_ID=420950000000006907
ZOHO_LAYOUT_ID=420950000000074011
ZOHO_COMPANY_FIELD_ID=<discovered via layout API>
```

Dashboard → **Workers & Pages → yds-chatbot → Settings → Environment variables** → add each under **Production**. Trigger a new deployment so they take effect.

The backend (`functions/api/escalate.ts`) checks `zohoConfigured(env)` before each request. Until all required vars are set, escalation submissions are queued into the Supabase `escalations` table as a safety net — no user request is ever lost.

---

## 3. Supabase schema

Run this once in the Supabase SQL editor to create the escalation fallback table (already in `src/schema.sql`):

```sql
create table if not exists escalations (
  id bigint generated always as identity primary key,
  name text not null,
  company text,
  email text not null,
  phone text,
  description text not null,
  original_question text,
  bot_answer text,
  sources jsonb default '[]'::jsonb,
  status text default 'pending',
  zoho_ticket_id text,
  created_at timestamptz default now()
);
create index if not exists escalations_created_at_idx on escalations (created_at desc);
create index if not exists escalations_status_idx on escalations (status);
```

---

## 4. Embedding the widget in Zoho Desk

Give the YDS admin this one-liner to paste into the portal's custom-scripts panel (Zoho Desk → Setup → Customization → Help Center → Custom Scripts):

```html
<script async src="https://yds-chatbot.pages.dev/widget.js"></script>
```

That's all. The bubble appears in the bottom-right of every portal page.

### Widget behavior

- Floating yellow paw bubble, bottom-right
- First visit: greeting tooltip ("Hi there! Have a question…") — dismissible
- Click bubble → chat panel slides up (380×600 on desktop, full-screen on mobile)
- After each answer: "Did this help? Yes / No" row
- **Yes** → inline thank-you
- **No** → inline form (Name, Company, Email, Phone, Description) → opens a Zoho ticket with the user's original question + bot answer automatically attached

### Local test

```
http://localhost:8788/widget-test
```

That page simulates a third-party embed so you can verify bubble + panel + escalation flow before pointing it at the real portal.

---

## 5. Nightly KB re-crawl (after refresh token lands)

A GitHub Actions workflow will refresh `articles.json` and re-ingest into Supabase on a nightly schedule using the refresh token. This is a separate PR — the token swap in `src/ingest/fetch-yds.ts` is next on the list once the client ID / secret / refresh token arrive.
