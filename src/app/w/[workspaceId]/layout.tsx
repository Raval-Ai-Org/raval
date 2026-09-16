import { SessionGate } from "@/components/auth/SessionGate";
import { WorkspaceProvider } from "@/components/workspace/WorkspaceProvider";

// Every page under /w/<workspaceId> acts on exactly that workspace. The
// provider verifies membership before any workspace UI renders, and is keyed
// by the id so switching workspaces remounts (and so resets) all workspace
// state below it.
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
      <WorkspaceProvider key={workspaceId} workspaceId={workspaceId}>
        {children}
      </WorkspaceProvider>
    </SessionGate>
  );
}
