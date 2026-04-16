# YDS ChatBot — Build Plan

## Phase 1: Scrape & Ingest (~1 session)
1. Fetch sitemap.xml, parse all 213 URLs
2. Crawl each page, extract clean text (strip nav/footer/HTML)
3. Chunk text into ~500-token segments with overlap
4. Generate embeddings for each chunk (Voyage AI or OpenAI)
5. Store vectors + source text + metadata (URL, title, category) in Supabase pgvector

**Output:** Populated vector database ready for queries

## Phase 2: RAG API (~1 session)
1. Create API endpoint (Cloudflare Worker or Node)
2. On query: embed the question → vector similarity search → top 5 chunks
3. Send chunks + question to Claude API with system prompt
4. Return answer with source links
5. Handle edge cases: no relevant results, out-of-scope questions

**Output:** Working API that answers questions from the KB

## Phase 3: Chat Widget (~1 session)
1. Build embeddable JS widget (iframe or web component)
2. Chat UI: message bubbles, typing indicator, source citations
3. Conversation history (multi-turn within session)
4. Paste-able `<script>` tag for client to drop on any page

**Output:** Embeddable chat widget the client can add to their site

## Phase 4: Zoho Integration (~1 session)
1. Determine Zoho integration point (SalesIQ bot, Desk extension, or webhook)
2. Connect RAG API to Zoho's bot/webhook system
3. Test end-to-end flow within Zoho

**Output:** Chatbot working inside Zoho

## Phase 5: Polish & Handoff
1. Re-sync pipeline (scheduled crawl for KB updates)
2. Analytics (questions asked, unanswered, popular topics)
3. Client API key setup, billing, documentation
4. Hand over or host on client's infrastructure
