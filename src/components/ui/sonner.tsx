"use client";

import { Toaster as Sonner } from "sonner";
import { useTheme } from "@/hooks/use-theme";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Notices sit top-centre, under the top bar, so they never cover the Generate
// button, the message box or the Studio dock (all bottom of the screen). One
// short card per notice, a status stripe instead of a loud fill, at most three
// at once.
const base =
  "pointer-events-auto flex w-[min(380px,calc(100vw-2rem))] items-start gap-3 rounded-2xl bg-surface-4 p-3.5 pr-10 text-foreground shadow-4 ring-1 ring-border/70";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();
  return (
    <Sonner
      className="toaster group"
      theme={theme as ToasterProps["theme"]}
      position="top-center"
      offset={{ top: 68, left: 16, right: 16 }}
      mobileOffset={{ top: 60, left: 16, right: 16 }}
      visibleToasts={3}
      duration={4500}
      gap={10}
      closeButton
      expand={false}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: base,
          content: "min-w-0 flex-1",
          title: "text-sm font-medium leading-snug text-foreground",
          description: "mt-0.5 text-xs leading-snug text-muted-foreground",
          icon: "mt-0.5 size-4 shrink-0 [&>svg]:size-4",
          actionButton:
            "ml-2 shrink-0 self-center rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90",
          cancelButton:
            "ml-2 shrink-0 self-center rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-muted-foreground",
          closeButton:
            "!left-auto !right-2.5 !top-2.5 !size-6 !translate-x-0 !translate-y-0 !rounded-full !border-0 !bg-transparent !text-muted-foreground hover:!bg-surface-2 hover:!text-foreground",
          success: "[&_[data-icon]]:text-success !ring-success-border",
          error: "[&_[data-icon]]:text-danger !ring-danger-border",
          warning: "[&_[data-icon]]:text-warning !ring-warning-border",
          info: "[&_[data-icon]]:text-info",
          loading: "[&_[data-icon]]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
