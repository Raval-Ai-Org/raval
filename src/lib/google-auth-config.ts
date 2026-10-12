/** OAuth Web client IDs are public identifiers, never client secrets. */
export function isGoogleWebClientId(value: unknown): value is string {
  return (
    typeof value === "string" && /^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(value)
  );
}
