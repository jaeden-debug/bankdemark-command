-- ============================================================
-- BankDeMark Command — Supabase Database Schema
-- Version: 1.0.0
-- Run this in your Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- HELPER: updated_at trigger function
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- TABLE: profiles
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email           TEXT,
  first_name      TEXT,
  age             INT,
  country         TEXT DEFAULT 'Canada',
  region          TEXT,
  user_type       TEXT DEFAULT 'individual'
                    CHECK (user_type IN ('individual','student','couple','family','freelancer','small_business','investor','retiree')),
  household_type  TEXT DEFAULT 'single'
                    CHECK (household_type IN ('single','couple','family','other')),
  business_owner  BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- ============================================================
-- TABLE: financial_snapshots
-- ============================================================
CREATE TABLE IF NOT EXISTS public.financial_snapshots (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  monthly_income              NUMERIC(12,2) DEFAULT 0,
  fixed_expenses              NUMERIC(12,2) DEFAULT 0,
  variable_expenses           NUMERIC(12,2) DEFAULT 0,
  housing_payment             NUMERIC(12,2) DEFAULT 0,
  total_debt                  NUMERIC(12,2) DEFAULT 0,
  average_debt_interest       NUMERIC(5,2) DEFAULT 0,
  minimum_debt_payment        NUMERIC(12,2) DEFAULT 0,
  savings_balance             NUMERIC(12,2) DEFAULT 0,
  investment_balance          NUMERIC(12,2) DEFAULT 0,
  emergency_fund_target_months NUMERIC(4,1) DEFAULT 6,
  credit_score_range          TEXT DEFAULT 'good'
                                CHECK (credit_score_range IN ('poor','fair','good','very_good','excellent')),
  primary_goal                TEXT DEFAULT 'build_emergency_fund',
  secondary_goal              TEXT,
  desired_retirement_age      INT DEFAULT 65,
  passive_income_target       NUMERIC(12,2) DEFAULT 0,
  risk_tolerance              TEXT DEFAULT 'moderate'
                                CHECK (risk_tolerance IN ('conservative','moderate','aggressive')),
  business_revenue            NUMERIC(12,2),
  business_expenses           NUMERIC(12,2),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)  -- One active snapshot per user (upsert on user_id)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_user_id ON public.financial_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_updated_at ON public.financial_snapshots(updated_at DESC);

CREATE TRIGGER financial_snapshots_updated_at
  BEFORE UPDATE ON public.financial_snapshots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE public.financial_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own snapshots"
  ON public.financial_snapshots FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own snapshots"
  ON public.financial_snapshots FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own snapshots"
  ON public.financial_snapshots FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own snapshots"
  ON public.financial_snapshots FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- TABLE: debts (itemized)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.debts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  balance         NUMERIC(12,2) NOT NULL DEFAULT 0,
  interest_rate   NUMERIC(5,2) NOT NULL DEFAULT 0,
  minimum_payment NUMERIC(12,2) NOT NULL DEFAULT 0,
  debt_type       TEXT DEFAULT 'other'
                    CHECK (debt_type IN ('credit_card','student_loan','auto_loan','personal_loan','mortgage','heloc','business_loan','other')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_debts_user_id ON public.debts(user_id);

CREATE TRIGGER debts_updated_at
  BEFORE UPDATE ON public.debts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own debts"
  ON public.debts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own debts"
  ON public.debts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own debts"
  ON public.debts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own debts"
  ON public.debts FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- TABLE: goals
-- ============================================================
CREATE TABLE IF NOT EXISTS public.goals (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  goal_type       TEXT NOT NULL,
  target_amount   NUMERIC(12,2) DEFAULT 0,
  current_amount  NUMERIC(12,2) DEFAULT 0,
  target_date     DATE,
  priority        INT DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_goals_user_id ON public.goals(user_id);
CREATE INDEX IF NOT EXISTS idx_goals_priority ON public.goals(user_id, priority);

CREATE TRIGGER goals_updated_at
  BEFORE UPDATE ON public.goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own goals"
  ON public.goals FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own goals"
  ON public.goals FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own goals"
  ON public.goals FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own goals"
  ON public.goals FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- TABLE: ai_conversations
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_id ON public.ai_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_created_at ON public.ai_conversations(created_at DESC);

CREATE TRIGGER ai_conversations_updated_at
  BEFORE UPDATE ON public.ai_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own conversations"
  ON public.ai_conversations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own conversations"
  ON public.ai_conversations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own conversations"
  ON public.ai_conversations FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own conversations"
  ON public.ai_conversations FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- TABLE: ai_messages
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_messages (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id   UUID NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role              TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content           TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_id ON public.ai_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_messages_user_id ON public.ai_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_messages_created_at ON public.ai_messages(created_at ASC);

-- RLS
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own messages"
  ON public.ai_messages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own messages"
  ON public.ai_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- TABLE: email_leads
-- ============================================================
CREATE TABLE IF NOT EXISTS public.email_leads (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email       TEXT NOT NULL UNIQUE,
  source      TEXT DEFAULT 'marketplace',
  user_type   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_leads_email ON public.email_leads(email);
CREATE INDEX IF NOT EXISTS idx_email_leads_source ON public.email_leads(source);
CREATE INDEX IF NOT EXISTS idx_email_leads_created_at ON public.email_leads(created_at DESC);

-- RLS
ALTER TABLE public.email_leads ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert an email lead (for newsletter capture without auth)
CREATE POLICY "Anyone can insert email leads"
  ON public.email_leads FOR INSERT
  WITH CHECK (true);

-- Only service role can select/update/delete email leads
CREATE POLICY "Service role can manage email leads"
  ON public.email_leads FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================
-- TABLE: recommendation_events (analytics tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.recommendation_events (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recommendation_key  TEXT NOT NULL,
  action              TEXT NOT NULL CHECK (action IN ('view', 'click', 'dismiss')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rec_events_user_id ON public.recommendation_events(user_id);
CREATE INDEX IF NOT EXISTS idx_rec_events_key ON public.recommendation_events(recommendation_key);
CREATE INDEX IF NOT EXISTS idx_rec_events_created_at ON public.recommendation_events(created_at DESC);

-- RLS
ALTER TABLE public.recommendation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own recommendation events"
  ON public.recommendation_events FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own recommendation events"
  ON public.recommendation_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- AUTO-CREATE PROFILE ON SIGNUP
-- Trigger: when a new auth.users row is created, insert a stub profile
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, first_name, country, user_type, household_type, business_owner)
  VALUES (
    NEW.id,
    NEW.email,
    '',
    'Canada',
    'individual',
    'single',
    FALSE
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- DONE
-- ============================================================
-- Tables created:
--   public.profiles
--   public.financial_snapshots
--   public.debts
--   public.goals
--   public.ai_conversations
--   public.ai_messages
--   public.email_leads
--   public.recommendation_events
--
-- RLS enabled on all tables.
-- updated_at triggers on all mutable tables.
-- Indexes on all foreign keys and common query fields.
-- Auto-profile creation trigger on auth.users insert.

-- ============================================================
-- MIGRATION: Stripe + Pro plan columns on profiles
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan                  TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro')),
  ADD COLUMN IF NOT EXISTS pro_plan              TEXT,
  ADD COLUMN IF NOT EXISTS stripe_customer_id    TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

CREATE INDEX IF NOT EXISTS idx_profiles_stripe_sub ON public.profiles(stripe_subscription_id);

-- ============================================================
-- TABLE: ai_usage  (rate limiting — free tier = 5/day)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_usage (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  used_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  count      INT  NOT NULL DEFAULT 0,
  UNIQUE(user_id, used_date)
);
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own ai_usage"   ON public.ai_usage FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own ai_usage" ON public.ai_usage FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own ai_usage" ON public.ai_usage FOR UPDATE USING (auth.uid() = user_id);

-- ============================================================
-- TABLE: score_history  (daily snapshots for trend chart)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.score_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  score        INT  NOT NULL,
  health_label TEXT,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_score_history_user ON public.score_history(user_id, recorded_at DESC);
ALTER TABLE public.score_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own score_history" ON public.score_history FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- TABLE: goals
-- ============================================================
CREATE TABLE IF NOT EXISTS public.goals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('emergency_fund','debt_payoff','savings','investment','custom')),
  target       NUMERIC(14,2) NOT NULL DEFAULT 0,
  current      NUMERIC(14,2) NOT NULL DEFAULT 0,
  target_date  DATE,
  notes        TEXT,
  completed    BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_goals_user ON public.goals(user_id);
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own goals" ON public.goals FOR ALL USING (auth.uid() = user_id);
CREATE TRIGGER goals_updated_at BEFORE UPDATE ON public.goals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
