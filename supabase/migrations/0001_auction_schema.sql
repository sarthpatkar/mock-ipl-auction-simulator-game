-- IPL Auction Simulation schema
-- Ensure required extensions
create extension if not exists "pgcrypto";

create or replace function is_room_member(p_room_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from room_participants
    where room_id = p_room_id
      and user_id = auth.uid()
  );
$$;

create or replace function can_read_bid(p_auction_session_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from auction_sessions a
    join room_participants rp on rp.room_id = a.room_id
    where a.id = p_auction_session_id
      and rp.user_id = auth.uid()
  );
$$;

-- 1.2 profiles
create table if not exists profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  username text not null unique,
  created_at timestamptz default now()
);

alter table profiles enable row level security;
drop policy if exists "Users can read all profiles" on profiles;
create policy "Users can read all profiles" on profiles for select using (true);
drop policy if exists "Users can insert own profile" on profiles;
create policy "Users can insert own profile" on profiles for insert
  with check (auth.uid() = id);
drop policy if exists "Users can update own profile" on profiles;
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);

-- 1.3 rooms
create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  admin_id uuid references profiles(id) not null,
  status text default 'lobby'
    check (status in ('lobby','auction','completed')),
  settings jsonb default '{
    "budget": 1000000000,
    "squad_size": 20,
    "timer_seconds": 15,
    "player_order": "category"
  }'::jsonb,
  created_at timestamptz default now()
);

alter table rooms enable row level security;

-- 1.4 room_participants
create table if not exists room_participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,
  team_name text not null,
  budget_remaining bigint not null default 1000000000,
  squad_count int default 0,
  joined_at timestamptz default now(),
  unique(room_id, user_id),
  unique(room_id, team_name)
);

alter table room_participants enable row level security;
drop policy if exists "Room members can read participants" on room_participants;
create policy "Room members can read participants" on room_participants for select
  using (is_room_member(room_id));
drop policy if exists "Users can join rooms" on room_participants;
create policy "Users can join rooms" on room_participants for insert
  with check (auth.uid() = user_id);
drop policy if exists "Users can leave rooms" on room_participants;
create policy "Users can leave rooms" on room_participants for delete
  using (auth.uid() = user_id);

drop policy if exists "Room members can read room" on rooms;
create policy "Room members can read room" on rooms for select
  using (is_room_member(id) or auth.uid() = admin_id);
drop policy if exists "Admin can update room" on rooms;
create policy "Admin can update room" on rooms for update
  using (auth.uid() = admin_id);
drop policy if exists "Authenticated users can create rooms" on rooms;
create policy "Authenticated users can create rooms" on rooms for insert
  with check (auth.uid() = admin_id);

-- 1.5 players
create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  age int,
  nationality text,
  ipl_team text,
  role text check (role in ('batter','wicketkeeper','allrounder','bowler')),
  category text check (category in ('capped','uncapped')),
  batting_style text,
  bowling_style text,
  image_url text,
  base_price bigint not null,
  base_price_label text,
  spouse text,
  created_at timestamptz default now()
);

alter table players enable row level security;
drop policy if exists "Anyone can read players" on players;
create policy "Anyone can read players" on players for select using (true);
drop policy if exists "No public insert" on players;
create policy "No public insert" on players for insert with check (false);

-- 1.6 auction_sessions
create table if not exists auction_sessions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade not null unique,
  current_player_id uuid references players(id),
  current_price bigint default 0,
  highest_bidder_id uuid references room_participants(id),
  ends_at timestamptz,
  status text default 'waiting'
    check (status in ('waiting','live','paused','sold','unsold','completed')),
  player_queue uuid[],
  completed_players uuid[] default '{}',
  active_bidders uuid[] default '{}',
  skipped_bidders uuid[] default '{}',
  round_label text default 'Round 1',
  created_at timestamptz default now()
);

create index if not exists idx_auction_room_id on auction_sessions(room_id);
create index if not exists idx_auction_status on auction_sessions(status);
create index if not exists idx_auction_ends_at on auction_sessions(ends_at);

alter table auction_sessions enable row level security;
drop policy if exists "Room members can read auction" on auction_sessions;
create policy "Room members can read auction" on auction_sessions for select
  using (is_room_member(room_id));
drop policy if exists "Admin can insert auction session" on auction_sessions;
create policy "Admin can insert auction session" on auction_sessions for insert
  with check (
    auth.uid() = (select admin_id from rooms where id = auction_sessions.room_id)
  );
drop policy if exists "Admin can update auction session" on auction_sessions;
create policy "Admin can update auction session" on auction_sessions for update
  using (
    auth.uid() = (select admin_id from rooms where id = auction_sessions.room_id)
  );

-- 1.7 bids
create table if not exists bids (
  id uuid primary key default gen_random_uuid(),
  auction_session_id uuid references auction_sessions(id) on delete cascade not null,
  player_id uuid references players(id) not null,
  bidder_id uuid references room_participants(id) not null,
  amount bigint not null,
  created_at timestamptz default now()
);

create index if not exists idx_bids_auction_session on bids(auction_session_id);
create index if not exists idx_bids_created_at on bids(created_at desc);

alter table bids enable row level security;
drop policy if exists "Room members can read bids" on bids;
create policy "Room members can read bids" on bids for select
  using (can_read_bid(auction_session_id));

-- 1.8 squad_players
create table if not exists squad_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade not null,
  participant_id uuid references room_participants(id) on delete cascade not null,
  player_id uuid references players(id) not null,
  price_paid bigint not null,
  acquired_at timestamptz default now(),
  unique(room_id, player_id)
);

create index if not exists idx_squad_participant on squad_players(participant_id);

alter table squad_players enable row level security;
drop policy if exists "Room members can read squads" on squad_players;
create policy "Room members can read squads" on squad_players for select
  using (is_room_member(room_id));
