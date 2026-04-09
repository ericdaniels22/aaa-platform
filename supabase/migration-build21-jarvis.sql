-- Build 2.1: Jarvis Chat — conversations and alerts tables

-- Jarvis conversations
create table if not exists jarvis_conversations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade,
  user_id uuid references user_profiles(id),
  title text,
  context_type text not null default 'general',
  messages jsonb not null default '[]'::jsonb,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_jarvis_conversations_job_id on jarvis_conversations(job_id);
create index if not exists idx_jarvis_conversations_user_id on jarvis_conversations(user_id);
create index if not exists idx_jarvis_conversations_context on jarvis_conversations(context_type);

alter table jarvis_conversations enable row level security;

create policy "Users can manage their own conversations"
  on jarvis_conversations for all
  using (user_id = auth.uid());

create policy "Admins can read all conversations"
  on jarvis_conversations for select
  using (
    exists (
      select 1 from user_profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- Jarvis alerts (used in Build 2.2 tools)
create table if not exists jarvis_alerts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete set null,
  user_id uuid references user_profiles(id),
  message text not null,
  priority text default 'medium',
  status text default 'active',
  due_date timestamptz not null,
  created_at timestamptz default now(),
  resolved_at timestamptz
);

create index if not exists idx_jarvis_alerts_status on jarvis_alerts(status);
create index if not exists idx_jarvis_alerts_user_id on jarvis_alerts(user_id);

alter table jarvis_alerts enable row level security;

create policy "Users can manage their own alerts"
  on jarvis_alerts for all
  using (user_id = auth.uid());

create policy "Admins can read all alerts"
  on jarvis_alerts for select
  using (
    exists (
      select 1 from user_profiles
      where id = auth.uid() and role = 'admin'
    )
  );
