// The "/" menu in the chat message box: every place in Mellox plus a few
// things people ask for often. Pure, so the list and its matching are tested.
import { PLACES, type PlaceGroup } from "./places";

export type ChatCommand = {
  id: string;
  label: string;
  hint: string;
  group: PlaceGroup | "Ask";
  keywords: string[];
  /** open = go to a place · prefill = put text in the box · send = ask it now */
  run:
    | { type: "open"; place: string }
    | { type: "prefill"; text: string }
    | { type: "send"; text: string };
};

const ASK: ChatCommand[] = [
  {
    id: "ask-remember",
    label: "Remember",
    hint: "Tell Mellox something to keep in mind",
    group: "Ask",
    keywords: ["memory", "always", "never", "rule", "preference"],
    run: { type: "prefill", text: "Remember: " },
  },
  {
    id: "ask-waiting",
    label: "What needs me?",
    hint: "Posts and plans waiting for your OK",
    group: "Ask",
    keywords: ["approve", "pending", "review", "todo"],
    run: { type: "send", text: "What is waiting for my approval right now?" },
  },
  {
    id: "ask-week",
    label: "This week",
    hint: "What's planned and scheduled",
    group: "Ask",
    keywords: ["calendar", "schedule", "plan", "upcoming"],
    run: { type: "send", text: "What is planned and scheduled for the next 7 days?" },
  },
  {
    id: "ask-results",
    label: "How are we doing?",
    hint: "Your numbers for the last 30 days",
    group: "Ask",
    keywords: ["analytics", "results", "performance", "stats"],
    run: { type: "send", text: "How did our content and website do over the last 30 days?" },
  },
  {
    id: "ask-competitors",
    label: "Competitor news",
    hint: "What your competitors did lately",
    group: "Ask",
    keywords: ["rivals", "updates", "market"],
    run: { type: "send", text: "What have our tracked competitors done recently?" },
  },
];

export const CHAT_COMMANDS: readonly ChatCommand[] = [
  ...ASK,
  ...PLACES.map((place): ChatCommand => ({
    id: `open-${place.id}`,
    label: place.label,
    hint: place.hint,
    group: place.group,
    keywords: place.keywords,
    run: { type: "open", place: place.id },
  })),
];

/** The text after "/", or null when the box isn't asking for the menu. */
export function commandQuery(input: string): string | null {
  if (!input.startsWith("/") || input.includes("\n") || input.length > 40) return null;
  return input.slice(1).trim().toLowerCase();
}

/** Commands for what was typed, best match first. [] when the menu is closed. */
export function matchCommands(input: string, limit = 8): ChatCommand[] {
  const query = commandQuery(input);
  if (query === null) return [];
  if (!query) return CHAT_COMMANDS.slice(0, limit);
  const scored = CHAT_COMMANDS.map((command, index) => {
    const label = command.label.toLowerCase();
    const score = label.startsWith(query)
      ? 0
      : label.includes(query)
        ? 1
        : command.keywords.some((k) => k.startsWith(query))
          ? 2
          : command.keywords.some((k) => k.includes(query)) ||
              command.hint.toLowerCase().includes(query)
            ? 3
            : -1;
    return { command, score, index };
  }).filter((entry) => entry.score >= 0);
  scored.sort((a, b) => a.score - b.score || a.index - b.index);
  return scored.slice(0, limit).map((entry) => entry.command);
}
