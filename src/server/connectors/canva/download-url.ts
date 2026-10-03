/** Canva export links are provider-owned, HTTPS, and short-lived. */
export function validCanvaDownloadUrl(raw: string) {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      (url.hostname === "canva.com" || url.hostname.endsWith(".canva.com")) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
