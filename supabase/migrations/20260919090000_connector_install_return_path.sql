-- Connector install states remember where in Mellox the user started connecting
-- (Settings → Connections, or a specific AI Visibility finding), so the GitHub
-- callback returns them to that exact page instead of a generic dashboard.
--
-- Only a same-origin relative path is stored (validated server-side by
-- safeReturnPath); the origin itself lives in return_origin.
--
-- Idempotent and non-destructive: safe to re-run.

ALTER TABLE public.connector_install_states
  ADD COLUMN IF NOT EXISTS return_path text;

ALTER TABLE public.connector_install_states
  DROP CONSTRAINT IF EXISTS connector_install_states_return_path_len;
ALTER TABLE public.connector_install_states
  ADD CONSTRAINT connector_install_states_return_path_len
  CHECK (return_path IS NULL OR (char_length(return_path) <= 300 AND left(return_path, 1) = '/'));
