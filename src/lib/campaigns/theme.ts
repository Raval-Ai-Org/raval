// How a campaign looks on its card: a few emoji and a soft two-colour wash,
// picked from the campaign's name (Halloween, Diwali, Black Friday…) and,
// failing that, from its kind. Pure and browser-safe; it only decorates.
// Add a moment here, never rename one: the art is matched by keyword.

export type CampaignTheme = {
  /** Three emoji, the first is the hero. */
  art: readonly [string, string, string];
  /** The wash behind the art, as two CSS colours. */
  from: string;
  to: string;
};

type Rule = { match: RegExp } & CampaignTheme;

const MOMENTS: readonly Rule[] = [
  { match: /hallowe/i, art: ["🎃", "👻", "🦇"], from: "#ff9a3c", to: "#6b3fa0" },
  { match: /diwali|deepavali/i, art: ["🪔", "✨", "🎆"], from: "#ffb347", to: "#e0457b" },
  { match: /black friday/i, art: ["🛍️", "🏷️", "⚡"], from: "#2b2b2b", to: "#5a5a5a" },
  { match: /cyber monday/i, art: ["💻", "⚡", "🛒"], from: "#2f6bff", to: "#7a3cff" },
  { match: /small business/i, art: ["🏪", "🤝", "💚"], from: "#3ec97a", to: "#1f8a70" },
  { match: /giving tuesday/i, art: ["💝", "🤲", "🌱"], from: "#ff7aa8", to: "#ffb86b" },
  {
    match: /christmas|xmas|holiday season|holidays/i,
    art: ["🎄", "🎁", "❄️"],
    from: "#d6334b",
    to: "#1f8a4c",
  },
  { match: /new year/i, art: ["🎉", "🥂", "🎆"], from: "#ffd166", to: "#5b4bdb" },
  { match: /year in review|wrapped/i, art: ["📅", "🏆", "✨"], from: "#7a5cff", to: "#2ec4b6" },
  { match: /valentine/i, art: ["💘", "🌹", "💌"], from: "#ff5c8a", to: "#ff9eb5" },
  { match: /women'?s day/i, art: ["💜", "🌷", "✊"], from: "#a259ff", to: "#ff7ac6" },
  { match: /ramadan/i, art: ["🌙", "🏮", "✨"], from: "#24306b", to: "#c9a227" },
  { match: /eid/i, art: ["🌙", "🕌", "✨"], from: "#1f8a70", to: "#c9a227" },
  { match: /easter/i, art: ["🐣", "🥚", "🌷"], from: "#ffd6e8", to: "#b8e986" },
  { match: /earth day/i, art: ["🌍", "🌱", "♻️"], from: "#3ec97a", to: "#2f80ed" },
  { match: /mother'?s day/i, art: ["💐", "💗", "🎀"], from: "#ff8fb1", to: "#ffc9a8" },
  { match: /father'?s day/i, art: ["👔", "🛠️", "💙"], from: "#2f80ed", to: "#56ccf2" },
  { match: /back to school/i, art: ["🎒", "✏️", "📚"], from: "#ffb703", to: "#219ebc" },
  { match: /mid-?year/i, art: ["📊", "🧭", "✅"], from: "#2ec4b6", to: "#7a5cff" },
  { match: /q4|planning season/i, art: ["🗓️", "🎯", "📈"], from: "#ff9f1c", to: "#2ec4b6" },
  { match: /summer/i, art: ["☀️", "🏖️", "🍉"], from: "#ffbe0b", to: "#fb5607" },
  { match: /spring/i, art: ["🌸", "🌿", "🦋"], from: "#ffafcc", to: "#a7d676" },
  { match: /autumn|fall\b/i, art: ["🍂", "🍁", "☕"], from: "#e76f51", to: "#f4a261" },
  { match: /winter/i, art: ["❄️", "⛄", "☕"], from: "#a2d2ff", to: "#5e60ce" },
  { match: /thanksgiving/i, art: ["🦃", "🥧", "🍂"], from: "#e76f51", to: "#9c6644" },
  { match: /pride/i, art: ["🏳️‍🌈", "💖", "✨"], from: "#ff5c8a", to: "#5b8cff" },
  { match: /holi\b/i, art: ["🎨", "🌈", "💦"], from: "#ff4fa0", to: "#ffd23f" },
  {
    match: /lunar new year|chinese new year/i,
    art: ["🧧", "🏮", "🐉"],
    from: "#d62828",
    to: "#f77f00",
  },
  { match: /independence|national day/i, art: ["🎆", "🎉", "🏳️"], from: "#2f80ed", to: "#eb5757" },
];

const KINDS: Record<string, CampaignTheme> = {
  "product-launch": { art: ["🚀", "✨", "📦"], from: "#7a5cff", to: "#2ec4b6" },
  event: { art: ["📅", "🎤", "🎟️"], from: "#2f80ed", to: "#9b51e0" },
  seasonal: { art: ["🍂", "❄️", "🌸"], from: "#ff9f1c", to: "#2ec4b6" },
  sale: { art: ["🏷️", "🛍️", "💸"], from: "#ff5c5c", to: "#ffb347" },
  showcase: { art: ["✨", "💎", "📸"], from: "#a259ff", to: "#ff7ac6" },
  teach: { art: ["💡", "📚", "🧠"], from: "#ffd166", to: "#06d6a0" },
  memes: { art: ["😂", "🔥", "💬"], from: "#ffbe0b", to: "#ff006e" },
  "behind-scenes": { art: ["🎬", "📷", "☕"], from: "#6c757d", to: "#2ec4b6" },
  "social-proof": { art: ["⭐", "💬", "🏆"], from: "#ffd166", to: "#ef476f" },
  giveaway: { art: ["🎁", "🎉", "🍀"], from: "#ef476f", to: "#ffd166" },
  "lead-magnet": { art: ["🧲", "📩", "📘"], from: "#118ab2", to: "#06d6a0" },
  collab: { art: ["🤝", "✨", "🙌"], from: "#7a5cff", to: "#ff7ac6" },
  milestone: { art: ["🏆", "🎉", "📈"], from: "#ffb703", to: "#fb8500" },
  "grand-opening": { art: ["🎀", "🏪", "🎊"], from: "#ef476f", to: "#ffd166" },
  hiring: { art: ["🧑‍💼", "📣", "🤝"], from: "#2f80ed", to: "#06d6a0" },
  "awareness-day": { art: ["🎗️", "💙", "🌍"], from: "#2f80ed", to: "#56ccf2" },
};

const DEFAULT_THEME: CampaignTheme = { art: ["📣", "✨", "🎯"], from: "#2ee66b", to: "#18c7b9" };

/** The look of a campaign card from its name (first) and its kind. */
export function campaignTheme(input: {
  title?: string | null;
  type?: string | null;
}): CampaignTheme {
  const title = input.title ?? "";
  const moment = MOMENTS.find((r) => r.match.test(title));
  if (moment) return { art: moment.art, from: moment.from, to: moment.to };
  return (input.type && KINDS[input.type]) || DEFAULT_THEME;
}
