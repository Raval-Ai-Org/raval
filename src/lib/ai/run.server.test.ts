import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
const mocks = vi.hoisted(() => ({ chat: vi.fn() }));
vi.mock("@/lib/ai-gateway.server", () => ({
  chatCompletion: mocks.chat,
  AiGatewayError: class extends Error {},
}));
vi.mock("@/server/guardrails/events", () => ({ logGuardrailEvent: vi.fn() }));
import { runStructuredPrompt } from "./run.server";
beforeEach(() => {
  vi.clearAllMocks();
});
it("shows the source photo to the caption model, including during a JSON repair", async () => {
  mocks.chat
    .mockResolvedValueOnce({ choices: [{ message: { content: "not json" } }] })
    .mockResolvedValueOnce({
      choices: [{ message: { content: '{"caption":"The blue product shown in the photo"}' } }],
    });
  const result = await runStructuredPrompt({
    route: "studio.upload-captions",
    system: "Describe the actual product.",
    user: "Write a caption.",
    images: [{ mediaType: "image/webp", data: "aGVsbG8=" }],
    schema: z.object({ caption: z.string() }),
  });
  expect(result.caption).toContain("blue product");
  expect(mocks.chat).toHaveBeenCalledTimes(2);
  for (const [request] of mocks.chat.mock.calls) {
    expect(request.messages[1].content).toContainEqual({
      type: "image_url",
      image_url: { url: "data:image/webp;base64,aGVsbG8=" },
    });
  }
});
