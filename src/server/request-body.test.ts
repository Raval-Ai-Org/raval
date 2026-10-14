import { describe, expect, it } from "vitest";
import { readJsonBody, readWebhookBody, RequestBodyTooLargeError } from "./request-body";

describe("readJsonBody", () => {
  it("parses JSON within the byte limit", async () => {
    const request = new Request("https://example.test/api", {
      method: "POST",
      body: JSON.stringify({ data: "ok" }),
    });
    await expect(readJsonBody(request, 64)).resolves.toEqual({ data: "ok" });
  });

  it("rejects a declared oversized body before reading it", async () => {
    const request = new Request("https://example.test/api", {
      method: "POST",
      headers: { "content-length": "100" },
      body: "{}",
    });
    await expect(readJsonBody(request, 10)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  it("rejects an oversized streamed body without Content-Length", async () => {
    const request = new Request("https://example.test/api", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"data":"'));
          controller.enqueue(new TextEncoder().encode("a".repeat(100)));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    await expect(readJsonBody(request, 20)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });
});

describe("signed webhook bodies", () => {
  it("preserves Unicode, whitespace and a BOM exactly for signatures", async () => {
    const raw = '\uFEFF{ "text": "سلام 🌍" }\r\n';
    const request = new Request("https://example.test/hook", { method: "POST", body: raw });
    expect(await readWebhookBody(request)).toBe(raw);
  });

  it("caps actual bytes even when Content-Length understates a Unicode payload", async () => {
    const request = new Request("https://example.test/hook", {
      method: "POST",
      headers: { "content-length": "1" },
      body: "🌍".repeat(10),
    });
    const response = await readWebhookBody(request, 20);
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(413);
  });

  it("cancels an oversized chunked stream without draining it", async () => {
    let cancelled = false;
    const request = new Request("https://example.test/hook", {
      method: "POST",
      duplex: "half",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(100));
        },
        cancel() {
          cancelled = true;
        },
      }),
    } as RequestInit);
    const response = await readWebhookBody(request, 20);
    expect((response as Response).status).toBe(413);
    expect(cancelled).toBe(true);
  });

  it("rejects malformed UTF-8 instead of verifying replacement characters", async () => {
    const request = new Request("https://example.test/hook", {
      method: "POST",
      body: new Uint8Array([0xff]),
    });
    const response = await readWebhookBody(request);
    expect((response as Response).status).toBe(400);
  });
});
