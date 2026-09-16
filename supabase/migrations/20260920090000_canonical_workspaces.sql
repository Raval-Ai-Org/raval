-- Canonical workspaces: one brand (normalized website domain) = one workspace
-- per owner, race-proof server-side creation, and guarded workspace columns.
--
-- Existing duplicates are FLAGGED (duplicate_of → the canonical workspace),
-- never merged or deleted here: their data stays where it is until the owner
-- decides in the UI. The unique index only covers unflagged rows.

-- ── Domain normalization ────────────────────────────────────────────────────
-- Must match src/lib/workspace/domain.ts (a unit test pins the cases).
CREATE OR REPLACE FUNCTION private.normalize_domain(url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  host text;
BEGIN
  IF url IS NULL THEN
    RETURN NULL;
  END IF;
  host := lower(btrim(url));
  host := regexp_replace(host, '^[a-z][a-z0-9+.-]*://', '');
  host := regexp_replace(host, '[/?#].*$', '');
  host := regexp_replace(host, '^[^@]*@', '');
  host := regexp_replace(host, ':[0-9]*$', '');
  host := regexp_replace(host, '\.+$', '');
  host := regexp_replace(host, '^www\.', '');
  IF host = '' THEN
    RETURN NULL;
  END IF;
  RETURN host;
END;
$$;

REVOKE ALL ON FUNCTION private.normalize_domain(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.normalize_domain(text) TO authenticated, service_role;

ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS domain text;
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS duplicate_of uuid REFERENCES public.workspaces(id) ON DELETE SET NULL;

UPDATE public.workspaces
   SET domain = private.normalize_domain(website_url)
 WHERE domain IS DISTINCT FROM private.normalize_domain(website_url);

-- ── Workspace role helper ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.workspace_role(_workspace_id uuid, _user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.workspace_members
   WHERE workspace_id = _workspace_id AND user_id = _user_id
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION private.workspace_role(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.workspace_role(uuid, uuid) TO authenticated, service_role;

-- ── Column guard ────────────────────────────────────────────────────────────
-- domain is always derived; plan / owner / duplicate flag are server-managed.
CREATE OR REPLACE FUNCTION private.guard_workspace_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.domain := private.normalize_domain(NEW.website_url);
  IF TG_OP = 'UPDATE' AND auth.uid() IS NOT NULL AND (
    NEW.plan IS DISTINCT FROM OLD.plan OR
    NEW.owner_id IS DISTINCT FROM OLD.owner_id OR
    NEW.duplicate_of IS DISTINCT FROM OLD.duplicate_of
  ) THEN
    RAISE EXCEPTION 'workspace plan, owner and duplicate flag are server-managed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_workspace_columns() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.guard_workspace_columns() TO service_role;

DROP TRIGGER IF EXISTS workspaces_column_guard ON public.workspaces;
CREATE TRIGGER workspaces_column_guard
  BEFORE INSERT OR UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION private.guard_workspace_columns();

-- ── Flag existing duplicates ────────────────────────────────────────────────
-- Canonical = the copy with the most real activity (connections > chats/scans
-- > studio > content), then onboarded, then oldest.
WITH scored AS (
  SELECT w.id, w.owner_id, w.domain,
         (SELECT count(*) FROM public.social_accounts s WHERE s.workspace_id = w.id) * 100
       + (SELECT count(*) FROM public.workspace_connections c WHERE c.workspace_id = w.id) * 50
       + (SELECT count(*) FROM public.conversations c WHERE c.workspace_id = w.id) * 10
       + (SELECT count(*) FROM public.geo_scans g WHERE g.workspace_id = w.id) * 10
       + (SELECT count(*) FROM public.studio_jobs j WHERE j.workspace_id = w.id) * 5
       + (SELECT count(*) FROM public.content_items i WHERE i.workspace_id = w.id)
       + CASE WHEN w.onboarded_at IS NOT NULL THEN 3 ELSE 0 END AS score,
         w.created_at
    FROM public.workspaces w
   WHERE w.domain IS NOT NULL
), ranked AS (
  SELECT id, owner_id, domain,
         first_value(id) OVER (PARTITION BY owner_id, domain ORDER BY score DESC, created_at ASC) AS canonical_id
    FROM scored
)
UPDATE public.workspaces w
   SET duplicate_of = r.canonical_id
  FROM ranked r
 WHERE w.id = r.id
   AND r.id <> r.canonical_id
   AND w.duplicate_of IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS workspaces_owner_domain_unique
  ON public.workspaces (owner_id, domain)
  WHERE domain IS NOT NULL AND duplicate_of IS NULL;

-- ── Idempotent creation ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspace_create_requests (
  idempotency_key text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_create_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_create_requests FROM anon, authenticated;
GRANT ALL ON public.workspace_create_requests TO service_role;

-- Creation is server-only: the browser can no longer insert workspaces directly
-- (that path skipped duplicate detection and membership).
DROP POLICY IF EXISTS workspaces_insert_owner ON public.workspaces;
DROP FUNCTION IF EXISTS public.create_workspace(text, text);

-- Returns (workspace_id, created). created = false means an existing workspace
-- was returned: the same idempotency key was replayed, or the owner already has
-- a workspace for this domain. A per-user advisory lock serializes concurrent
-- creates (double clicks, retries, multiple tabs).
CREATE OR REPLACE FUNCTION private.create_workspace_for_user(
  p_user_id uuid,
  p_name text,
  p_website_url text,
  p_idempotency_key text
)
RETURNS TABLE (workspace_id uuid, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_domain text := private.normalize_domain(p_website_url);
  v_existing uuid;
  v_id uuid;
BEGIN
  IF p_user_id IS NULL OR coalesce(btrim(p_name), '') = '' THEN
    RAISE EXCEPTION 'user and name are required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('workspace-create:' || p_user_id::text));

  IF p_idempotency_key IS NOT NULL THEN
    SELECT r.workspace_id INTO v_existing
      FROM public.workspace_create_requests r
     WHERE r.idempotency_key = p_idempotency_key AND r.user_id = p_user_id;
    IF v_existing IS NOT NULL THEN
      RETURN QUERY SELECT v_existing, false;
      RETURN;
    END IF;
  END IF;

  IF v_domain IS NOT NULL THEN
    SELECT w.id INTO v_existing
      FROM public.workspaces w
     WHERE w.owner_id = p_user_id AND w.domain = v_domain AND w.duplicate_of IS NULL
     LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN QUERY SELECT v_existing, false;
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.workspaces (owner_id, name, website_url)
  VALUES (p_user_id, btrim(p_name), nullif(btrim(coalesce(p_website_url, '')), ''))
  RETURNING id INTO v_id;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (v_id, p_user_id, 'owner');

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.workspace_create_requests (idempotency_key, user_id, workspace_id)
    VALUES (p_idempotency_key, p_user_id, v_id)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN QUERY SELECT v_id, true;
END;
$$;

REVOKE ALL ON FUNCTION private.create_workspace_for_user(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.create_workspace_for_user(uuid, text, text, text) TO service_role;

-- PostgREST only exposes public; this thin wrapper stays service-role only.
CREATE OR REPLACE FUNCTION public.create_workspace_for_user(
  p_user_id uuid,
  p_name text,
  p_website_url text,
  p_idempotency_key text
)
RETURNS TABLE (workspace_id uuid, created boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM private.create_workspace_for_user(p_user_id, p_name, p_website_url, p_idempotency_key);
$$;

REVOKE ALL ON FUNCTION public.create_workspace_for_user(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_workspace_for_user(uuid, text, text, text) TO service_role;

-- ── Deletion record ─────────────────────────────────────────────────────────
-- audit_logs cascade with the workspace, so deletions are recorded here.
CREATE TABLE IF NOT EXISTS public.workspace_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  workspace_name text,
  domain text,
  owner_id uuid,
  deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  storage_objects_removed integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_deletions FROM anon, authenticated;
GRANT ALL ON public.workspace_deletions TO service_role;

-- ── Invites: owners and admins manage them ──────────────────────────────────
DROP POLICY IF EXISTS invites_select_owner ON public.workspace_invites;
DROP POLICY IF EXISTS invites_insert_owner ON public.workspace_invites;
DROP POLICY IF EXISTS invites_update_owner ON public.workspace_invites;
DROP POLICY IF EXISTS invites_delete_owner ON public.workspace_invites;
DROP POLICY IF EXISTS invites_select_admin ON public.workspace_invites;
DROP POLICY IF EXISTS invites_insert_admin ON public.workspace_invites;
DROP POLICY IF EXISTS invites_update_admin ON public.workspace_invites;
DROP POLICY IF EXISTS invites_delete_admin ON public.workspace_invites;

CREATE POLICY invites_select_admin ON public.workspace_invites FOR SELECT TO authenticated
  USING (private.workspace_role(workspace_id, auth.uid()) IN ('owner', 'admin'));
CREATE POLICY invites_insert_admin ON public.workspace_invites FOR INSERT TO authenticated
  WITH CHECK (
    private.workspace_role(workspace_id, auth.uid()) IN ('owner', 'admin')
    AND invited_by = auth.uid()
  );
CREATE POLICY invites_update_admin ON public.workspace_invites FOR UPDATE TO authenticated
  USING (private.workspace_role(workspace_id, auth.uid()) IN ('owner', 'admin'))
  WITH CHECK (private.workspace_role(workspace_id, auth.uid()) IN ('owner', 'admin'));
CREATE POLICY invites_delete_admin ON public.workspace_invites FOR DELETE TO authenticated
  USING (private.workspace_role(workspace_id, auth.uid()) IN ('owner', 'admin'));
