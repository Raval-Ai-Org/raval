import { SessionGate } from "@/components/auth/SessionGate";
import { PlanGate } from "@/components/auth/PlanGate";
import { WorkspaceProvider } from "@/components/workspace/WorkspaceProvider";

// Every page under /w/<workspaceId> acts on exactly that workspace. The
// provider verifies membership before any workspace UI renders, and is keyed
// by the id so switching workspaces remounts (and so resets) all workspace
// state below it. With no plan behind the workspace, /checkout comes first
// (PlanGate), onboarding included.
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  return (
    <SessionGate>
      <PlanGate key={workspaceId} workspaceId={workspaceId}>
        <WorkspaceProvider key={workspaceId} workspaceId={workspaceId}>
          {children}
        </WorkspaceProvider>
      </PlanGate>
    </SessionGate>
  );
}
