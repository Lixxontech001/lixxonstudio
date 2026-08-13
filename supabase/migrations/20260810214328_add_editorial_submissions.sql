/*
# Add newsletter and contact submissions

## Overview
Adds the two public-facing forms required by the editorial site. Visitors can submit a newsletter email or contact message through the anon key. The site does not expose submitted records back to visitors.

## New Tables

### newsletter_subscribers
- id (uuid, primary key)
- email (text, unique, not null)
- created_at (timestamptz)

### contact_messages
- id (uuid, primary key)
- name (text, not null)
- email (text, not null)
- topic (text, not null)
- message (text, not null)
- created_at (timestamptz)

## Security
- Row level security is enabled on both tables.
- Anonymous and authenticated visitors may insert form submissions.
- No read, update, or delete policies are created, so submitted records remain private to trusted operators.
*/

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  topic text NOT NULL,
  message text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE newsletter_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_submit_newsletter" ON newsletter_subscribers;
CREATE POLICY "public_submit_newsletter" ON newsletter_subscribers FOR INSERT
  TO anon, authenticated WITH CHECK (length(trim(email)) >= 5 AND position('@' in email) > 1);

DROP POLICY IF EXISTS "public_submit_contact" ON contact_messages;
CREATE POLICY "public_submit_contact" ON contact_messages FOR INSERT
  TO anon, authenticated WITH CHECK (
    length(trim(name)) >= 2 AND
    length(trim(email)) >= 5 AND
    position('@' in email) > 1 AND
    length(trim(topic)) >= 2 AND
    length(trim(message)) >= 10
  );
