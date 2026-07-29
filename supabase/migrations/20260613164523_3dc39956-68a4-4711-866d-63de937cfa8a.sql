
-- Restrict approvals UPDATE to privileged roles only
DROP POLICY IF EXISTS approvals_update_members ON public.approvals;
CREATE POLICY approvals_update_privileged ON public.approvals
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = approvals.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner','admin','editor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = approvals.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner','admin','editor')
    )
  );

-- Explicit deny for chat_messages UPDATE/DELETE (append-only)
DROP POLICY IF EXISTS chat_no_update ON public.chat_messages;
CREATE POLICY chat_no_update ON public.chat_messages
  FOR UPDATE USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS chat_no_delete ON public.chat_messages;
CREATE POLICY chat_no_delete ON public.chat_messages
  FOR DELETE USING (false);
