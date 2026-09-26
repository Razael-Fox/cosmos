---
name: laya-ai-decision-engine
description: >
    Panduan baku integrasi dan standar keamanan Laya AI Decision Engine (System One) pada Cosmos API Gateway dan Bot Services, mencakup endpoint typed /intent dan /loan, zero-knowledge PII sanitization, circuit breaker, rate limiting, dan dual-gate safety.
---

# Laya AI Decision Engine (System One) Integration Standards

Dokumen ini adalah standar operasional dan panduan arsitektur baku untuk integrasi model keputusan non-autoregresif **Laya AI (System One)** ke dalam ekosistem Cosmos (API Gateway di `.worktrees/api/` dan Bot Engine di `src/`).

---

## 1. Konsep & Arsitektur Utama

Laya AI adalah model keputusan non-autoregresif (arsitektur System One) yang memproses state teks dan sekumpulan pertanyaan terstruktur dalam satu kali _forward pass_. Berbeda dari LLM generatif bertipe token-by-token (Groq SDK), Laya mengembalikan skor probabilitas terkalibrasi dan pilihan diskret (`choice`, `score`, `noul`) dengan latensi rendah.

```
+-----------------------------------------------------------------------------------+
|                           Cosmos Bot Engine (src/)                                |
|  - Inbound prompt: .sara / .ai / conversational flow                             |
|  - Zero-Knowledge PII Sanitization (Rule AB):                                    |
|    * JIDs & phone numbers -> [MASKED_JID], [MASKED_PHONE]                         |
|    * Currency amounts -> [MASKED_AMOUNT]                                          |
|    * Aliases -> Ephemeral RAM nonces ("contact_ref_...", "group_ref_...")         |
+-----------------------------------------------------------------------------------+
                                          |
                                          | HTTP POST (Internal IPC secret / JWT)
                                          v
+-----------------------------------------------------------------------------------+
|                       Cosmos API Gateway (.worktrees/api/)                        |
|  - Routes: /api/v1/decision/intent & /api/v1/decision/loan                        |
|  - Zod Schema Validation (Strictly no generic unvalidated /raw proxy)             |
|  - Rate Limiter: Per-caller sliding window throttle                               |
|  - Circuit Breaker: 3s hard timeout (AbortSignal.timeout(3000)), 60s cooldown     |
+-----------------------------------------------------------------------------------+
                                          |
                                          | JSON { model, state, questions }
                                          v
+-----------------------------------------------------------------------------------+
|               Upstream Laya Inference (zaitlabs / Modal / v1/systemone)           |
|  Single forward pass returning structured answers, choices, and probabilities     |
+-----------------------------------------------------------------------------------+
```

---

## 2. Prinsip Keamanan Wajib (Mandatory Security Guards)

### A. Zero-Knowledge Tokenization (Rule AB)

Penyedia inference pihak ketiga dapat menyimpan log request untuk pelatihan model masa depan. Oleh karena itu:

- **DILARANG KERAS** mengirimkan nomor telepon asli (`+62...`, `08...`), JID pengguna WhatsApp (`...@s.whatsapp.net`, `...@g.us`, `...@lid`), atau nominal saldo rekening mentah ke dalam payload `state`.
- **Wajib Sanitasi Terpusat:** Gunakan `DecisionClient.sanitizeUntrustedContent()` untuk menutupi informasi pribadi (PII) dan mengganti alias target obrolan dengan ephemeral token RAM nonces sebelum request keluar.

### B. Larangan Open Relay & Route `/raw`

- **Dilarang Mengekspos Rute Proksi Generic `/raw`:** Segala bentuk endpoint tanpa validasi skema ketat dilarang pada API gateway publik guna mencegah eksploitasi Server-Side Request Forgery (SSRF) dan penyalahgunaan kuota upstream.
- **Validasi Zod Eksklusif:** Setiap rute keputusan wajib memiliki skema Zod eksplisit (`IntentRequestSchema`, `LoanRequestSchema`).

### C. Circuit Breaker & Fallback Bertingkat

- **Batas Waktu Maksimal 3 Detik:** Panggilan upstream wajib dibatasi dengan `AbortController` berdurasi maksimal `3000ms`.
- **Circuit Breaker Cooldown:** Bila upstream mengalami kegagalan (status HTTP >= 400 atau timeout), sirkuit dibuka (_open circuit_) selama 60 detik untuk mencegah penumpukan request antrean pada bot loop.
- **Graceful Fallback:**
    - Intent classification: Jatuh tempo ke analisis kata kunci lokal deterministik atau Tier 1 Groq Guidance Planner.
    - Loan underwriting: Jatuh tempo ke Native Function Calling Groq LLM atau batasan reputasi deterministik `getCreditTier`.

### D. Dual-Gate Code-Enforced Safety

Hasil keputusan Laya hanya berperan sebagai **sinyal rekomendasi (advisory signal)**, BUKAN penentu mutlak yang dapat langsung mengubah basis data:

- Semua rekomendasi pinjaman tetap dibatasi secara ketat oleh aturan batas kredit di kode (`loanService.ts`): suku bunga 2%–15% dan tenor 7–30 hari.
- Eksekusi mutasi keuangan (`disburseLoan`) wajib tetap melewati memory mutex in-flight dan verifikasi atomik ACID `$transaction`.

---

## 3. Implementasi Standar & Lokasi File

| Komponen                 | Path Berkas                                                             | Fungsi Utama                                                                                        |
| ------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **API Decision Service** | `.worktrees/api/src/services/decisionService.ts`                        | Klien upstream System One, manajemen circuit breaker, fallback lokal.                               |
| **API Decision Routes**  | `.worktrees/api/src/routes/decision.ts`                                 | Rute Fastify `/api/v1/decision/intent` & `/loan`, autentikasi JWT/IPC, rate limiting, validasi Zod. |
| **Bot Decision Client**  | `src/services/agentEngine/decisionClient.ts`                            | Utilitas sanitasi PII zero-knowledge, pemanggilan HTTP gateway internal, graceful error catch.      |
| **Bot Guidance Planner** | `src/services/agentEngine/guidancePlanner.ts`                           | Fast-path penanganan obrolan murni berbasis Laya sebelum pemanggilan LLM generatif.                 |
| **Loan Underwriting**    | `src/services/loanService.ts`                                           | Penilaian risiko kredit berbasis metrik tersanitasi Laya yang diikat batas kode.                    |
| **Automated Tests**      | `.worktrees/api/tests/decision.test.ts`, `tests/decisionClient.test.ts` | Verifikasi autentikasi, skema, sanitasi PII, dan fallback gateway.                                  |
