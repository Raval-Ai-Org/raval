"""Decode native frames and find typography/backdrop change candidates locally.

python video-clone/refine-cuts.py
The timestamps are native source-frame times, not claims of semantic text cuts.
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
import subprocess
import sys

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE / "tools"))
import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.signal import find_peaks


def label_font(size=16):
    try:
        return ImageFont.truetype("C:/Windows/Fonts/consola.ttf", size)
    except OSError:
        return ImageFont.load_default(size=size)


def write_rows(path, rows):
    if not rows:
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def sheets(indices, source_frames, folder, fps, prefix, offsets=(-2, 0, 2, 5)):
    folder.mkdir(parents=True, exist_ok=True)
    per_page, thumb_width, thumb_height, gap, caption = 8, 288, 162, 8, 28
    for start in range(0, len(indices), per_page):
        group = indices[start:start + per_page]
        output = Image.new("RGB", (len(offsets) * (thumb_width + gap) + gap, len(group) * (thumb_height + caption + gap) + gap), "#152033")
        draw = ImageDraw.Draw(output)
        for row, event in enumerate(group):
            for col, offset in enumerate(offsets):
                index = min(max(0, event + offset), len(source_frames) - 1)
                x, y = gap + col * (thumb_width + gap), gap + row * (thumb_height + caption + gap)
                with Image.open(source_frames[index]) as source:
                    image = source.resize((thumb_width, thumb_height), Image.Resampling.LANCZOS)
                    output.paste(image, (x, y))
                draw.text((x + 2, y + thumb_height + 3), f"f{index:04d} {index / fps:07.3f}s ({offset:+d}f)", fill="#ffffff" if offset else "#cbe960", font=label_font())
        output.save(folder / f"{prefix}_{start // per_page + 1:03d}.jpg", quality=93)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=BASE / "temp/ref.mp4")
    parser.add_argument("--output", type=Path, default=BASE / "temp/refined")
    parser.add_argument("--until", type=float, default=25.8)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    source_folder = args.output / "source-frames"
    source_folder.mkdir(exist_ok=True)
    reader = imageio_ffmpeg.read_frames(str(args.input))
    meta = next(reader)
    reader.close()
    fps = meta["fps"]
    width, height = 480, 270
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    process = subprocess.Popen([ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-i", str(args.input), "-an", "-vf", f"scale={width}:{height}", "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    frame_bytes = width * height * 3
    metrics, frame_paths = [], []
    previous_gray, previous_mask = None, None
    while True:
        data = process.stdout.read(frame_bytes)
        if not data:
            break
        if len(data) != frame_bytes:
            raise RuntimeError("Truncated native video frame")
        rgb = np.frombuffer(data, dtype=np.uint8).reshape(height, width, 3)
        index = len(frame_paths)
        destination = source_folder / f"source_{index:04d}.jpg"
        Image.fromarray(rgb).save(destination, quality=92)
        frame_paths.append(destination)
        gray = rgb.astype(np.float32).mean(axis=2) / 255
        # A per-column median removes the original's tall gray stripe backgrounds.
        # The residual retains center glyphs; this remains a candidate generator.
        baseline = np.median(gray[round(height * .2):round(height * .8)], axis=0)
        residual = np.abs(gray - baseline[None, :])
        roi = (slice(round(height * .30), round(height * .70)), slice(round(width * .08), round(width * .92)))
        mask = residual[roi] > .07
        if previous_gray is None:
            background_delta = text_delta = center_delta = 0
        else:
            background_delta = float(np.mean(np.abs(gray - previous_gray)))
            text_delta = float(np.mean(mask != previous_mask))
            center_delta = float(np.mean(np.abs(gray[roi] - previous_gray[roi])))
        metrics.append({"source_frame_0based": index, "source_image_1based": index + 1, "seconds": round(index / fps, 6), "milliseconds": round(index / fps * 1000), "background_delta": round(background_delta, 6), "foreground_text_delta": round(text_delta, 6), "center_delta": round(center_delta, 6), "foreground_fraction": round(float(np.mean(mask)), 6)})
        previous_gray, previous_mask = gray, mask
    stderr = process.stderr.read().decode("utf-8", "replace")
    if process.wait():
        raise RuntimeError(stderr)
    write_rows(args.output / "native-frame-metrics.csv", metrics)
    # Short event spacing preserves one/two-frame flash transitions in the reference.
    bg = np.array([row["background_delta"] for row in metrics])
    fg = np.array([row["foreground_text_delta"] for row in metrics])
    center = np.array([row["center_delta"] for row in metrics])
    score = np.maximum(bg / .14, fg / .024)
    peaks, properties = find_peaks(score, height=.22, prominence=.13, distance=3)
    candidates = [int(index) for index in peaks if index / fps <= args.until]
    rows = []
    for index in candidates:
        row = dict(metrics[index])
        row["reason"] = "backdrop cut/flash" if bg[index] > .14 else "center glyph/animation change"
        row["score"] = round(float(score[index]), 5)
        row["verification"] = "Candidate only; inspect before/at/after images for semantic timing"
        rows.append(row)
    write_rows(args.output / "typography-cut-candidates.csv", rows)
    (args.output / "typography-cut-candidates.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    sheets(candidates, frame_paths, args.output / "candidate-sheets", fps, "candidate")
    # Every native source frame around the countdown and logo transition, plus intro.
    windows = [("intro", 0.9, 1.8), ("countdown", 25.45, 25.9), ("logo", 36.45, 36.95)]
    for name, begin, end in windows:
        native_indices = list(range(round(begin * fps), min(len(frame_paths), round(end * fps) + 1)))
        sheets(native_indices, frame_paths, args.output / "transition-sheets", fps, name, offsets=(0,))
    summary = {"native_fps": fps, "frame_count": len(frame_paths), "candidate_count": len(candidates), "candidate_end_seconds": args.until, "frame_numbering": "source_frame_0based/fps gives seconds; filenames use zero-based source indexes", "note": "Exact native-frame timestamps; candidate identity and first-visible text must be verified visually."}
    (args.output / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
