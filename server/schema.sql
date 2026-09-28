-- offload backend: Supabase tables + public photo bucket.
-- Paste the whole file into Supabase > SQL Editor and run it. Safe to run more than once.
--
-- Columns match the CONTRACT in CLAUDE.md exactly. Money is integer pence, ids are short text ("i_7kq2mx").
-- Arrays and objects are jsonb. items.meta is internal (stripped from GET /api/state).
--
-- Security: the server talks to Supabase with the service key, which bypasses RLS. RLS is switched on
-- with no policies, so the public anon key can't read or write these tables. Never ship the service key to the UI.
--
-- No foreign keys or enum checks on purpose: the server flushes rows every 500 ms in any order,
-- and a rejected write would silently lose state. scripts/validate.js checks integrity instead.

create table if not exists pickups (
  id            text primary key,
  seller_name   text not null default '',
  address       text not null default '',
  transcript    text not null default '',
  estimate_low  integer not null default 0,
  estimate_high integer not null default 0,
  preview       jsonb not null default '[]'::jsonb,   -- [{ label, low, high }]
  status        text not null default 'estimated',     -- estimated | booked | collected | listed
  runner_name   text,
  created_at    timestamptz not null default now()
);

create table if not exists items (
  id               text primary key,
  pickup_id        text not null,
  label            text not null default '',
  brand            text,
  type             text not null default 'other',      -- jacket | jeans | hoodie | t-shirt | dress | trainers | other
  size             text,
  grade            text,                               -- A | B | C | D | null
  condition_notes  jsonb not null default '[]'::jsonb,
  special          text,
  claim            text,
  claim_proof      text,
  seller_ask       integer,
  price_source     text not null default 'table',      -- comps | seller | table
  price_confidence text not null default 'low',        -- high | medium | low
  seller_story     text,
  photo_requests   jsonb not null default '[]'::jsonb,
  proof_request    text,
  seller_proof     jsonb not null default '[]'::jsonb,
  photos           jsonb not null default '[]'::jsonb,
  comps            jsonb not null default '[]'::jsonb,   -- [{ source, title, price, url }]
  list_price       integer not null default 0,
  floor_price      integer not null default 0,
  shopify_url      text,
  status           text not null default 'estimated',  -- estimated | needs_photos | photographed | listed | offer | sold | posted
  meta             jsonb not null default '{}'::jsonb
);

create table if not exists jobs (
  id          text primary key,
  type        text not null,                           -- pickup | post
  pickup_id   text not null,
  item_ids    jsonb not null default '[]'::jsonb,
  runner_name text,
  address     text not null default '',
  pay         integer not null default 0,
  status      text not null default 'open'             -- open | accepted | done
);

create table if not exists offers (
  id            text primary key,
  item_id       text not null,
  buyer         text not null default '',
  amount        integer not null,
  counter       integer,
  round         integer not null default 1,            -- 1 | 2
  status        text not null default 'pending',       -- pending | accepted | countered | rejected
  discount_code text
);

create table if not exists ledger (
  id            text primary key,
  item_id       text not null,
  sale_price    integer not null,
  seller_amount integer not null,
  runner_amount integer not null,
  our_amount    integer not null
);

create table if not exists events (
  id     text primary key,
  ts     timestamptz not null default now(),
  actor  text not null,                                -- agent | seller | runner | buyer
  text   text not null,
  money  integer
);

create index if not exists items_pickup_id_idx on items (pickup_id);
create index if not exists events_ts_idx on events (ts);

alter table pickups enable row level security;
alter table items   enable row level security;
alter table jobs    enable row level security;
alter table offers  enable row level security;
alter table ledger  enable row level security;
alter table events  enable row level security;

-- Supabase projects created after 30 May 2026 no longer grant new public tables to the API roles automatically,
-- so the service key would get "permission denied". Grant it explicitly (harmless on older projects).
-- anon and authenticated get nothing: the UI only talks to the backend.
grant select, insert, update, delete on table pickups, items, jobs, offers, ledger, events to service_role;

-- Public bucket for photos: anyone can view by URL (Shopify and the UI need that), only the service key can upload.
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do update set public = true;

-- Make the Data API see the new tables and grants straight away.
notify pgrst, 'reload schema';
