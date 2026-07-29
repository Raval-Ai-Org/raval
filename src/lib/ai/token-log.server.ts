// In-memory ring buffer for AI credit accounting. No DB; readable via
// an internal debug route if needed. Never contains raw prompts — just
// route/model/size metadata.

export type TokenLogEntry = {
  ts: number;
  route: string;
  model: string;
  inputChars: number;
  outputChars: number;
  cached: boolean;
  toolCall?: boolean;
};

const RING_SIZE = 500;
const ring: TokenLogEntry[] = [];

export function logAiCall(entry: Omit<TokenLogEntry, "ts">): void {
  ring.push({ ...entry, ts: Date.now() });
  if (ring.length > RING_SIZE) ring.shift();
}

export function readTokenLog(): TokenLogEntry[] {
  return ring.slice();
}
