// Connected apps (ADR-0042): what is connected, and the two business actions
// a person can ask for by name. Saving an email draft and exporting the
// calendar only make something new in the person's own tool; nothing is sent,
// and in chat both are a button.
import "server-only";
import { z } from "zod";
import { callFn } from "../bridge.server";
import { uuid, type McpTool } from "../tool";

type AppsView = {
  enabled: boolean;
  accounts: Array<{ app: string; label: string; status: string }>;
};

export const appsTools: McpTool[] = [
  {
    name: "list_connected_apps",
    title: "Connected apps",
    description:
      "Apps this brand connected through Mellox (Instagram, Facebook Pages, Pinterest, HubSpot, Mailchimp, Google Sheets) and whether each one works or needs reconnecting.",
    input: {},
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: async ({ workspaceId }, { caller }) => {
      const view = await callFn<AppsView>(caller, "integrations", "getIntegrations", {
        workspaceId,
      });
      return {
        on: view.enabled,
        apps: view.accounts.map((a) => ({ app: a.app, name: a.label, status: a.status })),
      };
    },
  },
  {
    name: "save_email_draft",
    title: "Save as a Mailchimp draft",
    description:
      "Save one post's words (and its picture) as a draft campaign in the brand's connected Mailchimp, for its first audience unless one is named. It is never sent: the person checks and sends it in Mailchimp.",
    input: { contentItemId: uuid, listId: z.string().min(1).max(40).optional() },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: ({ workspaceId, contentItemId, listId }, { caller }) =>
      callFn(caller, "integrations", "saveEmailDraft", { workspaceId, contentItemId, listId }),
  },
  {
    name: "export_calendar_to_sheets",
    title: "Export the calendar to Google Sheets",
    description:
      "Make a new Google Sheet in the brand's connected Google account with every planned and scheduled post between two dates (date, channel, status, title, text, link). It never edits an existing sheet.",
    input: {
      from: z.string().datetime({ offset: true }),
      to: z.string().datetime({ offset: true }),
    },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: ({ workspaceId, from, to }, { caller }) =>
      callFn(caller, "integrations", "exportCalendarToSheets", { workspaceId, from, to }),
  },
];
