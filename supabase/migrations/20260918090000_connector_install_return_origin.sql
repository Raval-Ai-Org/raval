-- Connector install states remember the origin the install was started from.
--
-- A GitHub App has one callback URL, but Mellox runs on several origins (the
-- custom domain, the Railway domain, localhost in development) and the user's
-- session lives in that origin's browser storage. The callback route reads
-- this column (service role only) to hand the installer back to the origin
-- that started the flow; the value is re-checked against an allowlist there.
--
-- Idempotent and non-destructive: safe to re-run.

ALTER TABLE public.connector_install_states
  ADD COLUMN IF NOT EXISTS return_origin text;

ALTER TABLE public.connector_install_states
  DROP CONSTRAINT IF EXISTS connector_install_states_return_origin_len;
ALTER TABLE public.connector_install_states
  ADD CONSTRAINT connector_install_states_return_origin_len
  CHECK (return_origin IS NULL OR char_length(return_origin) <= 200);
