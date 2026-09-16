-- Schema drift fix: the live project still ran the OLD handle_new_user, which
-- inserts a "My Workspace" (and owner membership) for every signup, although
-- 20260709212343 replaced it with a profile-only version. That placeholder is
-- a workspace nobody chose — it showed up on /projects and as a fallback.
--
-- Re-assert the profile-only trigger function. Workspaces are only ever created
-- explicitly (private.create_workspace_for_user). Existing placeholder rows are
-- left in place; the owner decides whether to delete them.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  display_name text;
  avatar text;
BEGIN
  display_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1),
    'New user'
  );
  avatar := COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture');
  INSERT INTO public.profiles (id, name, avatar_url)
  VALUES (NEW.id, display_name, avatar)
  ON CONFLICT (id) DO UPDATE
    SET name = COALESCE(EXCLUDED.name, public.profiles.name),
        avatar_url = COALESCE(EXCLUDED.avatar_url, public.profiles.avatar_url);
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
