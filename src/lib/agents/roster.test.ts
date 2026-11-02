import { describe, expect, it } from "vitest";
import { AUTOMATIONS } from "@/lib/autopilot/contracts";
import { AGENTS, agentState, rosterStates, type AgentFacts } from "./roster";

const empty: AgentFacts = {
  hasBrandDna: false,
  socialAccounts: 0,
  hasWebsite: false,
  autopilotOn: false,
  automations: [],
  apps: [],
  communityThreads: 0,
  agentsPaused: false,
  disabledWorkers: [],
};

const full: AgentFacts = {
  hasBrandDna: true,
  socialAccounts: 2,
  hasWebsite: true,
  autopilotOn: true,
  automations: ["geo_scan", "repurpose", "weekly_report"],
  apps: ["hubspot"],
  communityThreads: 5,
  agentsPaused: false,
  disabledWorkers: [],
};

const byId = (f: AgentFacts) => Object.fromEntries(rosterStates(f).map((s) => [s.id, s]));

describe("agents roster", () => {
  it("has six agents, each with a place and plain words", () => {
    expect(AGENTS.map((a) => a.id)).toEqual([
      "strategist",
      "creator",
      "social",
      "community",
      "search",
      "growth",
    ]);
    for (const a of AGENTS) {
      expect(a.does.length).toBeGreaterThan(10);
      for (const auto of a.automations) expect(AUTOMATIONS).toContain(auto);
    }
  });

  it("says what's missing and where to fix it", () => {
    const s = byId(empty);
    expect(s.strategist.state).toBe("needs");
    expect(s.strategist.missing[0].fix).toMatch(/Brain/);
    expect(s.growth.missing.map((m) => m.need)).toEqual(["crm"]);
    expect(s.social.missing.map((m) => m.need)).toEqual(["social_account", "autopilot"]);
  });

  it("is working only when something really runs", () => {
    const s = byId(full);
    expect(s.search).toMatchObject({ state: "working", running: ["geo_scan"] });
    expect(s.growth).toMatchObject({ state: "working", running: ["weekly_report"] });
    expect(s.social.state).toBe("working");
    expect(s.strategist.state).toBe("ready");
    expect(byId({ ...full, autopilotOn: false }).search).toMatchObject({
      state: "ready",
      running: [],
    });
  });

  it("shows paused checks when the team paused the agents", () => {
    const paused = agentState(
      AGENTS.find((a) => a.id === "creator")!,
      {
        ...full,
        agentsPaused: true,
      },
    );
    expect(paused.state).toBe("paused");
    const off = agentState(
      AGENTS.find((a) => a.id === "creator")!,
      {
        ...full,
        automations: [],
        disabledWorkers: ["content-fit"],
      },
    );
    expect(off).toMatchObject({ state: "ready", checksOff: ["content-fit"] });
  });
});
