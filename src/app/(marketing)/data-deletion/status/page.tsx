// Where Meta's data deletion callback sends a person to check their request
// (src/app/api/integrations/meta/data-deletion). The code is signed, so this
// page needs no table: a valid code means Mellox received the request and
// deleted at that moment.
import type { Metadata } from "next";
import { Trash2 } from "lucide-react";
import LegalPage from "@/marketing/components/legal/LegalPage";
import { readDeletionCode } from "@/lib/engage/meta-signed";
import { metaConfig } from "@/server/engage/meta/config.server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Data deletion status",
  robots: { index: false, follow: false },
};

function secret(): string {
  try {
    return metaConfig().appSecret;
  } catch {
    return "";
  }
}

export default async function DataDeletionStatusPage(props: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const { code } = await props.searchParams;
  const value = typeof code === "string" ? code.slice(0, 64) : "";
  const at = value ? readDeletionCode(value, secret()) : null;
  const when = at
    ? new Date(at).toLocaleString("en-GB", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: "UTC",
      }) + " UTC"
    : null;
  return (
    <LegalPage
      icon={<Trash2 size={26} strokeWidth={1.4} aria-hidden="true" />}
      pill="Legal"
      title="Data deletion status"
      updated={when ?? "—"}
      intro={
        when ? (
          <p>
            Request <strong>{value}</strong>: done. Mellox received it on {when} and deleted the
            data it held from that Facebook or Instagram connection at once: the sign-in, the Pages,
            comments, messages, replies and AI drafts.
          </p>
        ) : (
          <p>
            We couldn&apos;t find that confirmation code. Check it was copied whole, or email
            privacy@mellox.ai with the code and we&apos;ll look it up.
          </p>
        )
      }
      sections={[
        {
          id: "more",
          title: "More about deleting your data",
          paras: [
            "What Mellox deletes, and how to ask for anything else to be deleted, is explained at https://mellox.ai/data-deletion. Questions: privacy@mellox.ai.",
          ],
        },
      ]}
    />
  );
}
