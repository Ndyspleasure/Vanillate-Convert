# Engine mapping

Engines do the actual work. Each one is declared in `catalog/engines/<id>.json` (mode, pool,
binaries, read/write capabilities, status, license) and implemented by an adapter: server
adapters in `packages/engines/src/engines/`, browser engines in `packages/browser-engines/src/`.
Conversion rules ([FORMAT-REGISTRY.md](FORMAT-REGISTRY.md)) map format pairs to engine
pipelines; the full result is [CONVERSION-MATRIX.md](CONVERSION-MATRIX.md).

## Browser engines

Run in a module Web Worker in the visitor's browser; no installation, no server cost.

| Engine | Reads | Writes | Used for |
| --- | --- | --- | --- |
| `browser-image` | jpg, png, webp, gif, bmp, ico, avif, svg (what the browser can decode, probed at runtime) | jpg, png, webp, bmp, ico, tiff, pdf | Raster conversion via canvas and TypeScript encoders (TIFF, ICO, PDF); image compressor, resizer, rotator; images → PDF |
| `browser-data` | json, yaml, toml, xml, csv, tsv, ndjson, jsonl, ini | + sql, html, md, xlsx | Data format conversion; JSON/XML formatters and minifiers |
| `browser-subtitle` | srt, vtt, sbv, ass, ssa, sub, ttml, dfxp | srt, vtt, sbv, ass, sub, ttml, dfxp, txt | Subtitle conversion; timing shift |
| `browser-archive` | zip, tar, tgz, gz, cbz | zip, tar, tgz | Archive repacking, extraction, ZIP creation (with entry, size and ratio limits) |
| `browser-text` | txt, base64 | txt, base64, json | Base64 and URL encoding, file inspector |

## Server engines

Run by workers ([WORKER.md](WORKER.md)) as separate processes inside the sandbox
([SECURITY.md](SECURITY.md)). A worker probes the binaries at startup and only claims jobs whose
engines it has.

| Engine | Pool | Binaries | Main uses (offered routes) | Adapter notes |
| --- | --- | --- | --- | --- |
| `imagemagick` | image | `magick`, `convert` | 29 input / 11 output raster formats incl. HEIC, PSD, RAW (experimental), JP2, TGA, DDS, HDR (307 routes) | Restrictive policy per job (delegates and network/script coders off, resource limits); dimensions read from PAM output |
| `ffmpeg` | media | `ffmpeg`, `ffprobe` | Audio and video conversion, audio extraction, GIF/video, video compressor (603 routes) | Probes every input with `ffprobe` (streams, duration) first; enforces duration and pixel limits; builds filter graphs (scaling, padding) safely |
| `libreoffice` | document | `soffice`, `libreoffice` | Word processing, spreadsheets, presentations, drawings → PDF/Office/ODF/HTML/EPUB/CSV (173 routes) | Forced import filter per format, isolated profile per job, CSV formula evaluation off |
| `poppler` | document | `pdftoppm`, `pdftocairo` | PDF → PNG/JPG/TIFF/SVG/TXT/HTML (44 routes) | Page selection and limits; refuses renders over the pixel limit |
| `ghostscript` | document | `gs` | PS/EPS/AI → PDF/PNG/JPG/TIFF; PDF compressor (13 routes) | Always `-dSAFER` |
| `qpdf` | document | `qpdf` | PDF merge, split, page extraction, rotation | Page counts checked against limits |
| `pandoc` | document | `pandoc` | Markdown, HTML, DOCX, ODT, EPUB, RST, LaTeX, Org, FB2 (83 routes) | `--sandbox` when supported, otherwise only with isolated engine processes |
| `sevenzip` | archive | `7zz`, `7z` | 26 archive/disk-image formats → ZIP/7Z/TAR/…; extraction (154 routes) | Listing checked before extraction (paths, links, encryption, size, entries, ratio); extracted tree re-checked |
| `rsvg` | image | `rsvg-convert` | SVG → PNG/PDF/EPS/PS (4 routes) | Output size capped by the pixel limit |
| `assimp` | specialized | `assimp` | 3D models: OBJ, STL, FBX, glTF/GLB, 3DS, DAE, PLY, OFF (56 routes, experimental) | Output names keep OBJ/MTL references working |
| `exiftool` | image | `exiftool` | Metadata viewer and remover | Viewer output limited to public tags |
| `fonttools` | specialized | `python3` + fontTools (+ brotli) | TTF/OTF ↔ WOFF/WOFF2 (10 routes) | Python chosen at probe time (`VANILLATE_PYTHON`); refuses outline-flavor changes it cannot do |

Route counts are from the current registry (an offered route may use several engines).

## Pipelines

A rule's `steps` lists up to three engines; intermediate formats are given in `via`. The
pipeline (`packages/engines/src/pipeline.ts`) runs each step in the job's sandbox and passes
outputs on as the next step's inputs. `1:1` routes run once per input file, `n:1` routes once
for all inputs. Tools resolve to a tool route with an `operation` (e.g. `merge`, `compress`)
that the engine adapter implements.

## Availability

`engine.status` in the catalog caps route statuses (`available` → stable, `degraded` → limited,
`experimental`, `deprecated`, `unavailable`/`disabled` → unsupported). At runtime, workers
advertise which engines they really have, and the API refuses jobs that no live worker can run.
`VANILLATE_DISABLED_ENGINES` removes engines from a worker.

## Licensing

Engines are separate, **unmodified** executables invoked as processes with arguments; nothing
links them into Vanillate Convert's code, so their licenses do not extend to the project's own
code. Obligations arise when **distributing** them — for example publishing a worker container
image — and for network use of modified AGPL software.

| Engine | License (catalog) | Notes |
| --- | --- | --- |
| ImageMagick | ImageMagick License (Apache-2.0 style) | Permissive; keep the notice |
| FFmpeg | LGPL-2.1+; **GPL-2.0+** when built with libx264/libx265 | Distribution builds (Debian/Ubuntu) enable GPL components; shipping them means GPL source obligations |
| LibreOffice | MPL-2.0 | Weak copyleft; unmodified use unrestricted |
| Poppler | GPL-2.0-or-later | Source must be offered when distributed |
| Ghostscript | **AGPL-3.0** | Unmodified use is fine; *modified* Ghostscript offered over a network must provide its source. Commercial licenses are available from Artifex if that is ever a problem |
| qpdf | Apache-2.0 | Permissive |
| Pandoc | GPL-2.0-or-later | Source must be offered when distributed |
| 7-Zip | LGPL-2.1 with the unRAR restriction | The RAR code may not be used to re-create the RAR compression algorithm; RAR is only extracted |
| librsvg | LGPL-2.1-or-later | |
| assimp | BSD-3-Clause | Permissive |
| ExifTool | Artistic-1.0 or GPL-1.0-or-later (Perl terms) | |
| fontTools | MIT | Permissive |

Distributing the worker image therefore requires: shipping license texts (distribution packages
install them under `/usr/share/doc`), and offering the corresponding source of GPL/LGPL/AGPL
components — for Debian/Ubuntu packages, the matching source packages. Do not modify engines
without revisiting this table.

Browser and server JavaScript dependencies (bundled into the application):

| Package | License | Used by |
| --- | --- | --- |
| fflate | MIT | browser archive engine, web app ("download all") |
| yaml | ISC | browser data engine |
| smol-toml | BSD-3-Clause | browser data engine |
| fast-xml-parser | MIT | browser data engine |
| zod | MIT | catalog schemas, API validation |
| postgres | Unlicense | job store |
| aws4fetch | MIT | S3 storage |
| next, react, react-dom | MIT | web app |

Before adding an engine or dependency, record its license here and in the catalog
(`license`, `licenseNotes`), and check redistribution, commercial-use and container
implications.

*This is an engineering summary, not legal advice; review it before redistributing images.*
