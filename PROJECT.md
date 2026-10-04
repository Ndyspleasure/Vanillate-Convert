# Vanillate Convert — Project Specification

> **Language / Bahasa:** Indonesian / English  
> **Project:** Vanillate Convert  
> **Organization:** Vanillate Studio  
> **Project Type:** Web-based File Conversion & Processing Platform  
> **Deployment Target:** Vercel + External Processing Infrastructure  
> **Status:** Early Development

---

# 1. Ringkasan Proyek / Project Overview

## 🇮🇩 Bahasa Indonesia

**Vanillate Convert** adalah platform web all-in-one untuk melakukan **konversi, transformasi, kompresi, ekstraksi, optimasi, dan pemrosesan berbagai jenis file**.

Project ini dirancang sebagai salah satu project besar Vanillate Studio, dengan skala dan pendekatan yang serupa dengan Vanillate Science.

Tujuan utama project bukan hanya menyediakan beberapa converter populer, tetapi membangun sebuah **file processing platform** dengan dukungan format yang sangat luas dan terus dapat diperluas.

Vanillate Convert akan menggunakan sistem berbasis registry sehingga:

- format file dapat ditambahkan tanpa mengubah sistem inti;
- conversion path dapat didefinisikan melalui data;
- conversion engine dapat diganti atau ditambah;
- halaman converter dapat dibuat secara dinamis;
- ratusan format dapat dikelola secara terstruktur;
- ribuan kombinasi conversion dapat dibuat tanpa menulis ribuan implementasi manual.

---

## 🇬🇧 English

**Vanillate Convert** is an all-in-one web platform for **converting, transforming, compressing, extracting, optimizing, and processing different types of files**.

The project is intended to become one of Vanillate Studio's major products, with a scale and development philosophy similar to Vanillate Science.

The goal is not simply to provide a small collection of popular converters, but to build a **large-scale file processing platform** with broad format coverage and a scalable architecture.

Vanillate Convert uses a registry-driven architecture so that:

- new file formats can be added without rewriting the core system;
- conversion paths can be defined as structured data;
- conversion engines can be added or replaced;
- converter pages can be generated dynamically;
- hundreds of formats can be managed consistently;
- thousands of conversion combinations can exist without thousands of custom implementations.

---

# 2. Visi / Vision

## 🇮🇩 Bahasa Indonesia

Visi utama:

> **Menjadikan proses mengubah dan memproses file menjadi sederhana, cepat, aman, dan mudah diakses dari satu platform.**

Pengguna seharusnya tidak harus mencari website berbeda untuk setiap kebutuhan:

```text
PDF converter
Image converter
Video converter
Audio converter
Document converter
Archive converter
JSON converter
Ebook converter
Font converter
dan lain-lain.
```

Semua kebutuhan tersebut secara bertahap dikumpulkan dalam satu ekosistem.

---

## 🇬🇧 English

Primary vision:

> **Make file conversion and file processing simple, fast, secure, and accessible from a single platform.**

Users should not need a different website for every file-processing task.

Vanillate Convert aims to bring these workflows into one ecosystem.

---

# 3. Positioning Produk / Product Positioning

## 🇮🇩 Bahasa Indonesia

Vanillate Convert **bukan hanya file converter**.

Produk ini diposisikan sebagai:

> **All-in-one file conversion and processing platform.**

Kategori produk:

```text
Conversion
Compression
Transformation
Extraction
Optimization
Inspection
Batch Processing
Developer Tools
Specialized File Tools
```

---

## 🇬🇧 English

Vanillate Convert is **not only a file converter**.

The product should be positioned as:

> **An all-in-one file conversion and processing platform.**

Core product areas:

```text
Conversion
Compression
Transformation
Extraction
Optimization
Inspection
Batch Processing
Developer Tools
Specialized File Tools
```

---

# 4. Tujuan Utama / Core Goals

## 🇮🇩 Bahasa Indonesia

### 4.1 Dukungan Format Luas

Sistem harus dapat berkembang hingga mendukung:

- puluhan kategori;
- ratusan format;
- ribuan conversion paths;
- format umum;
- format khusus;
- format teknis;
- format legacy jika masih relevan dan aman untuk diproses.

### 4.2 Conversion Matrix

Sistem harus mengetahui kombinasi:

```text
INPUT FORMAT
      ↓
VALID CONVERSION
      ↓
OUTPUT FORMAT
```

Contoh:

```text
JPG → PNG
JPG → WEBP
JPG → AVIF
JPG → PDF
```

Tidak semua format harus dapat dikonversikan ke semua format.

### 4.3 Reliability

Conversion harus memiliki status:

```text
Stable
Supported
Limited
Experimental
Deprecated
Unsupported
```

Conversion yang tidak valid tidak boleh muncul sebagai pilihan normal.

### 4.4 Scalability

Sistem harus bisa berkembang dari:

```text
10 formats
→ 100 formats
→ 500+ formats
```

dan:

```text
100 conversions
→ 1,000 conversions
→ thousands of conversion paths
```

tanpa redesign total.

### 4.5 Privacy

File pengguna harus dianggap sebagai **untrusted private data**.

### 4.6 Performance

Operation ringan dapat diproses melalui browser jika memungkinkan.

Operation berat harus diproses melalui worker.

### 4.7 UX Konsisten

Semua converter harus terasa seperti satu produk yang sama meskipun menggunakan engine yang berbeda.

---

# 5. Target Pengguna / Target Users

## 🇮🇩 Bahasa Indonesia

### General Users

Untuk kebutuhan sehari-hari:

- convert gambar;
- convert PDF;
- compress file;
- convert video;
- extract archive;
- convert document.

### Students

- assignment files;
- PDF;
- document;
- spreadsheet;
- image optimization;
- presentation.

### Creators

- image conversion;
- video conversion;
- audio extraction;
- GIF;
- compression;
- resizing.

### Developers

- JSON;
- XML;
- CSV;
- YAML;
- SQL;
- Base64;
- encoding/decoding;
- metadata.

### Professionals

- Office documents;
- PDF processing;
- spreadsheets;
- batch processing;
- archive processing.

---

## 🇬🇧 English

Target users include:

- General users
- Students
- Creators
- Developers
- Professionals
- Technical users
- Small teams

The interface must remain accessible to non-technical users while providing advanced controls for technical users.

---

# 6. Product Scope

## 🇮🇩 Bahasa Indonesia

Vanillate Convert mencakup beberapa lapisan fitur.

### 6.1 Conversion

Konversi format:

```text
Format A → Format B
```

### 6.2 Compression

- Image compression
- PDF compression
- Video compression
- Audio compression
- Archive optimization

### 6.3 Transformation

- Resize
- Crop
- Rotate
- Flip
- Trim
- Re-encode
- Change quality
- Change bitrate
- Change resolution
- Change FPS
- Change DPI

### 6.4 Extraction

- Extract pages
- Extract images
- Extract audio
- Extract frames
- Extract archive
- Extract metadata

### 6.5 Combination

- Merge PDF
- Merge images
- Merge audio
- Merge video
- Images → PDF
- Files → Archive

### 6.6 Inspection

- Format detection
- MIME detection
- Metadata viewer
- Media information
- Archive information
- File information

---

## 🇬🇧 English

The platform covers:

- Conversion
- Compression
- Transformation
- Extraction
- Combination
- Inspection
- Batch processing
- Specialized tools

---

# 7. Format Categories / Kategori Format

Vanillate Convert is expected to support, where technically feasible:

```text
Image
PDF
Document
Spreadsheet
Presentation
Audio
Video
Archive
Data
Developer
Ebook
Subtitle
Font
Vector
3D
CAD
Scientific
Web
Metadata
Specialized
```

---

# 8. Image Platform

## 🇮🇩 Bahasa Indonesia

Target format:

```text
JPG
JPEG
PNG
WEBP
AVIF
GIF
APNG
BMP
TIFF
TIF
HEIC
HEIF
SVG
ICO
JXL
JP2
TGA
DDS
EXR
HDR
PSD
PSB
XCF
DNG
CR2
CR3
NEF
ARW
ORF
RW2
RAF
PEF
SRW
```

Dan format lainnya yang secara teknis dapat didukung engine terkait.

### Fitur

```text
Convert
Compress
Resize
Crop
Rotate
Flip
Quality
DPI
Metadata
Image → PDF
PDF → Image
GIF → Frames
Frames → GIF
```

---

# 9. PDF Platform

## 🇮🇩 Bahasa Indonesia

PDF diperlakukan sebagai kategori utama, bukan sekadar satu format conversion.

### Conversion

```text
PDF → JPG
PDF → PNG
PDF → WEBP
PDF → TXT
PDF → HTML
PDF → SVG
PDF → DOCX
PDF → XLSX
PDF → PPTX
```

### PDF Tools

```text
Merge
Split
Compress
Rotate
Reorder
Delete Pages
Extract Pages
Extract Images
Watermark
Metadata
PDF Validation
Password Protection
```

Operation yang berhubungan dengan password/encryption hanya boleh mendukung workflow yang sah dan tidak boleh dirancang untuk membobol proteksi.

---

# 10. Document Platform

Target:

```text
DOC
DOCX
ODT
RTF
TXT
HTML
HTM
MD
XML
```

Contoh conversion:

```text
DOCX → PDF
DOCX → TXT
DOCX → HTML
DOCX → ODT
ODT → DOCX
ODT → PDF
HTML → PDF
HTML → DOCX
Markdown → HTML
Markdown → PDF
Markdown → DOCX
```

---

# 11. Spreadsheet Platform

Target:

```text
XLS
XLSX
XLSM
ODS
CSV
TSV
DBF
XML
JSON
```

Contoh:

```text
XLSX → CSV
XLSX → PDF
XLSX → ODS
CSV → XLSX
CSV → JSON
CSV → XML
JSON → XLSX
XML → XLSX
```

---

# 12. Presentation Platform

Target:

```text
PPT
PPTX
ODP
PDF
```

Contoh:

```text
PPTX → PDF
PPTX → JPG
PPTX → PNG
PPTX → ODP
ODP → PPTX
```

---

# 13. Audio Platform

Target:

```text
MP3
WAV
FLAC
AAC
M4A
OGG
OPUS
AIFF
ALAC
WMA
AMR
AC3
DTS
APE
MKA
```

Fitur:

```text
Format Conversion
Bitrate
Sample Rate
Channels
Volume
Normalization
Trim
Merge
Extract Audio
Metadata
```

---

# 14. Video Platform

Target:

```text
MP4
MKV
MOV
AVI
WEBM
WMV
FLV
MPEG
MPG
M4V
3GP
3G2
TS
MTS
M2TS
OGV
VOB
ASF
RM
RMVB
```

Codec yang dapat ditangani bergantung pada engine:

```text
H.264
H.265 / HEVC
AV1
VP8
VP9
MPEG
ProRes
DNxHD
DNxHR
Theora
```

Fitur:

```text
Convert
Compress
Resize
Crop
Rotate
Trim
FPS
Bitrate
Codec
Aspect Ratio
Mute
Extract Audio
Extract Frames
Video → GIF
GIF → Video
Merge Video
```

---

# 15. Archive Platform

Target:

```text
ZIP
7Z
RAR
TAR
GZ
TGZ
BZ2
TBZ2
XZ
TXZ
LZ
LZMA
WIM
ISO
CAB
ARJ
LZH
CPIO
RPM
DEB
DMG
VHD
VHDX
VMDK
QCOW2
```

### Features

```text
Extract
Create
Convert
Inspect
Validate
Batch Extract
Archive → Archive
Files → Archive
```

Archive processing harus memiliki proteksi terhadap:

- path traversal;
- zip bombs;
- archive bombs;
- excessive extraction;
- recursive archives;
- excessive file counts.

---

# 16. Data & Developer Tools

Target:

```text
JSON
XML
YAML
CSV
TSV
TOML
INI
SQL
NDJSON
JSONL
HTML
Markdown
TXT
```

Tools:

```text
JSON Formatter
JSON Minifier
XML Formatter
XML Minifier
JSON → CSV
CSV → JSON
JSON → XML
XML → JSON
YAML → JSON
JSON → YAML
CSV → XML
XML → CSV
CSV → SQL
SQL → CSV
Base64 Encode
Base64 Decode
URL Encode
URL Decode
```

Tools yang bersifat ringan sebaiknya diproses langsung di browser jika aman dan memungkinkan.

---

# 17. Ebook Platform

Target:

```text
EPUB
MOBI
AZW
AZW3
CBZ
CBR
DJVU
PDF
```

Contoh:

```text
EPUB → PDF
PDF → EPUB
MOBI → EPUB
AZW3 → EPUB
Images → CBZ
CBZ → PDF
```

Dukungan format proprietary harus mengikuti kemampuan engine dan pertimbangan legal/technical.

---

# 18. Subtitle Platform

Target:

```text
SRT
VTT
ASS
SSA
SUB
SBV
TTML
DFXP
```

Tools:

```text
SRT → VTT
VTT → SRT
ASS → SRT
Subtitle Shift
Subtitle Sync
Subtitle Extraction
Subtitle Conversion
```

---

# 19. Font Platform

Target:

```text
TTF
OTF
WOFF
WOFF2
EOT
TTC
DFONT
```

Tools:

```text
TTF → WOFF
TTF → WOFF2
OTF → WOFF
OTF → WOFF2
WOFF → TTF
WOFF2 → TTF
Font Preview
Font Inspector
Font Metadata
```

---

# 20. Vector Platform

Target:

```text
SVG
EPS
AI
PDF
EMF
WMF
DXF
```

Fitur:

```text
SVG → PNG
SVG → JPG
SVG → PDF
EPS → SVG
EPS → PNG
PDF → SVG
Vector Preview
```

Format proprietary hanya ditambahkan jika tersedia processing path yang reliable dan appropriate.

---

# 21. 3D & CAD Platform

Target potensial:

```text
OBJ
STL
FBX
GLTF
GLB
3DS
DAE
PLY
OFF
STEP
STP
IGES
IGS
DXF
DWG
```

Fitur:

```text
3D Conversion
Model Preview
Mesh Inspection
CAD Conversion
Metadata Inspection
```

Kategori ini merupakan bagian advanced dan dapat dikembangkan setelah core platform stabil.

---

# 22. Scientific Platform

Target potensial:

```text
FITS
MAT
HDF
HDF5
NC
CDF
DICOM
NII
NIfTI
MRC
VTK
```

Potential tools:

```text
Scientific Data Conversion
Metadata Inspection
Image Export
Data Extraction
Visualization-oriented Export
```

Format yang mengandung informasi sensitif, terutama medical formats, membutuhkan aturan privacy tambahan.

---

# 23. Automatic File Detection

## 🇮🇩 Bahasa Indonesia

User sebaiknya tidak perlu selalu memilih format secara manual.

Sistem harus berusaha mendeteksi:

```text
Extension
MIME Type
Magic Bytes / File Signature
Container
Codec
Content Characteristics
```

Contoh:

```text
photo.heic
```

menjadi:

```text
Detected:
HEIC
Category:
Image
```

Kemudian sistem otomatis memberikan conversion yang valid.

---

## 🇬🇧 English

The system should automatically detect file characteristics whenever practical.

Detection may use:

- extension;
- MIME type;
- file signature;
- container;
- codec;
- content inspection.

The detected format becomes the primary input for conversion routing.

---

# 24. Conversion Registry

Semua format disimpan dalam registry terstruktur.

Contoh konsep:

```text
formats
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

Tujuannya adalah menjadikan registry sebagai **single source of truth**.

---

# 25. Conversion Matrix

Conversion path disimpan terpisah.

Contoh:

```text
JPG
 ├── PNG
 ├── WEBP
 ├── AVIF
 ├── TIFF
 └── PDF

HEIC
 ├── JPG
 ├── PNG
 ├── WEBP
 ├── TIFF
 └── PDF

MP4
 ├── WEBM
 ├── GIF
 ├── MP3
 ├── WAV
 └── M4A
```

Setiap conversion path dapat mempunyai:

```text
inputFormat
outputFormat
engine
processingMode
status
options
limitations
qualityModel
metadataPolicy
```

---

# 26. Conversion Engine

Vanillate Convert tidak seharusnya mengimplementasikan semua format dari nol.

Engine digunakan berdasarkan kategori.

Potential engines:

```text
ImageMagick
FFmpeg
LibreOffice
Pandoc
Ghostscript
7-Zip
Poppler
ExifTool
Specialized Libraries
Browser APIs
WASM-based Engines
```

Engine dapat ditambahkan tanpa mengubah UI utama.

---

# 27. Processing Modes

Ada dua processing mode utama.

## Browser

Digunakan jika:

- operation ringan;
- browser support memadai;
- privacy benefit besar;
- ukuran file sesuai;
- kualitas hasil acceptable.

Contoh:

```text
Image resize
Image compression
Simple image conversion
JSON formatting
Text transformation
Basic data conversion
```

## Server

Digunakan jika:

- file besar;
- operation berat;
- membutuhkan native engine;
- membutuhkan CPU/memory besar;
- browser support tidak cukup.

Contoh:

```text
Large video conversion
Complex PDF processing
Office conversion
Archive extraction
Specialized formats
```

---

# 28. Arsitektur Tingkat Tinggi / High-Level Architecture

```text
                           USER
                            │
                            ▼
                    VANILLATE CONVERT
                            │
               ┌────────────┴────────────┐
               │                         │
          Browser Tools              API Layer
               │                         │
               │                    File Upload
               │                         │
               │                    Job Creation
               │                         │
               └────────────┬────────────┘
                            ▼
                       File Storage
                            │
                            ▼
                         Job Queue
                            │
             ┌──────────────┼──────────────┐
             ▼              ▼              ▼
        Image Worker   Media Worker   Document Worker
             │              │              │
             └──────────────┼──────────────┘
                            ▼
                    Conversion Engines
                            │
                            ▼
                      Output Storage
                            │
                            ▼
                         Download
```

---

# 29. Vercel Deployment Strategy

## 🇮🇩 Bahasa Indonesia

Website utama ditargetkan menggunakan **Vercel**.

Vercel menangani:

```text
Frontend
Routing
SEO Pages
Application API
Format Registry Access
Conversion Routing
Job Creation
Job Status
User Interface
```

Heavy processing tidak harus dilakukan di web request utama.

Untuk file besar atau conversion berat:

```text
Vercel
   ↓
Storage
   ↓
Queue
   ↓
External Worker
   ↓
Conversion Engine
   ↓
Output Storage
```

Dengan pendekatan ini, project dapat berkembang tanpa menjadikan frontend deployment sebagai bottleneck conversion.

---

## 🇬🇧 English

The main web application is intended to run on Vercel.

Vercel is responsible for:

- Frontend
- Routing
- SEO pages
- Application API
- Registry access
- Conversion routing
- Job creation
- Job status
- User interface

Heavy processing should be isolated into dedicated workers when appropriate.

---

# 30. Upload Architecture

File upload harus memiliki alur yang aman.

```text
User
 ↓
Select / Drop File
 ↓
Pre-validation
 ↓
Upload
 ↓
Storage
 ↓
Format Detection
 ↓
Conversion Validation
 ↓
Job Creation
```

File besar tidak harus melewati web application body secara langsung.

Direct-to-storage upload atau mekanisme upload yang sesuai harus digunakan ketika dibutuhkan.

---

# 31. Job System

Setiap server-side conversion dianggap sebagai job.

Possible states:

```text
pending
uploading
queued
processing
finalizing
completed
failed
cancelled
expired
```

Job harus memiliki:

```text
jobId
input
output
status
progress
createdAt
startedAt
completedAt
error
engine
worker
```

---

# 32. Worker Architecture

Worker bertanggung jawab menjalankan conversion.

Contoh:

```text
Image Worker
PDF Worker
Document Worker
Audio Worker
Video Worker
Archive Worker
Data Worker
Specialized Worker
```

Worker harus:

1. mengambil job;
2. mendapatkan input file;
3. memvalidasi input;
4. menjalankan engine;
5. memvalidasi output;
6. menyimpan output;
7. memperbarui status;
8. melakukan cleanup.

---

# 33. Storage

Storage dibagi menjadi:

```text
Input Storage
Processing Storage
Output Storage
```

Semua storage yang menyimpan user files harus menggunakan access control yang tepat.

File yang sudah tidak diperlukan harus dihapus sesuai retention policy.

---

# 34. File Lifecycle

```text
UPLOAD
   ↓
VALIDATE
   ↓
PROCESS
   ↓
OUTPUT
   ↓
DOWNLOAD
   ↓
EXPIRE
   ↓
DELETE
```

Sistem harus memiliki cleanup untuk:

- expired uploads;
- failed jobs;
- cancelled jobs;
- abandoned uploads;
- expired outputs;
- temporary worker files.

---

# 35. Batch Processing

User dapat memasukkan beberapa file dalam satu workflow.

Contoh:

```text
20 JPG
   ↓
WEBP
   ↓
20 output files
   ↓
ZIP
```

Batch job harus dapat memberikan:

```text
Total Files
Successful
Failed
Pending
Processing
```

File yang gagal tidak boleh membuat seluruh batch kehilangan hasil yang berhasil.

---

# 36. User Experience

Homepage harus memprioritaskan upload-first experience.

Contoh:

```text
Vanillate Convert

Convert, compress and transform your files.

[ Drop files here ]
[ Choose Files ]

Popular Conversions
JPG → PNG
PDF → JPG
MP4 → MP3
DOCX → PDF
PNG → WEBP
```

Setelah upload:

```text
Detected:
HEIC Image

Convert to:

JPG
PNG
WEBP
AVIF
TIFF
PDF

[ Convert ]
```

---

# 37. Smart Conversion Suggestions

Setelah format terdeteksi, sistem dapat memberikan rekomendasi.

Contoh:

```text
MKV detected.

Recommended:
MP4

Other options:
WEBM
MOV
AVI
GIF
MP3
WAV
```

Recommendation system tidak boleh menggantikan daftar conversion valid.

---

# 38. Search & Format Explorer

Website harus memiliki pencarian:

```text
Search format...
Search converter...
Search tools...
```

Contoh:

```text
HEIC
HEIC to JPG
PDF converter
MP4 converter
Compress PDF
JSON to CSV
```

Format aliases harus didukung:

```text
JPEG = JPG
TIF = TIFF
HTM = HTML
```

---

# 39. Dynamic Routes

Format conversion harus dapat menghasilkan route seperti:

```text
/convert/jpg-to-png
/convert/png-to-webp
/convert/heic-to-jpg
/convert/pdf-to-jpg
/convert/docx-to-pdf
/convert/mkv-to-mp4
/convert/mp4-to-gif
```

Route dihasilkan dari conversion registry.

Tidak diperlukan satu source file khusus untuk setiap page.

---

# 40. SEO Strategy

Vanillate Convert dapat memiliki banyak landing pages berdasarkan conversion path.

Setiap supported route dapat memiliki:

```text
Title
Description
Canonical
Breadcrumb
Structured Data
Related Conversions
Related Formats
FAQ
```

Unsupported conversion tidak boleh dibuat sebagai indexed page.

SEO content harus tetap berguna dan tidak hanya berupa generated text tanpa nilai.

---

# 41. Internationalization / Multilingual

Project harus dirancang sejak awal agar dapat mendukung dua bahasa utama:

```text
id — Bahasa Indonesia
en — English
```

Default language dapat ditentukan sesuai strategi produk, tetapi struktur data harus mendukung multilingual content.

Contoh:

```text
Page Title
├── id
└── en

Description
├── id
└── en

Tool Name
├── id
└── en

Error Message
├── id
└── en
```

UI text tidak boleh tersebar hard-coded di banyak komponen.

Gunakan translation dictionary atau internationalization layer.

---

# 42. URL Localization

Strategi URL dapat menggunakan pendekatan yang konsisten.

Contoh:

```text
/id/convert/jpg-ke-png
/en/convert/jpg-to-png
```

atau satu URL dengan language-aware content.

Strategi final harus mempertimbangkan:

- SEO;
- canonical;
- sitemap;
- simplicity;
- internal linking;
- scalability.

Yang terpenting adalah tidak menciptakan duplicate content tanpa strategi canonical yang benar.

---

# 43. Accessibility

UI harus mempertimbangkan:

- keyboard navigation;
- screen readers;
- sufficient contrast;
- visible focus;
- accessible labels;
- button semantics;
- drag-and-drop alternative;
- progress announcements;
- error announcements.

Upload functionality tidak boleh hanya bergantung pada drag-and-drop.

---

# 44. Security

Semua upload dianggap berbahaya sampai terbukti aman.

Security requirements:

```text
File Signature Validation
MIME Validation
Extension Validation
Size Limits
CPU Limits
Memory Limits
Timeouts
Rate Limits
Path Traversal Protection
Command Injection Protection
Archive Bomb Protection
Worker Isolation
Secure Downloads
Temporary File Cleanup
```

Conversion engine tidak boleh menerima command arbitrary dari user.

---

# 45. Privacy

Prinsip:

```text
Private by Default
Temporary Processing
Automatic Cleanup
Protected Downloads
Minimal Retention
No Public File Listing
Clear Data Handling
```

Jika file diproses server-side, user harus mendapatkan informasi yang jelas mengenai pemrosesan tersebut.

Jika suatu operation benar-benar client-side, UI dapat menunjukkan:

```text
Processed in your browser.
```

Namun label ini hanya boleh digunakan jika file memang tidak dikirim ke server untuk operation tersebut.

---

# 46. Error System

Error teknis tidak boleh langsung menjadi pesan utama kepada user.

Engine:

```text
FFmpeg exit code 1
```

User message:

```text
We couldn't convert this file.

The file may be corrupted, unsupported,
or contain a feature that this converter
does not currently support.
```

Developer/admin tetap mendapatkan technical error yang lebih detail melalui logging.

---

# 47. Limits

Sistem harus memiliki limit yang eksplisit.

Contoh:

```text
Maximum File Size
Maximum Files per Batch
Maximum Job Duration
Maximum Output Size
Maximum Concurrent Jobs
Maximum Extracted Archive Size
Maximum Archive File Count
```

Limit dapat berbeda berdasarkan conversion category.

Limit harus terdokumentasikan di `LIMITS.md`.

---

# 48. Conversion Quality

Setiap conversion harus mempertimbangkan apakah hasilnya:

```text
Lossless
Lossy
Metadata-changing
Resolution-changing
Structure-changing
Potentially imperfect
```

Contoh:

```text
PNG → JPG
```

adalah potentially lossy.

Sistem harus memberi informasi jika conversion dapat mengurangi kualitas atau mengubah karakteristik file.

---

# 49. Metadata Handling

Metadata dapat menjadi bagian penting dari file.

Sistem perlu menentukan policy:

```text
Preserve
Strip
Transform
Unsupported
```

Contoh metadata:

```text
EXIF
GPS
ICC Profile
Document Metadata
Audio Tags
Video Metadata
```

Privacy-sensitive metadata seperti GPS harus diperhatikan secara khusus.

---

# 50. Validation

Conversion output harus divalidasi.

Minimal:

```text
File Exists
Correct MIME
Correct Extension
Readable Output
Expected Structure
Valid Size
```

Jika output gagal divalidasi, job tidak boleh dianggap `completed`.

---

# 51. Testing Strategy

Testing harus mencakup:

### Unit Test

- Registry
- Routing
- Validation
- Conversion selection
- Limits

### Integration Test

- Upload
- Job creation
- Worker
- Engine
- Storage
- Download

### Conversion Test

```text
Input
↓
Convert
↓
Output
↓
Validate
```

### Security Test

- Malformed files
- Oversized files
- Malicious archives
- Path traversal
- Unexpected MIME
- Resource exhaustion

### Regression Test

Conversion yang sudah stabil tidak boleh rusak ketika engine atau registry berubah.

---

# 52. Observability

Platform memerlukan monitoring untuk:

```text
Conversion Success Rate
Failure Rate
Average Processing Time
Queue Length
Worker Health
Storage Usage
Engine Error Rate
Job Timeout Rate
```

Logging tidak boleh menyimpan isi file user secara tidak perlu.

---

# 53. Administrative Requirements

Walaupun initial release dapat bersifat public utility, sistem internal dapat memiliki administrative tooling.

Potential admin functionality:

```text
Format Registry
Conversion Registry
Engine Registry
Job Monitoring
Worker Monitoring
Error Logs
Failed Jobs
System Limits
Feature Flags
```

Admin system harus dipisahkan dari public conversion interface.

---

# 54. Developer Experience

Developer baru harus dapat memahami:

```text
How formats work
How conversions work
How engines work
How jobs work
How workers work
How storage works
How routes are generated
How tests are written
```

Dokumentasi inti:

```text
README.md
PROJECT.md
ARCHITECTURE.md
FORMAT-REGISTRY.md
CONVERSION-MATRIX.md
ENGINE-MAPPING.md
API.md
STORAGE.md
WORKER.md
QUEUE.md
SECURITY.md
PRIVACY.md
SEO.md
LIMITS.md
TESTING.md
```

---

# 55. Repository Structure

Recommended initial structure:

```text
vanillate-convert/
│
├── apps/
│   └── web/
│
├── packages/
│   ├── core/
│   ├── formats/
│   ├── conversions/
│   ├── engines/
│   ├── validation/
│   ├── storage/
│   └── shared/
│
├── workers/
│   ├── image/
│   ├── pdf/
│   ├── document/
│   ├── audio/
│   ├── video/
│   ├── archive/
│   ├── data/
│   └── specialized/
│
├── catalog/
│   ├── formats/
│   ├── conversions/
│   └── engines/
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── FORMAT-REGISTRY.md
│   ├── CONVERSION-MATRIX.md
│   ├── ENGINE-MAPPING.md
│   ├── API.md
│   ├── STORAGE.md
│   ├── WORKER.md
│   ├── QUEUE.md
│   ├── SECURITY.md
│   ├── PRIVACY.md
│   ├── SEO.md
│   ├── LIMITS.md
│   └── TESTING.md
│
├── tests/
│
├── README.md
├── PROJECT.md
├── ROADMAP.md
└── package.json
```

Struktur final dapat berubah sesuai stack yang dipilih.

---

# 56. Data Architecture

Format dan conversion sebaiknya berasal dari structured data.

Contoh:

```text
catalog/
├── formats/
│   ├── image.json
│   ├── document.json
│   ├── audio.json
│   ├── video.json
│   ├── archive.json
│   └── ...
│
├── conversions/
│   ├── image.json
│   ├── document.json
│   ├── audio.json
│   ├── video.json
│   └── ...
│
└── engines/
    ├── imagemagick.json
    ├── ffmpeg.json
    ├── libreoffice.json
    ├── pandoc.json
    └── ...
```

Tujuan:

> **Markdown menjelaskan aturan; structured data menjadi sumber data aplikasi.**

---

# 57. Format Status

Setiap format harus mempunyai status.

Contoh:

```text
Stable
Supported
Limited
Experimental
Deprecated
Unsupported
```

Contoh:

```text
HEIC
Server: Stable
Browser: Limited
```

UI harus dapat menunjukkan informasi ini tanpa membingungkan user.

---

# 58. Engine Status

Engine juga harus memiliki status internal.

Contoh:

```text
Available
Unavailable
Degraded
Disabled
Experimental
Deprecated
```

Jika engine gagal, sistem harus dapat:

- menggunakan fallback jika tersedia;
- menandai conversion sebagai unavailable;
- tidak membuat seluruh platform gagal.

---

# 59. Fallback System

Jika suatu conversion mempunyai lebih dari satu engine yang kompatibel:

```text
Primary Engine
      ↓
Fallback Engine
      ↓
Failure
```

Fallback hanya boleh digunakan jika hasilnya dapat dipertanggungjawabkan.

Tidak semua conversion membutuhkan fallback.

---

# 60. Multi-step Conversion

Pada beberapa kasus, output tidak dapat dibuat secara langsung.

Contoh:

```text
Format A
   ↓
Intermediate Format
   ↓
Format B
```

Sistem dapat mendukung internal multi-step pipeline.

Namun pipeline harus dikelola secara eksplisit agar:

- intermediate file aman;
- kualitas tetap terkontrol;
- resource usage dapat diprediksi;
- error dapat ditangani dengan jelas.

---

# 61. Batch Conversion

Conversion matrix juga harus mendukung batch-compatible operation.

Contoh:

```text
10 PNG → 10 WEBP
```

Sistem harus mengetahui apakah operation:

```text
Per-file
Multi-file
Order-sensitive
Structure-sensitive
```

Contoh:

```text
Images → PDF
```

berbeda dengan:

```text
PNG → WEBP
```

karena Images → PDF membutuhkan beberapa input dalam satu operation.

---

# 62. Composite Tools

Vanillate Convert tidak selalu harus menghasilkan satu output dari satu input.

Contoh:

```text
Images
  ↓
PDF
```

atau:

```text
Video
  ↓
Audio
```

atau:

```text
Archive
  ↓
Extracted Files
```

Schema job harus dapat menangani:

```text
1 input → 1 output
1 input → many outputs
many inputs → 1 output
many inputs → many outputs
```

---

# 63. API Design Principles

API harus:

- predictable;
- versioned;
- idempotent where appropriate;
- secure;
- observable;
- documented.

Potential routes:

```text
POST /api/v1/jobs
GET  /api/v1/jobs/:id
POST /api/v1/jobs/:id/cancel

GET /api/v1/formats
GET /api/v1/formats/:id

GET /api/v1/conversions
GET /api/v1/conversions/:from/:to
```

---

# 64. Future Public API

Setelah platform stabil, Vanillate Convert dapat menyediakan API untuk developer.

Potential features:

```text
API Keys
Usage Limits
Conversion Jobs
Webhooks
Job Status
Format Registry API
Conversion Registry API
```

Public API bukan prioritas initial release.

---

# 65. Monetization Readiness

Project harus tetap dapat berkembang menuju berbagai model layanan tanpa memaksa monetization sejak awal.

Potential future models:

```text
Free
Pro
API
Developer
Business
```

Potential differences:

```text
File Size
Concurrent Jobs
Batch Size
Priority Queue
Advanced Formats
API Usage
Retention
```

Monetization must not compromise the basic reliability of the product.

---

# 66. International Product Architecture

Vanillate Convert should be ready to serve multiple countries and languages.

Initial:

```text
Indonesian
English
```

Future languages may be added through the same localization architecture.

Translated content should include:

```text
UI
Errors
Tool Descriptions
SEO Titles
SEO Descriptions
Help Content
FAQ
```

---

# 67. Accessibility of Technical Features

Advanced options should remain hidden or collapsed by default where appropriate.

Example:

```text
Basic
[ Convert ]

Advanced Options
├── Quality
├── Codec
├── Bitrate
├── Metadata
├── Resolution
└── FPS
```

This prevents technical settings from overwhelming normal users.

---

# 68. Product Quality Principles

Vanillate Convert prioritizes:

```text
Reliability
Security
Privacy
Performance
Scalability
Clarity
Maintainability
Accessibility
```

The number of supported formats is not the only measure of success.

A large catalog is only valuable if the supported conversion paths work correctly.

---

# 69. Non-Goals

Project tidak bertujuan untuk:

- memaksa dukungan setiap proprietary format;
- membobol encryption;
- menjamin perfect fidelity untuk semua conversion;
- menjalankan arbitrary executable files dari user;
- membuat semua kombinasi format tersedia hanya demi jumlah;
- menyimpan file user secara permanen tanpa alasan yang jelas.

---

# 70. Success Criteria

Project dianggap berada di jalur yang benar jika:

- format registry terstruktur;
- conversion matrix terdefinisi;
- engine abstraction stabil;
- browser/server routing berjalan;
- job system stabil;
- worker dapat scale;
- conversion result tervalidasi;
- temporary files dibersihkan;
- unsupported conversion tidak ditawarkan;
- SEO pages dapat dihasilkan dari registry;
- format baru dapat ditambahkan tanpa perubahan besar;
- dokumentasi sinkron dengan implementasi.

---

# 71. Development Priorities

Urutan prioritas:

```text
1. Foundation
2. Registry
3. Conversion Matrix
4. Engine Abstraction
5. Upload
6. Storage
7. Job System
8. Worker
9. Browser Processing
10. Image
11. PDF
12. Documents
13. Archives
14. Audio
15. Video
16. Data / Developer
17. Ebook
18. Subtitle
19. Font
20. Vector
21. 3D / CAD
22. Scientific
23. SEO Catalog
24. Scaling
25. Public API
```

---

# 72. Long-Term Product Structure

```text
Vanillate Convert
│
├── Convert
│   ├── Image
│   ├── PDF
│   ├── Document
│   ├── Spreadsheet
│   ├── Presentation
│   ├── Audio
│   ├── Video
│   ├── Archive
│   ├── Data
│   ├── Ebook
│   ├── Subtitle
│   ├── Font
│   ├── Vector
│   ├── 3D
│   ├── CAD
│   └── Scientific
│
├── Compress
│
├── Transform
│
├── Extract
│
├── Inspect
│
├── Batch Tools
│
├── Developer Tools
│
└── Advanced Tools
```

---

# 73. Future Vision / Visi Jangka Panjang

## 🇮🇩 Bahasa Indonesia

Vanillate Convert diharapkan berkembang dari sebuah website converter menjadi **platform file processing yang lengkap**.

Pengguna dapat datang dengan pertanyaan sederhana:

> “Saya punya file ini. Saya harus mengubahnya menjadi apa?”

Vanillate Convert kemudian membantu:

1. mendeteksi file;
2. memahami format;
3. menampilkan conversion yang valid;
4. merekomendasikan pilihan yang tepat;
5. memproses file;
6. memvalidasi hasil;
7. memberikan output;
8. menghapus temporary data sesuai kebijakan.

Kompleksitas teknis harus tetap berada di belakang sistem.

Yang dilihat user harus tetap sederhana.

---

## 🇬🇧 English

Vanillate Convert should eventually evolve from a simple converter website into a **complete file processing platform**.

A user should be able to arrive with a simple question:

> “I have this file. What can I do with it?”

Vanillate Convert should then:

1. detect the file;
2. identify the format;
3. display valid conversion options;
4. recommend appropriate outputs;
5. process the file;
6. validate the result;
7. provide the output;
8. clean up temporary data according to policy.

The technical complexity should remain behind the product.

The user experience should remain simple.

---

# 74. Final Product Principle

## 🇮🇩 Bahasa Indonesia

> **Jangan mengejar jumlah converter. Bangun sistem yang mampu menghasilkan converter secara scalable.**

Project ini harus dibangun berdasarkan prinsip:

```text
Registry
+
Conversion Rules
+
Engine Abstraction
+
Workers
+
Validation
+
Security
+
Good UX
=
Scalable File Processing Platform
```

---

## 🇬🇧 English

> **Do not chase the number of converters. Build a system that can generate and manage converters at scale.**

The platform should be built around:

```text
Registry
+
Conversion Rules
+
Engine Abstraction
+
Workers
+
Validation
+
Security
+
Good UX
=
Scalable File Processing Platform
```

---

# 75. Project Identity

**Product Name:** Vanillate Convert  
**Organization:** Vanillate Studio  
**Website:** https://vanillate.id/  
**Primary Purpose:** File conversion and processing  
**Deployment Target:** Vercel + dedicated processing infrastructure  
**Primary Languages:** Indonesian / English  
**Project Scale:** Large / Long-term  
**Architecture:** Registry-driven, worker-based, scalable  
**Initial Status:** Early Development

---

# 76. Related Documentation

Detailed implementation specifications should be maintained separately:

```text
docs/
├── ARCHITECTURE.md
├── FORMAT-REGISTRY.md
├── CONVERSION-MATRIX.md
├── ENGINE-MAPPING.md
├── API.md
├── STORAGE.md
├── WORKER.md
├── QUEUE.md
├── SECURITY.md
├── PRIVACY.md
├── SEO.md
├── LIMITS.md
└── TESTING.md
```

`PROJECT.md` defines **what Vanillate Convert is, what it is intended to become, and the principles governing the product**.

Technical implementation details should be maintained in the corresponding documentation files.