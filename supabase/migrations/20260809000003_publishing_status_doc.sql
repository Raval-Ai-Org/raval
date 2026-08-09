-- content_items.status is a plain TEXT column (NOT a Postgres enum). The
-- 'publishing' value is valid app-side (content.functions.ts StatusEnum, added in
-- US2). This migration only keeps the schema documentation accurate.
comment on column public.content_items.status is
  'draft | pending | approved | rejected | scheduled | publishing | published';
