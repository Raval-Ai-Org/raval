-- Bigger uploads (Library and Inspo): photos up to 100 MB, Library media up to
-- 200 MB and Inspo videos up to 300 MB. Inspo and Studio files are written to
-- this bucket by signed upload when R2 is off, so the bucket's own cap must
-- cover the largest file the app accepts (src/lib/inspo/uploads.ts). The
-- Supabase project's global upload limit (dashboard → Storage settings) must
-- be at least this as well. Idempotent.
UPDATE storage.buckets
SET file_size_limit = 314572800
WHERE id = 'generated-assets'
  AND file_size_limit IS NOT NULL
  AND file_size_limit < 314572800;
