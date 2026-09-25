// Provider-neutral failure wording for video renders.
import "server-only";

/** A provider's failure message, reworded when it is a safety-filter block. */
export function friendlyFailure(message: string | null): string {
  if (!message) return "The provider couldn't render this video.";
  if (/flagged|policy|violat|sensitive|nsfw|minor|prominent people/i.test(message)) {
    return `The provider's safety filter blocked this video (${message.slice(0, 160)}). Try rewording the script or using a different product photo.`;
  }
  return message.slice(0, 300);
}
