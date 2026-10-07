# Vanillate Convert — Roadmap

## 1. Roadmap Overview

Vanillate Convert is planned as a large-scale file conversion and processing platform.

Because the project is expected to support hundreds of formats and potentially thousands of valid conversion paths, development must be performed incrementally.

The roadmap prioritizes:

1. Architecture and data foundation
2. Core conversion infrastructure
3. High-value file categories
4. Media processing
5. Extended format coverage
6. Advanced and specialized formats
7. Performance and scalability
8. Product expansion

The roadmap is not a strict deadline schedule.

Phases may overlap when infrastructure is ready, but no phase should compromise the stability and security of the previous phase.

---

## Current Status (October 2026)

Phases 0–1 are complete and the foundations of Phases 2–13 exist; what follows is the summary,
the detailed checklists below remain the long-term plan.

| Area | State |
| --- | --- |
| Foundation | pnpm monorepo, strict TypeScript, ESLint, Prettier, Vitest, Playwright, CI (`.github/workflows/ci.yml`), documentation in `docs/` with decision records |
| Registry | 182 formats, 17 engines, 1554 offered conversions (1294 indexable), 24 tools — generated matrix in `docs/CONVERSION-MATRIX.md` |
| Application shell | Bilingual (id/en) Next.js site: home, conversion landing pages, formats, categories, tools, search, privacy, about; SEO (canonical, hreflang, JSON-LD, sitemap) |
| Browser processing | Images, data formats, subtitles, archives, text tools; 205 conversions and 16 tools run without a server |
| Server processing | Job API, PostgreSQL queue, S3/local storage, sandboxed worker with ImageMagick, FFmpeg, LibreOffice, Poppler, Ghostscript, qpdf, Pandoc, 7-Zip, librsvg, assimp, ExifTool, fontTools |
| Security | bubblewrap + unprivileged engine user, CPU/memory/file limits, content detection at every boundary, engine hardening, signed transfers, rate limits |
| Deployment | Vercel-ready web app; worker image (`workers/Dockerfile`); `docker compose` for the full stack |

Next priorities:

1. Production deployment: managed PostgreSQL and S3-compatible storage, worker hosting with
   bubblewrap enabled, monitoring and alerting on queue depth and failures.
2. Promote experimental conversions (RAW images, 3D models, PDF → Office) after broader
   real-world test files.
3. Batch UX (multiple targets, ZIP of server results), per-format advanced options.
4. Observability: metrics per engine (duration, failure rate), error dashboards.

---

# 2. Phase 0 — Project Foundation

## Objective

Establish the repository, development conventions, documentation, and core architecture before implementing large numbers of converters.

## Tasks

### Repository

- [x] Initialize repository structure
- [x] Configure package manager
- [x] Configure TypeScript
- [x] Configure linting
- [x] Configure formatting
- [ ] Configure Git hooks where necessary
- [x] Configure environment variables
- [x] Create development scripts
- [x] Create production build scripts

### Documentation

- [x] `README.md`
- [x] `PROJECT.md`
- [x] `ROADMAP.md`
- [x] `ARCHITECTURE.md`
- [x] `FORMAT-REGISTRY.md`
- [x] `CONVERSION-MATRIX.md`
- [x] `ENGINE-MAPPING.md`
- [x] `API.md`
- [x] `STORAGE.md`
- [x] `WORKER.md`
- [x] `QUEUE.md`
- [x] `SECURITY.md`
- [x] `PRIVACY.md`
- [x] `SEO.md`
- [x] `LIMITS.md`
- [x] `TESTING.md`

### Initial Architecture

- [ ] Define application boundaries
- [ ] Define API boundaries
- [ ] Define worker boundaries
- [ ] Define storage abstraction
- [ ] Define queue abstraction
- [ ] Define conversion engine abstraction
- [ ] Define job lifecycle
- [ ] Define error model
- [ ] Define logging model

---

# 3. Phase 1 — Core Data & Registry

## Objective

Create the central source of truth for formats, engines, and conversion paths.

This phase is critical because the rest of the platform depends on these registries.

## Format Registry

- [ ] Define format schema
- [ ] Define format categories
- [ ] Define file extensions
- [ ] Define MIME types
- [ ] Define aliases
- [ ] Define read capabilities
- [ ] Define write capabilities
- [ ] Define browser capabilities
- [ ] Define server capabilities
- [ ] Define engine mapping
- [ ] Define format status

Example:

```text
Format
├── id
├── name
├── category
├── extensions
├── mimeTypes
├── aliases
├── readable
├── writable
├── browserSupported
├── serverSupported
├── engines
└── status
```

## Conversion Registry

- [ ] Define conversion schema
- [ ] Define input format
- [ ] Define output format
- [ ] Define engine
- [ ] Define processing mode
- [ ] Define quality options
- [ ] Define metadata behavior
- [ ] Define limitations
- [ ] Define status
- [ ] Define validation rules

## Conversion Matrix

- [ ] Create image conversion matrix
- [ ] Create PDF conversion matrix
- [ ] Create document conversion matrix
- [ ] Create spreadsheet conversion matrix
- [ ] Create audio conversion matrix
- [ ] Create video conversion matrix
- [ ] Create archive conversion matrix
- [ ] Create data conversion matrix
- [ ] Create ebook conversion matrix
- [ ] Create subtitle conversion matrix
- [ ] Create font conversion matrix
- [ ] Create vector conversion matrix
- [ ] Create 3D/CAD conversion matrix
- [ ] Create scientific conversion matrix

---

# 4. Phase 2 — Application Shell

## Objective

Build the initial website and unified user experience.

## Tasks

- [ ] Build homepage
- [ ] Build upload interface
- [ ] Build drag-and-drop uploader
- [ ] Build file picker
- [ ] Build format detection UI
- [ ] Build output format selector
- [ ] Build conversion options UI
- [ ] Build progress indicator
- [ ] Build conversion result page
- [ ] Build download interface
- [ ] Build error state
- [ ] Build unsupported format state
- [ ] Build mobile responsive interface

## Navigation

- [ ] Categories
- [ ] All formats
- [ ] Popular conversions
- [ ] Recent tools
- [ ] Search
- [ ] Format explorer

---

# 5. Phase 3 — Browser Processing Foundation

## Objective

Allow lightweight conversions to run directly in the browser whenever practical.

## Tasks

- [ ] Define browser conversion API
- [ ] Define browser worker architecture
- [ ] Implement Web Worker processing
- [ ] Implement memory-safe file handling
- [ ] Implement browser progress reporting
- [ ] Implement cancellation
- [ ] Implement browser error handling
- [ ] Implement browser output validation

## Initial Browser Tools

- [ ] Image resize
- [ ] Image compression
- [ ] Basic image format conversion
- [ ] JSON formatting
- [ ] JSON minification
- [ ] CSV transformation
- [ ] Text transformations
- [ ] Basic metadata inspection

Browser processing should only be enabled when the implementation is reliable for the selected operation.

---

# 6. Phase 4 — Image Conversion

## Objective

Launch the first major conversion category.

## Formats

Initial target:

- [ ] JPG
- [ ] JPEG
- [ ] PNG
- [ ] WEBP
- [ ] AVIF
- [ ] GIF
- [ ] APNG
- [ ] BMP
- [ ] TIFF
- [ ] HEIC
- [ ] HEIF
- [ ] SVG
- [ ] ICO

Extended target:

- [ ] JXL
- [ ] JP2
- [ ] TGA
- [ ] DDS
- [ ] PSD
- [ ] PSB
- [ ] EXR
- [ ] HDR
- [ ] RAW formats
- [ ] Additional formats supported by selected engines

## Features

- [ ] Convert
- [ ] Compress
- [ ] Resize
- [ ] Crop
- [ ] Rotate
- [ ] Flip
- [ ] Quality control
- [ ] DPI adjustment
- [ ] Metadata handling
- [ ] Batch conversion
- [ ] Image → PDF
- [ ] PDF → image

## Initial SEO Pages

- [ ] JPG → PNG
- [ ] JPG → WEBP
- [ ] PNG → JPG
- [ ] PNG → WEBP
- [ ] HEIC → JPG
- [ ] HEIC → PNG
- [ ] WEBP → JPG
- [ ] WEBP → PNG
- [ ] AVIF → JPG
- [ ] JPG → PDF
- [ ] PNG → PDF

---

# 7. Phase 5 — PDF Platform

## Objective

Build a dedicated PDF processing layer.

## Conversion

- [ ] PDF → JPG
- [ ] PDF → PNG
- [ ] PDF → WEBP
- [ ] PDF → TXT
- [ ] PDF → HTML
- [ ] PDF → SVG
- [ ] PDF → DOCX
- [ ] PDF → XLSX
- [ ] PDF → PPTX

## PDF Tools

- [ ] Merge PDF
- [ ] Split PDF
- [ ] Compress PDF
- [ ] Rotate pages
- [ ] Reorder pages
- [ ] Delete pages
- [ ] Extract pages
- [ ] Extract images
- [ ] Add watermark
- [ ] Metadata inspection
- [ ] Metadata removal
- [ ] Password protection where supported
- [ ] PDF validation
- [ ] PDF/A-related tooling where supported

## Image → PDF

- [ ] JPG → PDF
- [ ] PNG → PDF
- [ ] WEBP → PDF
- [ ] HEIC → PDF
- [ ] Batch images → PDF

---

# 8. Phase 6 — Document & Office

## Objective

Support common document, spreadsheet, and presentation workflows.

## Documents

- [ ] DOC
- [ ] DOCX
- [ ] ODT
- [ ] RTF
- [ ] TXT
- [ ] HTML
- [ ] Markdown
- [ ] XML

## Spreadsheet

- [ ] XLS
- [ ] XLSX
- [ ] XLSM
- [ ] ODS
- [ ] CSV
- [ ] TSV

## Presentation

- [ ] PPT
- [ ] PPTX
- [ ] ODP

## Conversion

- [ ] DOCX → PDF
- [ ] DOCX → TXT
- [ ] DOCX → HTML
- [ ] DOCX → ODT
- [ ] ODT → DOCX
- [ ] ODT → PDF
- [ ] HTML → PDF
- [ ] HTML → DOCX
- [ ] Markdown → HTML
- [ ] Markdown → PDF
- [ ] XLSX → PDF
- [ ] XLSX → CSV
- [ ] CSV → XLSX
- [ ] ODS → XLSX
- [ ] PPTX → PDF
- [ ] PPTX → images
- [ ] ODP → PPTX

## Office Validation

- [ ] Output document validation
- [ ] Spreadsheet integrity validation
- [ ] Presentation integrity validation
- [ ] Corrupted input detection

---

# 9. Phase 7 — Archive Tools

## Objective

Provide archive creation, extraction, and archive-to-archive conversion where technically appropriate.

## Formats

- [ ] ZIP
- [ ] 7Z
- [ ] TAR
- [ ] GZ
- [ ] BZ2
- [ ] XZ
- [ ] RAR
- [ ] ISO
- [ ] CAB
- [ ] WIM
- [ ] Additional supported formats

## Features

- [ ] Extract archive
- [ ] Create ZIP
- [ ] Create 7Z
- [ ] Create TAR
- [ ] Archive → archive conversion
- [ ] Files → archive
- [ ] Batch extraction
- [ ] Archive inspection
- [ ] Archive validation

## Security

- [ ] Zip bomb detection
- [ ] Archive recursion limits
- [ ] Maximum extracted size
- [ ] Maximum file count
- [ ] Path traversal protection
- [ ] Extraction sandbox

---

# 10. Phase 8 — Audio

## Objective

Build a scalable audio conversion system.

## Initial Formats

- [ ] MP3
- [ ] WAV
- [ ] FLAC
- [ ] AAC
- [ ] M4A
- [ ] OGG
- [ ] OPUS
- [ ] AIFF
- [ ] ALAC
- [ ] WMA
- [ ] AMR

## Features

- [ ] Format conversion
- [ ] Bitrate control
- [ ] Sample-rate conversion
- [ ] Channel conversion
- [ ] Volume normalization
- [ ] Trim
- [ ] Merge
- [ ] Audio extraction
- [ ] Metadata inspection
- [ ] Metadata editing where supported

## Example Paths

- [ ] MP3 → WAV
- [ ] WAV → MP3
- [ ] FLAC → MP3
- [ ] FLAC → WAV
- [ ] M4A → MP3
- [ ] AAC → MP3
- [ ] OGG → MP3
- [ ] OPUS → MP3
- [ ] MP4 → MP3
- [ ] MKV → MP3

---

# 11. Phase 9 — Video

## Objective

Build the large-scale media processing layer.

## Formats

- [ ] MP4
- [ ] MKV
- [ ] MOV
- [ ] AVI
- [ ] WEBM
- [ ] WMV
- [ ] FLV
- [ ] MPEG
- [ ] MPG
- [ ] M4V
- [ ] 3GP
- [ ] TS
- [ ] MTS
- [ ] M2TS
- [ ] OGV
- [ ] VOB
- [ ] Additional supported containers

## Features

- [ ] Video conversion
- [ ] Video compression
- [ ] Resize
- [ ] Crop
- [ ] Rotate
- [ ] Trim
- [ ] Change FPS
- [ ] Change bitrate
- [ ] Change codec
- [ ] Change aspect ratio
- [ ] Remove audio
- [ ] Extract audio
- [ ] Extract frames
- [ ] Generate GIF
- [ ] GIF → video
- [ ] Merge video
- [ ] Batch conversion

## Initial Conversion Paths

- [ ] MKV → MP4
- [ ] MOV → MP4
- [ ] AVI → MP4
- [ ] WEBM → MP4
- [ ] MP4 → WEBM
- [ ] MP4 → GIF
- [ ] GIF → MP4
- [ ] MP4 → MP3
- [ ] MOV → MP3
- [ ] MKV → MP3

---

# 12. Phase 10 — Data & Developer Tools

## Objective

Expand the platform beyond traditional binary files.

## Formats

- [ ] JSON
- [ ] XML
- [ ] YAML
- [ ] CSV
- [ ] TSV
- [ ] TOML
- [ ] INI
- [ ] SQL
- [ ] NDJSON
- [ ] JSONL
- [ ] Markdown
- [ ] HTML

## Tools

- [ ] JSON formatter
- [ ] JSON minifier
- [ ] XML formatter
- [ ] XML minifier
- [ ] YAML converter
- [ ] JSON ↔ CSV
- [ ] JSON ↔ XML
- [ ] YAML ↔ JSON
- [ ] CSV ↔ XLSX
- [ ] CSV ↔ TSV
- [ ] CSV → SQL
- [ ] SQL → CSV
- [ ] Base64 encode
- [ ] Base64 decode
- [ ] URL encode
- [ ] URL decode

These tools should be optimized for browser-side processing whenever possible.

---

# 13. Phase 11 — Ebook & Subtitle

## Ebook

- [ ] EPUB
- [ ] MOBI
- [ ] AZW
- [ ] AZW3
- [ ] CBZ
- [ ] CBR
- [ ] DJVU

## Ebook Conversion

- [ ] EPUB → PDF
- [ ] PDF → EPUB
- [ ] MOBI → EPUB
- [ ] AZW3 → EPUB
- [ ] Images → CBZ

## Subtitle

- [ ] SRT
- [ ] VTT
- [ ] ASS
- [ ] SSA
- [ ] SUB
- [ ] SBV
- [ ] TTML

## Subtitle Tools

- [ ] SRT → VTT
- [ ] VTT → SRT
- [ ] ASS → SRT
- [ ] Subtitle shift
- [ ] Subtitle synchronization
- [ ] Subtitle extraction

---

# 14. Phase 12 — Font & Vector

## Font

- [ ] TTF
- [ ] OTF
- [ ] WOFF
- [ ] WOFF2
- [ ] EOT
- [ ] TTC

## Font Tools

- [ ] TTF → WOFF
- [ ] TTF → WOFF2
- [ ] OTF → WOFF
- [ ] OTF → WOFF2
- [ ] WOFF → TTF
- [ ] WOFF2 → TTF
- [ ] Font preview
- [ ] Font metadata inspection

## Vector

- [ ] SVG
- [ ] EPS
- [ ] AI
- [ ] EMF
- [ ] WMF
- [ ] DXF

## Vector Tools

- [ ] SVG → PNG
- [ ] SVG → JPG
- [ ] SVG → PDF
- [ ] EPS → SVG
- [ ] EPS → PNG
- [ ] PDF → SVG
- [ ] Vector preview

Proprietary formats must be implemented only where a reliable and legally appropriate processing path exists.

---

# 15. Phase 13 — 3D & CAD

## Objective

Expand support into specialized 3D and CAD workflows.

## 3D Formats

- [ ] OBJ
- [ ] STL
- [ ] FBX
- [ ] GLB
- [ ] GLTF
- [ ] PLY
- [ ] DAE
- [ ] 3DS
- [ ] OFF

## CAD Formats

- [ ] DXF
- [ ] STEP
- [ ] STP
- [ ] IGES
- [ ] IGS
- [ ] Additional feasible formats

## Features

- [ ] 3D format conversion
- [ ] Model preview
- [ ] Mesh inspection
- [ ] Basic metadata
- [ ] CAD conversion
- [ ] CAD preview where feasible

This phase should only begin after the core conversion infrastructure is stable.

---

# 16. Phase 14 — Scientific Formats

## Objective

Support specialized scientific and technical file formats.

Potential formats:

- [ ] FITS
- [ ] MAT
- [ ] HDF
- [ ] HDF5
- [ ] NetCDF
- [ ] CDF
- [ ] DICOM
- [ ] NIfTI
- [ ] VTK
- [ ] Additional scientific formats

Potential capabilities:

- [ ] Scientific data extraction
- [ ] Image export
- [ ] Metadata inspection
- [ ] Structured data conversion
- [ ] Visualization-compatible export

Sensitive formats such as medical imaging require additional privacy and metadata considerations.

---

# 17. Phase 15 — Batch Processing

## Objective

Introduce a generalized batch conversion framework.

## Features

- [ ] Multiple file upload
- [ ] Batch format conversion
- [ ] Batch compression
- [ ] Batch resizing
- [ ] Batch extraction
- [ ] Batch metadata operations
- [ ] Individual job status
- [ ] Overall batch status
- [ ] Failed item retry
- [ ] Download all
- [ ] ZIP generated outputs

Example:

```text
20 JPG files
      ↓
Convert to WebP
      ↓
20 outputs
      ↓
Download ZIP
```

---

# 18. Phase 16 — Worker & Queue Scaling

## Objective

Prepare the infrastructure for large conversion workloads.

## Queue

- [ ] Job queue
- [ ] Retry strategy
- [ ] Job priority
- [ ] Job timeout
- [ ] Dead-letter handling
- [ ] Cancellation
- [ ] Expiration

## Workers

- [ ] Image worker
- [ ] PDF worker
- [ ] Document worker
- [ ] Archive worker
- [ ] Audio worker
- [ ] Video worker
- [ ] Data worker
- [ ] Specialized worker

## Scaling

- [ ] Worker concurrency
- [ ] Resource limits
- [ ] Auto-scaling strategy
- [ ] Queue monitoring
- [ ] Worker health checks
- [ ] Failed job recovery

---

# 19. Phase 17 — Security Hardening

## Objective

Harden the entire file-processing pipeline.

## Security Controls

- [ ] File signature validation
- [ ] MIME validation
- [ ] Extension validation
- [ ] File size limits
- [ ] Archive limits
- [ ] Resource limits
- [ ] Path traversal protection
- [ ] Command injection protection
- [ ] Worker sandboxing
- [ ] Temporary file isolation
- [ ] Secure download links
- [ ] Rate limiting
- [ ] Abuse prevention
- [ ] Conversion timeout
- [ ] Memory limits
- [ ] CPU limits

## Security Testing

- [ ] Malformed files
- [ ] Oversized files
- [ ] Archive bombs
- [ ] Corrupted media
- [ ] Malicious document samples
- [ ] Path traversal attempts
- [ ] Unexpected MIME types
- [ ] Worker abuse cases

---

# 20. Phase 18 — Privacy & File Lifecycle

## Objective

Make temporary file handling predictable and auditable.

## Tasks

- [ ] Define retention policy
- [ ] Implement automatic cleanup
- [ ] Cleanup failed uploads
- [ ] Cleanup abandoned jobs
- [ ] Cleanup expired downloads
- [ ] Secure storage
- [ ] Protected object paths
- [ ] Access-controlled downloads
- [ ] Privacy documentation

## Validation

- [ ] Confirm files are deleted after expiration
- [ ] Confirm failed jobs are cleaned up
- [ ] Confirm output files are not publicly indexed
- [ ] Confirm temporary URLs expire as designed

---

# 21. Phase 19 — SEO & Conversion Catalog

## Objective

Build the large SEO-oriented conversion catalog.

## Dynamic Routes

```text
/convert/[from]-to-[to]
```

Examples:

```text
/convert/jpg-to-png
/convert/heic-to-jpg
/convert/pdf-to-jpg
/convert/docx-to-pdf
/convert/mkv-to-mp4
```

## SEO Features

- [ ] Dynamic page generation
- [ ] Metadata generation
- [ ] Canonical URL
- [ ] Sitemap generation
- [ ] Breadcrumbs
- [ ] Related conversions
- [ ] Related formats
- [ ] Structured data where appropriate
- [ ] Search integration
- [ ] Noindex unsupported combinations

## Catalog

- [ ] Format explorer
- [ ] Conversion explorer
- [ ] Search formats
- [ ] Search tools
- [ ] Popular conversions
- [ ] Related conversions

---

# 22. Phase 20 — User Experience Improvements

## Objective

Make the platform easier to use despite the growing technical complexity.

## Features

- [ ] Smart format detection
- [ ] Suggested conversions
- [ ] Recent conversions
- [ ] Conversion history where appropriate
- [ ] Drag-and-drop improvements
- [ ] Mobile optimization
- [ ] Accessibility improvements
- [ ] Keyboard support
- [ ] Clear error messages
- [ ] Conversion previews
- [ ] Estimated output information

The interface should remain simple even as the number of supported tools increases.

---

# 23. Phase 21 — Observability

## Objective

Gain visibility into system health without collecting unnecessary user file data.

## Tasks

- [ ] Application logging
- [ ] Worker logging
- [ ] Job metrics
- [ ] Failure rate metrics
- [ ] Queue metrics
- [ ] Conversion duration metrics
- [ ] Engine error metrics
- [ ] Storage metrics
- [ ] Worker health metrics
- [ ] Alerting

Operational telemetry must avoid unnecessarily storing sensitive user file contents.

---

# 24. Phase 22 — Performance Optimization

## Objective

Optimize conversion speed, infrastructure cost, and user experience.

## Browser

- [ ] Reduce bundle size
- [ ] Lazy-load conversion tools
- [ ] Optimize Web Workers
- [ ] Stream or chunk supported operations
- [ ] Memory optimization

## Server

- [ ] Worker optimization
- [ ] Parallel processing where safe
- [ ] Queue optimization
- [ ] Storage optimization
- [ ] Output caching where appropriate
- [ ] Resource-aware scheduling

## UX

- [ ] Faster upload initialization
- [ ] Real-time progress
- [ ] Faster output availability
- [ ] Better retry behavior

---

# 25. Phase 23 — Reliability & Quality Program

## Objective

Ensure every supported converter meets a consistent quality standard.

## Conversion Testing

Each stable conversion should have:

- [ ] Valid input test
- [ ] Invalid input test
- [ ] Corrupted input test
- [ ] Output existence test
- [ ] Output MIME test
- [ ] Output integrity test
- [ ] Metadata behavior test
- [ ] Size regression test where relevant
- [ ] Performance baseline
- [ ] Error handling test

## Compatibility Matrix

Maintain automated tests covering:

```text
Input Format
      ↓
Conversion
      ↓
Output Format
      ↓
Expected Result
```

New engines or registry changes must not silently break existing stable conversions.

---

# 26. Phase 24 — Advanced Features

These features may be introduced after the core platform is mature.

## Potential Features

- [ ] Conversion presets
- [ ] User-defined presets
- [ ] Advanced batch workflows
- [ ] Multi-step conversion pipelines
- [ ] Watch-folder style workflows where technically feasible
- [ ] API access
- [ ] Developer API
- [ ] Webhooks
- [ ] Advanced media presets
- [ ] Custom compression profiles
- [ ] File comparison
- [ ] Before/after preview
- [ ] Output quality comparison

---

# 27. Phase 25 — API Platform

## Objective

Expose selected conversion capabilities as a developer platform.

Potential API:

```text
POST /api/v1/jobs
GET  /api/v1/jobs/:id
POST /api/v1/jobs/:id/cancel
GET  /api/v1/formats
GET  /api/v1/conversions
```

Potential capabilities:

- [ ] API authentication
- [ ] API keys
- [ ] Usage limits
- [ ] Job management
- [ ] Webhooks
- [ ] Conversion metadata API
- [ ] Developer documentation
- [ ] API monitoring

This phase should only be introduced after the underlying conversion infrastructure is stable.

---

# 28. Phase 26 — Production Readiness

Before considering the platform production-ready at scale:

## Infrastructure

- [ ] Production storage
- [ ] Production queue
- [ ] Production workers
- [ ] Monitoring
- [ ] Alerting
- [ ] Backup strategy
- [ ] Disaster recovery
- [ ] Resource limits

## Security

- [ ] Security review
- [ ] Dependency audit
- [ ] Worker isolation audit
- [ ] File handling audit
- [ ] Abuse prevention review

## Quality

- [ ] Conversion regression suite
- [ ] Load testing
- [ ] Large file testing
- [ ] Batch testing
- [ ] Failure recovery testing
- [ ] Browser compatibility testing
- [ ] Mobile testing

## Product

- [ ] Finalize core UX
- [ ] Finalize privacy information
- [ ] Finalize limits
- [ ] Finalize supported format registry
- [ ] Finalize stable conversion matrix

---

# 29. Long-Term Vision

The long-term goal is for Vanillate Convert to evolve from:

```text
File Converter
```

into:

```text
Complete File Processing Platform
```

with multiple product layers:

```text
Vanillate Convert
│
├── Converter
│   ├── Image
│   ├── Document
│   ├── PDF
│   ├── Audio
│   ├── Video
│   ├── Archive
│   ├── Data
│   ├── Ebook
│   ├── Font
│   ├── Vector
│   ├── 3D
│   ├── CAD
│   └── Scientific
│
├── Compressor
│
├── Transformer
│
├── Extractor
│
├── Inspector
│
├── Developer Tools
│
└── Advanced File Tools
```

The platform should continuously expand format coverage while maintaining strict quality and security standards.

---

# 30. Release Philosophy

Releases should prioritize stability over the number of newly supported formats.

A format should only be marked as stable when:

1. The input can be validated reliably.
2. The selected engine handles the format reliably.
3. The output can be validated.
4. Failure scenarios are handled correctly.
5. Resource limits are enforced.
6. Security risks have been considered.
7. Automated tests cover the conversion.
8. The user experience is consistent.

A smaller stable catalog is preferable to a large catalog filled with unreliable conversion paths.

---

# 31. Current Priority

The immediate priority is **not** to add hundreds of converters immediately.

The first objective is to establish the system that will make hundreds of converters possible.

Current priority order:

```text
1. Repository foundation
2. Architecture
3. Format registry
4. Conversion registry
5. Conversion matrix
6. Engine abstraction
7. Upload system
8. Job system
9. Worker system
10. Image conversion
11. PDF tools
12. Document conversion
13. Archive tools
14. Audio conversion
15. Video conversion
16. Data/developer tools
17. Extended formats
18. Specialized formats
19. SEO catalog
20. Production scaling
```

---

# 32. Roadmap Principle

The roadmap should remain flexible.

The exact order of individual formats may change based on:

- Technical feasibility
- Engine support
- Infrastructure constraints
- Security considerations
- User demand
- Conversion quality
- Licensing considerations
- Performance
- Maintenance cost

The central architecture and quality standards should remain consistent even as individual roadmap items change.