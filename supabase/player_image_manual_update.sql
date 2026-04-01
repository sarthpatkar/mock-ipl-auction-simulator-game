-- Manual AI avatar update helper
--
-- Step 1: Run this to get the player ids you need:
-- select id, name
-- from public.players
-- order by name;
--
-- Step 2: Upload AI-generated avatar images to Supabase Storage bucket `player-images`
-- using the file name format:
--   <player_id>.webp
--
-- Step 3: Replace the sample rows below with your real mappings.
-- Public URL format:
-- https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/player-images/<player_id>.webp

with mappings(player_id, image_url) as (
  values
    ('00000000-0000-0000-0000-000000000000'::uuid, 'https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/player-images/00000000-0000-0000-0000-000000000000.webp'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/player-images/11111111-1111-1111-1111-111111111111.webp')
)
update public.players p
set image_url = m.image_url
from mappings m
where p.id = m.player_id;

-- Verify after updating:
-- select name, image_url
-- from public.players
-- order by name;
