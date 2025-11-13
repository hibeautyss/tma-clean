-- =============================================
-- Supabase schema bootstrap for Meeting Planner
-- Run this script inside the Supabase SQL editor
-- =============================================

-- Extensions ---------------------------------------------------------------
create extension if not exists "pgcrypto";

-- Tables -------------------------------------------------------------------
create table if not exists public.polls (
    id uuid primary key default gen_random_uuid(),
    share_code text not null unique default upper(encode(gen_random_bytes(4), 'hex')),
    title text not null check (char_length(title) between 3 and 200),
    description text,
    location text,
    timezone text not null default 'UTC',
    specify_times boolean not null default false,
    creator jsonb,
    created_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.poll_options (
    id uuid primary key default gen_random_uuid(),
    poll_id uuid not null references public.polls(id) on delete cascade,
    option_date date not null,
    start_minute integer,
    end_minute integer,
    created_at timestamptz not null default timezone('utc'::text, now()),
    constraint option_requires_valid_range check (
        (start_minute is null and end_minute is null)
        or (start_minute is not null and end_minute is not null and start_minute < end_minute)
    )
);

create index if not exists poll_options_poll_id_idx on public.poll_options (poll_id, option_date);

create table if not exists public.votes (
    id uuid primary key default gen_random_uuid(),
    poll_id uuid not null references public.polls(id) on delete cascade,
    voter_name text not null,
    voter_contact text,
    created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists votes_poll_id_idx on public.votes (poll_id);

create table if not exists public.vote_selections (
    id uuid primary key default gen_random_uuid(),
    vote_id uuid not null references public.votes(id) on delete cascade,
    poll_option_id uuid not null references public.poll_options(id) on delete cascade,
    availability text not null check (availability in ('yes', 'no', 'maybe')),
    created_at timestamptz not null default timezone('utc'::text, now()),
    constraint vote_option_unique unique (vote_id, poll_option_id)
);

-- Permissions --------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update on public.polls to anon, authenticated;
grant select, insert on public.poll_options to anon, authenticated;
grant select, insert on public.votes to anon, authenticated;
grant select, insert on public.vote_selections to anon, authenticated;

-- RLS Policies (explicit so we keep service_role out of the client) --------
alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.votes enable row level security;
alter table public.vote_selections enable row level security;

drop policy if exists "anon_select_polls" on public.polls;
create policy "anon_select_polls" on public.polls
    for select using (true);

drop policy if exists "anon_insert_polls" on public.polls;
create policy "anon_insert_polls" on public.polls
    for insert with check (true);

drop policy if exists "anon_update_polls" on public.polls;
create policy "anon_update_polls" on public.polls
    for update using (true)
    with check (true);

drop policy if exists "anon_select_poll_options" on public.poll_options;
create policy "anon_select_poll_options" on public.poll_options
    for select using (true);

drop policy if exists "anon_insert_poll_options" on public.poll_options;
create policy "anon_insert_poll_options" on public.poll_options
    for insert with check (true);

drop policy if exists "anon_select_votes" on public.votes;
create policy "anon_select_votes" on public.votes
    for select using (true);

drop policy if exists "anon_insert_votes" on public.votes;
create policy "anon_insert_votes" on public.votes
    for insert with check (true);

drop policy if exists "anon_select_vote_selections" on public.vote_selections;
create policy "anon_select_vote_selections" on public.vote_selections
    for select using (true);

drop policy if exists "anon_insert_vote_selections" on public.vote_selections;
create policy "anon_insert_vote_selections" on public.vote_selections
    for insert with check (true);

-- Utility view to fetch polls with options in one round trip (optional)
create or replace view public.poll_with_options as
select
    p.*,
    json_agg(
        json_build_object(
            'id', o.id,
            'option_date', o.option_date,
            'start_minute', o.start_minute,
            'end_minute', o.end_minute
        )
        order by o.option_date asc, o.start_minute asc
    ) filter (where o.id is not null) as options
from public.polls p
left join public.poll_options o on o.poll_id = p.id
group by p.id;

grant select on public.poll_with_options to anon, authenticated;
alter view public.poll_with_options set (security_barrier = true);
