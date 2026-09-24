---
name: cosmos-agent-engine
description: >
    Panduan baku arsitektur dan implementasi CosmosAgentEngine: runtime eksekusi AI tool deterministik dan aman untuk Groq Provider, mencakup dual-LLM pipeline, zero-knowledge contact privacy, self-healing interceptor, konfirmasi interaktif, dan remote location delegation.
---

# CosmosAgentEngine Architecture & Operational Standards

Dokumen ini adalah standar operasional dan panduan arsitektur baku untuk **CosmosAgentEngine**, runtime eksekusi tool AI yang aman, deterministik, dan zero-knowledge pada Cosmos WhatsApp Bot framework (`src/services/agentEngine/`).

---

## 1. Arsitektur Dual-LLM (Two-Tier Guidance + Execution Pipeline)

CosmosAgentEngine memisahkan perencanaan intent dari eksekusi tool untuk mencegah halusinasi parameter dan menghemat Token-Per-Minute (TPM) provider Groq:

```
+-----------------------------------------------------------------------------------+
|                        Inbound WhatsApp Message Event                             |
|  - Command Entrypoint: .sara <prompt> / .ai <prompt>                              |
|  - Conversational Entrypoint: Natural DMs / Group Mentions via Offline AI         |
+-----------------------------------------------------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|               TIER 1: GUIDANCE & PLANNING LLM (Small-Parameter)                   |
|                   Model: llama-3.1-8b-instant -> openai/gpt-oss-20b               |
|                   Prompt: buildSaraGuidancePrompt(promptCtx)                      |
|                                                                                   |
|  1. Menganalisis intent eksplisit pengguna (<300ms).                              |
|  2. Memetakan alias informal ("Mom") -> synthetic nonce token ("contact_ref_...").|
|  3. Memilih candidate tool tunggal (atau primaryTool: null jika obrolan santai). |
|  4. Menghasilkan Guidance Brief terstruktur via Groq JSON Mode.                   |
+-----------------------------------------------------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                    TypeScript Code-Enforced Policy Gate                           |
|  - Memverifikasi izin caller terhadap ToolAiPolicy & Role-Based Access Control.   |
|  - Membuang teks bebas Tier 1; meneruskan hanya parameter tervalidasi skema.      |
|  - Menginjeksikan HANYA skema tool kandidat (1 tool max) ke Tier 2.               |
+-----------------------------------------------------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                TIER 2: EXECUTION & SYNTHESIS LLM (High-Parameter)                 |
|                   Model: llama-3.3-70b-versatile -> openai/gpt-oss-120b           |
|                   Prompt: buildSaraPersonaPrompt(promptCtx)                       |
|                                                                                   |
|  - Menjalankan Native Tool Calling dengan parameter presisi tinggi.              |
|  - Groq Self-Healing Interceptor: Menyelamatkan error tool_use_failed             |
|    dengan validasi ulang mutlak pada Policy Gate sebelum dieksekusi.              |
|  - Mensintesis respon akhir yang elegan, ramah, dan santun (Sara Persona).        |
+-----------------------------------------------------------------------------------+
```

---

## 2. Zero-Knowledge Personal Contact Security (Ephemeral Nonces)

1. **Prinsip Nol-Eksposur:** Nomor telepon mentah pengguna pribadi (Ibu, Ayah, kerabat) **DILARANG KERAS** diekspos ke dalam prompt LLM Tier 1 maupun Tier 2.
2. **128-Bit Ephemeral Nonces:** Setiap kontak dipetakan menjadi token acak kriptografis di server RAM (`contact_ref_${crypto.randomBytes(16).toString('hex')}`).
3. **Bound to Caller:** Token hanya valid untuk `callerJid` yang memintanya; upaya resolusi oleh pengguna lain (`userB`) otomatis ditolak sebagai pelanggaran keamanan.
4. **Capability Scoping:** Setiap token memiliki batasan izin tool (`allowedTools: Set<string>`).
5. **RAM Protection & LRU Eviction:** Tokon store dibatasi maksimal 10.000 token server-wide dan 10 token per pengguna dengan TTL efemeral 3 menit.
6. **Enkripsi At-Rest:** Nomor telepon kontak disimpan di database SQLite pada tabel `UserContactBook` menggunakan enkripsi AES-256-GCM via `encryptString()` / `decryptString()`.

---

## 3. Matriks Kebijakan Tool (Tool Classification & RBAC)

Semua perintah dan tool AI dikelompokkan secara ketat pada `ToolAiPolicy`:

| Policy Tier               | Tools                                                                                                                                                                | Penanganan                                                                             |
| :------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------- |
| **DENIED**                | `addbalance`, `forceupdate`, `config`, `subbot`, `idcard`, `cancel`, `tgadd`, `tgdel`, `tgpair`, `roulette_*`, `slot`, `coinflip`, `dice`, `setlang`, `setgrouplang` | Dilarang dipanggil oleh AI. Otomatis difilter dari Tier 2 dan ditolak secara graceful. |
| **READ_ONLY**             | `get_balance`, `system_info`, `market`, `property_catalog`, `property_inventory`, `myplan`, `vault`, `top`, `help`, `menu`                                           | Kueri data idempoten; langsung dieksekusi tanpa risiko mutasi state.                   |
| **UTILITY**               | `send_message`, `send_location`, `stt`, `sticker_maker`, `stickerly`, `pinterestdl`, `tiktokdl`, `ytdl`, `play`, `quoted`, `readviewonce`                            | Utilitas media dan pengiriman pesan via WhatsApp socket native.                        |
| **CONFIRMATION_REQUIRED** | `transfer`, `bank_action` (withdraw/transfer), `property_buy`, `property_sell`, `loan`, `shop`                                                                       | Memutasi saldo atau aset; wajib melalui staging 2-fase `.confirm` / `.cancel`.         |

---

## 4. Konfirmasi Interaktif & Perlindungan TOCTOU (`AgentConfirmationManager`)

1. **Staging Tertunda:** Setiap aksi mutasi state diverifikasi dan didaftarkan ke `AgentConfirmationManager` dan `cancellationManager`.
2. **Pencocokan Identitas Pengguna:** Hanya pengguna asli (`userJid` atau `userLid`) yang dapat mengonfirmasi aksi dengan mengetik `.confirm`, `confirm`, `.ya`, atau `ya`. Pengguna lain dalam grup yang mencoba mengonfirmasi akan otomatis ditolak.
3. **Eksekusi Atomik Database:** Fungsi eksekusi `execute()` tidak mengandalkan saldo cache, melainkan mengeksekusi langsung di dalam `prisma.$transaction` untuk mencegah _Time-of-Check to Time-of-Use_ (TOCTOU).
4. **Dukungan Pembatalan Global:** Pengguna dapat membatalkan aksi kapan saja dengan mengetik `.cancel`.

---

## 5. Delegasi Lokasi Jarak Jauh (Remote Location Forwarding — "shareloc")

1. **Mode A (Quoted Location):** Jika perintah `.sara please send this location to Mom` mengutip pesan lokasi WhatsApp yang sudah ada, engine langsung mengekstraksi koordinat dan mengirimkan lokasi ke Mom beserta teks atribusi:
    ```text
    "${senderName} sent this from a different number — Sara AI"
    ```
2. **Mode B (Interactive Multi-Step Staging):** Jika tidak ada lokasi yang dikutip, engine mendaftarkan sesi lokasi interaktif selama 3 menit. Sara meminta pengguna membagikan pin lokasi. Saat pesan lokasi berikutnya tiba, `processLocationForwarding` mencegat koordinat, mendetokenisasi JID Mom di RAM, mengirim pin lokasi dan atribusi ke Mom, serta mengonfirmasi pengiriman ke pengguna.

---

## 6. Sanitasi & Normalisasi Nomor Telepon Internasional (`src/utils/phone.ts`)

1. **Multi-Token Spaced Parsing:** Perintah `.contact add <alias> <phoneNumber>` menggabungkan seluruh sisa token (`parts.slice(2).join(' ')`), sehingga nomor berjarak seperti `+94 77 837 0112` terbaca utuh.
2. **Scrubbing Karakter:** Menghapus seluruh karakter non-angka (`\s`, `-`, `()`, `+`, `.`, dll.).
3. **Standarisasi Internasional & Lokal:**
    - Mempertahankan kode negara E.164 saat tanda `+` dihilangkan (`+94 77 837 0112` $\rightarrow$ `94778370112`).
    - Mengubah awalan lokal Indonesia `0...` menjadi `62...` (`081234567890` $\rightarrow$ `6281234567890`).
    - Memperbaiki salah ketik awalan ganda `6208...` menjadi `628...`.
    - Menghapus kode keluar internasional `00...` (`0094...` $\rightarrow$ `94...`).
4. **Validasi Panjang E.164:** Memastikan panjang digit valid antara 10 hingga 15 digit sebelum disimpan ke database.

---

## 7. Dynamic Model Fallback Chain & Caching

Jika Groq mengembalikan status 404 (`model_not_found`) atau 400 (`model_decommissioned`), engine secara otomatis mencoba kandidat berikutnya:

- **Tier 1 (Planning):** `process.env.AGENT_GUIDANCE_MODEL` $\rightarrow$ `llama-3.1-8b-instant` $\rightarrow$ `openai/gpt-oss-20b` $\rightarrow$ `qwen/qwen3.8-27b`.
- **Tier 2 (Execution):** `process.env.AGENT_EXECUTOR_MODEL` $\rightarrow$ `llama-3.3-70b-versatile` $\rightarrow$ `openai/gpt-oss-120b` $\rightarrow$ `qwen/qwen3.8-27b` $\rightarrow$ `openai/gpt-oss-20b`.
- **Active Model Caching:** Model yang berhasil di-cache di memori agar request berikutnya tidak mengalami overhead pencarian 404.
