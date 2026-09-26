# Cosmos WhatsApp Bot Commands Context & Knowledge Base

Dokumen ini berisi panduan lengkap, mendalam, dan terstruktur mengenai seluruh perintah (commands) dan fitur yang tersedia di Cosmos WhatsApp Bot Framework. Dokumen ini dirancang sebagai basis pengetahuan (ground-truth context) bagi AI Assistant (Sara) agar dapat memberikan jawaban dan panduan yang akurat, terperinci, dan tanpa halusinasi kepada pengguna.

---

## 1. Media & Stickers (Stiker & Media)

### `.brat` (Brat Sticker Generator)

- **Fungsi:** Membuat stiker teks atau stiker teks animasi bergaya album "Brat" (latar hijau limau dengan teks buram khas).
- **Aliases:** `.brat`, `.bratanimasi`, `.bratanimated`, `brat animasi`, `brat animated`
- **Format Dasar (Statis):**
    - `.brat <teks>` — Menghasilkan stiker statis (.webp 512x512).
    - Contoh: `.brat Hello World`
- **Format Animasi:**
    - Perintah animasi otomatis dipicu jika diawali dengan kata `animasi` / `animated`, alias `.bratanimasi` / `.bratanimated`, atau flag `-a` / `--animated` / `--animasi`.
    - Contoh: `.brat animated Hello World` atau `.brat animasi Halo Dunia`
- **Pengaturan Jeda Animasi (Dash Delay):**
    - Menggunakan flag `-d <ms>` atau `-d=<ms>` (rentang: 50 ms – 5000 ms, default: 500 ms).
    - Contoh: `.brat animated -d 250 Hello World`
    - Contoh unit suffix: `.brat animated -300ms Hello World` atau `.brat animasi -400 Halo Dunia`
    - Contoh prefix delay: `.brat animasi 300 Halo Dunia` atau `.brat animated 1000 Hello World`
- **Disambiguasi Teks Harfiah (Menulis "animasi" tanpa menganimasikan):**
    - Jika pengguna ingin membuat stiker teks yang mengandung kata "animasi" atau "animated" secara statis, bungkus teks dengan tanda kutip ganda `"..."`, tanda kutip tunggal `'...'`, atau monospace WhatsApp `...` / `` `...` ``.
    - Contoh: `.brat "animasi keren"` atau `.brat ```animasi keren``` ` atau `.brat `animasi keren``
    - Atau gunakan flag static: `.brat animasi keren -s` atau `.brat animasi keren --static`
- **Membalas Pesan (Quoted):**
    - Balas pesan teks apa saja dengan `.brat` untuk membuat stiker dari pesan tersebut, atau balas dengan `.brat animated -d 300` untuk versi animasi.
- **Bantuan / Tutorial:**
    - Mengetik `.brat` saja tanpa teks akan memunculkan kartu tutorial lengkap mengenai penggunaan parameter.

### `.sticker` / `.s` / `.stiker` (Sticker Maker)

- **Fungsi:** Mengonversi gambar, video pendek (maksimal 5 detik), atau GIF menjadi stiker WhatsApp WebP 512x512 berkualitas tinggi.
- **Aliases:** `.sticker`, `.s`, `.stiker`
- **Penggunaan:** Kirim media gambar/video/GIF dengan caption `.s` atau balas pesan media tersebut dengan mengetik `.s`.
- **Batasan:** Ukuran media maksimal 15 MB. Durasi video ideal di bawah 5 detik.

### `.stickerly` / `.spack` (Sticker.ly Pack Exporter)

- **Fungsi:** Mencari paket stiker di platform Sticker.ly atau mengekspor paket stiker langsung ke WhatsApp melalui tautan URL.
- **Aliases:** `.stickerly`, `.spack`, `.stickerpack`
- **Penggunaan:**
    - Pencarian: `.stickerly anime` lalu pilih nomor stiker yang ingin diunduh.
    - Tautan Langsung: `.stickerly https://sticker.ly/s/XXXXXX`
- **Pembatalan:** Ketik `.cancel` saat dalam sesi pemilihan stiker untuk membatalkan antrean.

---

## 2. Personal Contact Book & Zero-Knowledge Messaging (Kontak & Delegasi Pesan)

### `.contact` / `.kontak` (Personal Contact Manager)

- **Fungsi:** Mengelola buku telepon pribadi pengguna secara terisolasi (per-user). Nomor telepon disimpan dengan enkripsi AES-256-GCM zero-knowledge sehingga nomor asli aman dan tidak pernah terekspos secara mentah ke model AI.
- **Aliases:** `.contact`, `.kontak`
- **Sub-commands:**
    - **Tambah Kontak:** `.contact add <alias> <nomor_telepon>`
        - Jika alias memiliki spasi, wajib menggunakan monospace WhatsApp atau kutipan: `.contact add `Ls Friends` 6281234567890` atau `.contact add "Budi Kantor" 0812345678`.
    - **Daftar Kontak:** `.contact list` (menampilkan daftar nama alias dan nomor telepon yang disamarkan seperti `62812****7890`).
    - **Hapus Kontak:** `.contact del <alias>` (contoh: `.contact del Mom` atau `.contact del `Ls Friends``).
- **Integrasi dengan Sara AI:**
    - Setelah kontak tersimpan, pengguna bisa meminta Sara mengirim pesan atau lokasi tanpa menyebut nomor telepon:
        - Contoh: `.sara tolong kabari Mom bahwa saya akan pulang terlambat`
        - Contoh: `.sara tolong kirim pesan ke Ls Friends: besok kumpul jam 7 malam ya`

---

## 3. Economy & Banking (Cosmos Central Bank / CCB & Pasar)

### `.bank` / `.atm` (Cosmos Central Bank)

- **Fungsi:** Sistem perbankan resmi Cosmos berbasis pembukuan ganda ACID (double-entry ledger) untuk simpan pinjam, mutasi, dan transfer antar-pengguna.
- **Prasyarat:** Wajib memiliki Virtual ID Card / KTP (`.register id`).
- **Sub-commands:**
    - Buka Rekening: `.bank register` atau `.bank daftar` (otomatis membuka rekening tabungan bank dengan saldo awal).
    - Cek Saldo & Mutasi: `.bank balance`, `.bank saldo`, atau `.bank statement`.
    - Setor Tunai (Deposit): `.bank deposit <jumlah>` atau `.bank setor <jumlah>` (memindahkan koin dari dompet tunai ke rekening bank).
    - Tarik Tunai (Withdraw): `.bank withdraw <jumlah>` atau `.bank tarik <jumlah>` (memindahkan uang dari bank ke dompet tunai).
    - Transfer Antar-Rekening: `.bank transfer <no_rekening_tujuan> <jumlah>` (membutuhkan konfirmasi interaktif 3 menit, dapat dibatalkan dengan `.cancel`).

### `.loan` / `.pinjam` (AI Credit Risk & Underwriting Loan)

- **Fungsi:** Pengajuan pinjaman bank yang dinilai secara otomatis oleh underwriting AI berdasarkan reputasi kredit (0-1000 poin), skor aktivitas, dan agunan aset.
- **Prasyarat:** Memiliki KTP dan rekening Cosmos Central Bank.
- **Sub-commands:**
    - Cek Skor Kredit & Batas Pinjaman: `.loan check` atau `.loan score`.
    - Ajukan Pinjaman: `.loan apply <jumlah>` (contoh: `.loan apply 10.000.000`).
    - Bayar Pinjaman: `.loan pay [jumlah]` atau `.loan repay all`.
    - Status Pinjaman Aktif: `.loan status`.
- **Konsekuensi Default:** Jika melewati jatuh tempo (7-30 hari), rekening akan dibekukan (`FROZEN`) dan aset inventaris disita otomatis.

### `.shop` / `.store` (Cosmos General Store)

- **Fungsi:** Membeli perlengkapan kerja, lisensi, peralatan, atau properti untuk meningkatkan efisiensi ekonomi.
- **Penggunaan:** `.shop` untuk melihat katalog kategori atau `.shop <kategori>` (misal: `.shop tool`, `.shop property`).

### `.shop buy` (Beli Item)

- **Fungsi:** Membeli item atau properti menggunakan saldo kasino/tunai.
- **Penggunaan:** `.shop buy <short_id_atau_nama_item> [jumlah]`. Contoh: `.shop buy cangkul 1`.

### `.property inventory` / `.inventory` / `.inv` / `.bag` (Inventaris Pengguna)

- **Fungsi:** Menampilkan seluruh aset, peralatan kerja, kendaraan, dan properti yang dimiliki oleh pengguna beserta status kepemilikannya (`Owned` / `Pawned`).

### `.property sell` (Jual / Gadai Properti & Item)

- **Fungsi:** Menjual properti atau menggadaikannya kembali ke bank dengan sistem negosiasi AI.
- **Penggunaan:** `.property sell <nama_properti>`.

### `.market` / `.economy` & `.forceupdate`

- **Fungsi:** Memeriksa laju inflasi global, suku bunga bank, dan pengali ekonomi makro (`EconomyMultiplier`). `.forceupdate` khusus untuk pemilik bot untuk menyinkronkan ekonomi.

---

## 4. Employment & Careers (Sistem Pekerjaan & Gaji)

### `.register id` / `.check id` (Virtual ID Card / KTP)

- **Fungsi:** Pendaftaran identitas warga digital Cosmos yang menjadi syarat mutlak untuk bekerja, membuka rekening bank, mengajukan pinjaman, dan membeli SIM.
- **Penggunaan:**
    - Pendaftaran: `.register id` (alur interaktif verifikasi NIK, nama lengkap, tanggal lahir, dan foto identitas).
    - Cek Kartu: `.check id` (menampilkan kartu KTP digital visual).
- **Pembatalan:** Ketik `.cancel` kapan saja selama proses registrasi.

### `.apply license` / `.sim` (Surat Izin Mengemudi Virtual)

- **Fungsi:** Mengajukan SIM A, B, atau C untuk pekerjaan yang membutuhkan kendaraan (misal: supir taksi, kurir, masinis).
- **Penggunaan:** `.apply license A` atau `.sim A`. Memerlukan usia >= 17 tahun pada KTP.

### `.apply job` / `.job` (Bursa Kerja Digital)

- **Fungsi:** Melihat lowongan pekerjaan yang tersedia, melihat persyaratan item/SIM, dan melamar pekerjaan.
- **Penggunaan:**
    - Daftar lowongan: `.job`
    - Lamar pekerjaan: `.job apply <nama_pekerjaan>` atau `.lamar kerja <nama_pekerjaan>` (contoh: `.job apply barista`).

### `.work` / `.shift` / `.kerja` (Shift Kerja)

- **Fungsi:** Menjalankan shift kerja untuk mendapatkan gaji (disesuaikan dengan pengali inflasi ekonomi). Memiliki cooldown shift antar-pekerjaan.
- **Penggunaan:** `.work`.

---

## 5. Casino & Games (Kasino & Minigame)

### Saldo & Hadiah

- `.balance` / `.bal` / `.saldo`: Cek saldo koin kasino sendiri atau pengguna lain (`.balance @user`).
- `.daily claim` / `.claim`: Mengklaim hadiah koin kasino harian (reset tiap 24 jam).
- `.transfer` / `.tf`: Mentransfer koin kasino tunai ke pengguna lain (contoh: `.transfer @user 50000`).
- `.top` / `.topglobal`: Peringkat kekayaan kasino di grup atau secara global.
- `.vault`: Memeriksa cadangan brankas bandar (House Vault).

### Permainan Kasino

- `.coinflip <heads/tails> <taruhan>`: Lempar koin keberuntungan (contoh: `.coinflip heads 100.000` atau `.coinflip tails all`).
- `.dice <tebakan_angka_1-6> <taruhan>`: Tebak dadu 6 sisi dengan pengali kemenangan tinggi (contoh: `.dice 6 50.000`).
- `.slot <taruhan>`: Mesin slot klasik 3-reel (contoh: `.slot 100.000` atau `.slot all`).
- `.fevertime`: (Khusus Owner) Mengaktifkan mode demam kasino 15 menit dengan bonus payout berlipat ganda.

### Buckshot Roulette

- Permainan duel shotgun bergiliran dengan peluru sungguhan (live) dan peluru hampa (blank).
- **Alur Perintah:**
    1. `.create game` — Membuat ruang permainan baru di grup.
    2. `.bet <jumlah>` — Memasang taruhan meja.
    3. `.join game` — Bergabung ke sesi yang menunggu lawan.
    4. `.start game` — Memulai pertandingan.
    5. `.shoot <self/opponent>` — Menembak diri sendiri atau lawan.
    6. `.use <nama_item>` — Menggunakan item taktis (kaca pembesar, gergaji, bir, rokok, borgol).
    7. `.cancel` — Membatalkan sesi permainan sebelum dimulai.

---

## 6. Downloaders & Media Tools (Pengunduh Media)

- `.tiktok dl` / `.tiktok <url>`: Mengunduh video TikTok tanpa tanda air (watermark) atau format audio MP3.
- `.yt dl` / `.yt <url>`: Mengunduh video atau audio YouTube menggunakan mesin `yt-dlp`.
- `.play <judul_lagu>`: Mencari lagu di YouTube Music dan mengunduh format audio langsung ke obrolan.
- `.pinterest dl` / `.pin <url>`: Mengunduh gambar, karusel foto, atau video pendek dari Pinterest.
- `.telegram dl` / `.tg <url>`: Mengunduh media dari postingan saluran publik Telegram atau saluran privat yang telah didaftarkan.
- `.tg add`, `.tg del`, `.tg list`: Mendaftarkan atau mengelola sesi grup privat Telegram untuk proksi pengunduhan media bot.

---

## 7. AI, Speech & Utilities (Asisten AI & Alat Bantu)

### `.sara` / `.ai` (Sara AI Personal Assistant)

- **Fungsi:** Berinteraksi langsung dengan persona cerdas Sara untuk konsultasi, informasi, pengiriman pesan delegasi, atau bantuan fitur Cosmos.
- **Penggunaan:** `.sara <pertanyaan/instruksi>` (contoh: `.sara jelaskan cara pakai fitur brat` atau `.sara tolong ingatkan saya besok pagi`).

### `.stt` / `.ptt` (Speech-to-Text Transcription)

- **Fungsi:** Mentranskripsikan pesan suara (voice note/audio) yang dibalas menjadi teks menggunakan Groq Whisper AI.
- **Penggunaan:** Balas pesan suara (voice note) dengan mengetik `.stt`.

### `.quoted` / `.q` (Quoted Message Forwarder)

- **Fungsi:** Mengambil dan meneruskan pesan asli yang dikutip oleh orang lain jika pesan tersebut tersembunyi atau terlalu jauh di atas riwayat chat.
- **Penggunaan:** Balas pesan yang mengutip pesan lain dengan mengetik `.q`.

### `.rvo` / `.readviewonce` (Reveal View-Once Media)

- **Fungsi:** Membuka pesan sekali lihat (view-once photo/video/audio) dan mengirimkannya kembali agar dapat disimpan.
- **Penggunaan:** Balas pesan sekali lihat dengan `.rvo`.

### `.profile photo` / `.getprofilephoto` / `.pp` (Profile Photo Fetcher)

- **Fungsi:** Mengambil foto profil resolusi penuh milik diri sendiri atau pengguna lain yang dimention/dibalas. Foto akan dihapus otomatis setelah 10 detik untuk menjaga privasi.

### `.toggle autocorrect` / `.toggleautocorrection` (AI Typo Corrector)

- **Fungsi:** Mengaktifkan atau menonaktifkan fitur koreksi otomatis salah ketik (typo) berbasis AI di grup atau obrolan.

### `.toggle offline ai` / `.toggleofflineai` (Offline AI Responder)

- **Fungsi:** Menyalakan asisten AI santai yang merespons pesan secara alami saat bot dalam mode offline.

---

## 8. Sub-Bot, Multi-Device & Account Management (Jadibot)

### `.subbot` / `.jadibot` (Sub-Bot Cloning & Management)

- **Fungsi:** Mengkloning bot ke nomor WhatsApp pribadi pengguna melalui kode pairing (Pairing Code) Baileys dengan database SQLite terisolasi.
- **Penggunaan:**
    - Pairing: `.subbot pair <nomor_wa> code` (contoh: `.subbot pair 6281234567890 code`).
    - Hentikan Sub-Bot: `.subbot stop`
    - Periksa Status: `.subbot status`
- **Pembatalan:** Ketik `.cancel` selama masa tunggu pairing code untuk membatalkan koneksi secara aman.

### `.config` (Sub-Bot Custom Configuration)

- **Fungsi:** Mengatur API key pribadi (Groq, OpenRouter), persona AI, dan fitur sub-bot agar mandiri dari bot induk.

### `.my plan` / `.myplan` / `.my quota` (Subscription & Quota)

- **Fungsi:** Memeriksa sisa kuota harian, status langganan VIP/Premium, dan batas pengunduhan media.

---

## 9. System, Help & Administration (Bantuan & Administrasi)

### `.menu` / `.help` (Navigasi Sistem & Bantuan)

- **Fungsi:** Menampilkan katalog navigasi utama, daftar kategori, atau rincian spesifik satu perintah.
- **Penggunaan:**
    - Menu Utama: `.menu` atau `.help`
    - Semua Perintah: `.allmenu` atau `.menu all`
    - Bantuan Perintah Tertentu: `.help <nama_perintah>` (contoh: `.help brat`, `.help bank`).

### `.set lang` / `.set group lang` (Pengaturan Bahasa)

- **Fungsi:** Mengubah preferensi bahasa pengguna (DM) atau grup antara Bahasa Indonesia (`id`) dan Bahasa Inggris (`en`).
- **Penggunaan:** `.set lang en`, `.set lang id`, `.set group lang id`, `.set group lang en`.

### `.cancel` / `.batal` / `.abort` (Global Cancellation)

- **Fungsi:** Membatalkan alur multi-langkah interaktif apa pun yang sedang berlangsung (pendaftaran KTP, transfer bank, lobby kasino, pairing sub-bot, atau ekspor stiker).

### `.group add` / `.group del` / `.whitelist all` / `.whitelist` (Group Authorization - Owner/Admin)

- **Fungsi:** Mendaftarkan grup obrolan agar bot diizinkan merespons perintah di grup tersebut.

---

## 10. Panduan Respons Sara AI Berdasarkan Konteks Ini

Saat pengguna menanyakan cara penggunaan suatu fitur kepada Sara (misalnya: _.sara bagaimana cara membuat stiker brat?_ atau _.sara apa itu central bank?_), Sara **WAJIB**:

1. Menjelaskan secara ringkas, luwes, dan akurat sesuai fakta yang tercantum di dalam dokumen ini tanpa mengarang parameter fiktif.
2. Menyertakan contoh sintaks perintah yang konkret dan dapat langsung disalin oleh pengguna (misal: `.brat animated -d 300 Hello World` atau `.brat "animasi keren"`).
3. Jika perintah memiliki prasyarat (seperti Bank atau Pinjaman yang memerlukan KTP via `.register id`), beri tahu pengguna dengan ramah.
