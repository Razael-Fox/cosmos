# Cosmos Web Portal (`website` branch)

Public web portal and management dashboard for **Cosmos WhatsApp & Multi-Device Bot Platform**. Built with Next.js 16 (App Router), React 19, TypeScript, and Tailwind CSS.

> **Deployment Branch Note**: This branch is a long-lived deployment branch specifically consumed by `scripts/docker-build.sh` for single-container Docker deployment on LXC NAT VPS environments protected by Cloudflare. It is never merged directly into `main`.

---

## 🌟 Key Features

1. **Anti-Banned Inverted Verification (Mode 1)**:
   - Eliminates WhatsApp spam detection bans by having the user initiate the WhatsApp conversation using Click-to-Chat (`wa.me/<BOT>?text=.verify%20<TOKEN>`).
   - Generates opaque tokens formatted as `COSMOS-XXXXXX-<last4>` and listens for real-time WebSocket events (`/ws/auth/status?session=<regSessionId>`) for instant login.

2. **Turnstile-Gated Direct OTP (Mode 2)**:
   - Fallback 6-digit OTP verification protected by Cloudflare Turnstile anti-abuse challenges and per-number rate limits.

3. **Multi-Device Sub-Bot Web Pairing**:
   - Authenticated, whitelisted users can link their WhatsApp number as an autonomous sub-bot without running terminal commands.
   - Supports both **8-Digit Pairing Code** and **Real-Time QR Scan** methods with validity countdown timers.

4. **Tiered Pricing & Manual WhatsApp Sales Flow**:
   - **Free Tier**: Rp0 (2 sub-bots, 5 groups).
   - **Subsidized Tier**: Rp10.000/mo (5 sub-bots, 10 groups, custom prefix).
   - **Partner Tier**: Rp32.000/mo (12 sub-bots, 25 groups, custom prefix, high priority, early access).
   - Direct click-to-chat WhatsApp link with prefilled order references (`COSMOS-SUB-<timestamp>`) for manual QRIS / Bank Transfer payments.

5. **Whitelisted Groups & IDOR Protection**:
   - Strict tenant-isolated group whitelist management respecting subscription quotas.

6. **Bilingual UI (Indonesian default & English)**:
   - Centralized dictionary in `lib/dictionary.ts` with reactive language switching.

---

## 🛠️ Tech Stack & Requirements

- **Framework**: Next.js 16.3.5 (App Router, Turbopack, standalone output)
- **UI & Styling**: React 19, Tailwind CSS v4, `@phosphor-icons/react`, Base UI
- **Package Manager**: **pnpm only** (never npm or yarn)
- **Validation**: ESLint 9 (flat config) & strict TypeScript checks

---

## 🚀 Getting Started

### 1. Environment Configuration

Copy the sample environment file:

```bash
cp .env.example .env.local
```

Key environment variables:

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_API_URL` | Fastify backend API URL (leave empty for standalone fallback) | `http://127.0.0.1:4000` |
| `NEXT_PUBLIC_BOT_NUMBER` | Primary Cosmos Bot WhatsApp phone number | `628123456789` |
| `NEXT_PUBLIC_SALES_NUMBER` | Sales representative WhatsApp phone number | `628123456789` |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile Site Key | `1x00000000000000000000AA` (test key) |
| `NEXT_PUBLIC_SITE_URL` | Public origin URL | `http://localhost:3000` |

### 2. Development

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 3. Verification & Production Build

```bash
# Run ESLint
pnpm lint

# Run strict TypeScript type check
pnpm exec tsc --noEmit

# Production standalone build
pnpm build
```

---

## 📁 Project Structure

```
├── app/
│   ├── api/v1/             # Contract-compatible standalone route handlers
│   │   ├── auth/           # register-inverted, register-direct, verify-otp, login, status
│   │   ├── subscriptions/  # status, sales-link
│   │   ├── groups/         # list, whitelist, delete
│   │   └── subbots/        # pair, list, delete
│   ├── dashboard/          # User dashboard (sub-bots, groups, quotas)
│   ├── login/              # Login portal
│   ├── pricing/            # Tiered cards, comparison table & FAQ
│   ├── register/           # Registration portal (Inverted & Direct OTP modes)
│   ├── globals.css         # Tailwind styles & theme variables
│   ├── layout.tsx          # Root layout with LanguageProvider, Navbar & Footer
│   └── page.tsx            # Landing page
├── components/
│   ├── DirectOtpModal.tsx      # Mode 2 6-digit OTP modal
│   ├── Footer.tsx              # Portal footer
│   ├── InvertedVerifyDialog.tsx# Mode 1 WhatsApp Click-to-Chat dialog
│   ├── Navbar.tsx              # Responsive navigation & language switcher
│   ├── PairingModal.tsx        # Sub-bot pairing modal (Code & QR)
│   ├── Pricing.tsx             # Pricing cards & direct WhatsApp sales links
│   └── Turnstile.tsx           # Cloudflare Turnstile widget
└── lib/
    ├── api.ts              # Typed client for backend contract & WebSockets
    ├── currency.ts         # Rupiah formatting utility (Rp0, Rp10.000, Rp32.000)
    ├── dictionary.ts       # Centralized id/en internationalization dictionary
    ├── i18n.tsx            # LanguageProvider and useTranslation hook
    ├── mockStore.ts        # In-memory mock store for standalone dev verification
    └── types.ts            # Shared TypeScript data models
```
