-- Enable pgvector extension
create extension if not exists vector;

-- Knowledge base chunks with embeddings
create table kb_chunks (
  id bigint generated always as identity primary key,
  title text not null,             -- article title
  url text not null,               -- source URL
  category text,                   -- KB category name
  content text not null,           -- chunk text (~500 tokens)
  embedding vector(768),           -- Gemini text-embedding-004 dimension
  created_at timestamptz default now()
);

-- Index for fast similarity search
create index on kb_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 20);

-- Function to search by similarity
create or replace function match_chunks(
  query_embedding vector(768),
  match_count int default 5,
  match_threshold float default 0.7
)
returns table (
  id bigint,
  title text,
  url text,
  category text,
  content text,
  similarity float
)
language sql stable
as $$
  select
    id,
    title,
    url,
    category,
    content,
    1 - (embedding <=> query_embedding) as similarity
  from kb_chunks
  where 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- Escalation fallback: when the bot answer is flagged as unhelpful and Zoho
-- ticket creation either isn't configured yet or fails, we log the request
-- here so nothing is lost. Rows can be manually forwarded into Zoho or cleaned
-- up after the Zoho integration goes live.
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
  status text default 'pending',      -- pending | forwarded | ignored
  zoho_ticket_id text,                -- populated after manual forward
  created_at timestamptz default now()
);

create index if not exists escalations_created_at_idx on escalations (created_at desc);
create index if not exists escalations_status_idx on escalations (status);
