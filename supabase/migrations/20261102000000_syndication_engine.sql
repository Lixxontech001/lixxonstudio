-- Table for unlimited multi-channel destinations
create table if not exists public.syndication_destinations (
  id uuid primary key default gen_random_uuid(),
  platform text not null, -- 'discord', 'flipboard', 'telegram', 'bluesky', 'mastodon', 'medium', 'tumblr', 'substack'
  name text not null, -- e.g. "Skincare Discord #community", "Flipboard Wellness Magazine"
  niche text not null default 'all', -- 'all', 'skincare', 'wellness', 'style'
  is_active boolean not null default true,
  config jsonb not null default '{}'::jsonb, -- holds dynamic credentials/tokens/webhooks per destination
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Table for tracking dispatches and preventing duplicate syndication
create table if not exists public.syndication_logs (
  id uuid primary key default gen_random_uuid(),
  post_id text not null,
  post_slug text not null,
  destination_id uuid references public.syndication_destinations(id) on delete cascade,
  platform text not null,
  status text not null, -- 'success', 'failed', 'skipped'
  error_message text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.syndication_destinations enable row level security;
alter table public.syndication_logs enable row level security;

create policy "Allow authenticated admin full access to syndication_destinations"
  on public.syndication_destinations for all
  to authenticated
  using (true)
  with check (true);

create policy "Allow authenticated admin full access to syndication_logs"
  on public.syndication_logs for all
  to authenticated
  using (true)
  with check (true);

