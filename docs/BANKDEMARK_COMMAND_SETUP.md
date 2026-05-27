# BankDeMark Command — Setup Guide

**Version:** 1.0.0  
**Stack:** Next.js 14 · TypeScript · Tailwind CSS · Supabase · OpenAI-compatible AI

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Install Dependencies](#2-install-dependencies)
3. [Environment Variables](#3-environment-variables)
4. [Supabase Setup](#4-supabase-setup)
5. [Enable Supabase Auth](#5-enable-supabase-auth)
6. [Run the Schema](#6-run-the-schema)
7. [Configure the AI Coach](#7-configure-the-ai-coach)
8. [Local Development](#8-local-development)
9. [Vercel Deployment](#9-vercel-deployment)
10. [Customize Content](#10-customize-content)
11. [Connect Stripe (Pro Payments)](#11-connect-stripe-pro-payments)
12. [File Reference Map](#12-file-reference-map)
13. [Architecture Notes](#13-architecture-notes)

---

## 1. Prerequisites

- Node.js 18+ installed
- A Supabase account (free tier works): [supabase.com](https://supabase.com)
- An OpenAI API key (or compatible API): [platform.openai.com](https://platform.openai.com)
- A Vercel account for deployment: [vercel.com](https://vercel.com)
- Git

---

## 2. Install Dependencies

```bash
cd BankDeMark-app
npm install
```

This installs:
- `next` 14 with App Router
- `@supabase/supabase-js` and `@supabase/ssr` for auth + database
- `openai` SDK (supports any OpenAI-compatible endpoint)
- `tailwindcss`, `clsx`, `date-fns`

---

## 3. Environment Variables

Copy the example file and fill in your values:

```bash
cp .env.example .env.local
```

Open `.env.local` and set:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

AI_API_KEY=sk-your-api-key
AI_MODEL=gpt-4o-mini
AI_BASE_URL=https://api.openai.com/v1
```

**Where to find Supabase keys:**  
Supabase Dashboard → Your Project → Settings → API

**Important:**  
- `NEXT_PUBLIC_*` variables are safe to expose to the browser  
- `SUPABASE_SERVICE_ROLE_KEY` and `AI_API_KEY` are server-only — never prefix with `NEXT_PUBLIC_`  
- Never commit `.env.local` to git (it's in `.gitignore` by default)

---

## 4. Supabase Setup

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Choose a region close to your users (e.g., `us-east-1` for North America)
3. Note your project URL and API keys from **Settings → API**
4. Paste them into `.env.local`

---

## 5. Enable Supabase Auth

1. In Supabase Dashboard → **Authentication → Providers**
2. **Email** provider should be enabled by default — confirm it is
3. Optional: Enable Google, GitHub OAuth for social login
4. Go to **Authentication → Settings**:
   - Set **Site URL** to your production domain (e.g., `https://bankdemark.com`)
   - Add `http://localhost:3000` to **Redirect URLs** for local dev

**Email confirmation (recommended for production):**  
Authentication → Settings → Enable email confirmations

---

## 6. Run the Schema

1. In Supabase Dashboard → **SQL Editor**
2. Click **New Query**
3. Copy the entire contents of `supabase/bankdemark-command-schema.sql`
4. Paste into the SQL editor
5. Click **Run** (or press `Cmd+Enter`)

This creates all 8 tables with RLS, indexes, and triggers.

**Verify it worked:**  
Table Editor → you should see: `profiles`, `financial_snapshots`, `debts`, `goals`, `ai_conversations`, `ai_messages`, `email_leads`, `recommendation_events`

---

## 7. Configure the AI Coach

The AI coach works with any OpenAI-compatible API.

### Option A: OpenAI (recommended)
```env
AI_API_KEY=sk-your-openai-key
AI_MODEL=gpt-4o-mini
AI_BASE_URL=https://api.openai.com/v1
```

`gpt-4o-mini` is recommended for cost-effective production use. Use `gpt-4o` for higher quality responses.

### Option B: Anthropic (via API adapter)
If using an Anthropic-to-OpenAI proxy:
```env
AI_API_KEY=your-anthropic-key
AI_MODEL=claude-3-haiku-20240307
AI_BASE_URL=https://your-proxy-url/v1
```

### Option C: Local (Ollama)
```env
AI_API_KEY=ollama
AI_MODEL=llama3
AI_BASE_URL=http://localhost:11434/v1
```

### Option D: Disable AI (if not ready)
Leave `AI_API_KEY` empty. The AI coach will return a clear error message with setup instructions — no crashes.

**AI route location:** `app/api/command/coach/route.ts`

---

## 8. Local Development

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)  
You'll be redirected to `/command` which shows the hero for unauthenticated users.

**Development flow:**
1. Click "Start Free" → create an account
2. Complete the 5-step onboarding
3. Your dashboard calculates instantly
4. Test each module: Debt Engine, Wealth Engine, Affordability, AI Coach, Reports

**Type checking:**
```bash
npm run type-check
```

**Linting:**
```bash
npm run lint
```

---

## 9. Vercel Deployment

### One-command deploy:
```bash
npm install -g vercel
vercel
```

### Manual Vercel setup:
1. Push your code to GitHub
2. Go to [vercel.com](https://vercel.com) → Import Project → select your repo
3. Framework: **Next.js** (auto-detected)
4. Add all environment variables from `.env.local` in Vercel Dashboard → Settings → Environment Variables
5. Deploy

### Required Vercel env vars:
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
AI_API_KEY
AI_MODEL
AI_BASE_URL
```

**After deploying:**
- Update Supabase Auth **Site URL** to your Vercel production URL
- Add your Vercel URL to Supabase **Redirect URLs**

---

## 10. Customize Content

### Edit Affiliate/Product Cards
**File:** `lib/command/constants.ts` → `MARKETPLACE_PRODUCTS` array

Each product has:
```typescript
{
  id: 'unique-id',
  category: 'Category Name',
  name: 'Product Name',
  tagline: 'Short value prop',
  description: 'Longer description',
  features: ['Feature 1', 'Feature 2'],
  cta_label: 'Button text',
  cta_href: '/your-affiliate-link',  // ← Replace this
  badge: 'Optional badge',
  sponsored: false,
}
```

Replace `cta_href` values with your real affiliate links.

### Edit Pricing (Pro Plans)
**File:** `components/command/ProUpgradeCard.tsx`

Change prices, plan names, and feature lists in this file.  
Connect Stripe by following Section 11.

### Edit SEO Lead Pages
**File:** `lib/command/constants.ts` → `SEO_LEAD_PAGES` array

Add or remove lead pages. Each should have a corresponding Next.js route at `app/[slug]/page.tsx`.

### Edit Financial Assumptions
**File:** `lib/command/constants.ts`

Key constants you may want to adjust:
```typescript
INVESTMENT_RETURNS = { conservative: 0.04, moderate: 0.07, aggressive: 0.10 }
SAFE_WITHDRAWAL_RATE = 0.04  // 4% rule
FIRE_MULTIPLIER = 25         // 25x annual expenses
DEBT_THRESHOLDS = { high_pressure: 0.20, danger_zone: 0.35, high_interest_rate: 0.10 }
```

### Customize Branding
- **Colors:** `tailwind.config.ts` → `theme.extend.colors`
- **Fonts:** `app/globals.css` → Google Fonts import
- **Logo:** Replace the "B" monogram in `CommandNav.tsx` and `CommandHero.tsx`
- **Company name:** Global find/replace `BankDeMark`

---

## 11. Connect Stripe (Pro Payments)

The Pro upgrade UI is ready in `components/command/ProUpgradeCard.tsx`. To connect Stripe:

### Step 1: Create Stripe products
In Stripe Dashboard:
- Create "BankDeMark Pro Monthly" product → Price: $19/month recurring
- Create "BankDeMark Pro Yearly" product → Price: $149/year recurring  
- Create "BankDeMark Lifetime" product → Price: $299 one-time

### Step 2: Add Stripe env vars
```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_MONTHLY_PRICE_ID=price_...
STRIPE_YEARLY_PRICE_ID=price_...
STRIPE_LIFETIME_PRICE_ID=price_...
```

### Step 3: Install Stripe SDK
```bash
npm install stripe @stripe/stripe-js
```

### Step 4: Create checkout route
Create `app/api/command/checkout/route.ts`:
```typescript
import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request) {
  const { priceId, userId } = await req.json();
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    mode: priceId === process.env.STRIPE_LIFETIME_PRICE_ID ? 'payment' : 'subscription',
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/command/dashboard?upgraded=true`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/command/marketplace`,
    client_reference_id: userId,
  });
  return Response.json({ url: session.url });
}
```

### Step 5: Add pro_tier column to profiles
```sql
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pro_tier TEXT DEFAULT 'free'
  CHECK (pro_tier IN ('free', 'pro', 'lifetime'));
```

### Step 6: Webhook to upgrade user on payment
Create `app/api/webhooks/stripe/route.ts` to handle `checkout.session.completed` events and update `profiles.pro_tier`.

---

## 12. File Reference Map

```
BankDeMark-app/
├── app/
│   ├── globals.css              ← Brand styles, Tailwind base
│   ├── layout.tsx               ← Root layout with SEO metadata
│   ├── page.tsx                 ← Redirects to /command
│   ├── command/
│   │   ├── page.tsx             ← /command landing + auth wall
│   │   ├── dashboard/page.tsx   ← Main dashboard
│   │   ├── onboarding/page.tsx  ← 5-step profile setup
│   │   ├── debt/page.tsx        ← Debt Engine
│   │   ├── wealth/page.tsx      ← Wealth Engine
│   │   ├── affordability/page.tsx ← Affordability Engine
│   │   ├── coach/page.tsx       ← AI Coach
│   │   ├── reports/page.tsx     ← Financial Reports
│   │   └── marketplace/page.tsx ← Products + Recommendations
│   └── api/
│       └── command/
│           └── coach/route.ts   ← AI API route (OpenAI-compatible)
├── components/command/
│   ├── CommandShell.tsx         ← Auth wrapper + app layout
│   ├── CommandHero.tsx          ← Public landing/hero
│   ├── CommandNav.tsx           ← Sidebar (desktop) + top/bottom nav (mobile)
│   ├── OnboardingForm.tsx       ← 5-step financial profile wizard
│   ├── DashboardOverview.tsx    ← Full dashboard with all metrics
│   ├── FinancialHealthScore.tsx ← Score ring + breakdown
│   ├── MetricCard.tsx           ← Reusable metric display card
│   ├── PriorityStack.tsx        ← Ordered action stack + risk warnings
│   ├── DebtEngine.tsx           ← Debt payoff strategies
│   ├── WealthEngine.tsx         ← Investment projections + FIRE
│   ├── AffordabilityEngine.tsx  ← Can-I-afford-this calculator
│   ├── AICoach.tsx              ← Chat interface for AI coach
│   ├── ReportsPanel.tsx         ← Print-ready financial reports
│   ├── Marketplace.tsx          ← Products + email capture
│   ├── RecommendationCard.tsx   ← Single recommendation display
│   ├── ProUpgradeCard.tsx       ← Pro pricing UI (Stripe-ready)
│   └── LegalDisclaimer.tsx      ← Legal disclaimer component
├── lib/
│   ├── command/
│   │   ├── types.ts             ← All TypeScript types
│   │   ├── constants.ts         ← Config, products, labels, questions
│   │   ├── calculations.ts      ← Pure financial calculation functions
│   │   ├── recommendations.ts   ← Rule-based recommendation engine
│   │   └── aiContext.ts         ← AI system message + user context builder
│   └── supabase/
│       ├── client.ts            ← Browser Supabase client
│       └── server.ts            ← Server Supabase client (SSR)
├── middleware.ts                ← Auth route protection
├── supabase/
│   └── bankdemark-command-schema.sql ← Complete DB schema
├── docs/
│   └── BANKDEMARK_COMMAND_SETUP.md   ← This file
└── .env.example                 ← Environment variable template
```

---

## 13. Architecture Notes

### Auth Flow
- Supabase Email Auth with `@supabase/ssr` for cookie-based sessions
- `middleware.ts` protects `/command/dashboard` and all inner routes
- `CommandShell.tsx` handles the auth modal (sign up / sign in)
- New signups automatically get a profile row via a Supabase trigger

### Data Architecture
- One `financial_snapshots` row per user (unique on `user_id`, upserted on save)
- Itemized debts in `debts` table — optional, falls back to simplified model
- All calculations run client-side in `lib/command/calculations.ts` — no server round-trip needed for the dashboard
- AI conversations stored in `ai_conversations` + `ai_messages` for context window

### Calculation Engine
All financial math lives in `lib/command/calculations.ts` as pure functions. To modify any formula:
- `calcHealthScore()` — weighted health score (line ~170)
- `calcFIRENumber()` — FIRE calculation (line ~120)
- `calcDebtAvalanche/Snowball()` — payoff strategies (line ~80)
- `calcAffordability()` — affordability verdict (line ~145)

### AI Coach
- Route: `app/api/command/coach/route.ts`
- Pulls user's profile + snapshot from Supabase
- Calculates live metrics for context
- Loads last 10 messages for conversation continuity
- Uses `lib/command/aiContext.ts` to build the system message + user context
- Compatible with any OpenAI-format API via env vars

### Monetization Hooks
All monetization infrastructure is in place:
- `ProUpgradeCard.tsx` — pricing UI, Stripe-ready
- `email_leads` table — newsletter capture
- `MARKETPLACE_PRODUCTS` in constants.ts — affiliate slots
- `SEO_LEAD_PAGES` in constants.ts — internal link cards
- `recommendation_events` table — click tracking

### SEO
- All public pages have full `Metadata` objects in their `page.tsx`
- Private user pages have `robots: { index: false }` to prevent indexing
- Canonical URLs included on public pages
- Future SEO pages should be added as routes under `app/[slug]/page.tsx`

---

## Legal Notice

BankDeMark Command is educational financial planning software. It is not a licensed financial advisor, broker, bank, lender, or credit bureau. Always include the provided legal disclaimer in all user-facing views. Do not remove or modify the disclaimer language without legal review.

---

*BankDeMark Command V1 — Built with Next.js 14, Supabase, and OpenAI*
