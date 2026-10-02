// What Autopilot learned from its own results. Pure: measured posts in, a few
// plain sentences out. The sentences go into the next weekly plan and onto the
// home screen, so the plan adapts and the person can see why.

export type MeasuredPiece = {
  title: string;
  platform: string | null;
  contentType: string | null;
  views: number;
};

const LABEL: Record<string, string> = {
  linkedin: "LinkedIn",
  twitter: "X",
  instagram: "Instagram",
  facebook: "Facebook",
  threads: "Threads",
  tiktok: "TikTok",
  youtube: "YouTube",
  social: "posts",
  image: "image posts",
  carousel: "carousels",
  video: "videos",
};

function averages(pieces: MeasuredPiece[], key: (p: MeasuredPiece) => string | null) {
  const groups = new Map<string, number[]>();
  for (const piece of pieces) {
    const k = key(piece);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), piece.views]);
  }
  return (
    [...groups.entries()]
      // Two measured posts at least, so one lucky post is not a pattern.
      .filter(([, views]) => views.length >= 2)
      .map(([name, views]) => ({ name, avg: views.reduce((a, b) => a + b, 0) / views.length }))
      .sort((a, b) => b.avg - a.avg)
  );
}

/** Up to three findings, strongest first. Empty until there is enough to go on. */
export function summarizeLearnings(pieces: MeasuredPiece[]): string[] {
  const measured = pieces.filter((p) => p.views > 0);
  if (measured.length < 3) return [];
  const out: string[] = [];

  const best = [...measured].sort((a, b) => b.views - a.views)[0];
  out.push(`Best so far: "${best.title}" (${best.views.toLocaleString("en-US")} views).`);

  const platforms = averages(measured, (p) => p.platform);
  if (platforms.length >= 2 && platforms[0].avg >= platforms[platforms.length - 1].avg * 1.3) {
    const top = platforms[0];
    const low = platforms[platforms.length - 1];
    const times = Math.round((top.avg / Math.max(1, low.avg)) * 10) / 10;
    out.push(
      `${LABEL[top.name] ?? top.name} reaches about ${times}× more people than ${LABEL[low.name] ?? low.name}.`,
    );
  }

  const formats = averages(measured, (p) => p.contentType);
  if (formats.length >= 2 && formats[0].avg >= formats[formats.length - 1].avg * 1.3) {
    const top = LABEL[formats[0].name] ?? formats[0].name;
    const low = LABEL[formats[formats.length - 1].name] ?? formats[formats.length - 1].name;
    out.push(`${top.charAt(0).toUpperCase()}${top.slice(1)} do better than ${low}.`);
  }
  return out.slice(0, 3);
}
