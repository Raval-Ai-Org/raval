-- Serialize installation, withdrawal, and refresh per workspace. Only trusted
-- server code may execute these functions; encrypted tokens never reach members.
CREATE OR REPLACE FUNCTION public.save_canva_authorization(
  p_workspace_id uuid, p_user_id uuid, p_state_id uuid,
  p_access_token_enc text, p_refresh_token_enc text,
  p_expires_at timestamptz, p_scopes text[], p_canva_user_id text, p_canva_team_id text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_connection_id uuid;
BEGIN
  IF p_canva_user_id IS NULL OR p_canva_team_id IS NULL
    OR length(p_canva_user_id) NOT BETWEEN 1 AND 256
    OR length(p_canva_team_id) NOT BETWEEN 1 AND 256
    THEN RAISE EXCEPTION 'Canva identity required'; END IF;
  PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workspace unavailable'; END IF;
  PERFORM 1 FROM public.workspace_members
    WHERE workspace_id = p_workspace_id AND user_id = p_user_id
      AND role IN ('owner', 'admin', 'editor');
  IF NOT FOUND THEN RAISE EXCEPTION 'Workspace authorization required'; END IF;
  PERFORM 1 FROM public.connector_install_states
    WHERE id = p_state_id AND workspace_id = p_workspace_id AND user_id = p_user_id
      AND provider = 'canva' AND consumed_at IS NOT NULL AND expires_at > now()
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Canva authorization expired or withdrawn'; END IF;

  INSERT INTO public.workspace_connections (
    workspace_id, provider, status, external_account_id, account_login,
    verification, connected_by, permissions, metadata, updated_at
  ) VALUES (
    p_workspace_id, 'canva', 'active', 'workspace', 'Canva', 'oauth',
    p_user_id, jsonb_build_object('scopes', p_scopes),
    jsonb_build_object('canva_user_id', p_canva_user_id, 'canva_team_id', p_canva_team_id), now()
  ) ON CONFLICT (workspace_id, provider, external_account_id) DO UPDATE SET
    status = 'active', account_login = 'Canva', verification = 'oauth',
    connected_by = p_user_id, permissions = EXCLUDED.permissions,
    metadata = public.workspace_connections.metadata || EXCLUDED.metadata,
    revoked_at = NULL, last_error = NULL, updated_at = now()
  RETURNING id INTO v_connection_id;

  INSERT INTO public.canva_oauth_credentials (
    connection_id, workspace_id, access_token_enc, refresh_token_enc,
    access_token_expires_at, scopes, updated_at
  ) VALUES (v_connection_id, p_workspace_id, p_access_token_enc,
    p_refresh_token_enc, p_expires_at, p_scopes, now())
  ON CONFLICT (connection_id) DO UPDATE SET
    access_token_enc = EXCLUDED.access_token_enc,
    refresh_token_enc = EXCLUDED.refresh_token_enc,
    access_token_expires_at = EXCLUDED.access_token_expires_at,
    scopes = EXCLUDED.scopes, updated_at = now();
  DELETE FROM public.connector_install_states WHERE id = p_state_id;
  RETURN v_connection_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.withdraw_canva_authorization(p_workspace_id uuid)
RETURNS TABLE(refresh_token_enc text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workspace unavailable'; END IF;
  RETURN QUERY SELECT c.refresh_token_enc FROM public.canva_oauth_credentials c
    WHERE c.workspace_id = p_workspace_id;
  DELETE FROM public.connector_install_states
    WHERE workspace_id = p_workspace_id AND provider = 'canva';
  UPDATE public.workspace_connections SET status = 'revoked', revoked_at = now(), updated_at = now()
    WHERE workspace_id = p_workspace_id AND provider = 'canva';
  DELETE FROM public.canva_oauth_credentials WHERE workspace_id = p_workspace_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_canva_authorization(
  p_workspace_id uuid, p_connection_id uuid, p_previous_refresh_token_enc text,
  p_access_token_enc text, p_refresh_token_enc text, p_expires_at timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.canva_oauth_credentials c SET
    access_token_enc = p_access_token_enc, refresh_token_enc = p_refresh_token_enc,
    access_token_expires_at = p_expires_at, updated_at = now()
    WHERE c.workspace_id = p_workspace_id AND c.connection_id = p_connection_id
      AND c.refresh_token_enc = p_previous_refresh_token_enc
      AND EXISTS (SELECT 1 FROM public.workspace_connections w
        WHERE w.id = p_connection_id AND w.workspace_id = p_workspace_id
          AND w.provider = 'canva' AND w.status = 'active');
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.save_canva_authorization(uuid, uuid, uuid, text, text, timestamptz, text[], text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.withdraw_canva_authorization(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_canva_authorization(uuid, uuid, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_canva_authorization(uuid, uuid, uuid, text, text, timestamptz, text[], text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.withdraw_canva_authorization(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_canva_authorization(uuid, uuid, text, text, text, timestamptz) TO service_role;
