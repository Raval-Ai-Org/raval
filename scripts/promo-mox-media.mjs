#!/usr/bin/env node
/**
 * Media steps for the "Meet Mox" film (/promo-lab?film=mox).
 *
 *   node scripts/promo-mox-media.mjs frames <name> <video> [seconds] [width]
 *     Cuts a video into numbered stills in public/promo-mox/<name>/ (the film
 *     draws footage one still per frame). Prints the count and frame rate to
 *     put in MOX_MEDIA (src/lib/promo/mox-timeline.ts).
 *
 *   node scripts/promo-mox-media.mjs mix <voiceDir> <music> <picture> <out>
 *     Places each narration phrase at its cue, lowers the music under the
 *     voice, brings the mix to -14 LUFS and joins it to the recorded picture.
 *
 * Uses the FFmpeg that ships with MotionMox unless FFMPEG_PATH is set.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const bundled = path.resolve("node_modules/@motionmox/compositor-win32-x64-msvc");
const ffmpeg = process.env.FFMPEG_PATH ?? path.join(bundled, "ffmpeg.exe");
const ffprobe = process.env.FFPROBE_PATH ?? path.join(bundled, "ffprobe.exe");

function run(bin, args) {
  const result = spawnSync(bin, args, { encoding: "utf8" });
  if (result.status !== 0) {
    console.error(result.stderr);
    process.exit(1);
  }
  return result.stdout.trim();
}

/**
 * The narration: [film second, line file, from, to] (seconds inside the file).
 * Lines are l00.mp3 … l10.mp3, one per sentence group of the script.
 */
export const CUES = [
  [0.4, "l00", 0.15, 1.47],
  [2.9, "l00", 1.92, 2.74],
  [4.5, "l00", 3.15, 3.93],
  [6.1, "l00", 4.34, 7.1],
  [11.5, "l01", 0.13, 2.12],
  [14.4, "l01", 2.52, 5.15],
  [17.5, "l01", 5.49, 6.72],
  [19.5, "l02", 0, 3.47],
  [23.7, "l02", 3.78, 5.07],
  [25.7, "l02", 5.49, 7.02],
  [29.1, "l03", 0.12, 1.26],
  [35.7, "l04", 0, 3.17],
  [40.3, "l04", 3.49, 4.2],
  [41.8, "l04", 4.51, 5.36],
  [43.3, "l04", 5.64, 6.78],
  [47.2, "l05", 0, 1.86],
  [49.8, "l05", 2.15, 2.77],
  [51.1, "l05", 2.95, 3.76],
  [52.4, "l05", 3.86, 4.64],
  [53.7, "l05", 4.75, 5.48],
  [55.0, "l05", 5.63, 6.89],
  [61.1, "l05", 7.15, 9.35],
  [63.9, "l05", 9.56, 10.94],
  [66.4, "l06", 0.16, 0.84],
  [69.1, "l06", 1.54, 2.36],
  [72.7, "l07", 0.13, 2.23],
  [75.6, "l07", 2.42, 3.76],
  [79.8, "l08", 0.11, 1.87],
  [82.4, "l08", 2.09, 3.74],
  [84.5, "l08", 3.92, 4.57],
  [90.3, "l09", 0.11, 1.83],
  [96.4, "l10", 0, 0.75],
  [97.6, "l10", 1.01, 3.21],
  [103.1, "l10", 3.53, 4.74],
];

/**
 * The music bed, cut to the film: [film second, from, to, fade in, fade out]
 * (seconds inside the track). The track builds, goes quiet, then drops; the
 * quiet lands on "And you're tired" and the drop on "Meet Mox".
 */
const MUSIC_PARTS = [
  [0, 8.5, 37, 0.4, 0],
  [28.2, 42, 78.5, 0, 0],
  [63.4, 94, 112, 0.05, 0.6],
  [80.9, 52.9, 79, 0.5, 0],
];

/** A calm stretch ("All day. All night."): the music sits back between these seconds. */
const CALM = [65.6, 72.0];

const DURATION = 107;
const UNDER_VOICE = 0.16;
const ALONE = 0.62;

/** Music level over time: low under the voice, up in gaps of 1.5 s or more, out at the end. */
function musicLevel() {
  const points = [[0, ALONE]];
  const spoken = CUES.map(([at, , from, to]) => [at, at + (to - from)]);
  spoken.forEach(([start, end], index) => {
    const previousEnd = index === 0 ? -9 : spoken[index - 1][1];
    if (start - previousEnd >= 1.5) points.push([start - 0.35, ALONE]);
    points.push([start, UNDER_VOICE]);
    const next = spoken[index + 1]?.[0] ?? DURATION;
    points.push([end, UNDER_VOICE]);
    if (next - end >= 1.5) points.push([end + 0.5, ALONE]);
  });
  points.push([DURATION - 2.2, ALONE], [DURATION, 0]);
  const sorted = points
    .filter(([t]) => t >= 0)
    .sort((a, b) => a[0] - b[0])
    .filter(([t], i, all) => i === 0 || t > all[i - 1][0]);
  // A chain of straight ramps between the points.
  let expression = String(sorted[sorted.length - 1][1]);
  for (let i = sorted.length - 2; i >= 0; i--) {
    const [t0, v0] = sorted[i];
    const [t1, v1] = sorted[i + 1];
    const ramp = `${v0}+(${(v1 - v0).toFixed(3)})*(t-${t0.toFixed(2)})/${(t1 - t0).toFixed(2)}`;
    expression = `if(lt(t,${t1.toFixed(2)}),${ramp},${expression})`;
  }
  const clip = (x) => `min(1,max(0,${x}))`;
  const calm = `(1-0.5*${clip(`(t-${CALM[0]})/0.8`)}*${clip(`(${CALM[1]}-t)/0.8`)})`;
  return `(${expression})*${calm}`;
}

/**
 * Sound effects, made here from scratch (no samples): soft whooshes on the
 * cuts, pops as things land, ticks on the word wheel and the counter, and a
 * riser into "Meet Mox". [film second, kind].
 */
const SFX = [
  [2.8, "pop"], [4.4, "pop"], [6.0, "pop"], [7.1, "whoosh"],
  [11.0, "whoosh"], [14.2, "whoosh"],
  ...[15.35, 15.9, 16.45].map((t) => [t, "pop"]),
  ...Array.from({ length: 14 }, (_, i) => [19.4 + i * 0.3 - i * i * 0.006, "tick"]),
  [27.0, "riser"], [28.2, "impact"],
  [35.2, "whoosh"], [37.0, "pop"], [40.2, "pop"], [41.7, "pop"], [43.2, "pop"],
  ...[0, 1, 2, 3].map((i) => [44.8 + i * 0.14, "tick"]),
  [46.8, "whoosh"],
  ...[49.8, 51.1, 52.4, 53.7, 55.0].map((t) => [t, "tick"]),
  [56.8, "whoosh"], [58.2, "whoosh"],
  [61.1, "pop"], [61.8, "pop"], [62.5, "pop"], [63.9, "impact"],
  [65.4, "whoosh"], [72.2, "whoosh"], [74.1, "pop"],
  ...[0, 1, 2].map((i) => [75.75 + i * 0.22, "pop"]),
  [79.4, "whoosh"],
  ...[0, 1, 2, 3].map((i) => [82.3 + i * 0.4, "pop"]),
  [86.2, "impact"],
  ...Array.from({ length: 30 }, (_, i) => [86.4 + i * 0.11, "tick"]),
  [89.8, "whoosh"], [92.1, "pop"], [93.1, "pop"],
  [95.4, "whoosh"], [101.0, "whoosh"], [101.4, "pop"], [103.0, "pop"],
]; // prettier-ignore

/** Writes the effects as one stereo 48 kHz WAV the length of the film. */
function writeSfx(file) {
  const rate = 48000;
  const total = Math.ceil(DURATION * rate);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  let seed = 12345;
  const noise = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2147483648 - 1;
  };
  const add = (at, length, sample, pan = 0) => {
    const start = Math.round(at * rate);
    const count = Math.round(length * rate);
    for (let i = 0; i < count && start + i < total; i++) {
      if (start + i < 0) continue;
      const value = sample(i / rate, i / count);
      left[start + i] += value * (1 - Math.max(0, pan));
      right[start + i] += value * (1 + Math.min(0, pan));
    }
  };
  SFX.forEach(([at, kind], index) => {
    const pan = ((index % 5) - 2) * 0.12;
    if (kind === "pop") {
      add(
        at,
        0.11,
        (t, p) => Math.sin(2 * Math.PI * (620 - 340 * p) * t) * Math.exp(-p * 5) * 0.32,
        pan,
      );
    } else if (kind === "tick") {
      add(at, 0.03, (t, p) => Math.sin(2 * Math.PI * 1900 * t) * Math.exp(-p * 7) * 0.13, pan);
    } else if (kind === "whoosh") {
      let low = 0;
      add(at - 0.22, 0.6, (t, p) => {
        // Noise through a filter that opens and closes: air moving past.
        low += (noise() - low) * (0.03 + 0.22 * Math.sin(Math.PI * p));
        return low * Math.sin(Math.PI * p) ** 2 * 0.5;
      }, pan); // prettier-ignore
    } else if (kind === "riser") {
      let low = 0;
      add(at, 1.2, (t, p) => {
        low += (noise() - low) * (0.02 + 0.3 * p * p);
        return (low * 0.35 + Math.sin(2 * Math.PI * (180 + 520 * p * p) * t) * 0.07) * p * p;
      });
    } else if (kind === "impact") {
      let low = 0;
      add(at, 0.7, (t, p) => {
        low += (noise() - low) * 0.08;
        return (Math.sin(2 * Math.PI * (82 - 30 * p) * t) * 0.6 + low * 0.25 * Math.exp(-p * 9)) * Math.exp(-p * 5);
      }); // prettier-ignore
    }
  });
  const data = Buffer.alloc(total * 4);
  for (let i = 0; i < total; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), i * 4);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), i * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([header, data]));
}

const [command, ...rest] = process.argv.slice(2);

if (command === "frames") {
  const [name, video, seconds, width] = rest;
  const outDir = path.resolve("public/promo-mox", name);
  mkdirSync(outDir, { recursive: true });
  const rate = run(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", video]); // prettier-ignore
  const args = ["-v", "error", "-y", "-i", video];
  if (seconds) args.push("-t", seconds);
  if (width) args.push("-vf", `scale=${width}:-2`);
  args.push("-q:v", "2", path.join(outDir, "f%04d.jpg"));
  run(ffmpeg, args);
  console.log(`${name}: ${readdirSync(outDir).length} stills at ${rate} fps`);
} else if (command === "mix") {
  const [voiceDir, music, picture, out] = rest;
  const inputs = [];
  const chains = [];
  CUES.forEach(([at, line, from, to], index) => {
    inputs.push("-ss", String(from), "-to", String(to), "-i", path.join(voiceDir, `${line}.mp3`));
    chains.push(
      `[${index}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(at * 1000)}:all=1[v${index}]`,
    );
  });
  const musicIndex = CUES.length;
  MUSIC_PARTS.forEach(([at, from, to, fadeIn, fadeOut], index) => {
    inputs.push("-ss", String(from), "-to", String(to), "-i", music);
    const length = to - from;
    const fade = `min(1,min(${fadeIn > 0 ? `t/${fadeIn}` : "1"},${fadeOut > 0 ? `(${length}-t)/${fadeOut}` : "1"}))`;
    chains.push(
      `[${musicIndex + index}:a]aresample=48000,aformat=channel_layouts=stereo,volume='max(0,${fade})':eval=frame,adelay=${Math.round(at * 1000)}:all=1[m${index}]`,
    );
  });
  const sfxIndex = musicIndex + MUSIC_PARTS.length;
  const sfxFile = path.join(path.dirname(path.resolve(picture)), "meet-mox-sfx.wav");
  writeSfx(sfxFile);
  inputs.push("-i", sfxFile);
  chains.push(`[${sfxIndex}:a]aresample=48000,aformat=channel_layouts=stereo,volume=0.55[sfx]`);
  const pictureIndex = sfxIndex + 1;
  inputs.push("-i", picture);
  chains.push(
    `${MUSIC_PARTS.map((_, index) => `[m${index}]`).join("")}amix=inputs=${MUSIC_PARTS.length}:normalize=0,atrim=0:${DURATION},volume='${musicLevel()}':eval=frame[bed]`,
  );
  chains.push(
    `${CUES.map((_, index) => `[v${index}]`).join("")}amix=inputs=${CUES.length}:normalize=0,volume=1.7[voice]`,
  );
  chains.push(
    `[voice][bed][sfx]amix=inputs=3:normalize=0,apad=whole_dur=${DURATION},atrim=0:${DURATION},loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[mix]`,
  );
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  run(ffmpeg, [
    "-v", "error", "-y", ...inputs,
    "-filter_complex", chains.join(";"),
    "-map", `${pictureIndex}:v`, "-map", "[mix]",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", out,
  ]); // prettier-ignore
  console.log(`Saved ${out}`);
} else {
  console.error("Usage: promo-mox-media.mjs frames|mix … (see the file header)");
  process.exit(1);
}
