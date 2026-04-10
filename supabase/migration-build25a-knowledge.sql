-- Build 2.5a: RAG Knowledge Base Infrastructure
-- pgvector extension, knowledge_documents, knowledge_chunks tables

-- Enable pgvector extension
create extension if not exists vector;

-- Knowledge documents (uploaded standards / reference files)
create table if not exists knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  file_name text not null,
  standard_id text not null,
  description text,
  chunk_count integer default 0,
  status text not null default 'processing',
  file_path text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_knowledge_documents_standard on knowledge_documents(standard_id);
create index if not exists idx_knowledge_documents_status on knowledge_documents(status);

-- Knowledge chunks (embedded text segments for vector search)
create table if not exists knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references knowledge_documents(id) on delete cascade,
  content text not null,
  embedding vector(1024),
  section_number text,
  section_title text,
  page_number integer,
  chunk_index integer not null default 0,
  token_count integer default 0,
  created_at timestamptz default now()
);

create index if not exists idx_knowledge_chunks_document on knowledge_chunks(document_id);
create index if not exists idx_knowledge_chunks_section on knowledge_chunks(section_number);

-- HNSW index for fast cosine similarity search
create index if not exists idx_knowledge_chunks_embedding
  on knowledge_chunks using hnsw (embedding vector_cosine_ops);

-- RLS policies
alter table knowledge_documents enable row level security;
alter table knowledge_chunks enable row level security;

-- Admin-only access for knowledge management
create policy "Admins can manage knowledge documents"
  on knowledge_documents for all
  using (
    exists (
      select 1 from user_profiles
      where id = auth.uid() and role = 'admin'
    )
  );

create policy "Admins can manage knowledge chunks"
  on knowledge_chunks for all
  using (
    exists (
      select 1 from user_profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- Service role needs access for API routes (bypasses RLS by default)
-- Authenticated users can read chunks (for agent search)
create policy "Authenticated users can read knowledge chunks"
  on knowledge_chunks for select
  using (auth.role() = 'authenticated');

create policy "Authenticated users can read knowledge documents"
  on knowledge_documents for select
  using (auth.role() = 'authenticated');

-- Function to search knowledge chunks by vector similarity
create or replace function search_knowledge_chunks(
  query_embedding vector(1024),
  match_count integer default 5,
  filter_document_id uuid default null
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  section_number text,
  section_title text,
  page_number integer,
  chunk_index integer,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    kc.id,
    kc.document_id,
    kc.content,
    kc.section_number,
    kc.section_title,
    kc.page_number,
    kc.chunk_index,
    1 - (kc.embedding <=> query_embedding) as similarity
  from knowledge_chunks kc
  where
    kc.embedding is not null
    and (filter_document_id is null or kc.document_id = filter_document_id)
  order by kc.embedding <=> query_embedding
  limit match_count;
end;
$$;
