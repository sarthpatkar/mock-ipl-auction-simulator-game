# Section 1 — Create Supabase Project
1. Go to https://supabase.com/dashboard and click **New Project**.
2. Select an organization (or create one) and choose a **Project name**.
3. Set a strong **Database Password** and note it for later.
4. Choose the nearest **Region** and click **Create new project**.
5. Wait for the project to finish provisioning.

# Section 2 — Get credentials (URL, anon key, service role key) and where to paste them
1. In the Supabase dashboard, open **Project Settings → API**.
2. Copy **Project URL** and **anon public** key.
3. Copy **service_role** key.
4. On your machine, open `.env.local` (created by setup.sh) and paste:
   - `NEXT_PUBLIC_SUPABASE_URL` = [Project URL](https://rkgckqlstuycgzuwspcn.supabase.co)
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = anon public key
   - `SUPABASE_SERVICE_ROLE_KEY` = service_role key
5. Save `.env.local`.

# Section 3 — Run migrations in SQL Editor
1. In the dashboard, go to **Database → SQL Editor**.
2. Open a new query tab.
3. Paste the contents of `supabase/migrations/0001_auction_schema.sql` and click **Run**.
4. Paste `supabase/migrations/0002_rpc_functions.sql` and click **Run**.
5. Paste `supabase/migrations/0003_room_code.sql` and click **Run**.
6. Paste `supabase/migrations/0004_triggers.sql` and click **Run**.
7. Paste `supabase/migrations/0005_auction_updated_at.sql` and click **Run**.
8. Paste `supabase/migrations/0006_access_control_and_admin_rpc.sql` and click **Run**.
9. Paste `supabase/migrations/0007_fix_recursive_rls.sql` and click **Run**.
10. Paste `supabase/migrations/0008_room_access_and_join_rpc.sql` and click **Run**.
11. Paste `supabase/migrations/0009_budget_sync_and_seed_guard.sql` and click **Run**.

# Section 4 — Enable Realtime for exactly these 4 tables
1. Go to **Database → Replication → Tables**.
2. Toggle **auction_sessions** to Enabled.
3. Toggle **bids** to Enabled.
4. Toggle **room_participants** to Enabled.
5. Toggle **rooms** to Enabled.
6. Click **Save** if prompted.

# Section 5 — Enable Email Auth and disable email confirmation for local testing
1. Go to **Authentication → Providers → Email**.
2. Enable **Email** provider.
3. Disable **Confirm email** (turn off email confirmation).
4. Click **Save**.

# Section 6 — Run setup.sh
1. In your project folder, make the script executable: `chmod +x setup.sh`.
2. Run `./setup.sh`.
3. If it warns about missing env values, edit `.env.local`, then re-run `./setup.sh`.

# Section 7 — Verify checklist
1. In **Table Editor**, confirm 7 tables exist: `profiles`, `rooms`, `room_participants`, `players`, `auction_sessions`, `bids`, `squad_players`.
2. In **Database → SQL Editor → Functions** (or run `select routine_name from information_schema.routines where routine_schema='public';`), confirm RPCs exist: `place_bid`, `skip_player`, `finalize_player`, `advance_to_next_player`, `pause_auction`, `resume_auction`, `stop_auction`.
3. In **Database → Replication → Tables**, confirm Realtime is enabled for the 4 tables.
4. In **Authentication → Providers → Email**, confirm email provider is enabled and confirmation is off.
