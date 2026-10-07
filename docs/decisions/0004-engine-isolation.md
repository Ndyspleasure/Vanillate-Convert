# 0004 — Engine isolation

**Decision.** Engine processes run through `ProcessRunner`: argument arrays (no shell), a
minimal environment, their own process group, `prlimit` limits (CPU, address space, file size,
open files), inside a bubblewrap sandbox (no network, read-only system, only the job directory
writable) and, when the worker runs as root, as an unprivileged user. Production workers refuse
to start without at least one isolation layer.

**Reason.** Conversion engines parse hostile input and have a long history of vulnerabilities
(ImageMagick, Ghostscript, LibreOffice, FFmpeg). A compromise must not reach other jobs, secrets
or the network.

**Alternatives.** A container or microVM per job (stronger, but seconds of overhead and an
orchestrator dependency); seccomp profiles per engine (fragile across engine versions);
trusting engine configuration alone (insufficient).

**Trade-offs.** bubblewrap needs user namespaces, which some container platforms block; the
engine-user layer covers those cases without network isolation. Per-process memory limits use
address space, which is coarse; container limits are still recommended.

**Impact.** One worker image runs every engine safely; isolation is tested
(`packages/engines/test/runner.test.ts`).
