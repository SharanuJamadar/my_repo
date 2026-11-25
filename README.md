# MY TRADE — Multi-Market Trading Terminal

MY TRADE is a full-stack trading workspace built with React, TypeScript, Tailwind CSS, Express, Lightweight Charts, Firebase Auth/Firestore, and Gemini AI analysis.

## Architecture

- **Frontend (`src/`)**: React 19 SPA with Vite, modular views (`src/components/`), custom hooks (`src/hooks/`), route utilities (`src/lib/routeUtils.ts`), Firebase persistence (`src/lib/firestoreService.ts`), and local demo isolation (`src/lib/localStorageService.ts`).
- **Backend (`server.ts` & `server/`)**:
  - `server/strategyEngine.ts`: Multi-timeframe quantitative strategy engine with session-anchored VWAP, ATR/ADX/RSI/MACD indicators, dynamic tick-size decimals, liquidity session gating, breakout/breakdown triggers (`WAIT` vs `ACTIVE`), and structural support/resistance R:R evaluation.
  - `server/geminiService.ts`: Schema-validated Gemini AI chart vision, live setup commentary, trading desk assistant, and market news briefings (configurable via `GEMINI_MODEL`).
  - `server/brokerOAuth.ts`: Encrypted (`AES-256-GCM`) broker OAuth session persistence with strict single-use CSRF state validation and exact-origin `postMessage` callbacks.
  - `server/securityGuards.ts`: Verified Firebase ID token / operator RBAC helpers, SSRF hostname/IPv4/IPv6/DNS guards, sliding-window rate limiter, bounded TTL cache, and finite numeric config sanitization.
  - `server/positionMonitor.ts`: 24/7 server-side open position monitor with 3-stage trailing stop-loss and partial profit booking.
- **Security Rules (`firestore.rules`)**: Verified-user owner isolation, role-claim / `admins` collection checks, bounded field validation, and automated ESLint security-rule linting.

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and set required secrets (`GEMINI_API_KEY`, `ADMIN_ALLOWED_EMAILS`, `BROKER_SESSION_ENCRYPTION_KEY`, and any optional broker/Telegram credentials).
3. Run in development mode (port 3000):
   ```bash
   npm run dev
   ```

## Scripts

- `npm run dev` — Start Express + Vite dev server via `tsx server.ts`
- `npm run build` — Build frontend (`dist/`) and bundle backend (`dist/server.mjs`) via `esbuild`
- `npm start` — Run compiled production server (`node dist/server.mjs`)
- `npm run lint` — Run TypeScript typechecking (`tsc --noEmit`) and Firestore security rule lint (`eslint firestore.rules`)
- `npm test` — Run backend unit tests (`tsx --test tests/*.test.ts`)
- `npm run clean` — Cross-platform cleanup of `dist/`

## Security Highlights

- All AI, Pine evaluation, position monitor, and order routes require verified Firebase authentication (`Authorization: Bearer <idToken>`) and per-user rate limiting.
- Live broker order execution, Exness bridge probes, SL trailing, and Telegram bot controls require verified operator privileges (`ADMIN_ALLOWED_EMAILS` or Firebase custom `admin` claim).
- Kill switch state is enforced server-side (`/api/account/kill-switch`) and cannot be bypassed via request body flags.
- Broker OAuth tokens are encrypted at rest with AES-256-GCM and protected by mandatory single-use CSRF state tokens.
