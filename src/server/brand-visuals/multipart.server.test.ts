import { it, expect } from "vitest";
import { readReferenceForm } from "./multipart.server";

it("rejects a chunked reference before parsing an unbounded body", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      c.enqueue(new Uint8Array(8));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("https://mellox.test/upload", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit);
  await expect(readReferenceForm(request, 10)).rejects.toThrow(/smaller/);
  expect(cancelled).toBe(true);
});
it("accepts a bounded multipart reference", async () => {
  const form = new FormData();
  form.set("notes", "Use this lighting");
  const result = await readReferenceForm(
    new Request("https://mellox.test/upload", { method: "POST", body: form }),
  );
  expect(result.get("notes")).toBe("Use this lighting");
});
