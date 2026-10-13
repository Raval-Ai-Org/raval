-- Visual evidence and approved directions share existing private assets.
CREATE TABLE IF NOT EXISTS public.brand_visual_capture_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  url text NOT NULL CHECK (char_length(url) <= 2048),
  mode text NOT NULL DEFAULT 'website' CHECK(mode IN ('website','references')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  stage text NOT NULL DEFAULT 'queued',
  pages jsonb NOT NULL DEFAULT '[]', max_pages integer NOT NULL DEFAULT 4 CHECK (max_pages BETWEEN 1 AND 8),
  next_page integer NOT NULL DEFAULT 0, attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz, lease_token uuid, error text, warnings jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS public.brand_visual_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  capture_job_id uuid REFERENCES public.brand_visual_capture_jobs(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('website','upload','library')),
  purpose text NOT NULL DEFAULT 'style' CHECK (purpose IN ('style','product','person','inspiration','avoid')),
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','approved','removed')),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes)<=600),
  formats text[] NOT NULL DEFAULT '{}', campaign text, source_url text,
  region jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,asset_id)
);
CREATE TABLE IF NOT EXISTS public.brand_visual_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  capture_job_id uuid REFERENCES public.brand_visual_capture_jobs(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','approved')),
  profile jsonb NOT NULL CHECK (jsonb_typeof(profile)='object'),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(capture_job_id)
);
CREATE TABLE IF NOT EXISTS public.brand_visual_settings (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  active_profile_id uuid REFERENCES public.brand_visual_profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.brand_visual_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.brand_visual_profiles(id) ON DELETE SET NULL,
  job_id uuid REFERENCES public.studio_jobs(id) ON DELETE CASCADE,
  source_ids uuid[] NOT NULL DEFAULT '{}',
  reason text NOT NULL CHECK(reason IN ('matches','wrong-theme','wrong-product','too-busy','typography','too-artificial')),
  note text NOT NULL DEFAULT '' CHECK(char_length(note)<=600),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,job_id,created_by)
);
CREATE INDEX IF NOT EXISTS brand_visual_jobs_due ON public.brand_visual_capture_jobs(status,lease_until);
CREATE UNIQUE INDEX IF NOT EXISTS brand_visual_one_active_scan ON public.brand_visual_capture_jobs(workspace_id) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS brand_visual_sources_ws ON public.brand_visual_sources(workspace_id,status);
CREATE INDEX IF NOT EXISTS brand_visual_profiles_ws ON public.brand_visual_profiles(workspace_id,created_at DESC);
CREATE INDEX IF NOT EXISTS brand_visual_feedback_ws ON public.brand_visual_feedback(workspace_id,created_at DESC);
CREATE OR REPLACE FUNCTION public.guard_brand_visual_workspace()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_TABLE_NAME='brand_visual_sources' THEN
    IF NOT EXISTS(SELECT 1 FROM public.assets WHERE id=NEW.asset_id AND workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'visual_asset_wrong_workspace'; END IF;
    IF NEW.capture_job_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.brand_visual_capture_jobs WHERE id=NEW.capture_job_id AND workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'visual_capture_wrong_workspace'; END IF;
  ELSIF TG_TABLE_NAME='brand_visual_profiles' THEN
    IF NEW.capture_job_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.brand_visual_capture_jobs WHERE id=NEW.capture_job_id AND workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'visual_capture_wrong_workspace'; END IF;
  ELSIF TG_TABLE_NAME='brand_visual_settings' THEN
    IF NEW.active_profile_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.brand_visual_profiles WHERE id=NEW.active_profile_id AND workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'visual_profile_wrong_workspace'; END IF;
  ELSIF TG_TABLE_NAME='brand_visual_feedback' THEN
    IF NEW.profile_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.brand_visual_profiles WHERE id=NEW.profile_id AND workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'visual_profile_wrong_workspace'; END IF;
    IF NEW.job_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.studio_jobs WHERE id=NEW.job_id AND workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'visual_job_wrong_workspace'; END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['brand_visual_sources','brand_visual_profiles','brand_visual_settings','brand_visual_feedback'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS brand_visual_workspace_guard ON public.%I',t);
    EXECUTE format('CREATE TRIGGER brand_visual_workspace_guard BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_brand_visual_workspace()',t);
  END LOOP;
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['brand_visual_capture_jobs','brand_visual_sources','brand_visual_profiles','brand_visual_settings','brand_visual_feedback'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated',t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
    EXECUTE format('DROP POLICY IF EXISTS "Members read visual taste" ON public.%I',t);
    EXECUTE format('CREATE POLICY "Members read visual taste" ON public.%I FOR SELECT TO authenticated USING (private.is_workspace_member(workspace_id,auth.uid()))',t);
  END LOOP;
END $$;

-- Serialize approval/restore and preserve concurrently edited Brand DNA fields.
CREATE OR REPLACE FUNCTION public.activate_brand_visual_profile(p_workspace uuid,p_profile uuid,p_expected uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actual uuid; chosen jsonb;
BEGIN
  INSERT INTO public.brand_visual_settings(workspace_id) VALUES(p_workspace) ON CONFLICT DO NOTHING;
  SELECT active_profile_id INTO actual FROM public.brand_visual_settings WHERE workspace_id=p_workspace FOR UPDATE;
  IF actual IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'visual_direction_changed'; END IF;
  SELECT profile INTO chosen FROM public.brand_visual_profiles WHERE id=p_profile AND workspace_id=p_workspace;
  IF chosen IS NULL THEN RAISE EXCEPTION 'visual_profile_not_found'; END IF;
  UPDATE public.brand_visual_profiles SET status='approved' WHERE id=p_profile AND workspace_id=p_workspace;
  UPDATE public.brand_visual_sources SET status='approved'
    WHERE workspace_id=p_workspace AND kind='website' AND status='candidate'
    AND id::text IN(SELECT jsonb_array_elements_text(coalesce(chosen->'directions'->coalesce((chosen->>'selected')::integer,0)->'sourceIds','[]'::jsonb)));
  UPDATE public.brand_visual_settings SET active_profile_id=p_profile,updated_at=now() WHERE workspace_id=p_workspace;
  UPDATE public.workspace_brand_dna SET
    dna=jsonb_set(dna,'{visualProfileId}',to_jsonb(p_profile::text),true),version=version+1,updated_at=now()
    WHERE workspace_id=p_workspace;
END $$;
REVOKE ALL ON FUNCTION public.activate_brand_visual_profile(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.activate_brand_visual_profile(uuid,uuid,uuid) TO service_role;

-- Brand DNA saves from an older browser must retain the authoritative visual link.
CREATE OR REPLACE FUNCTION public.guard_visual_dna_link()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE active uuid;
BEGIN
  SELECT active_profile_id INTO active FROM public.brand_visual_settings WHERE workspace_id=NEW.workspace_id;
  IF active IS NOT NULL THEN NEW.dna=jsonb_set(coalesce(NEW.dna,'{}'::jsonb),'{visualProfileId}',to_jsonb(active::text),true);
  ELSE NEW.dna=coalesce(NEW.dna,'{}'::jsonb)-'visualProfileId'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS visual_dna_link_guard ON public.workspace_brand_dna;
CREATE TRIGGER visual_dna_link_guard BEFORE INSERT OR UPDATE ON public.workspace_brand_dna FOR EACH ROW EXECUTE FUNCTION public.guard_visual_dna_link();

CREATE OR REPLACE FUNCTION public.use_manual_visual_look(p_workspace uuid,p_expected uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actual uuid;
BEGIN
  INSERT INTO public.brand_visual_settings(workspace_id) VALUES(p_workspace) ON CONFLICT DO NOTHING;
  SELECT active_profile_id INTO actual FROM public.brand_visual_settings WHERE workspace_id=p_workspace FOR UPDATE;
  IF actual IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'visual_direction_changed'; END IF;
  UPDATE public.brand_visual_settings SET active_profile_id=NULL,updated_at=now() WHERE workspace_id=p_workspace;
  UPDATE public.workspace_brand_dna SET dna=dna-'visualProfileId',version=version+1,updated_at=now() WHERE workspace_id=p_workspace;
END $$;
REVOKE ALL ON FUNCTION public.use_manual_visual_look(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.use_manual_visual_look(uuid,uuid) TO service_role;

-- Text edits replace every linked draft together, and lose a race to scheduling.
CREATE OR REPLACE FUNCTION public.replace_visual_artwork(p_workspace uuid,p_job uuid,p_expected jsonb,p_output jsonb,p_asset uuid,p_headline text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.studio_jobs%ROWTYPE; a public.assets%ROWTYPE; linked integer;
BEGIN
  SELECT * INTO j FROM public.studio_jobs WHERE id=p_job AND workspace_id=p_workspace FOR UPDATE;
  IF j.id IS NULL OR j.status<>'succeeded' OR j.output IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'visual_artwork_changed'; END IF;
  SELECT * INTO a FROM public.assets WHERE id=p_asset AND workspace_id=p_workspace AND status='ready' AND deleted_at IS NULL;
  IF a.id IS NULL OR a.storage_path IS NULL THEN RAISE EXCEPTION 'visual_asset_unavailable'; END IF;
  PERFORM id FROM public.content_items WHERE workspace_id=p_workspace AND id=ANY(j.content_item_ids) ORDER BY id FOR UPDATE;
  SELECT count(*) INTO linked FROM public.content_items WHERE workspace_id=p_workspace AND id=ANY(j.content_item_ids) AND status IN ('draft','pending','approved');
  IF linked=0 OR linked<>cardinality(j.content_item_ids) THEN RAISE EXCEPTION 'visual_post_changed'; END IF;
  UPDATE public.content_items SET status='draft',media_url=NULL,
    meta=coalesce(meta,'{}'::jsonb)||jsonb_build_object('artwork_headline',p_headline,'asset_id',p_asset,'asset_storage_path',a.storage_path,'asset_status','ready','media_type','image')
    WHERE workspace_id=p_workspace AND id=ANY(j.content_item_ids);
  UPDATE public.studio_jobs SET output=p_output,asset_ids=array_append(coalesce(asset_ids,'{}'::uuid[]),p_asset) WHERE id=p_job AND workspace_id=p_workspace;
END $$;
REVOKE ALL ON FUNCTION public.replace_visual_artwork(uuid,uuid,jsonb,jsonb,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.replace_visual_artwork(uuid,uuid,jsonb,jsonb,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_visual_analysis(p_job uuid,p_token uuid,p_profile jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.brand_visual_capture_jobs%ROWTYPE;
BEGIN
  SELECT * INTO j FROM public.brand_visual_capture_jobs WHERE id=p_job FOR UPDATE;
  IF j.id IS NULL OR j.status<>'running' OR j.lease_token IS DISTINCT FROM p_token THEN RAISE EXCEPTION 'visual_scan_cancelled'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=j.workspace_id AND user_id=j.created_by AND role IN ('owner','admin','editor')) THEN RAISE EXCEPTION 'visual_scan_access_removed'; END IF;
  INSERT INTO public.brand_visual_profiles(workspace_id,capture_job_id,created_by,profile) VALUES(j.workspace_id,j.id,j.created_by,p_profile) ON CONFLICT(capture_job_id) DO NOTHING;
  UPDATE public.brand_visual_capture_jobs SET status='succeeded',stage='ready',lease_until=NULL,lease_token=NULL,error=NULL,updated_at=now() WHERE id=j.id;
END $$;
REVOKE ALL ON FUNCTION public.complete_visual_analysis(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_visual_analysis(uuid,uuid,jsonb) TO service_role;

-- A video storyboard is an image preview, never a finished video approval.
CREATE OR REPLACE FUNCTION public.guard_visual_storyboard_approval()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.meta->>'requires_visual_video'='true' THEN
    NEW.meta=jsonb_set(coalesce(NEW.meta,'{}'::jsonb),'{requires_visual_video}','true'::jsonb,true);
  END IF;
  IF NEW.status IN ('approved','scheduled','publishing') AND NEW.meta->>'storyboard_preview'='true' THEN
    RAISE EXCEPTION 'Render the video before approving its storyboard';
  END IF;
  IF NEW.status IN ('approved','scheduled','publishing') AND NEW.meta->>'requires_visual_video'='true' AND NOT EXISTS(
    SELECT 1 FROM public.assets WHERE id::text=NEW.meta->>'asset_id' AND workspace_id=NEW.workspace_id AND status='ready' AND asset_type='video' AND deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'A finished video asset is required'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS visual_storyboard_approval_guard ON public.content_items;
CREATE TRIGGER visual_storyboard_approval_guard BEFORE INSERT OR UPDATE ON public.content_items
FOR EACH ROW EXECUTE FUNCTION public.guard_visual_storyboard_approval();
