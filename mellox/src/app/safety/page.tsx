import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import LegalPage from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "AI Safety and Acceptable Use",
  description:
    "Mellox AI prohibits non-consensual intimate imagery, sexual exploitation and deceptive impersonation. Read our safeguards and report abuse.",
  alternates: { canonical: "/safety" },
};

export default function SafetyPage() {
  return (
    <LegalPage
      icon={<ShieldCheck aria-hidden="true" />}
      pill="Trust and safety"
      title="AI Safety and Acceptable Use"
      updated="11 October 2026"
      intro={
        <p>
          Mellox AI helps businesses and agencies create responsible marketing. These rules apply to
          prompts, reference uploads, generated images and videos, shared content, connected
          accounts and Google API use.
        </p>
      }
      sections={[
        {
          id: "prohibited",
          title: "Prohibited uses",
          list: [
            "Never create, request, alter, upload, share or facilitate non-consensual intimate imagery (NCII), including AI-generated NCII, deepfake pornography and non-consensual synthetic sexual content involving an identifiable person.",
            "Sexual exploitation, sexual content involving minors, coercion, trafficking, harassment and threats to distribute intimate imagery are prohibited. Claiming consent does not permit exploitation or unlawful content.",
            "Do not deceptively impersonate people, fabricate endorsements, invade privacy or misuse a person's face, voice, likeness, confidential information or third-party intellectual property. Obtain the necessary rights and consent for reference material.",
            "Do not use Google APIs, Google-derived information or any connected service for these purposes or to evade its terms. Do not bypass safety checks or try another provider to evade a refusal.",
          ],
        },
        {
          id: "safeguards",
          title: "Safeguards and enforcement",
          paras: [
            "Mellox reviews image and video generation prompts on the server and checks reference images before generation. Generated images are checked before they are returned or cached. A blocked request is refused; when these checks cannot complete, generation is paused rather than treated as safe. Safety refusals cannot be overridden by acknowledging a warning or by automatic provider fallback.",
            "Finished videos are checked using sampled frames every two seconds before release. Stored media is also reviewed before sharing, publishing or scheduled publishing. These checks pause the action if review cannot complete; they do not cover every instant or review audio, and cannot establish a person's consent or detect every abuse.",
            "Safety events record rule/category information for investigation without recording full prompts or intimate images in those events. Mellox may block sharing, remove content or suspend/terminate access under its Terms. Human investigation and account enforcement remain necessary alongside automated safeguards.",
          ],
        },
        {
          id: "report",
          title: "Report abuse or request review",
          paras: [
            "Report suspected NCII, exploitation, impersonation or privacy/IP abuse to support@mellox.ai or https://mellox.ai/contact. You do not need a Mellox account to report. Include a content URL or identifier, the issue, your relationship to the content and a way to contact you. Do not attach intimate imagery or unnecessary sensitive information.",
            "Use the same contact to request review of a mistaken refusal or enforcement decision. Human investigation and account-level enforcement require the operator's support process; mailbox monitoring and escalation responsibilities must be confirmed before launch.",
            "Read the full Terms of Service at https://mellox.ai/terms and Privacy Policy at https://mellox.ai/privacy. Google API use is subject to https://developers.google.com/terms and https://developers.google.com/terms/api-services-user-data-policy.",
          ],
        },
      ]}
    />
  );
}
