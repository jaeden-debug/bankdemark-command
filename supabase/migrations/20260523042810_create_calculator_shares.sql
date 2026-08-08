create table if not exists calculator_shares (
  id text primary key,
  calculator text not null,
  inputs jsonb not null default '{}'::jsonb,
  results jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists calculator_shares_created_at_idx
on calculator_shares(created_at desc);
