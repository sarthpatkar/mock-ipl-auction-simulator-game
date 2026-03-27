-- Clear all player image mappings so images can be re-uploaded manually.
update public.players
set image_url = null;
