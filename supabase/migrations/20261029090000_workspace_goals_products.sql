-- Goals and the product catalogue (ADR-0035): what a brand wants from its
-- marketing, and what it actually sells.
--
-- workspace_goals     one row per workspace. `goals` is WorkspaceGoals
--                     (src/lib/goals/contracts.ts), always written through
--                     decideGoals. Numbers here are what a person typed; Mellox
--                     never writes an estimate into them.
-- workspace_products  the brand's products and services. Photos are rows in
--                     `assets` (metadata.source = 'product-photo'); this table
--                     only keeps their ids, so every photo is checked against
--                     the workspace before Studio uses it.
--
-- Read by members (RLS); written only by the server after a role check
-- (src/server/fns/goals.ts, src/server/fns/products.ts). Idempotent.

CREATE TABLE IF NOT EXISTS public.workspace_goals (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  goals jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_goals_size CHECK (pg_column_size(goals) <= 8000)
);

ALTER TABLE public.workspace_goals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_goals FROM anon, authenticated;
GRANT SELECT ON public.workspace_goals TO authenticated;
GRANT ALL ON public.workspace_goals TO service_role;

DROP POLICY IF EXISTS "Members read goals" ON public.workspace_goals;
CREATE POLICY "Members read goals"
  ON public.workspace_goals FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP TRIGGER IF EXISTS workspace_goals_touch ON public.workspace_goals;
CREATE TRIGGER workspace_goals_touch BEFORE UPDATE ON public.workspace_goals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.workspace_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'product' CHECK (kind IN ('product', 'service')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 1200),
  price text NOT NULL DEFAULT '' CHECK (char_length(price) <= 60),
  url text CHECK (url IS NULL OR char_length(url) <= 600),
  category text NOT NULL DEFAULT '' CHECK (char_length(category) <= 80),
  benefits text[] NOT NULL DEFAULT '{}' CHECK (cardinality(benefits) <= 6),
  facts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (pg_column_size(facts) <= 4000),
  image_asset_ids uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(image_asset_ids) <= 8),
  primary_asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('scan', 'shopify', 'manual')),
  position integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  fingerprint text NOT NULL CHECK (char_length(fingerprint) BETWEEN 1 AND 200),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_products_fingerprint_unique UNIQUE (workspace_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS workspace_products_list_idx
  ON public.workspace_products(workspace_id, status, position);

ALTER TABLE public.workspace_products ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_products FROM anon, authenticated;
GRANT SELECT ON public.workspace_products TO authenticated;
GRANT ALL ON public.workspace_products TO service_role;

DROP POLICY IF EXISTS "Members read products" ON public.workspace_products;
CREATE POLICY "Members read products"
  ON public.workspace_products FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP TRIGGER IF EXISTS workspace_products_touch ON public.workspace_products;
CREATE TRIGGER workspace_products_touch BEFORE UPDATE ON public.workspace_products
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
