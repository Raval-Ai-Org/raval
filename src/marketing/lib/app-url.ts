export const APP_URL = "/signup";

export function appUrlFor(site: string): string {
  const value = site.trim();
  return value ? `${APP_URL}?url=${encodeURIComponent(value.slice(0, 2000))}` : APP_URL;
}
