-- Add slug and detail columns to products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS what_it_is text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS what_its_used_for text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS why_we_recommend text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS key_ingredients text;

-- Update existing products with slugs and rich detail content
UPDATE products SET
  slug = 'vitamin-c-15-brightening-serum',
  what_it_is = 'A lightweight, fast-absorbing serum formulated with 15% L-ascorbic acid — the most clinically studied form of vitamin C. Designed for daily morning use to brighten, even out skin tone, and protect against environmental damage.',
  what_its_used_for = 'Brightening dark spots and hyperpigmentation, boosting collagen production for firmer skin, neutralizing free radicals from pollution and UV exposure, and enhancing the effectiveness of your sunscreen. Apply 3-4 drops to clean skin every morning before moisturizer.',
  why_we_recommend = 'Most vitamin C serums on the market use unstable forms that oxidize within weeks. This formula uses L-ascorbic acid at the clinically proven 15% concentration, stabilized with ferulic acid and vitamin E. The opaque air-tight pump packaging prevents oxidation, meaning every drop delivers active vitamin C. Our editors have tested dozens of vitamin C serums and this one delivers visible brightening within 4 weeks without the irritation common with high-strength formulas.',
  key_ingredients = '15% L-Ascorbic Acid, Ferulic Acid, Vitamin E, Hyaluronic Acid'
WHERE name = 'Vitamin C 15% Brightening Serum';

UPDATE products SET
  slug = 'hyaluronic-acid-hydrating-essence',
  what_it_is = 'A deeply hydrating essence that combines three molecular weights of hyaluronic acid to penetrate multiple layers of the skin. Lightweight and non-sticky, it creates a plump, dewy canvas for the rest of your routine.',
  what_its_used_for = 'Restoring moisture to dehydrated skin, plumping fine lines caused by dryness, creating a smooth base for serums and moisturizers, and strengthening the skin barrier. Apply to damp skin after cleansing, morning and night, pressing gently into the skin.',
  why_we_recommend = 'This essence solves the most common hyaluronic acid problem — it only works when applied to damp skin and sealed with a moisturizer. The formula includes three HA weights: high molecular for surface hydration, medium for mid-layer plumping, and low molecular for deeper penetration. We recommend it because it is fragrance-free, non-comedogenic, and works equally well under heavy creams or lightweight lotions.',
  key_ingredients = 'Sodium Hyaluronate (3 weights), Glycerin, Panthenol, Ceramides'
WHERE name = 'Hyaluronic Acid Hydrating Essence';

UPDATE products SET
  slug = 'mineral-spf-35-daily-shield',
  what_it_is = 'A broad-spectrum mineral sunscreen using non-nano zinc oxide at SPF 35. Formulated to leave no white cast on medium to deep skin tones, with a natural-matte finish that works under makeup or alone.',
  what_its_used_for = 'Daily protection against UVA (aging) and UVB (burning) rays. Prevents photoaging, dark spots, and skin cancer. Apply every morning as the last step in your skincare routine. Reapply every 2 hours during direct sun exposure.',
  why_we_recommend = 'Finding a mineral sunscreen that does not leave a white cast is notoriously difficult. This formula uses a specialized zinc oxide dispersion technology that blends invisibly into all skin tones. It is non-greasy, does not pill under makeup, and contains niacinamide to control oil throughout the day. Our editors wear this daily — it is the sunscreen we actually want to put on.',
  key_ingredients = 'Non-Nano Zinc Oxide 20%, Niacinamide, Green Tea Extract, Squalane'
WHERE name = 'Mineral SPF 35 Daily Shield';

UPDATE products SET
  slug = 'retinol-03-renewal-night-serum',
  what_it_is = 'A gentle but effective 0.3% retinol night serum formulated with soothing botanicals to minimize irritation. Encapsulated retinol releases gradually overnight for sustained results without the harsh side effects.',
  what_its_used_for = 'Reducing fine lines and wrinkles, improving skin texture and tone, unclogging pores, and stimulating collagen production. Apply a pea-sized amount to dry skin 2-3 nights per week, gradually increasing to nightly use. Always follow with moisturizer.',
  why_we_recommend = 'Retinol is the most proven anti-aging ingredient, but many people abandon it due to irritation. This 0.3% encapsulated formula releases retinol slowly over the night, dramatically reducing redness and peeling. It also includes bisabolol and allantoin to soothe. We recommend starting here before moving to prescription retinoids. Pair with a good moisturizer and daily sunscreen for best results.',
  key_ingredients = '0.3% Encapsulated Retinol, Bisabolol, Allantoin, Vitamin E'
WHERE name = 'Retinol 0.3% Renewal Night Serum';

UPDATE products SET
  slug = 'magnesium-glycinate-sleep-support',
  what_it_is = 'A highly bioavailable magnesium glycinate supplement designed to support restful sleep, muscle relaxation, and stress reduction. 200mg per serving in an easy-to-swallow capsule form.',
  what_its_used_for = 'Improving sleep quality and reducing time to fall asleep, relaxing tense muscles after exercise or long work days, supporting nervous system calm, and reducing anxiety symptoms. Take 1-2 capsules 30 minutes before bed.',
  why_we_recommend = 'Magnesium glycinate is the best-absorbed form of magnesium and the least likely to cause digestive upset. Unlike melatonin, it does not disrupt your natural sleep architecture — it simply gives your nervous system the mineral it needs to wind down. Our editors have found it particularly helpful for stress-related sleep issues. It is third-party tested, free of fillers, and made in a GMP-certified facility.',
  key_ingredients = 'Magnesium Glycinate 200mg, Vegetable Cellulose Capsule'
WHERE name = 'Magnesium Glycinate Sleep Support';

UPDATE products SET
  slug = 'daily-reset-journal',
  what_it_is = 'A 90-day guided journal designed to bring intentionality to your mornings and evenings. Dated entries with prompts for gratitude, daily intentions, habit tracking, and evening reflection.',
  what_its_used_for = 'Building a consistent morning routine, tracking wellness habits, reducing mental clutter through structured journaling, and creating a tangible record of your personal growth over 90 days.',
  why_we_recommend = 'We designed this journal based on the morning routines that actually work — gratitude, intention-setting, and habit stacking. Unlike blank journals that feel overwhelming, each page has guided prompts that take 5 minutes in the morning and 3 minutes in the evening. The quality of the paper, the linen cover, and the lay-flat binding make it a joy to use daily. This is the journal our editors actually use every morning.',
  key_ingredients = 'Linen hardcover, 90 dated entries, habit tracker, weekly review'
WHERE name = 'The Daily Reset Journal';

-- Make slug unique
CREATE UNIQUE INDEX IF NOT EXISTS products_slug_key ON products (slug) WHERE slug IS NOT NULL;
