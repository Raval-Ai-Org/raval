import AppShell from "@/app/app/AppShell";

// The workspace shell persists across /w/<id>/app and /w/<id>/app/chat/<conv>,
// so opening a conversation doesn't remount chat mid-reply. The shell reads the
// active conversation from the URL.
export default function WorkspaceAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppShell />
      {children}
    </>
  );
}
