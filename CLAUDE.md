# CLAUDE.md — Vanillate Match

## 0. Tujuan Dokumen

Dokumen ini adalah instruksi kerja utama untuk Claude Code saat mengembangkan, memperbaiki, menguji, mengaudit, dan men-deploy **Vanillate Match**.

Vanillate Match adalah aplikasi matchmaking/social discovery berbasis Discord dengan pengalaman utama yang berjalan secara privat melalui Discord interaction/ephemeral UI dan User Install, sementara Guild Install digunakan sebagai entry point, engagement surface, dan growth channel.

Claude Code harus memperlakukan dokumen ini sebagai **project operating policy**.

---

# 1. MODE KERJA: AUTONOMOUS BY DEFAULT

## Prinsip utama

Claude Code diberikan kepercayaan penuh untuk menyelesaikan pekerjaan teknis yang diperlukan tanpa meminta izin berulang kali.

**Jangan meminta konfirmasi untuk tindakan teknis rutin.**

Claude Code diperbolehkan secara proaktif:

- membaca seluruh repository yang relevan;
- mencari file, dependency, configuration, environment usage, schema, migration, route, command, component, service, worker, test, dan deployment configuration;
- membuat, mengubah, memindahkan, atau menghapus file yang memang diperlukan;
- memperbaiki bug dan error yang ditemukan meskipun tidak secara eksplisit disebutkan di task awal;
- menjalankan build, lint, test, typecheck, migration, seed, formatter, dan validation;
- memasang dependency yang benar-benar diperlukan;
- memperbarui dependency bila dibutuhkan untuk compatibility, security, atau bug fix;
- membaca dokumentasi resmi dan menggunakan konektor/tool yang tersedia;
- menggunakan GitHub/Git provider, database, deployment provider, logs, monitoring, atau connector lain yang telah tersedia di environment;
- melakukan diagnosis lintas layer: Discord → application → database → deployment → external service;
- memperbaiki konfigurasi environment yang salah;
- melakukan migration/schema adjustment yang diperlukan;
- melakukan rollback terhadap perubahan yang baru saja dibuat apabila validasi membuktikan perubahan tersebut bermasalah;
- mengulang build/test/debug cycle sampai masalah benar-benar terselesaikan atau sampai terdapat blocker eksternal yang nyata;
- membuat dokumentasi teknis tambahan bila diperlukan agar sistem mudah dirawat.

## Jangan berhenti hanya karena ada error pertama

Jika menemukan error:

1. Identifikasi akar masalah.
2. Perbaiki.
3. Jalankan validasi ulang.
4. Jika muncul error baru akibat perubahan, lanjutkan diagnosis.
5. Jangan meninggalkan repository dalam keadaan lebih buruk dari sebelumnya.

Targetnya bukan sekadar **"kode berhasil ditulis"**, tetapi **"fitur berjalan dan tervalidasi"**.

---

# 2. ATURAN PERMINTAAN IZIN

Claude Code **tidak perlu meminta izin** untuk:

- install package;
- update package;
- membuat migration;
- menjalankan test/build/lint/typecheck;
- memperbaiki file configuration;
- memperbaiki command/interaction handler;
- mengubah database schema selama perubahan tersebut memang dibutuhkan oleh fitur dan dilakukan dengan aman;
- menggunakan connector/tool yang tersedia;
- membaca log aplikasi/deployment/database;
- membuat atau memperbarui dokumentasi;
- melakukan refactor yang aman dan relevan;
- melakukan deployment ke environment yang memang menjadi target task;
- melakukan rollback terhadap perubahan yang baru dibuat jika validasi gagal.

## Saat menghadapi keputusan yang ambigu

Jangan berhenti untuk bertanya jika masih ada pilihan yang dapat diputuskan secara engineering.

Gunakan prioritas berikut:

1. Keamanan user dan privacy.
2. Integritas data.
3. Compatibility dengan Discord dan repository.
4. Konsistensi dengan arsitektur yang sudah ada.
5. Simplicity / maintainability.
6. Performance.
7. UX.
8. Minimal perubahan yang diperlukan.

Pilih solusi yang paling aman dan backward-compatible.

Jika ada dua pilihan yang sama-sama valid, pilih yang paling sederhana, terdokumentasi, dan mudah di-maintain.

---

# 3. KEBIJAKAN CONNECTOR & EXTERNAL ACTION

Claude Code boleh menggunakan connector dan aksi eksternal yang tersedia tanpa meminta izin tambahan, selama tindakan tersebut relevan terhadap pekerjaan proyek.

Contoh aksi yang boleh dilakukan:

- GitHub/Git provider: inspect branch, commit history, PR, issues, file state, CI logs, dan melakukan perubahan yang diperlukan;
- Supabase/Postgres: inspect schema, run safe migration/query, inspect logs, validate data integrity;
- Vercel/deployment provider: inspect deployments, build logs, environment configuration, dan melakukan deployment jika dibutuhkan;
- Discord developer/application resources: memeriksa konfigurasi app, command configuration, scopes, permissions, interaction context, dan dokumentasi resmi;
- package registries/documentation: memverifikasi compatibility dan API usage;
- monitoring/logging provider yang tersedia;
- tool/connector lain yang secara teknis relevan.

## Aturan connector

- Gunakan sumber resmi terlebih dahulu untuk keputusan API/platform.
- Jangan menebak capability Discord jika dapat diverifikasi.
- Jangan mengarang nama endpoint, permission, field, event, atau behavior.
- Jika connector mengembalikan error, diagnosis dan coba jalur teknis lain yang valid.
- Jika sebuah connector tidak tersedia, lanjutkan dengan tool yang memang tersedia tanpa menganggap capability yang tidak ada.
- Jangan memindahkan secret ke source code.
- Jangan mencetak token, API key, password, private key, OAuth secret, atau credential sensitif ke output/log.

---

# 4. ATURAN DATA & KEAMANAN

Vanillate Match menangani data profile dan interaksi personal. Privacy adalah prioritas desain.

Data matchmaking harus **tidak ditampilkan ke channel publik**.

Informasi seperti berikut harus diproses secara private:

- foto/video profile;
- nama dan umur profile;
- lokasi profile;
- bio;
- Likes;
- Matches;
- preference;
- verification status;
- notification state;
- relationship/match state.

## Golden rule

**Server boleh menjadi entry point, tetapi bukan tempat publik untuk menampilkan data matchmaking.**

Gunakan ephemeral/private interaction bila user memulai flow dari server.

Jangan mengirim profile pengguna, daftar Likes, Match, atau personal matchmaking data ke channel publik.

---

# 5. USER INSTALL + GUILD INSTALL

Vanillate Match mendukung:

- **User Install** sebagai akses personal/berkelanjutan;
- **Guild Install** sebagai presence di server, entry point, engagement, dan growth surface.

## User Install

User wajib diarahkan untuk User Install agar hubungan user dengan aplikasi tidak bergantung pada keberadaan user di server tertentu.

Walaupun user sedang mutual dengan bot di guild, jangan menganggap guild membership sebagai pengganti User Install.

## Guild Install

Guild Install digunakan untuk:

- `/match` dari server dengan pengalaman private/ephemeral;
- `/invite`;
- `/server-settings`;
- `/help`;
- engagement server;
- acquisition/growth;
- optional notification relationship saat mutual guild tersedia.

## Jangan membuat asumsi yang salah

- User Install bukan jaminan unsolicited DM.
- Mutual guild bukan jaminan DM selalu berhasil.
- DM/privacy restriction harus ditangani secara graceful.
- Match tidak boleh gagal hanya karena notification DM gagal.

---

# 6. MATCHMAKING: SOURCE OF TRUTH

Discord hanya menjadi UI / interaction layer.

**Backend/database adalah source of truth.**

Jangan menjadikan ephemeral message, DM, atau state UI sebagai penyimpanan utama.

Arsitektur konseptual:

```text
Discord Interaction
        ↓
Application Services
        ↓
Match / Discovery Engine
        ↓
Database
```

Match harus tetap tersimpan walaupun:

- DM tidak terkirim;
- user keluar dari guild;
- ephemeral message hilang;
- Discord interaction selesai;
- user menutup Discord;
- notification delivery gagal.

---

# 7. FLOW UTAMA USER

## `/start`

Fungsi:

- onboarding;
- User Install;
- verification;
- setup profile;
- setup media;
- Friend Request readiness;
- aktivasi profile.

Profile tidak boleh aktif tanpa minimal satu media.

---

# 8. PROFILE

Profile harus clean.

Field utama:

```text
Nama
Umur
Lokasi
Bio
Media
Verification status
```

Jangan menambahkan metadata yang tidak diperlukan hanya agar profile terlihat penuh.

Hindari menampilkan:

- jumlah Likes;
- jumlah Match;
- statistik yang tidak diperlukan;
- informasi server;
- Discord technical metadata;
- data pribadi yang tidak perlu.

Verification badge dapat ditampilkan sebagai trust signal.

---

# 9. MEDIA PROFILE

Media adalah **WAJIB**.

Aturan final:

```text
Minimal media: 1

Pilihan A:
- maksimal 4 foto

Pilihan B:
- maksimal 1 video
```

Foto dan video **tidak boleh dicampur**.

Valid:

```text
1–4 foto
ATAU
1 video
```

Tidak valid:

```text
foto + video
video + video
lebih dari 4 foto
lebih dari 1 video
```

## Video

Target specification:

```text
Durasi maksimum: 14 detik
Format utama: MP4
Codec yang direkomendasikan: H.264
Resolusi target: <= 720p
Ukuran file internal yang disarankan: <= 15 MB
```

Tetap validasi terhadap capability/platform Discord saat implementasi.

Media yang melanggar limit harus ditolak secara jelas dan user diberi cara memperbaikinya.

---

# 10. DISCOVERY / SWIPE EXPERIENCE

User dapat menjalankan matchmaking dari:

- User Install/private app context;
- Guild Install dengan ephemeral/private interaction.

Profile kandidat **tidak boleh muncul ke channel publik**.

Flow dasar:

```text
/match
   ↓
Check new Likes / Matches
   ↓
If new activity exists:
   Show activity first
   ↓
Show profile
   ↓
Congrats message
   ↓
Next profile
   ↓
...
   ↓
Done
   ↓
ONLY [ Lanjutkan ]
   ↓
Normal Discovery / Match
```

Setelah daftar Like/Match baru selesai ditampilkan, **hanya tombol `Lanjutkan`** yang tersedia untuk meneruskan ke discovery.

---

# 11. LIKE → LIKE BACK → MATCH

Logic inti:

```text
A likes B

if B already likes A:
    create MATCH
else:
    save LIKE
```

Saat mutual like terjadi:

```text
A → B = LIKE
B → A = LIKE
        ↓
     MATCH
```

Match harus idempotent.

Jangan membuat duplicate match akibat:

- double click;
- retry interaction;
- webhook/event retry;
- worker restart;
- duplicate request.

Gunakan unique constraint / deterministic relationship key yang sesuai.

---

# 12. FLOW LIKES / MATCHES

Saat user menekan `Lihat Likes` atau saat `/match` mendeteksi Likes/Matches baru:

Tampilkan profile satu per satu.

Tidak ada tombol interaksi discovery di profile yang sudah masuk tahap ini.

Pattern:

```text
Profile #1
↓
Ucapan selamat
[ 👤 Lihat Profile ] [ 📖 Tutorial ]
↓
Profile #2
↓
Ucapan selamat
[ 👤 Lihat Profile ] [ 📖 Tutorial ]
↓
...
```

Profile kandidat/match harus tetap clean.

Tombol `Lihat Profile` membuka Discord profile pasangan.

Tombol `Tutorial` memberikan langkah Add Friend / Message Request.

---

# 13. MATCH MESSAGE / UX

Tone bahasa Indonesia harus:

- santai;
- ramah;
- mudah dimengerti semua kalangan;
- clean;
- tidak terlalu formal;
- tidak terlalu alay;
- tidak terlalu banyak emoji;
- tidak menggunakan jargon teknis kepada user.

Contoh gaya Match:

```text
💞 Yeay, kalian match!

Selamat! Kamu dan Raka berhasil saling menyukai.
Semoga kalian bisa menghabiskan waktu bersama dan menemukan banyak hal seru untuk dibicarakan. 😊

[ 👤 Lihat Profile ] [ 📖 Tutorial ]
```

Gunakan `kamu`, bukan `Anda`.

---

# 14. ADD FRIEND & TUTORIAL

Setelah Match, bot tidak perlu membuat chat internal penuh.

Tujuan utama:

```text
Match
 ↓
Profile
 ↓
Add Friend di Discord
 ↓
Chat di Discord
```

Tutorial harus step-by-step dan menjelaskan:

1. Tekan `Lihat Profile`.
2. Buka profile Discord pasangan.
3. Tekan `Add Friend`.
4. Jika perlu, cek Message Requests.
5. Setelah terhubung, lanjut chat di Discord.

Jangan mengklaim bot dapat membaca atau mengontrol DM user secara bebas.

---

# 15. FRIEND REQUEST READINESS

Sebelum matchmaking aktif, user perlu diarahkan untuk memastikan Friend Request mereka memungkinkan pasangan mengirim permintaan pertemanan.

Jika fitur tersebut diperlukan oleh UX yang sedang berjalan, berikan tutorial yang jelas.

Jangan menyembunyikan requirement penting.

---

# 16. AUTO LIKE NOTIFICATION

User dapat memiliki setting:

```text
🔔 Auto Like Notification
```

Untuk mengaktifkan fitur ini, project dapat menggunakan Community/MUTUAL GUILD relationship sebagai salah satu eligibility layer sesuai arsitektur produk.

Benefit yang dirancang:

```text
🔔 Auto Like Notification
🚀 +30% Profile Visibility
```

Gunakan wording **Profile Visibility**, bukan janji “30% lebih banyak Likes”.

Karena jumlah Likes tidak dapat dijamin.

---

# 17. COMMUNITY / SERVER CONNECTION

User dapat:

### Opsi A
Join Community resmi.

### Opsi B
Invite Vanillate Match ke server yang mereka kelola.

Tujuannya:

- membuat app/bot hadir di server;
- mendapatkan mutual guild relationship;
- membuka optional notification capability;
- mendapatkan growth/acquisition exposure;
- memberikan +30% Profile Visibility dan Auto Like Notification sesuai aturan produk.

## Server removal / leave

Jika bot keluar dari server atau user tidak lagi memenuhi community relationship:

- jangan hapus profile;
- jangan hapus Likes;
- jangan hapus Matches;
- jangan hapus account;
- pause benefit yang bergantung pada server relationship;
- simpan pending notification;
- recovery saat relationship kembali tersedia, jika sesuai aturan produk.

---

# 18. NOTIFICATION SYSTEM

Notification harus event-driven dan persistent.

Contoh event:

```text
LIKE_RECEIVED
MATCH_CREATED
```

Notification pipeline:

```text
Event
 ↓
Notification Service
 ↓
Eligibility Check
 ↓
Try Delivery
 ↓
Delivered / Pending / Failed
```

## DM bukan source of truth

Jika DM gagal:

```text
Match tetap dibuat.
Like tetap dibuat.
Notification tetap tersimpan.
```

## Jangan spam DM

Gunakan aggregation/deduplication.

Contoh:

```text
5 Like baru
1 Match baru
```

Lebih baik:

```text
❤️ Kamu punya 5 Like baru!
💞 Kamu juga punya 1 Match baru!

[ Lihat ]
```

daripada 6 DM berturut-turut.

## Recovery

Jika user kembali memiliki mutual guild relationship:

```text
Pending Notifications
 ↓
Deduplicate
 ↓
Aggregate
 ↓
Send summary
 ↓
Mark delivered
```

Gunakan idempotency key untuk mencegah duplicate notification.

---

# 19. GUILD INSTALL: SERVER EXPERIENCE

Guild Install bukan tempat menampilkan matchmaking data secara publik.

Command utama server:

```text
/match
/invite
/server-settings
/help
```

## `/match`

Harus private/ephemeral.

Pattern:

```text
/match
 ↓
Check new activity
 ↓
Show Like/Match profiles privately
 ↓
Only [ Lanjutkan ]
 ↓
Normal Match / Discovery
```

## `/invite`

Menampilkan link/informasi untuk mengundang Vanillate Match ke server lain.

## `/server-settings`

Hanya admin.

Hanya mengatur:

```text
Channel Vanillate Match
```

Pengaturan engagement lain menggunakan default/on sesuai product specification dan tidak perlu diekspos sebagai setting user.

## `/help`

Bantuan singkat penggunaan bot di server.

---

# 20. SERVER ENGAGEMENT

Setelah Guild Install, bot dapat menggunakan channel yang sudah dikonfigurasi admin untuk engagement ringan.

Jika channel belum dipilih, gunakan fallback yang aman sesuai implementation design, misalnya:

```text
1. Configured channel
2. #general jika valid
3. Channel yang memenuhi permission dan cocok untuk fallback
4. Jangan kirim jika tidak ada channel yang aman
```

Pesan engagement:

- ucapan selamat pagi;
- ucapan selamat malam;
- pesan random;
- CTA untuk membuka aplikasi.

Pesan tidak boleh menampilkan data personal matchmaking.

Jangan mempublikasikan:

- siapa yang Likes siapa;
- siapa sedang mencari siapa;
- profile pribadi;
- Match pribadi;
- jumlah Likes seorang user;
- data sensitif lainnya.

Tujuan server engagement adalah:

```text
Engagement
 ↓
CTA
 ↓
Open App
 ↓
Private Matchmaking
```

---

# 21. `/match` ADALAH ENTRY POINT UTAMA

Jangan membuat terlalu banyak command.

User commands final:

```text
/start
/match
/likes
/profile
/settings
/help
```

Server commands final:

```text
/match
/invite
/server-settings
/help
```

Discovery actions sebaiknya menggunakan button/modal, bukan command terpisah.

Jangan membuat command tambahan seperti:

```text
/like
/skip
/next
/unmatch
/addfriend
/chat
/setbio
/setphoto
/setvideo
```

kecuali ada kebutuhan teknis kuat yang terbukti lebih baik daripada button/modal.

---

# 22. DATABASE / DOMAIN MODEL

Gunakan model relational yang jelas.

Entitas inti minimal:

```text
users
profiles
profile_media
verification
preferences
likes
matches
blocks
reports
notifications
activity_events
server_connections
conversations (jika diperlukan)
```

Gunakan constraints/indexes untuk menjaga integrity.

Contoh prinsip:

- satu profile aktif per user;
- media type konsisten;
- max 4 photo ATAU 1 video;
- like relationship idempotent;
- match relationship unique;
- block mengalahkan discovery/match eligibility;
- report dapat diproses tanpa menghapus evidence;
- notification memiliki lifecycle state.

---

# 23. PRIVACY & DATA MINIMIZATION

Simpan hanya data yang benar-benar diperlukan.

Gunakan separation antara:

```text
Account identity
Match profile
Verification
Notification state
Relationship state
```

Jangan mengekspos raw database object ke Discord.

Jangan menaruh secret, credential, moderation evidence sensitif, atau internal score ke embed profile user.

---

# 24. SECURITY RULES

Claude Code harus proaktif mencari security issue yang berhubungan dengan perubahan.

Perhatikan terutama:

- IDOR / authorization bypass;
- user dapat melihat profile yang seharusnya tersembunyi;
- user dapat membaca Likes orang lain;
- user dapat mengakses Match milik user lain;
- duplicate likes/matches;
- race condition pada mutual like;
- spam interactions;
- notification flood;
- file upload abuse;
- oversized media;
- malicious filenames/content types;
- injection pada bio atau text;
- secret leakage;
- permissive API endpoint;
- insecure webhook validation;
- missing rate limits;
- privilege escalation admin/server settings.

Jika menemukan vulnerability yang jelas, perbaiki sebagai bagian dari pekerjaan tanpa menunggu task terpisah.

---

# 25. RACE CONDITION / CONCURRENCY

Matchmaking sangat sensitif terhadap race condition.

Contoh:

```text
A likes B
B likes A
A retries
B retries
Worker retries
```

Hasil akhir tetap harus:

```text
1 LIKE relation per direction
1 MATCH
```

Gunakan transaction / unique constraints / upsert / optimistic concurrency sesuai stack.

---

# 26. DISCORD INTERACTION RULES

Selalu perhatikan:

- interaction acknowledgement;
- response timing;
- follow-up vs initial response;
- ephemeral/private response;
- component custom IDs;
- stale buttons;
- expired interactions;
- duplicate clicks;
- permission differences antara guild/user install;
- command integration types;
- interaction contexts;
- bot permission checks.

Jangan mengandalkan UI state sebagai authorization.

Authorization harus diverifikasi kembali di backend.

---

# 27. STALE / INVALID UI

Semua button di Discord dapat menjadi stale.

Jika user menekan button dari session lama:

- jangan crash;
- jangan memproses target yang sudah tidak valid;
- berikan pesan yang ramah;
- arahkan user kembali ke state aktif.

Contoh:

```text
Sesi ini sudah tidak berlaku.
Yuk mulai lagi dari /match.
```

---

# 28. OBSERVABILITY

Tambahkan logging yang cukup untuk diagnosis tetapi tidak membocorkan data sensitif.

Event penting:

```text
PROFILE_CREATED
PROFILE_UPDATED
VERIFICATION_COMPLETED
DISCOVERY_VIEW
LIKE_CREATED
MATCH_CREATED
NOTIFICATION_CREATED
NOTIFICATION_DELIVERED
NOTIFICATION_FAILED
USER_INSTALL_DETECTED
GUILD_CONNECTED
GUILD_DISCONNECTED
```

Gunakan correlation/request ID bila tersedia.

Jangan logging full profile media, token, full message content yang sensitif, atau credential.

---

# 29. TESTING REQUIREMENTS

Setiap fitur baru minimal divalidasi dengan:

```text
Typecheck
Lint
Unit tests
Integration tests yang relevan
Build
```

Untuk perubahan matchmaking, tambahkan test kasus:

```text
A likes B
B likes A
A retries
B retries
Already matched
Block
Unblock
User leaves guild
User rejoins guild
DM available
DM unavailable
Notification pending
Notification recovery
Expired interaction
Double click button
```

Untuk media:

```text
1 photo
4 photos
5 photos -> reject
1 video
2 videos -> reject
photo + video -> reject
video duration >14s -> reject
invalid MIME -> reject
oversized file -> reject
```

---

# 30. DEPLOYMENT

Deployment harus diperlakukan sebagai bagian dari engineering, bukan langkah manual terpisah.

Sebelum deploy:

```text
Install/dependency integrity
Typecheck
Lint
Tests
Build
Migration status
Environment variable validation
Discord command registration/config validation
```

Setelah deploy:

```text
Check deployment status
Check logs
Check bot startup
Check command registration
Check database connectivity
Check critical endpoint/interaction
```

Jika deploy gagal:

1. baca log;
2. diagnosis;
3. perbaiki;
4. deploy ulang;
5. validasi.

---

# 31. MIGRATION SAFETY

Untuk perubahan database:

- gunakan migration yang deterministic;
- hindari silent destructive changes;
- tambahkan index/constraint yang diperlukan;
- validasi data existing bila schema berubah;
- gunakan transaction bila memungkinkan;
- jangan menghapus data production hanya untuk menyelesaikan error biasa;
- jika perlu perubahan destruktif, buat backup/recovery path terlebih dahulu bila infrastructure mendukung.

Tidak perlu meminta izin untuk migration yang aman dan diperlukan.

---

# 32. DEPENDENCY POLICY

Jangan menambahkan dependency hanya karena “bisa”.

Gunakan dependency baru jika:

- menyelesaikan kebutuhan nyata;
- lebih aman daripada custom implementation;
- lebih maintainable;
- atau diperlukan untuk compatibility.

Sebelum menambahkan library besar:

- periksa apakah dependency sudah ada;
- gunakan API native bila memadai;
- pilih package yang aktif dirawat;
- verifikasi compatibility dengan runtime/project.

---

# 33. CODE QUALITY

Prioritaskan:

- readability;
- explicit behavior;
- typed boundaries;
- small services/functions;
- clear domain logic;
- testable code;
- deterministic behavior;
- error handling.

Hindari:

- giant handler;
- hidden global state;
- duplicated business logic;
- magic constants tanpa alasan;
- silent catch;
- swallowing exceptions;
- UI-driven authorization.

---

# 34. BUG-FIX PHILOSOPHY

Jangan hanya menambal gejala jika akar masalah dapat ditemukan.

Gunakan pola:

```text
Reproduce
 ↓
Trace
 ↓
Identify Root Cause
 ↓
Fix
 ↓
Regression Test
 ↓
Validate
```

Jika bug ternyata berasal dari layer lain, perbaiki pada layer yang benar.

---

# 35. UX PRINCIPLES

Vanillate Match harus terasa seperti aplikasi sosial yang simple.

Tone:

```text
Santai
Ramah
Clean
Playful secukupnya
Tidak terlalu formal
Tidak terlalu alay
Tidak terlalu banyak emoji
```

Interaction principle:

```text
Few commands
More buttons
Clear next action
Private by default
No unnecessary friction
```

---

# 36. FINAL ACCEPTANCE CRITERIA

Task dianggap selesai hanya jika:

- implementasi sudah masuk repository;
- typecheck/lint/test/build relevan lolos;
- flow utama dapat dijalankan;
- error yang ditemukan sudah ditangani;
- tidak ada obvious regression;
- privacy behavior sesuai desain;
- User Install/Guild Install behavior tidak dicampur secara salah;
- match tetap aman jika DM gagal;
- notification tidak duplicate/spam;
- stale interactions tidak crash;
- database integrity tetap terjaga;
- dokumentasi diperbarui bila behavior berubah.

Jika ada blocker eksternal yang benar-benar tidak bisa diatasi dari sisi code/configuration, jelaskan **apa yang menjadi blocker, bukti error-nya, dan apa yang sudah dicoba**. Jangan hanya mengatakan “tidak bisa”.

---

# 37. KOMITMEN KERJA CLAUDE CODE

Saat mengerjakan Vanillate Match:

> **Jangan berhenti di tengah jalan hanya karena menemukan masalah teknis. Cari akar masalah, lakukan perbaikan yang diperlukan, gunakan tool/connector yang tersedia, validasi hasilnya, dan lanjutkan sampai task benar-benar selesai.**

> **Prioritaskan keamanan, privacy, data integrity, Discord compatibility, lalu UX dan maintainability.**

> **Jangan meminta izin untuk pekerjaan teknis rutin. Gunakan judgement engineering dan dokumentasikan keputusan penting setelah pekerjaan selesai.**

> **Jangan mengorbankan privacy matchmaking hanya demi kemudahan implementasi.**

> **Jika solusi sederhana dan aman tersedia, pilih solusi tersebut.**
