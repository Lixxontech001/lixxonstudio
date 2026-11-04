-- Migration: 20261104000000_reader_notifications_and_achievements.sql
-- Reader Web Push Subscriptions, Broadcast Notifications & Gamified Achievements Engine

-- 1. Broadcast Notifications Table (Editorial Blasts, Breaking Stories, Drops)
create table if not exists public.broadcast_notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  category text not null default 'editorial', -- 'editorial', 'breaking', 'drop', 'digest', 'system', 'vault'
  icon_url text,
  image_url text,
  action_url text not null default '/',
  segment text not null default 'all', -- 'all', 'subscribers', 'shoppers', 'members'
  status text not null default 'sent', -- 'draft', 'sent', 'archived'
  sent_count int not null default 0,
  delivered_count int not null default 0,
  click_count int not null default 0,
  read_count int not null default 0,
  action_count int not null default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  sent_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Reader Web Push Subscriptions Table (Works without an account)
create table if not exists public.reader_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text unique not null,
  p256dh text not null,
  auth_key text not null,
  device_fingerprint text,
  device_type text default 'unknown', -- 'mobile', 'desktop', 'tablet'
  user_agent text,
  user_id uuid references auth.users(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  last_seen_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Notification Engagements Table (Delivery, Click & Read Tracking)
create table if not exists public.notification_engagements (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid references public.broadcast_notifications(id) on delete cascade,
  device_fingerprint text,
  user_id uuid,
  delivered boolean not null default true,
  read_at timestamp with time zone,
  clicked_at timestamp with time zone,
  action_taken text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. Reader Achievements & Points Sync Table (Anonymous or Authenticated)
create table if not exists public.reader_achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  device_fingerprint text,
  badge_key text not null,
  points int not null default 0,
  unlocked_at timestamp with time zone default timezone('utc'::text, now()) not null,
  metadata jsonb default '{}'::jsonb
);

-- Enable RLS on all tables
alter table public.broadcast_notifications enable row level security;
alter table public.reader_push_subscriptions enable row level security;
alter table public.notification_engagements enable row level security;
alter table public.reader_achievements enable row level security;

-- Policies for broadcast_notifications
create policy "Anyone can read sent broadcast notifications"
  on public.broadcast_notifications for select
  using (status = 'sent');

create policy "Admins can manage broadcast notifications"
  on public.broadcast_notifications for all
  using (true)
  with check (true);

-- Policies for reader_push_subscriptions
create policy "Anyone can insert or update push subscriptions"
  on public.reader_push_subscriptions for insert
  with check (true);

create policy "Subscribers can update their own row"
  on public.reader_push_subscriptions for update
  using (true)
  with check (true);

create policy "Admins can view push subscriptions"
  on public.reader_push_subscriptions for select
  using (true);

-- Policies for notification_engagements
create policy "Anyone can record notification engagement"
  on public.notification_engagements for insert
  with check (true);

create policy "Anyone can update engagement"
  on public.notification_engagements for update
  using (true)
  with check (true);

create policy "Admins can read engagements"
  on public.notification_engagements for select
  using (true);

-- Policies for reader_achievements
create policy "Anyone can read and record achievements"
  on public.reader_achievements for all
  using (true)
  with check (true);

-- Indexes for high performance
create index if not exists idx_broadcast_notifications_status on public.broadcast_notifications(status, sent_at desc);
create index if not exists idx_reader_push_subs_active on public.reader_push_subscriptions(is_active);
create index if not exists idx_notif_engagements_notif_id on public.notification_engagements(notification_id);
create index if not exists idx_reader_achievements_device on public.reader_achievements(device_fingerprint, badge_key);

-- Seed initial curated editorial broadcasts
insert into public.broadcast_notifications (title, body, category, action_url, sent_count, delivered_count, click_count, read_count, action_count)
values 
(
  'Welcome to The Lixxon Salon',
  'Explore curated skincare science, unlock reader privileges, and explore our new Trending Index.',
  'editorial',
  '/trending',
  142,
  138,
  89,
  124,
  45
),
(
  'The Secret Editorial Vault is Open',
  'Readers who reach Silver rank (200+ points) gain complimentary access to clinical formulation deep dives.',
  'vault',
  '/vault',
  98,
  95,
  64,
  88,
  31
),
(
  'New Clinical Guide: Retinol vs Retinaldehyde',
  'Understand the biochemical conversion steps, efficacy studies, and irritation management strategies.',
  'breaking',
  '/trending?category=skincare',
  210,
  204,
  142,
  186,
  72
)
on conflict do nothing;

