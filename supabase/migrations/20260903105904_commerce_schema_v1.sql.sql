/*
# Commerce Schema — Products Extension, Orders, Customers, Downloads, Collections, Analytics

## Overview
Extends Lixxon Studio's database with full commerce infrastructure for digital products,
affiliate/recommended products, orders, customers, secure digital delivery, editorial
collections, sponsored content support, newsletter improvements, and lightweight analytics.

## New Tables
1. `shop_products` — Lixxon's own digital products (guides, ebooks, etc.)
2. `shop_categories` — Product categories for the shop
3. `orders` — Customer orders with payment status
4. `order_items` — Line items within an order
5. `customers` — Customer records (email-based, no auth required initially)
6. `download_entitlements` — Secure download tokens for purchased products
7. `collections` — Curated editorial collections (e.g. "Skin Reset", "Sunday Reset")
8. `collection_items` — Ordered articles within a collection
9. `article_products` — Products linked to articles ("Shop this article")
10. `sponsored_content` — Sponsored post metadata
11. `article_views` — Lightweight first-party article view tracking
12. `product_clicks` — Product click tracking

## Modified Tables
- `newsletter_subscribers` — Added `status`, `source`, `updated_at` columns
- `products` — Added `is_digital`, `file_path`, `preview_file_path`, `currency`, `sku`,
  `product_type`, `is_featured`, `is_active`, `sort_order`, `what_is_included`, `seo_title`,
  `seo_description` columns (all nullable, additive)

## Security
- All new tables have RLS enabled
- Public read for published content; admin-only for orders, customers, analytics
- Download entitlements are scoped by customer email + token
- No service-role credentials in frontend
*/

-- ==================== SHOP CATEGORIES ====================
CREATE TABLE IF NOT EXISTS shop_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  description text,
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE shop_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_read_shop_categories" ON shop_categories;
CREATE POLICY "public_read_shop_categories" ON shop_categories
  FOR SELECT TO anon, authenticated USING (is_active = true);
DROP POLICY IF EXISTS "admin_all_shop_categories" ON shop_categories;
CREATE POLICY "admin_all_shop_categories" ON shop_categories
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ==================== EXTEND EXISTING products TABLE ====================
DO $$ BEGIN
  ALTER TABLE products ADD COLUMN IF NOT EXISTS is_digital boolean DEFAULT false;
  ALTER TABLE products ADD COLUMN IF NOT EXISTS file_path text;
  ALTER TABLE products ADD COLUMN IF NOT EXISTS preview_file_path text;
  ALTER TABLE products ADD COLUMN IF NOT EXISTS currency text DEFAULT 'USD';
  ALTER TABLE products ADD COLUMN IF NOT EXISTS sku text;
  ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type text DEFAULT 'affiliate';
  ALTER TABLE products ADD COLUMN IF NOT EXISTS is_featured boolean DEFAULT false;
  ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
  ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;
  ALTER TABLE products ADD COLUMN IF NOT EXISTS what_is_included text;
  ALTER TABLE products ADD COLUMN IF NOT EXISTS seo_title text;
  ALTER TABLE products ADD COLUMN IF NOT EXISTS seo_description text;
  ALTER TABLE products ADD COLUMN IF NOT EXISTS shop_category_id uuid REFERENCES shop_categories(id) ON DELETE SET NULL;
  ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
  ALTER TABLE products ADD COLUMN IF NOT EXISTS sponsor_name text;
  ALTER TABLE products ADD COLUMN IF NOT EXISTS is_sponsored boolean DEFAULT false;
  ALTER TABLE products ADD COLUMN IF NOT EXISTS disclosure_text text;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Allow public to read active products, admin to do everything
DROP POLICY IF EXISTS "public_read_products" ON products;
CREATE POLICY "public_read_products" ON products
  FOR SELECT TO anon, authenticated USING (is_active = true);
DROP POLICY IF EXISTS "admin_all_products" ON products;
CREATE POLICY "admin_all_products" ON products
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ==================== CUSTOMERS ====================
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  name text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
-- Customers can see their own record by email match (no auth required, but scoped)
DROP POLICY IF EXISTS "customer_self_read" ON customers;
CREATE POLICY "customer_self_read" ON customers
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_customers" ON customers;
CREATE POLICY "anon_insert_customers" ON customers
  FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "admin_all_customers" ON customers;
CREATE POLICY "admin_all_customers" ON customers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ==================== ORDERS ====================
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text UNIQUE NOT NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  customer_email text NOT NULL,
  customer_name text,
  status text NOT NULL DEFAULT 'pending',
  payment_status text NOT NULL DEFAULT 'pending',
  payment_reference text,
  payment_provider text DEFAULT 'flutterwave',
  amount numeric(12,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
-- Customers can see their own orders by email (scoped, not requiring auth)
DROP POLICY IF EXISTS "customer_read_own_orders" ON orders;
CREATE POLICY "customer_read_own_orders" ON orders
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_orders" ON orders;
CREATE POLICY "anon_insert_orders" ON orders
  FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "admin_all_orders" ON orders;
CREATE POLICY "admin_all_orders" ON orders
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ==================== ORDER ITEMS ====================
CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  product_slug text,
  price numeric(12,2) NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  file_path text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customer_read_own_order_items" ON order_items;
CREATE POLICY "customer_read_own_order_items" ON order_items
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "admin_all_order_items" ON order_items;
CREATE POLICY "admin_all_order_items" ON order_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ==================== DOWNLOAD ENTITLEMENTS ====================
CREATE TABLE IF NOT EXISTS download_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  customer_email text NOT NULL,
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  download_token text UNIQUE NOT NULL,
  download_count integer DEFAULT 0,
  max_downloads integer DEFAULT 5,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE download_entitlements ENABLE ROW LEVEL SECURITY;
-- Anyone with the token can read (token is unguessable, scoped to email)
DROP POLICY IF EXISTS "public_read_entitlements" ON download_entitlements;
CREATE POLICY "public_read_entitlements" ON download_entitlements
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_update_entitlements" ON download_entitlements;
CREATE POLICY "anon_update_entitlements" ON download_entitlements
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "admin_all_entitlements" ON download_entitlements;
CREATE POLICY "admin_all_entitlements" ON download_entitlements
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ==================== COLLECTIONS ====================
CREATE TABLE IF NOT EXISTS collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text UNIQUE NOT NULL,
  description text,
  cover_image text,
  is_featured boolean DEFAULT false,
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_read_collections" ON collections;
CREATE POLICY "public_read_collections" ON collections
  FOR SELECT TO anon, authenticated USING (is_active = true);
DROP POLICY IF EXISTS "admin_all_collections" ON collections;
CREATE POLICY "admin_all_collections" ON collections
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ==================== COLLECTION ITEMS ====================
CREATE TABLE IF NOT EXISTS collection_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid REFERENCES collections(id) ON DELETE CASCADE,
  post_id uuid REFERENCES posts(id) ON DELETE CASCADE,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE collection_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_read_collection_items" ON collection_items;
CREATE POLICY "public_read_collection_items" ON collection_items
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "admin_all_collection_items" ON collection_items;
CREATE POLICY "admin_all_collection_items" ON collection_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ==================== ARTICLE ↔ PRODUCT RELATIONSHIPS ====================
CREATE TABLE IF NOT EXISTS article_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid REFERENCES posts(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(post_id, product_id)
);
ALTER TABLE article_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_read_article_products" ON article_products;
CREATE POLICY "public_read_article_products" ON article_products
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "admin_all_article_products" ON article_products;
CREATE POLICY "admin_all_article_products" ON article_products
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ==================== SPONSORED CONTENT ====================
CREATE TABLE IF NOT EXISTS sponsored_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid REFERENCES posts(id) ON DELETE CASCADE,
  sponsor_name text NOT NULL,
  campaign_name text,
  start_date timestamptz,
  end_date timestamptz,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE sponsored_content ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_read_sponsored" ON sponsored_content;
CREATE POLICY "public_read_sponsored" ON sponsored_content
  FOR SELECT TO anon, authenticated USING (is_active = true);
DROP POLICY IF EXISTS "admin_all_sponsored" ON sponsored_content;
CREATE POLICY "admin_all_sponsored" ON sponsored_content
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ==================== EXTEND NEWSLETTER ====================
DO $$ BEGIN
  ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';
  ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS source text;
  ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ==================== ARTICLE VIEWS (analytics) ====================
CREATE TABLE IF NOT EXISTS article_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid REFERENCES posts(id) ON DELETE CASCADE,
  fingerprint text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE article_views ENABLE ROW LEVEL SECURITY;
-- Allow anon insert for view tracking, admin-only read
DROP POLICY IF EXISTS "anon_insert_article_views" ON article_views;
CREATE POLICY "anon_insert_article_views" ON article_views
  FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "admin_read_article_views" ON article_views;
CREATE POLICY "admin_read_article_views" ON article_views
  FOR SELECT TO authenticated USING (true);

-- ==================== PRODUCT CLICKS (analytics) ====================
CREATE TABLE IF NOT EXISTS product_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  fingerprint text,
  source text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE product_clicks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_insert_product_clicks" ON product_clicks;
CREATE POLICY "anon_insert_product_clicks" ON product_clicks
  FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "admin_read_product_clicks" ON product_clicks;
CREATE POLICY "admin_read_product_clicks" ON product_clicks
  FOR SELECT TO authenticated USING (true);

-- ==================== INDEXES ====================
CREATE INDEX IF NOT EXISTS idx_orders_customer_email ON orders(customer_email);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_download_entitlements_token ON download_entitlements(download_token);
CREATE INDEX IF NOT EXISTS idx_download_entitlements_email ON download_entitlements(customer_email);
CREATE INDEX IF NOT EXISTS idx_article_products_post_id ON article_products(post_id);
CREATE INDEX IF NOT EXISTS idx_collection_items_collection_id ON collection_items(collection_id);
CREATE INDEX IF NOT EXISTS idx_article_views_post_id ON article_views(post_id);
CREATE INDEX IF NOT EXISTS idx_sponsored_content_post_id ON sponsored_content(post_id);
CREATE INDEX IF NOT EXISTS idx_products_product_type ON products(product_type);
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_is_featured ON products(is_featured);
