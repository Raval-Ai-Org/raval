
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE display_name text; avatar text;
BEGIN
  display_name := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1), 'New user');
  avatar := COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture');
  INSERT INTO public.profiles (id, name, avatar_url) VALUES (NEW.id, display_name, avatar)
  ON CONFLICT (id) DO UPDATE SET name = COALESCE(EXCLUDED.name, public.profiles.name), avatar_url = COALESCE(EXCLUDED.avatar_url, public.profiles.avatar_url);
  RETURN NEW;
END; $function$;

-- Remove stale auto-created empty workspaces (never onboarded, no website, no chats, no content)
DELETE FROM public.workspaces w
WHERE w.name = 'My Workspace'
  AND w.website_url IS NULL
  AND w.onboarded_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.chat_messages c WHERE c.workspace_id = w.id)
  AND NOT EXISTS (SELECT 1 FROM public.content_items ci WHERE ci.workspace_id = w.id)
  AND (SELECT count(*) FROM public.workspace_members m WHERE m.workspace_id = w.id) <= 1;
