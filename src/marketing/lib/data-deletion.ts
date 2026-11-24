// Content for /data-deletion: the data deletion instructions page Meta (and Google) ask an app to publish.
// Keep it in step with the retention section of privacy.ts; both read the same day counts.
import { META_DELETION_DAYS, META_MESSAGE_RETENTION_DAYS } from "./privacy";
import type { TermsSection } from "./terms";

export const DATA_DELETION_UPDATED = "24 November 2026";

export const DATA_DELETION_PREFACE = [
  "You can remove Mellox's access to your accounts and have the data Mellox holds about you deleted at any time. This page explains how, what is deleted and how long it takes.",
  "If you connected Instagram or Facebook to Mellox, or you sent a comment or message to a business that uses Mellox, the steps below apply to you.",
];

export const DATA_DELETION: TermsSection[] = [
  {
    id: "remove-access",
    title: "Remove Mellox from Instagram or Facebook",
    paras: [
      "This stops Mellox from reading or posting anything new straight away. Mellox then deletes the data it holds from that account, as described below.",
    ],
    blocks: [
      { h: "Instagram" },
      {
        ol: [
          "Open Instagram and go to your profile, then Settings and activity.",
          "Open Website permissions (or Apps and websites), then Apps and websites.",
          "Find Mellox under Active and choose Remove.",
        ],
      },
      { h: "Facebook" },
      {
        ol: [
          "Open Facebook and go to Settings and privacy, then Settings.",
          "Open Apps and websites (under Your activity or Permissions).",
          "Find Mellox and choose Remove.",
        ],
      },
      {
        p: "You can also disconnect an account inside Mellox: Settings, then Social accounts, then Disconnect. Either way works; you don't need to do both.",
      },
    ],
  },
  {
    id: "request-deletion",
    title: "Ask us to delete your data",
    paras: [
      "Email privacy@mellox.ai with the subject Data deletion request, or use https://mellox.ai/contact. Tell us the Instagram username, Facebook Page or Mellox account email the request is about. We may ask you to confirm the request from that account or email so nobody can delete someone else's data.",
      "If you are not a Mellox customer but commented on or messaged a business that uses Mellox, include the business's account name and your own username. That business controls its own copy of the conversation, but we will delete what Mellox holds.",
    ],
  },
  {
    id: "what-is-deleted",
    title: "What is deleted, and when",
    list: [
      `Within ${META_DELETION_DAYS} days of removing Mellox, disconnecting the account or a confirmed request: the account's sign-in connection, comments, messages and replies, the account and post information Mellox read from Meta, and AI reply drafts made from them.`,
      `Even without a request, Instagram and Facebook comments and messages are deleted ${META_MESSAGE_RETENTION_DAYS} days after they arrive.`,
      "Deleting your whole Mellox account or workspace deletes everything in it the same way, including Brand DNA, content and connected-account data.",
      "Backups held by our hosting providers roll over on their own schedules, and deleted data leaves them as they expire. Records we must keep by law, such as billing and tax records, and security logs that show a connection existed, are kept only as long as that purpose needs.",
      "Posts you already published stay on Instagram or Facebook. Delete them there if you want them gone.",
    ],
  },
  {
    id: "confirmation",
    title: "Confirmation",
    paras: [
      "We reply to every deletion request by email to confirm it was received, and again when the deletion is complete. Questions about this page: privacy@mellox.ai. The full details are in our Privacy Policy at https://mellox.ai/privacy.",
    ],
  },
];
