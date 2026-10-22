-- Durable multi-clip jobs shared by Studio, UGC and the video API.
CREATE TABLE IF NOT EXISTS public.video_compositions (
  id uuid PRIMARY KEY,
  revision integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.video_compositions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.video_compositions FROM anon, authenticated;
GRANT ALL ON public.video_compositions TO service_role;
