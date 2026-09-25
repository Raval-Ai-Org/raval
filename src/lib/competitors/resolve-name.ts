import {
  hostOf,
  isAggregatorSource,
  isLowQualitySource,
  type WebSource,
} from "@/lib/research/sources";

/** A scan-supplied name becomes a website only when search found its own domain. */
export function siteForNamedCompetitor(
  name: string,
  sources: readonly WebSource[],
  ownDomain: string | null,
): WebSource | null {
  const generic = new Set(["the", "and", "for", "inc", "ltd", "app", "com", "company", "software"]);
  const tokens =
    name
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter((part) => part.length >= 3 && !generic.has(part)) ?? [];
  if (!tokens.length) return null;
  return (
    sources.find((source) => {
      if (isLowQualitySource(source.url) || isAggregatorSource(source.url)) return false;
      const host = hostOf(source.url);
      if (!host || host === ownDomain || (ownDomain && host.endsWith(`.${ownDomain}`)))
        return false;
      const hostname = host.replace(/[^a-z0-9]/g, "");
      return tokens.some((token) => hostname.includes(token));
    }) ?? null
  );
}
