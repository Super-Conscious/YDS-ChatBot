# YDS ChatBot

RAG chatbot that answers questions from the Yellow Dog Software knowledge base.

**Stack:** Gemini (embeddings + chat) · Supabase pgvector · Cloudflare Pages

## Architecture

```
User → Pages (static HTML) → Pages Function /api/ask → Gemini embed → Supabase vector search → Gemini Flash → answer + sources
```

## Setup

1. **Supabase** — create project, run `src/schema.sql`, disable the ivfflat index for POC scale:
   ```sql
   drop index if exists kb_chunks_embedding_idx;
   ```
2. **Gemini API key** — free tier from https://aistudio.google.com/app/apikey
3. Copy `.env.example` → `.env` and fill in values
4. `npm install`

## Ingest the KB

```bash
npm run fetch      # Pull articles from YDS portal → articles.json
npm run ingest articles.json   # Chunk, embed, insert into Supabase
npm run ask "How do I set par levels?"   # CLI test
```

## Deploy

```bash
npm run dev        # Local preview at http://localhost:8788
npm run deploy     # Deploy to Cloudflare Pages
```

Set `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` as env vars in the Cloudflare Pages dashboard.

## Project Layout

- `public/index.html` — chat UI
- `functions/api/ask.ts` — Pages Function (RAG endpoint)
- `src/ingest/fetch-yds.ts` — Zoho Desk portal fetcher (session-cookie auth, bridge before OAuth)
- `src/ingest/ingest.ts` — chunk + embed + insert
- `src/embeddings.ts` — Gemini embedding client
- `src/rag.ts` — RAG logic (CLI)
- `src/schema.sql` — Supabase schema (pgvector, 768 dims)
