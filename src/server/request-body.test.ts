import { describe, expect, it } from "vitest";
import { readJsonBody, RequestBodyTooLargeError } from "./request-body";

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
