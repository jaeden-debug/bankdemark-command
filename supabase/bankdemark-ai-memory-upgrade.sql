-- ============================================================
-- BankDeMark Command — AI Memory Upgrade
-- Run in Supabase SQL Editor
-- ============================================================

ALTER TABLE public.ai_conversations
ADD COLUMN IF NOT EXISTS summary TEXT,
ADD COLUMN IF NOT EXISTS last_context_summary TEXT;

CREATE TABLE IF NOT EXISTS public.ai_user_memory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL DEFAULT 'profile'
    CHECK (memory_type IN ('profile','goal','business','preference','constraint','strategy','financial_context')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  importance INT NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  source TEXT DEFAULT 'ai_chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_user_memory_user_id ON public.ai_user_memory(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_user_memory_importance ON public.ai_user_memory(user_id, importance DESC);

CREATE TRIGGER ai_user_memory_updated_at
  BEFORE UPDATE ON public.ai_user_memory
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.ai_user_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own AI memory"
  ON public.ai_user_memory FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own AI memory"
  ON public.ai_user_memory FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own AI memory"
  ON public.ai_user_memory FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own AI memory"
  ON public.ai_user_memory FOR DELETE
  USING (auth.uid() = user_id);
