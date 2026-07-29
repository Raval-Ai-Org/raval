DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_ws uuid;
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
  ON CONFLICT (id) DO UPDATE SET
    name = COALESCE(EXCLUDED.name, public.profiles.name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.profiles.avatar_url);

  SELECT wm.workspace_id INTO new_ws
  FROM public.workspace_members wm
  WHERE wm.user_id = NEW.id
  ORDER BY wm.created_at ASC
  LIMIT 1;

  IF new_ws IS NULL THEN
    INSERT INTO public.workspaces (owner_id, name)
    VALUES (NEW.id, 'My Workspace')
    RETURNING id INTO new_ws;

    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (new_ws, NEW.id, 'owner')
    ON CONFLICT (workspace_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();