/*
# Create blog comments table with reply support

## Overview
Adds a comments system for the editorial blog. Visitors can leave comments on articles
and reply to existing comments (one level of nesting). No authentication required.
Comments are public-readable so anyone can see the discussion, and anyone can post.

## New Tables

### comments
- id (uuid, primary key)
- post_id (uuid, FK to posts, ON DELETE CASCADE)
- parent_id (uuid, FK to comments self-referencing, nullable, ON DELETE CASCADE for replies)
- author_name (text, not null, 2-50 chars)
- author_email (text, not null, validated for basic email shape)
- content (text, not null, 3-1000 chars)
- is_visible (boolean, default true, allows admin moderation via Supabase dashboard)
- created_at (timestamptz, default now())

## Security
- RLS enabled on comments.
- Public read: anyone can see visible comments (TO anon, authenticated, USING is_visible = true).
- Public insert: anyone can post a comment or reply (TO anon, authenticated, WITH CHECK on field lengths and email shape).
- No update or delete policies from the frontend. Moderation is handled via Supabase dashboard by trusted operators.

## Indexes
- idx_comments_post_id for fast lookups by article.
- idx_comments_parent_id for fetching replies.
- idx_comments_created_at for chronological ordering.
*/