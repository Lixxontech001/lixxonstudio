-- 20261104010000_salon_functions_and_management.sql
-- Database-backed storage for Salon Automated Functions:
-- 1. reader_regimens (Personalized AM/PM routine formulas)
-- 2. reader_vanity_items (Digital cosmetic shelf & PAO degradation tracking)
-- 3. salon_house_protocols (Admin-curated official studio clinical regimens)
-- 4. salon_privilege_settings (Dynamic admin controls for ranks and perks)

-- Table: Personalized Reader Regimens
create table if not exists public.reader_regimens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  fingerprint text not null,
  title text not null default 'My Clinical Regimen',
  skin_type text not null default 'combination', -- dry, oily, combination, sensitive, normal
  climate text not null default 'temperate', -- humid, arid, cold, urban
  concerns jsonb not null default '[]'::jsonb, -- e.g. ["barrier", "hyperpigmentation", "fine_lines"]
  morning_steps jsonb not null default '[]'::jsonb,
  evening_steps jsonb not null default '[]'::jsonb,
  weekly_schedule jsonb not null default '{}'::jsonb,
  synergy_score integer not null default 92,
  is_active boolean not null default true,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists idx_reader_regimens_user_id on public.reader_regimens(user_id);
create index if not exists idx_reader_regimens_fingerprint on public.reader_regimens(fingerprint);

-- Table: Reader Digital Vanity & PAO Shelf
create table if not exists public.reader_vanity_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  fingerprint text not null,
  product_name text not null,
  brand text not null default 'Studio Selected',
  category text not null default 'serum', -- cleanser, toner, serum, moisturizer, sunscreen, treatment, eye_cream, oil
  opened_on date not null default current_date,
  pao_months integer not null default 6,
  volume_ml integer,
  estimated_price numeric(10,2) default 0.00,
  key_actives jsonb not null default '[]'::jsonb,
  safety_score integer default 95,
  is_emptied boolean not null default false,
  notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists idx_reader_vanity_fingerprint on public.reader_vanity_items(fingerprint);
create index if not exists idx_reader_vanity_user_id on public.reader_vanity_items(user_id);

-- Table: Admin House Protocols (Official studio formulas available to all readers)
create table if not exists public.salon_house_protocols (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  tagline text not null,
  skin_type text not null default 'all',
  target_concerns jsonb not null default '[]'::jsonb,
  difficulty text not null default 'intermediate', -- novice, intermediate, advanced, master
  morning_steps jsonb not null default '[]'::jsonb,
  evening_steps jsonb not null default '[]'::jsonb,
  weekly_cadence text not null default 'Skin Cycling: Exfoliate / Retinoid / Recovery / Recovery',
  curator_name text not null default 'Lixxon Formulation Board',
  is_published boolean not null default true,
  cloned_count integer not null default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Table: Dynamic Salon Privilege Settings & Tier Rules
create table if not exists public.salon_privilege_settings (
  key text primary key,
  title text not null,
  description text,
  tier integer not null default 1,
  required_points integer not null default 100,
  is_enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS
alter table public.reader_regimens enable row level security;
alter table public.reader_vanity_items enable row level security;
alter table public.salon_house_protocols enable row level security;
alter table public.salon_privilege_settings enable row level security;

-- Policies: Reader Regimens
create policy "Anyone can select reader_regimens by fingerprint or user_id"
  on public.reader_regimens for select
  using (
    (auth.uid() is not null and user_id = auth.uid()) or
    fingerprint is not null
  );

create policy "Anyone can insert reader_regimens"
  on public.reader_regimens for insert
  with check (true);

create policy "Anyone can update reader_regimens by fingerprint or user_id"
  on public.reader_regimens for update
  using (
    (auth.uid() is not null and user_id = auth.uid()) or
    fingerprint is not null
  );

create policy "Admins can manage reader_regimens"
  on public.reader_regimens for all
  using (true)
  with check (true);

-- Policies: Reader Vanity Items
create policy "Anyone can select reader_vanity_items by fingerprint or user_id"
  on public.reader_vanity_items for select
  using (
    (auth.uid() is not null and user_id = auth.uid()) or
    fingerprint is not null
  );

create policy "Anyone can insert reader_vanity_items"
  on public.reader_vanity_items for insert
  with check (true);

create policy "Anyone can update or delete reader_vanity_items"
  on public.reader_vanity_items for all
  using (
    (auth.uid() is not null and user_id = auth.uid()) or
    fingerprint is not null
  );

-- Policies: Salon House Protocols
create policy "Public can read published house protocols"
  on public.salon_house_protocols for select
  using (is_published = true);

create policy "Admins can manage salon_house_protocols"
  on public.salon_house_protocols for all
  using (true)
  with check (true);

-- Policies: Salon Privilege Settings
create policy "Public can read salon_privilege_settings"
  on public.salon_privilege_settings for select
  using (true);

create policy "Admins can manage salon_privilege_settings"
  on public.salon_privilege_settings for all
  using (true)
  with check (true);

-- Seed Initial Curated House Protocols
insert into public.salon_house_protocols (title, slug, tagline, skin_type, target_concerns, difficulty, morning_steps, evening_steps, weekly_cadence, curator_name)
values
  (
    'The Barrier Glass Protocol',
    'barrier-glass-protocol',
    'Maximal hydration and lipid restoration for compromised, reactive skin barriers.',
    'sensitive',
    '["barrier_repair", "erythema_redness", "deep_hydration"]'::jsonb,
    'intermediate',
    '[
      {"step": 1, "phase": "AM", "type": "Cleanse", "name": "Milky Oat Lipid Cleanser", "ph": "5.5", "wait": 0, "notes": "Rinse with lukewarm water only"},
      {"step": 2, "phase": "AM", "type": "Hydrate", "name": "Polyglutamic Acid & Centella Essence", "ph": "5.8", "wait": 1, "notes": "Pat gently onto damp skin"},
      {"step": 3, "phase": "AM", "type": "Repair", "name": "Ectoin & 3:1:1 Ceramide Complex", "ph": "6.0", "wait": 2, "notes": "Restores stratum corneum micro-tears"},
      {"step": 4, "phase": "AM", "type": "Protect", "name": "Mineral SPF 50+ Invisible Zinc", "ph": "6.5", "wait": 0, "notes": "Full two-finger measurement"}
    ]'::jsonb,
    '[
      {"step": 1, "phase": "PM", "type": "First Cleanse", "name": "Squalane & Jojoba Melting Balm", "ph": "6.0", "wait": 0, "notes": "Dissolve SPF and environmental particulates"},
      {"step": 2, "phase": "PM", "type": "Second Cleanse", "name": "Low-Foam Amino Acid Gel", "ph": "5.2", "wait": 0, "notes": "Gentle residue sweep"},
      {"step": 3, "phase": "PM", "type": "Recovery", "name": "Copper Tripeptide-1 (GHK-Cu) 1% Serum", "ph": "6.5", "wait": 5, "notes": "Stimulates collagen I & III synthesis"},
      {"step": 4, "phase": "PM", "type": "Occlusion", "name": "Cholesterol & Squalane Comfort Balm", "ph": "5.9", "wait": 0, "notes": "Lock trans-epidermal water loss (TEWL)"}
    ]'::jsonb,
    'Daily Gentle Protocol: Non-stripping restorative cadence without direct peeling acids until barrier test reaches 100%.',
    'Dr. H. Vance, Formulation Chemist'
  ),
  (
    'The Clinical Retinoid & Cellular Renewal Masterclass',
    'clinical-retinoid-renewal',
    'Gold-standard cellular turnover without the hallmark retinoid dermatitis peeling.',
    'combination',
    '["fine_lines", "cellular_turnover", "hyperpigmentation", "pore_refinement"]'::jsonb,
    'advanced',
    '[
      {"step": 1, "phase": "AM", "type": "Cleanse", "name": "Enzyme Hydrating Cleanser", "ph": "5.5", "wait": 0, "notes": "No scrubbing"},
      {"step": 2, "phase": "AM", "type": "Antioxidant", "name": "Pure L-Ascorbic Acid 15% + Ferulic 0.5%", "ph": "3.0", "wait": 10, "notes": "Wait 10 minutes for optimal free radical neutralization"},
      {"step": 3, "phase": "AM", "type": "Hydrate", "name": "Niacinamide 4% & Hyaluronic Multi-Weight", "ph": "5.5", "wait": 1, "notes": "Strengthens baseline tolerance"},
      {"step": 4, "phase": "AM", "type": "Shield", "name": "High-Protection Hybrid Fluid SPF 50", "ph": "6.2", "wait": 0, "notes": "Mandatory with nightly retinoids"}
    ]'::jsonb,
    '[
      {"step": 1, "phase": "PM", "type": "Cleanse", "name": "Replenishing Oil Cleanser", "ph": "5.8", "wait": 0, "notes": "Remove sunscreen and daily sebum"},
      {"step": 2, "phase": "PM", "type": "Buffer Base", "name": "Lightweight Hyaluronic Emulsion", "ph": "5.5", "wait": 3, "notes": "Sandwich technique step 1 for zero peel"},
      {"step": 3, "phase": "PM", "type": "Active", "name": "Microencapsulated Retinaldehyde 0.1%", "ph": "6.0", "wait": 15, "notes": "Direct precursor to retinoic acid; 11x faster than retinol"},
      {"step": 4, "phase": "PM", "type": "Buffer Top", "name": "Phytoceramide Rich Recovery Crème", "ph": "5.7", "wait": 0, "notes": "Sandwich technique step 2"}
    ]'::jsonb,
    'Skin Cycling Cadence: Mon/Thu Retinaldehyde | Tue Glycolic Acid 7% | Wed/Fri/Sat/Sun Barrier Recovery.',
    'Lixxon Clinical Research'
  )
on conflict (slug) do nothing;

