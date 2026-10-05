-- Vanillate Convert: job queue, worker registry and rate limits.
-- Jobs never store file contents; only metadata, storage keys and a hash of the access token.

create table if not exists vc_jobs (
  id text primary key,
  status text not null,
  progress smallint not null default 0 check (progress between 0 and 100),
  target jsonb not null,
  engines text[] not null,
  pool text not null,
  options jsonb not null default '{}'::jsonb,
  inputs jsonb not null,
  outputs jsonb not null default '[]'::jsonb,
  error jsonb,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  priority integer not null default 0,
  token_hash text not null,
  worker_id text,
  lease_expires_at timestamptz,
  run_after timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null,
  version integer not null default 0,
  constraint vc_jobs_status_check check (
    status in ('pending', 'uploading', 'queued', 'processing', 'finalizing', 'completed', 'failed', 'cancelled', 'expired')
  )
);

-- The queue: workers claim the oldest highest-priority queued job of their pools.
create index if not exists vc_jobs_queue_idx on vc_jobs (pool, priority desc, run_after, created_at) where status = 'queued';
-- Lease recovery for crashed workers.
create index if not exists vc_jobs_lease_idx on vc_jobs (lease_expires_at) where status in ('processing', 'finalizing');
-- Retention sweeper.
create index if not exists vc_jobs_expiry_idx on vc_jobs (expires_at);

create table if not exists vc_workers (
  id text primary key,
  pools text[] not null,
  engines jsonb not null,
  version text,
  started_at timestamptz not null,
  last_seen_at timestamptz not null
);

create table if not exists vc_rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null,
  primary key (key, window_start)
);
