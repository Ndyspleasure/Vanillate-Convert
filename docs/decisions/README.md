# Decision records

Significant technical decisions, with the reasons and trade-offs, so later changes can revisit
them deliberately. Format: Decision, Reason, Alternatives considered, Trade-offs, Expected
impact. Add a new numbered file for a new decision; mark superseded ones instead of deleting
them.

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-registry-driven-catalog.md) | Formats, engines and conversions are data compiled into a registry | Accepted |
| [0002](0002-browser-first-processing.md) | Browser-first processing, server when needed | Accepted |
| [0003](0003-postgres-queue.md) | PostgreSQL as the job queue | Accepted |
| [0004](0004-engine-isolation.md) | Engines in bubblewrap, as an unprivileged user, with resource limits | Accepted |
| [0005](0005-static-pages.md) | Statically generated localized pages with a static CSP | Accepted |
| [0006](0006-direct-storage-transfers.md) | Files go directly between the browser and storage | Accepted |
| [0007](0007-engine-hardening.md) | Engine-specific hardening (forced filters, embedded policies) | Accepted |
