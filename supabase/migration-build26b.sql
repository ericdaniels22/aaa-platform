-- Build 2.6b: Marketing Page — image library and social media drafts

-- Marketing image library
create table if not exists marketing_assets (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  storage_path text not null,
  description text,
  tags text[] default '{}',
  uploaded_by text,
  created_at timestamptz default now()
);

create index if not exists idx_marketing_assets_tags on marketing_assets using gin(tags);
create index if not exists idx_marketing_assets_created on marketing_assets(created_at);

alter table marketing_assets enable row level security;

create policy "Admins can manage marketing assets"
  on marketing_assets for all
  using (
    exists (
      select 1 from user_profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- Social media drafts
create table if not exists marketing_drafts (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  caption text not null,
  hashtags text,
  image_id uuid references marketing_assets(id) on delete set null,
  image_brief text,
  status text not null default 'draft',
  conversation_id uuid references jarvis_conversations(id) on delete set null,
  posted_at timestamptz,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_marketing_drafts_platform on marketing_drafts(platform);
create index if not exists idx_marketing_drafts_status on marketing_drafts(status);
create index if not exists idx_marketing_drafts_created on marketing_drafts(created_at);

alter table marketing_drafts enable row level security;

create policy "Admins can manage marketing drafts"
  on marketing_drafts for all
  using (
    exists (
      select 1 from user_profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- Note: Create 'marketing-assets' storage bucket manually in Supabase dashboard
-- Settings: public bucket, allowed MIME types: image/jpeg, image/png, image/webp, image/gif
-- Max file size: 10MB
