-- Run this in Supabase → SQL Editor

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  date timestamptz not null,
  type text not null,
  account text,
  category text,
  amount numeric not null,
  note text,
  created_at timestamptz default now()
);

alter table transactions enable row level security;

create policy "Allow all" on transactions
  for all using (true) with check (true);

alter publication supabase_realtime add table transactions;
