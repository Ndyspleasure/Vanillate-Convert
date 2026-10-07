# 0007 — Engine-specific hardening

**Decision.** Beyond the sandbox, each engine is configured for untrusted input:
ImageMagick gets a restrictive policy written into every job (and installed as the system
policy) that disables delegates, network and script coders, and PostScript/PDF/SVG coders;
LibreOffice gets a forced import filter per format and an isolated profile, with CSV formula
evaluation off; Pandoc runs with `--sandbox` when the build supports it; Ghostscript runs with
`-dSAFER`; 7-Zip archives are listed and checked before extraction.

**Reason.** Defense in depth. Engines auto-detect input types — a file named `.docx` could be
parsed by a far riskier importer — and some features (delegates, URL coders, formulas) are
exploitation primitives.

**Alternatives.** Relying on the sandbox only.

**Trade-offs.** Some legitimate inputs are refused (e.g. SVG through ImageMagick — routed to
librsvg instead), and policies must be kept in sync with engine versions; a test asserts the
embedded ImageMagick policy equals the installed file.

**Impact.** A misdetected or crafted file is handled by the importer the user asked for, with
dangerous features off.
