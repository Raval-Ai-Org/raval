// Provider-neutral failure wording for video renders.
import "server-only";

/** A provider's failure message, reworded when it is a safety-filter block. */
export function friendlyFailure(message: string | null): string {
  if (!message) return "The provider couldn't render this video.";
  if (/flagged|policy|violat|sensitive|nsfw|minor|prominent people/i.test(message)) {
    return "Safety review blocked this video. Do not bypass a safety refusal. Review /safety or contact support@mellox.ai to request review.";
  }
  return message.slice(0, 300);
}
