import type { Metadata } from "next";
import { Trash2 } from "lucide-react";
import LegalPage from "@/marketing/components/legal/LegalPage";
import Rich from "@/marketing/components/legal/Rich";
import {
  DATA_DELETION,
  DATA_DELETION_PREFACE,
  DATA_DELETION_UPDATED,
} from "@/marketing/lib/data-deletion";

export const metadata: Metadata = {
  title: "Data deletion",
  description:
    "How to remove Mellox AI's access to your Instagram or Facebook account and have your data deleted.",
  alternates: { canonical: "/data-deletion" },
};

export default function DataDeletionPage() {
  return (
    <LegalPage
      icon={<Trash2 size={26} strokeWidth={1.4} aria-hidden="true" />}
      pill="Legal"
      title="Data deletion"
      updated={DATA_DELETION_UPDATED}
      intro={DATA_DELETION_PREFACE.map((p) => (
        <p key={p}>
          <Rich text={p} />
        </p>
      ))}
      sections={DATA_DELETION}
    />
  );
}
