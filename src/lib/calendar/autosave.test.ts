import { describe, expect, it, vi } from "vitest";
import { AutosaveQueue } from "./autosave";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

type Patch = { title?: string; caption?: string };

describe("calendar autosave", () => {
  it("changes the read revision when edits are queued or completed", async () => {
    const queue = new AutosaveQueue<Patch>();
    const before = queue.version;
    queue.enqueue("post", { title: "New" });
    expect(queue.version).toBeGreaterThan(before);
    const queued = queue.version;
    await queue.flush("post", async () => undefined);
    expect(queue.version).toBeGreaterThan(queued);
  });
  it("serializes edits and makes approval wait for the latest batch", async () => {
    const queue = new AutosaveQueue<Patch>();
    const first = deferred();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    queue.enqueue("post", { title: "First title" });
    const background = queue.flush("post", save);
    await Promise.resolve();
    queue.enqueue("post", { title: "Latest title", caption: "Latest caption" });
    const approve = vi.fn();
    const approval = queue.flush("post", save).then(approve);
    expect(save).toHaveBeenCalledTimes(1);
    expect(queue.peek("post")).toEqual({ title: "Latest title", caption: "Latest caption" });
    expect(approve).not.toHaveBeenCalled();
    first.resolve();
    await Promise.all([background, approval]);
    expect(save.mock.calls.map(([patch]) => patch)).toEqual([
      { title: "First title" },
      { title: "Latest title", caption: "Latest caption" },
    ]);
    expect(approve).toHaveBeenCalledOnce();
    expect(queue.peek("post")).toEqual({});
  });

  it("retains failed fields, keeps newer edits and blocks dependent actions", async () => {
    const queue = new AutosaveQueue<Patch>();
    const first = deferred();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    queue.enqueue("post", { title: "First", caption: "Must retain" });
    const background = queue.flush("post", save);
    await Promise.resolve();
    queue.enqueue("post", { title: "Newer" });
    const approve = vi.fn();
    const approval = queue.flush("post", save).then(approve);
    const settled = Promise.allSettled([background, approval]);
    first.reject(new Error("Save failed"));
    expect((await settled).map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(approve).not.toHaveBeenCalled();
    expect(queue.peek("post")).toEqual({ title: "Newer", caption: "Must retain" });
    await queue.flush("post", save);
    expect(save).toHaveBeenLastCalledWith({ title: "Newer", caption: "Must retain" });
    expect(queue.pendingIds()).toEqual([]);
  });

  it("waits for an in-flight save before discarding a deleted post's edits", async () => {
    const queue = new AutosaveQueue<Patch>();
    const first = deferred();
    queue.enqueue("post", { title: "First" });
    const background = queue.flush("post", () => first.promise);
    const settled = Promise.allSettled([background]);
    const discarded = queue.discard("post");
    first.reject(new Error("Save failed"));
    await settled;
    await discarded;
    expect(queue.pendingIds()).toEqual([]);
  });

  it("does not start another queued save when a post is being deleted", async () => {
    const queue = new AutosaveQueue<Patch>();
    const first = deferred();
    const save = vi.fn(() => first.promise);
    queue.enqueue("post", { title: "First" });
    const background = queue.flush("post", save);
    await Promise.resolve();
    queue.enqueue("post", { title: "Never save after delete" });
    const discarded = queue.discard("post");
    first.resolve();
    await Promise.all([background, discarded]);
    expect(save).toHaveBeenCalledOnce();
    expect(queue.peek("post")).toEqual({});
  });

  it("allows different posts to save independently", async () => {
    const queue = new AutosaveQueue<Patch>();
    const first = deferred();
    queue.enqueue("a", { title: "A" });
    queue.enqueue("b", { title: "B" });
    const a = queue.flush("a", () => first.promise);
    const b = vi.fn().mockResolvedValue(undefined);
    await queue.flush("b", b);
    expect(b).toHaveBeenCalledOnce();
    expect(queue.peek("a")).toEqual({ title: "A" });
    first.resolve();
    await a;
  });
});
