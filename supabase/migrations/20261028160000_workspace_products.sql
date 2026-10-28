-- The brand's real products, found on its website (or added by a person), each
-- with a photo stored as a private workspace asset. Studio shows the exact
-- product in ads and pictures instead of inventing one.
--
-- Members read through RLS; writes go through the server (role checked there)
-- with the service role, like brand_visual_sources. A product a person removed
-- stays `removed`, so the next website scan never brings it back.
CREATE TABLE IF NOT EXISTS public.workspace_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  url text NOT NULL CHECK (char_length(url) BETWEEN 1 AND 2048),
  price text NOT NULL DEFAULT '' CHECK (char_length(price) <= 40),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  category text NOT NULL DEFAULT '' CHECK (char_length(category) <= 120),
  image_asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  image_storage_path text CHECK (image_storage_path IS NULL OR char_length(image_storage_path) <= 1024),
  image_source_url text CHECK (image_source_url IS NULL OR char_length(image_source_url) <= 2048),
  source text NOT NULL DEFAULT 'scan' CHECK (source IN ('scan', 'manual')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  is_primary boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, url)
);

CREATE INDEX IF NOT EXISTS workspace_products_ws
  ON public.workspace_products (workspace_id, status, position);
-- At most one main product per brand.
CREATE UNIQUE INDEX IF NOT EXISTS workspace_products_one_primary
  ON public.workspace_products (workspace_id) WHERE is_primary AND status = 'active';

-- A product's photo must be an asset of the same workspace.
CREATE OR REPLACE FUNCTION public.guard_workspace_product()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.image_asset_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.assets WHERE id = NEW.image_asset_id AND workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'product_asset_wrong_workspace';
  END IF;
  IF NEW.image_storage_path IS NOT NULL AND (
       left(NEW.image_storage_path, char_length('workspace/' || NEW.workspace_id::text || '/assets/'))
         <> 'workspace/' || NEW.workspace_id::text || '/assets/'
       OR position('..' IN NEW.image_storage_path) > 0
     ) THEN
    RAISE EXCEPTION 'product_path_wrong_workspace';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS workspace_product_guard ON public.workspace_products;
CREATE TRIGGER workspace_product_guard
  BEFORE INSERT OR UPDATE ON public.workspace_products
  FOR EACH ROW EXECUTE FUNCTION public.guard_workspace_product();

ALTER TABLE public.workspace_products ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_products FROM anon, authenticated;
GRANT SELECT ON public.workspace_products TO authenticated;
GRANT ALL ON public.workspace_products TO service_role;
DROP POLICY IF EXISTS "Members read products" ON public.workspace_products;
CREATE POLICY "Members read products" ON public.workspace_products
  FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));
