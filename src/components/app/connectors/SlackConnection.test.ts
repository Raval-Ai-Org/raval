import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/workspace/WorkspaceProvider", () => ({
  useOptionalWorkspaceRole: () => "admin",
}));
vi.mock("@/lib/slack.functions", () => ({}));

import { SlackConnection } from "./SlackConnection";

describe("Slack Connections card", () => {
  it("shows native branding and a loading state while connection details load", () => {
    const html = renderToStaticMarkup(
      React.createElement(SlackConnection, {
        workspaceId: "00000000-0000-4000-8000-000000000001",
      }),
    );
    expect(html).toContain("Slack connection");
    expect(html).toContain("Review content, get a daily brief");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('role="status" aria-busy="true"');
  });
});
