GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_shares TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_share_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_events TO authenticated;
GRANT ALL ON public.client_shares TO service_role;
GRANT ALL ON public.client_share_items TO service_role;
GRANT ALL ON public.client_events TO service_role;

-- Allow inserts on client_events under RLS for workspace members (manual marketer-side notes).
-- The public client portal inserts via service_role and bypasses RLS.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='client_events' AND policyname='Members insert events'
  ) THEN
    CREATE POLICY "Members insert events" ON public.client_events
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.client_shares cs
          JOIN public.workspace_members wm ON wm.workspace_id = cs.workspace_id
          WHERE cs.id = client_events.share_id AND wm.user_id = auth.uid()
        )
      );
  END IF;
END $$;