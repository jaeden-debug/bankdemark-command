-- ============================================================
-- DROP ai_user_memory
--
-- Written only by the legacy coach (removed in 8359a6c), which built
-- "memories" from raw user text by substring match and re-injected them
-- as "VERIFIED long-term memories… override generic assumptions" — a
-- self-serve prompt-injection channel.
--
-- No reader remains in the codebase. Two rows exist, both belonging to
-- one internal account. They are archived rather than destroyed: this is
-- a financial product and a dropped table should be recoverable for a
-- while, even when the data is judged worthless.
--
-- Zylx's durable memory will be rebuilt later from STRUCTURED records
-- (business settings, preferences, goals) rather than from prose the
-- user typed — that is what made this design unsafe.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS archive;
REVOKE ALL ON SCHEMA archive FROM anon, authenticated;

-- Snapshot before dropping. Service-role only; not in the exposed API.
CREATE TABLE IF NOT EXISTS archive.ai_user_memory_20260808 AS
  SELECT *, NOW() AS archived_at FROM public.ai_user_memory;

DROP TABLE IF EXISTS public.ai_user_memory CASCADE;
