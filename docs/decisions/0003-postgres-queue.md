# 0003 — PostgreSQL as the job queue

**Decision.** Jobs live in one PostgreSQL table. Workers claim the next job of their pools with
`FOR UPDATE SKIP LOCKED`, filtered to engines they have, hold it with a renewable lease, and a
sweeper recovers expired leases and applies retention. Updates use optimistic concurrency.

**Reason.** Jobs need durable state anyway (status, outputs, token hash, retention). One store
for state and queue avoids a second system and keeps transitions transactional. `SKIP LOCKED`
handles the expected throughput (many jobs per second) easily.

**Alternatives.** Redis/BullMQ (another service, state split across two systems), SQS/Cloud
Tasks (vendor lock-in, still needs a state store), a hosted workflow engine (cost, complexity).

**Trade-offs.** Polling instead of push (bounded by `WORKER_POLL_MS` with backoff); very high
throughput would need partitioning or a dedicated broker.

**Impact.** Operating the platform needs only PostgreSQL and object storage besides the web app
and workers. The `JobStore` interface keeps a future broker possible.
