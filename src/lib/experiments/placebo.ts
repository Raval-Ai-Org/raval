// placebo.ts — the randomization test (ADR-0024 §6).
//
// Within a pair, which page got the change was a coin flip. Swapping arms
// inside pairs therefore enumerates the design's own randomization
// distribution. The p-value is the share of swap patterns whose lift is at
// least as extreme (in log terms, two-sided) as the one observed. All 2^pairs
// patterns are used when that is no more than the draw budget; otherwise
// random patterns, counting the observed one (so p is never zero).
import type { ExperimentMetric } from "./constants";
import { metricParts, rowFor, type PageSeries } from "./series";

type Side = { preNum: number; preDen: number; postNum: number; postDen: number };
export type PairSum = { treatment: Side; control: Side };

export function pairSums(input: {
  metric: ExperimentMetric;
  pairs: { treatment: string; control: string }[];
  series: PageSeries;
  preDates: string[];
  postDates: string[];
}): PairSum[] {
  const side = (path: string): Side => {
    const s = { preNum: 0, preDen: 0, postNum: 0, postDen: 0 };
    for (const d of input.preDates) {
      const v = metricParts(input.metric, rowFor(input.series, path, d));
      s.preNum += v.num;
      s.preDen += v.den;
    }
    for (const d of input.postDates) {
      const v = metricParts(input.metric, rowFor(input.series, path, d));
      s.postNum += v.num;
      s.postDen += v.den;
    }
    return s;
  };
  return input.pairs.map((p) => ({ treatment: side(p.treatment), control: side(p.control) }));
}

/** Log ratio-lift for a swap pattern (bit set = swapped); null if undefined. */
function logLift(pairs: PairSum[], swapped: (i: number) => boolean): number | null {
  let tpn = 0,
    tpd = 0,
    cpn = 0,
    cpd = 0,
    tqn = 0,
    tqd = 0,
    cqn = 0,
    cqd = 0;
  for (let i = 0; i < pairs.length; i++) {
    const s = swapped(i);
    const t = s ? pairs[i].control : pairs[i].treatment;
    const c = s ? pairs[i].treatment : pairs[i].control;
    tpn += t.preNum;
    tpd += t.preDen;
    cpn += c.preNum;
    cpd += c.preDen;
    tqn += t.postNum;
    tqd += t.postDen;
    cqn += c.postNum;
    cqd += c.postDen;
  }
  if (tpd <= 0 || cpd <= 0 || tqd <= 0 || cqd <= 0) return null;
  if (tpn <= 0 || cpn <= 0 || tqn <= 0 || cqn <= 0) return null;
  return Math.log(tqn / tqd) - Math.log(cqn / cqd) - (Math.log(tpn / tpd) - Math.log(cpn / cpd));
}

export function placeboTest(
  pairs: PairSum[],
  _metric: ExperimentMetric,
  draws: number,
  rng: () => number,
): { p: number | null; exact: boolean; observed: number | null } {
  const observed = logLift(pairs, () => false);
  if (observed === null) return { p: null, exact: false, observed: null };
  const extreme = Math.abs(observed) - 1e-12;
  const n = pairs.length;

  if (n <= 30 && 2 ** n <= draws) {
    let hits = 0;
    let total = 0;
    for (let mask = 0; mask < 2 ** n; mask++) {
      const v = logLift(pairs, (i) => ((mask >>> i) & 1) === 1);
      if (v === null) continue;
      total++;
      if (Math.abs(v) >= extreme) hits++;
    }
    return { p: total ? hits / total : null, exact: true, observed };
  }

  let hits = 1;
  let total = 1;
  const swaps = new Array<boolean>(n);
  for (let k = 0; k < draws; k++) {
    for (let i = 0; i < n; i++) swaps[i] = rng() < 0.5;
    const v = logLift(pairs, (i) => swaps[i]);
    if (v === null) continue;
    total++;
    if (Math.abs(v) >= extreme) hits++;
  }
  return { p: hits / total, exact: false, observed };
}
