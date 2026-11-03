-- Migration: 20261103000000_trending_announcements_feedback.sql
-- Comprehensive schema for Trending Hub, Intelligent Dual-Modality Announcements,
-- Behavioral Analytics/Telemetry, and Interactive Feedback Desk.

-- 1. TRENDING HUB
create table if not exists public.trending_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  excerpt text not null default '',
  content text default '',
  category text not null default 'all', -- 'all', 'skincare', 'fashion', 'wellness', 'others'
  item_type text not null default 'update', -- 'product', 'debate', 'ingredient', 'update'
  metadata jsonb not null default '{}'::jsonb,
  destination_url text default '',
  cover_image text default '',
  upvotes integer not null default 0,
  views_count integer not null default 0,
  clicks_count integer not null default 0,
  read_time_minutes integer not null default 3,
  priority_order integer not null default 0,
  is_pinned boolean not null default false,
  is_archived boolean not null default false,
  expires_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create or replace function public.increment_trending_engagement(
  p_item_id uuid,
  p_kind text
) returns void
language plpgsql
security definer
as $$
begin
  if p_kind = 'upvote' then
    update public.trending_items set upvotes = upvotes + 1 where id = p_item_id;
  elsif p_kind = 'view' then
    update public.trending_items set views_count = views_count + 1 where id = p_item_id;
  elsif p_kind = 'click' then
    update public.trending_items set clicks_count = clicks_count + 1 where id = p_item_id;
  end if;
end;
$$;

alter table public.trending_items enable row level security;

create policy "Allow public read access to active trending_items"
  on public.trending_items for select
  to anon, authenticated
  using (is_archived = false and (expires_at is null or expires_at > now()));

create policy "Allow authenticated admin full access to trending_items"
  on public.trending_items for all
  to authenticated
  using (true)
  with check (true);

-- 2. INTELLIGENT DUAL-MODALITY ANNOUNCEMENTS
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  badge_text text default 'EDITORIAL SPOTLIGHT',
  form_type text not null default 'modal', -- 'modal', 'toast'
  image_url text default '',
  button1_label text default '',
  button1_url text default '',
  button2_label text default '',
  button2_url text default '',
  trigger_delay_seconds integer not null default 5,
  scroll_percentage integer not null default 0,
  cooldown_minutes integer not null default 3,
  target_audience text not null default 'all_pages', -- 'all_pages', 'articles_only', 'new_visitors'
  is_active boolean not null default true,
  priority integer not null default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.announcements enable row level security;

create policy "Allow public read access to active announcements"
  on public.announcements for select
  to anon, authenticated
  using (is_active = true);

create policy "Allow authenticated admin full access to announcements"
  on public.announcements for all
  to authenticated
  using (true)
  with check (true);

-- 3. TELEMETRY & BEHAVIORAL ANALYTICS EVENTS
create table if not exists public.announcement_events (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid references public.announcements(id) on delete cascade,
  form_type text not null default 'modal',
  event_type text not null, -- 'impression', 'click_button1', 'click_button2', 'dismiss', 'retention_dwell', 'scroll_depth'
  page_path text not null default '/',
  dwell_seconds integer not null default 0,
  fingerprint text default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.announcement_events enable row level security;

create policy "Allow public insert to announcement_events"
  on public.announcement_events for insert
  to anon, authenticated
  with check (true);

create policy "Allow authenticated admin read access to announcement_events"
  on public.announcement_events for select
  to authenticated
  using (true);

create policy "Allow authenticated admin delete access to announcement_events"
  on public.announcement_events for delete
  to authenticated
  using (true);

-- 4. INTERACTIVE SITE FEEDBACK DESK
create table if not exists public.site_feedback (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'General Idea', -- 'Praise', 'Question', 'Bug / Issue', 'General Idea'
  message text not null,
  rating integer default 5, -- 1-5 score
  name text default '',
  email text default '',
  page_url text default '',
  viewport text default '',
  status text not null default 'unread', -- 'unread', 'under_review', 'resolved', 'archived'
  admin_notes text default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.site_feedback enable row level security;

create policy "Allow public insert to site_feedback"
  on public.site_feedback for insert
  to anon, authenticated
  with check (true);

create policy "Allow authenticated admin full access to site_feedback"
  on public.site_feedback for all
  to authenticated
  using (true)
  with check (true);

-- Initial seed items
insert into public.trending_items (
  title, slug, excerpt, content, category, item_type, metadata, destination_url, cover_image, upvotes, views_count, clicks_count, read_time_minutes, priority_order, is_pinned
) values
(
  'Copper Peptide Rapid Barrier Ampoule',
  'copper-peptide-rapid-barrier-ampoule',
  'Clinical barrier restoration engineered with pure GHK-Cu complex and bio-fermented hyaluronic fractions.',
  'A medical-grade formulation accelerating epidermal re-epithelialization within 48 hours without irritation.',
  'skincare',
  'product',
  '{"brand": "Biologique Lab", "badge": "CLINICAL HEAT", "why_trending": "Featured by top cosmetic chemists for rapid post-retinoid barrier repair.", "rating_score": 98, "affiliate_url": "/shop", "price": "$78"}'::jsonb,
  '/shop',
  'https://images.pexels.com/photos/3373736/pexels-photo-3373736.jpeg?auto=compress&cs=tinysrgb&w=1200',
  42, 1280, 154, 4, 100, true
),
(
  'Is Double Cleansing Compromising the Skin Barrier?',
  'is-double-cleansing-compromising-the-skin-barrier',
  'The ongoing debate among dermatologists on sebum stripping vs. micellar cleansing efficacy.',
  'Debate summary: Hydrophilic cleansing oils remain safe when followed by non-foaming surfactant gels at pH 5.5.',
  'skincare',
  'debate',
  '{"topic_headline": "Over-Cleansing vs. Pore Congestion", "counter_arguments": "Stripping essential ceramide layers vs. incomplete removal of zinc oxide sunscreen.", "community_takeaway": "Emulsify with lukewarm water and restrict to evening routines only.", "discussion_url": "/blog"}'::jsonb,
  '/blog',
  'https://images.pexels.com/photos/3785147/pexels-photo-3785147.jpeg?auto=compress&cs=tinysrgb&w=1200',
  89, 2140, 310, 5, 90, false
),
(
  'Retinol vs. Granactive Retinoid (HPR): The 2026 Consensus',
  'retinol-vs-granactive-retinoid-hpr-2026-consensus',
  'Comparing direct retinoic receptor binding against multi-step enzymatic conversion pathways.',
  'Clinical consensus: HPR demonstrates equivalent pro-collagen transcription with 60% less transepidermal water loss.',
  'wellness',
  'ingredient',
  '{"controversy": "Direct gene transcription vs. stability degradation in oil solutions.", "consensus": "Granactive retinoid is the preferred entry point for reactive, sensitized skin types.", "study_summary": "12-week double-blind randomized trial (n=84) confirms parity in fine line reduction.", "study_url": "https://pubmed.ncbi.nlm.nih.gov"}'::jsonb,
  'https://pubmed.ncbi.nlm.nih.gov',
  'https://images.pexels.com/photos/3685530/pexels-photo-3685530.jpeg?auto=compress&cs=tinysrgb&w=1200',
  64, 1620, 198, 6, 80, false
),
(
  'European Clean Fragrance Disclosure Mandate Enacted',
  'european-clean-fragrance-disclosure-mandate-enacted',
  'New 2026-2027 labeling standards mandate itemized disclosure of natural allergen fractions.',
  'Regulatory flash: Essential oil blends will no longer be sheltered under generic parfum labeling.',
  'others',
  'update',
  '{"source_name": "International Fragrance Association", "source_url": "https://ifrafragrance.org", "timestamp_label": "2 hours ago"}'::jsonb,
  'https://ifrafragrance.org',
  'https://images.pexels.com/photos/965989/pexels-photo-965989.jpeg?auto=compress&cs=tinysrgb&w=1200',
  28, 890, 76, 2, 70, false
),
(
  'The Architectural Linen Overshirt: Capsule Wardrobe Foundation',
  'the-architectural-linen-overshirt-capsule-wardrobe-foundation',
  'Hand-loomed European flax cut with structured shoulders and dropped sleeve volume.',
  'Designed for seasonal transition layering with breathable thermal regulation.',
  'fashion',
  'product',
  '{"brand": "Lixxon Atelier", "badge": "STAFF PICK", "why_trending": "Chosen by editors as the definitive warm-season layering essential.", "rating_score": 96, "affiliate_url": "/collections", "price": "$145"}'::jsonb,
  '/collections',
  'https://images.pexels.com/photos/994517/pexels-photo-994517.jpeg?auto=compress&cs=tinysrgb&w=1200',
  53, 1450, 187, 3, 85, false
)
on conflict (slug) do nothing;

insert into public.announcements (
  title, description, badge_text, form_type, image_url, button1_label, button1_url, button2_label, button2_url, trigger_delay_seconds, scroll_percentage, cooldown_minutes, target_audience, is_active, priority
) values
(
  'The Daily Glow Reset & Digital Guides',
  'Explore our newly curated digital masterclasses, evidence-backed skincare routines, and timeless capsule edits designed for modern intentional living.',
  'CURATED EDITORIAL',
  'modal',
  'https://images.pexels.com/photos/3373736/pexels-photo-3373736.jpeg?auto=compress&cs=tinysrgb&w=1200',
  'Explore Collections',
  '/collections',
  'View Trending',
  '/trending',
  6,
  25,
  5,
  'all_pages',
  true,
  10
),
(
  'Issue #42: The Microbiome & Lipid Barrier',
  'Our latest weekly digest breaks down the latest biochemical research on ceramide synthesis and mindful routines.',
  'WEEKLY DIGEST',
  'toast',
  '',
  'Read Issue',
  '/weekly-digest',
  '',
  '',
  8,
  35,
  4,
  'all_pages',
  true,
  5
)
on conflict do nothing;
