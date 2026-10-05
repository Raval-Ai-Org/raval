import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Dimensions, RunRow, Subject, TwinRow } from "@/lib/audience/contracts";
import { makeTrait, type TwinDraft } from "@/lib/audience/twins";
import {
  runSweep,
  saveTwinDrafts,
  scoreSubjects,
  type AudiencePorts,
  type ScorePiece,
} from "./engine";
import { createMemoryAudienceStore, type MemoryAudienceStore } from "./store.memory";

const WS = "w0000000-0000-4000-8000-000000000001";
const USER = "u0000000-0000-4000-8000-000000000001";
const WORKER = "test-worker";

const dims = (n: number): Dimensions => ({ fit: n, hook: n, clarity: n, trust: n, cta: n });

const subject: Subject = {
  kind: "post",
  platform: "linkedin",
  title: "Launch",
  body: "We just opened bookings for winter. Which week works for you?",
};

const draft = (slug: string, weight: number): TwinDraft => ({
  slug,
  name: slug,
  segment: "",
  summary: "",
  weight,
  profile: [makeTrait("goal", `${slug} goal`, "brand_dna")],
  origin: "brand_dna",
  origin_ref: null,
});

let clock: Date;
let store: MemoryAudienceStore;
let finished: RunRow[];
let changed: string[];

function ports(over: Partial<AudiencePorts> = {}): AudiencePorts {
  return {
    now: () => clock,
    enabled: () => true,
    buildTwins: vi.fn(async () => [draft("owners", 60), draft("managers", 40)]),
    score: vi.fn(async (_actor: unknown, _twins: unknown, pieces: ScorePiece[]) => ({
      pieces: pieces.map((p) => ({
        index: p.index,
        dimensions: dims(70),
        why: "Clear offer.",
        fixes: ["Name the price"],
      })),
    })),
    react: vi.fn(async (_actor, twin: TwinRow, _subject, people: number) => ({
      dimensions: dims(twin.slug === "owners" ? 80 : 60),
      people: Array.from({ length: people }, (_, i) => ({
        who: `Person ${i}`,
        stance: i % 2 ? "like" : "neutral",
        quote: "Might book.",
        wouldAct: i === 0,
      })),
      likes: ["Clear dates"],
      objections: ["No price"],
    })),
    synthesize: vi.fn(async () => ({
      why: "People like the dates but want a price.",
      fixes: ["Add the price"],
    })),
    writeVariants: vi.fn(async () => [
      {
        label: "Problem first",
        title: "",
        body: "Winter slots go fast. Which week works for you?",
      },
      {
        label: "Short and blunt",
        title: "",
        body: "Winter bookings are open. Pick your week today?",
      },
    ]),
    judge: vi.fn(async (_actor: unknown, _twin: unknown, versions: unknown[], people: number) => ({
      versions: versions.map((_v, index) => ({
        index,
        dimensions: dims(index === 1 ? 85 : 55),
        picks: index === 1 ? people : 0,
        reason: `reason ${index}`,
      })),
    })),
    finished: (run) => finished.push(run),
    changed: (workspaceId) => changed.push(workspaceId),
    ...over,
  };
}

async function seedTwins() {
  await saveTwinDrafts(store, WS, [draft("owners", 60), draft("managers", 40)], USER);
}

async function enqueue(
  kind: RunRow["kind"],
  key = `${kind}-key-1`,
  input: RunRow["input"] = { subject, contentType: "social" },
) {
  return store.insertRun({ workspace_id: WS, kind, idempotency_key: key, input, created_by: USER });
}

const sweep = (p: AudiencePorts, onlyId?: string) => runSweep(store, p, { worker: WORKER, onlyId });
const run = async (id: string) => (await store.getRun(WS, id))!;

beforeEach(() => {
  clock = new Date("2026-10-05T08:00:00Z");
  store = createMemoryAudienceStore(() => clock);
  finished = [];
  changed = [];
});

describe("enqueue", () => {
  it("returns the same run for the same key", async () => {
    const first = await enqueue("pulse");
    const second = await enqueue("pulse");
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.run.id).toBe(first.run.id);
    expect(store.runs).toHaveLength(1);
  });
});

describe("building groups", () => {
  it("saves proposed groups, tells generators, and finishes", async () => {
    const p = ports();
    const { run: queued } = await enqueue("twins", "twins-key-1", {});
    await sweep(p, queued.id);
    const done = await run(queued.id);
    expect(done.status).toBe("succeeded");
    expect(done.output).toMatchObject({ groups: 2, added: 2 });
    expect(store.twins.map((t) => t.slug).sort()).toEqual(["managers", "owners"]);
    expect(changed).toEqual([WS]);
    expect(finished.map((r) => r.status)).toEqual(["succeeded"]);
    expect(store.events.map((e) => e.kind)).toEqual(["groups_saved"]);
  });

  it("fails plainly when there is nothing to build from", async () => {
    const { run: queued } = await enqueue("twins", "twins-key-2", {});
    await sweep(ports({ buildTwins: async () => [] }), queued.id);
    const done = await run(queued.id);
    expect(done.status).toBe("failed");
    expect(done.last_error).toContain("Brand DNA");
    expect(finished.map((r) => r.status)).toEqual(["failed"]);
  });

  it("keeps a person's group and an archived group as they left them", async () => {
    await seedTwins();
    const owners = store.twins.find((t) => t.slug === "owners")!;
    owners.origin = "user";
    owners.name = "My owners";
    owners.profile = [makeTrait("pain", "Mine", "user")];
    const managers = store.twins.find((t) => t.slug === "managers")!;
    managers.status = "archived";

    const out = await saveTwinDrafts(store, WS, [draft("owners", 10), draft("managers", 90)], USER);
    expect(out.updated).toBe(1);
    expect(owners.name).toBe("My owners");
    expect(owners.weight).toBe(60);
    expect(owners.profile.map((t) => t.text)).toEqual(
      expect.arrayContaining(["Mine", "owners goal"]),
    );
    expect(managers.status).toBe("archived");
  });

  it("does not bump the version when nothing changed, and stops at the limit", async () => {
    await seedTwins();
    const before = store.twins.map((t) => t.version);
    await seedTwins();
    expect(store.twins.map((t) => t.version)).toEqual(before);
    await saveTwinDrafts(
      store,
      WS,
      ["a", "b", "c", "d", "e", "f"].map((s) => draft(s, 10)),
      USER,
    );
    expect(store.twins.filter((t) => t.status === "active")).toHaveLength(6);
  });
});

describe("quick score", () => {
  const item = { subject, contentType: "social", contentItemId: null };

  it("returns nothing without an audience, and never calls the model", async () => {
    const p = ports();
    expect(
      await scoreSubjects({ store, ports: p }, { workspaceId: WS, userId: USER }, [item]),
    ).toEqual([null]);
    expect(p.score).not.toHaveBeenCalled();
  });

  it("scores once, then answers the same text from the stored result", async () => {
    await seedTwins();
    const p = ports();
    const actor = { workspaceId: WS, userId: USER };
    const [first] = await scoreSubjects({ store, ports: p }, actor, [item]);
    expect(first?.overall).toBe(70);
    expect(first?.result.confidence).toBe("low");
    expect(first?.result.fixes).toEqual(["Name the price"]);
    const [again] = await scoreSubjects({ store, ports: p }, actor, [
      { ...item, subject: { ...subject, body: subject.body.toUpperCase() } },
    ]);
    expect(again?.id).toBe(first?.id);
    expect(p.score).toHaveBeenCalledTimes(1);
  });

  it("scores again when the text or the audience changes", async () => {
    await seedTwins();
    const p = ports();
    const actor = { workspaceId: WS, userId: USER };
    await scoreSubjects({ store, ports: p }, actor, [item]);
    await scoreSubjects({ store, ports: p }, actor, [
      { ...item, subject: { ...subject, body: `${subject.body} New line?` } },
    ]);
    expect(p.score).toHaveBeenCalledTimes(2);
    await store.upsertTwin(WS, draft("owners", 70), USER);
    await scoreSubjects({ store, ports: p }, actor, [item]);
    expect(p.score).toHaveBeenCalledTimes(3);
  });

  it("applies free checks and real results on top of the model's numbers", async () => {
    await seedTwins();
    await store.saveCalibration({
      workspace_id: WS,
      platform: "linkedin",
      content_type: "social",
      n: 20,
      bias: 10,
      mae: 12,
      learned: [],
    });
    const flat = { ...subject, body: "We opened bookings for the winter season last week." };
    const [row] = await scoreSubjects(
      { store, ports: ports() },
      { workspaceId: WS, userId: USER },
      [{ ...item, subject: flat }],
    );
    // cta capped at 55: .85*70 + .15*55 = 67.75 → 68; shift 10*20/40 = 5.
    expect(row?.dimensions.cta).toBe(55);
    expect(row?.result.raw).toBe(68);
    expect(row?.overall).toBe(63);
    expect(row?.calibrated).toBe(true);
    expect(row?.result.confidence).toBe("high");
  });

  it("skips a piece the model left out instead of inventing a score", async () => {
    await seedTwins();
    const p = ports({
      score: async () => ({ pieces: [{ index: 1, dimensions: dims(60), why: "", fixes: [] }] }),
    });
    const out = await scoreSubjects({ store, ports: p }, { workspaceId: WS, userId: USER }, [
      item,
      { ...item, subject: { ...subject, body: "A second, different post. Reply with your pick?" } },
    ]);
    expect(out[0]).toBeNull();
    expect(out[1]?.overall).toBe(60);
  });
});

describe("deeper check", () => {
  it("asks every group, then summarises in a second stage", async () => {
    await seedTwins();
    const p = ports();
    const { run: queued } = await enqueue("pulse");
    await sweep(p, queued.id);
    const done = await run(queued.id);
    expect(done.status).toBe("succeeded");
    expect(done.progress).toEqual({ done: 3, total: 3 });
    expect(p.react).toHaveBeenCalledTimes(2);
    expect(p.synthesize).toHaveBeenCalledTimes(1);
    const prediction = store.predictions[0];
    expect(prediction.depth).toBe("pulse");
    expect(prediction.run_id).toBe(queued.id);
    expect(prediction.result.pulse?.people).toBe(16);
    expect(prediction.result.why).toContain("price");
    expect(prediction.result.confidence).toBe("low");
    expect(store.events.map((e) => e.kind)).toEqual([
      "group_answered",
      "group_answered",
      "result_ready",
    ]);
    expect(finished.map((r) => r.status)).toEqual(["succeeded"]);
  });

  it("never pays twice for a group after a crash", async () => {
    await seedTwins();
    let calls = 0;
    const flaky = ports({
      react: vi.fn(async (_a, twin: TwinRow, _s, people: number) => {
        calls++;
        if (twin.slug === "managers" && calls <= 2) throw new Error("provider down");
        return {
          dimensions: dims(70),
          people: Array.from({ length: people }, () => ({
            who: "x",
            stance: "like",
            quote: "ok",
            wouldAct: false,
          })),
          likes: [],
          objections: [],
        };
      }),
    });
    const { run: queued } = await enqueue("pulse");
    const first = await sweep(flaky, queued.id);
    expect(first.failed).toBe(1);
    let row = await run(queued.id);
    expect(row.status).toBe("running");
    expect(row.attempts).toBe(1);
    expect(Object.keys((row.state as { answers: object }).answers)).toHaveLength(1);
    expect(finished).toEqual([]);

    clock = new Date(clock.getTime() + 2 * 60_000);
    await sweep(flaky, queued.id);
    row = await run(queued.id);
    expect(row.status).toBe("succeeded");
    // owners once, managers twice (one failure, one success).
    expect(flaky.react).toHaveBeenCalledTimes(3);
  });

  it("gives up after repeated failures and reports the end once", async () => {
    await seedTwins();
    const broken = ports({
      react: async () => {
        throw new Error("down");
      },
    });
    const { run: queued } = await enqueue("pulse");
    for (let i = 0; i < 3; i++) {
      await sweep(broken, queued.id);
      clock = new Date(clock.getTime() + 10 * 60_000);
    }
    const row = await run(queued.id);
    expect(row.status).toBe("failed");
    expect(finished.map((r) => r.status)).toEqual(["failed"]);
    expect(store.predictions).toHaveLength(0);
  });

  it("fails when too few groups give a usable answer", async () => {
    await seedTwins();
    await store.upsertTwin(WS, draft("third", 20), USER);
    const p = ports({
      react: vi.fn(async (_a, twin: TwinRow) =>
        twin.slug === "owners"
          ? {
              dimensions: dims(70),
              people: [{ who: "x", stance: "like", quote: "ok", wouldAct: false }],
              likes: [],
              objections: [],
            }
          : { people: [] },
      ),
    });
    const { run: queued } = await enqueue("pulse");
    await sweep(p, queued.id);
    const row = await run(queued.id);
    expect(row.status).toBe("failed");
    expect(row.last_error).toContain("Too few");
    // An unusable answer is not asked for again.
    expect(p.react).toHaveBeenCalledTimes(3);
  });

  it("keeps the reactions when only the summary fails", async () => {
    await seedTwins();
    const { run: queued } = await enqueue("pulse");
    await sweep(
      ports({
        synthesize: async () => {
          throw new Error("down");
        },
      }),
      queued.id,
    );
    expect((await run(queued.id)).status).toBe("succeeded");
    expect(store.predictions[0].result.why).toBe("No price");
  });

  it("stops when cancelled mid-run and saves nothing", async () => {
    await seedTwins();
    const { run: queued } = await enqueue("pulse");
    const p = ports({
      react: vi.fn(async (_a, _twin, _s, people: number) => {
        await store.requestCancel(WS, queued.id);
        return {
          dimensions: dims(70),
          people: Array.from({ length: people }, () => ({
            who: "x",
            stance: "like",
            quote: "ok",
            wouldAct: false,
          })),
          likes: [],
          objections: [],
        };
      }),
    });
    await sweep(p, queued.id);
    const row = await run(queued.id);
    expect(row.status).toBe("cancelled");
    expect(store.predictions).toHaveLength(0);
    expect(p.synthesize).not.toHaveBeenCalled();
    expect(finished.map((r) => r.status)).toEqual(["cancelled"]);
  });

  it("cancels a queued run at once and never starts it", async () => {
    await seedTwins();
    const { run: queued } = await enqueue("pulse");
    expect((await store.requestCancel(WS, queued.id))?.status).toBe("cancelled");
    const p = ports();
    expect((await sweep(p, queued.id)).claimed).toBe(0);
    expect(p.react).not.toHaveBeenCalled();
  });

  it("needs an audience and leaves a switched-off workspace alone", async () => {
    const { run: none } = await enqueue("pulse", "pulse-key-none");
    await sweep(ports(), none.id);
    expect((await run(none.id)).last_error).toContain("audience");

    await seedTwins();
    const { run: off } = await enqueue("pulse", "pulse-key-off");
    const p = ports({ enabled: () => false });
    await sweep(p, off.id);
    expect((await run(off.id)).status).toBe("queued");
    expect(p.react).not.toHaveBeenCalled();
  });

  it("does not let a second worker take a leased run", async () => {
    await seedTwins();
    const { run: queued } = await enqueue("pulse");
    const [mine] = await store.claim("worker-a", 1, 150, queued.id);
    expect(await store.claim("worker-b", 1, 150, queued.id)).toEqual([]);
    expect(await store.updateRun(mine, "worker-b", { stage: "asking" })).toBe(false);
    clock = new Date(clock.getTime() + 151_000);
    expect(await store.claim("worker-b", 1, 150, queued.id)).toHaveLength(1);
  });
});

describe("comparing versions", () => {
  it("writes versions, has every group judge them, and names a winner", async () => {
    await seedTwins();
    const p = ports();
    const { run: queued } = await enqueue("tournament");
    await sweep(p, queued.id);
    const done = await run(queued.id);
    expect(done.status).toBe("succeeded");
    expect(p.writeVariants).toHaveBeenCalledTimes(1);
    expect(p.judge).toHaveBeenCalledTimes(2);
    const output = done.output as {
      variants: { isOriginal: boolean; rank: number; label: string }[];
      winnerIndex: number;
      tooClose: boolean;
      summary: string;
      confidence: string;
    };
    expect(output.variants).toHaveLength(3);
    expect(output.variants[0].isOriginal).toBe(true);
    expect(output.winnerIndex).toBe(1);
    expect(output.tooClose).toBe(false);
    expect(output.summary).toContain("Problem first");
    expect(output.confidence).toBe("low");
    expect(store.events.map((e) => e.kind)).toEqual([
      "versions_ready",
      "group_answered",
      "group_answered",
      "result_ready",
    ]);
  });

  it("does not rewrite the versions on a retry", async () => {
    await seedTwins();
    let judged = 0;
    const p = ports({
      judge: vi.fn(async (_a: unknown, _t: unknown, versions: unknown[], people: number) => {
        if (++judged === 1) throw new Error("down");
        return {
          versions: versions.map((_v, index) => ({
            index,
            dimensions: dims(60 + index),
            picks: index === 0 ? people : 0,
            reason: "",
          })),
        };
      }),
    });
    const { run: queued } = await enqueue("tournament");
    await sweep(p, queued.id);
    clock = new Date(clock.getTime() + 2 * 60_000);
    await sweep(p, queued.id);
    expect((await run(queued.id)).status).toBe("succeeded");
    expect(p.writeVariants).toHaveBeenCalledTimes(1);
  });

  it("compares supplied versions without writing any, and keeps their refs", async () => {
    await seedTwins();
    const p = ports();
    const { run: queued } = await enqueue("tournament", "tournament-key-concepts", {
      variants: [
        { label: "Concept A", title: "A", body: "A founder shows the mess before the fix." },
        { label: "Concept B", title: "B", body: "A customer unboxes it on camera." },
      ],
      variantRefs: ["c-a", "c-b"],
    });
    await sweep(p, queued.id);
    const output = (await run(queued.id)).output as {
      variants: { ref: string; isOriginal: boolean }[];
    };
    expect(p.writeVariants).not.toHaveBeenCalled();
    expect(output.variants.map((v) => v.ref)).toEqual(["c-a", "c-b"]);
    expect(output.variants.some((v) => v.isOriginal)).toBe(false);
  });

  it("says when the result is a coin toss", async () => {
    await seedTwins();
    const p = ports({
      judge: async (_a, _t, versions, people: number) => ({
        versions: versions.map((_v, index) => ({
          index,
          dimensions: dims(70),
          picks: Math.floor(people / versions.length),
          reason: "",
        })),
      }),
    });
    const { run: queued } = await enqueue("tournament");
    await sweep(p, queued.id);
    const output = (await run(queued.id)).output as { tooClose: boolean; summary: string };
    expect(output.tooClose).toBe(true);
    expect(output.summary).toContain("too close to call");
  });

  it("fails when no other version could be written", async () => {
    await seedTwins();
    const { run: queued } = await enqueue("tournament");
    await sweep(ports({ writeVariants: async () => [] }), queued.id);
    expect((await run(queued.id)).status).toBe("failed");
  });
});
