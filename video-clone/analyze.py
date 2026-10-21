"""Extract a local video into time-indexed review material; no network access.

Run from the repository root: python video-clone/analyze.py
Dependencies live in video-clone/tools (Pillow, numpy, scipy, imageio-ffmpeg).
Transient peaks are signal-analysis estimates, not verified semantic beat labels.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import wave

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE / "tools"))

import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import uniform_filter1d
from scipy.signal import find_peaks


def run_ffmpeg(ffmpeg: str, arguments: list[str]) -> str:
    process = subprocess.run(
        [ffmpeg, "-hide_banner", "-nostdin", *arguments],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if process.returncode:
        raise RuntimeError(process.stderr[-12000:])
    return process.stderr


def font(size: int) -> ImageFont.ImageFont:
    for name in ("C:/Windows/Fonts/consola.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default(size=size)


def clock(seconds: float) -> str:
    return f"{int(seconds // 60):02d}:{seconds % 60:06.3f}"


def write_csv(path: Path, rows: list[dict], fields: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def contact_sheets(frames: list[Path], directory: Path, fps: float) -> list[dict]:
    directory.mkdir(parents=True, exist_ok=True)
    cols, rows, width, height, caption, gap = 5, 4, 320, 180, 40, 8
    count = cols * rows
    output = []
    label_font = font(17)
    for offset in range(0, len(frames), count):
        sheet = Image.new("RGB", (cols * (width + gap) + gap, rows * (height + caption + gap) + gap), "#142033")
        draw = ImageDraw.Draw(sheet)
        for index, source in enumerate(frames[offset:offset + count]):
            timestamp = (offset + index) / fps
            x = gap + index % cols * (width + gap)
            y = gap + index // cols * (height + caption + gap)
            with Image.open(source) as frame:
                thumbnail = frame.convert("RGB")
                thumbnail.thumbnail((width, height), Image.Resampling.LANCZOS)
                sheet.paste(thumbnail, (x + (width - thumbnail.width) // 2, y + (height - thumbnail.height) // 2))
            draw.text((x + 4, y + height + 4), f"#{offset + index + 1:04d}  {clock(timestamp)}", fill="#f2f5f8", font=label_font)
        path = directory / f"sheet_{offset // count + 1:03d}.jpg"
        sheet.save(path, quality=92)
        output.append({"file": str(path), "start_seconds": offset / fps, "end_seconds": min(len(frames) - 1, offset + count - 1) / fps})
    return output


def waveform_image(audio: np.ndarray, rate: int, peaks: list[dict], destination: Path) -> None:
    image = Image.new("RGB", (1800, 480), "#0b1424")
    draw = ImageDraw.Draw(image)
    x0, y0, plot_width, plot_height = 70, 60, 1680, 330
    duration = len(audio) / rate
    center = y0 + plot_height // 2
    draw.line((x0, center, x0 + plot_width, center), fill="#526072")
    for x in range(plot_width):
        a = int(x / plot_width * len(audio))
        b = max(a + 1, int((x + 1) / plot_width * len(audio)))
        section = audio[a:b]
        if section.size:
            low, high = float(np.min(section)), float(np.max(section))
            draw.line((x0 + x, center - high * plot_height * .47, x0 + x, center - low * plot_height * .47), fill="#cbe960")
    for peak in peaks:
        x = x0 + peak["seconds"] / duration * plot_width
        draw.line((x, y0, x, y0 + 14), fill="#fda972")
    tick_every = max(1, math.ceil(duration / 18))
    for second in range(0, math.ceil(duration), tick_every):
        x = x0 + second / duration * plot_width
        draw.line((x, y0 + plot_height, x, y0 + plot_height + 8), fill="#718097")
        draw.text((x - 12, y0 + plot_height + 16), f"{second}s", fill="white", font=font(18))
    draw.text((70, 18), "Reference waveform | orange marks: estimated transient onsets", fill="white", font=font(22))
    draw.text((70, 445), "16 kHz mono analysis; timestamps use decoded audio. Confirm effect identity by listening.", fill="#bac7d9", font=font(17))
    image.save(destination)


def analyze_audio(path: Path, destination: Path, ffmpeg: str) -> dict:
    wav = destination / "ref_analysis_16k.wav"
    run_ffmpeg(ffmpeg, ["-y", "-i", str(path), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)])
    with wave.open(str(wav), "rb") as source:
        rate = source.getframerate()
        samples = np.frombuffer(source.readframes(source.getnframes()), dtype="<i2").astype(np.float64) / 32768
    if not samples.size:
        raise RuntimeError("Decoded audio is empty")
    # 5 ms hop, 10 ms RMS window: the label precision is 1 ms, measurement resolution 5 ms.
    hop = rate // 200
    energy = uniform_filter1d(samples * samples, size=rate // 100, mode="constant")
    rms = np.sqrt(np.maximum(energy[::hop], 0))
    novelty = np.maximum(0, rms - np.roll(rms, 3))
    novelty[:3] = 0
    positive = novelty[novelty > 0]
    floor = float(np.quantile(positive, .65)) if positive.size else 0
    maximum = float(np.max(novelty))
    threshold = max(floor, maximum * .045, .00015)
    peak_indices, properties = find_peaks(novelty, height=threshold, prominence=threshold * .65, distance=16)
    peaks = []
    for index, prominence in zip(peak_indices, properties["prominences"]):
        # Approximate attack start from the preceding rise instead of the local energy maximum.
        left = int(index)
        while left > max(0, int(index) - 10) and novelty[left - 1] > novelty[index] * .18:
            left -= 1
        seconds = round(left * hop / rate, 3)
        peaks.append({"id": len(peaks) + 1, "seconds": seconds, "milliseconds": round(seconds * 1000), "novelty_peak_seconds": round(index * hop / rate, 3), "relative_strength": round(float(prominence / max(maximum, 1e-9)), 5), "measurement_resolution_ms": 5, "label": "estimated transient; not a verified SFX/beat"})
    write_csv(destination / "audio-onset-estimates.csv", peaks, ["id", "seconds", "milliseconds", "novelty_peak_seconds", "relative_strength", "measurement_resolution_ms", "label"])
    (destination / "audio-onset-estimates.json").write_text(json.dumps(peaks, indent=2), encoding="utf-8")
    waveform_image(samples, rate, peaks, destination / "waveform.png")
    silence_log = run_ffmpeg(ffmpeg, ["-i", str(path), "-vn", "-af", "silencedetect=noise=-40dB:d=0.05", "-f", "null", "-"])
    silence_events = [{"event": kind, "seconds": float(seconds)} for kind, seconds in re.findall(r"silence_(start|end):\s*([\d.]+)", silence_log)]
    (destination / "audio-silence.json").write_text(json.dumps(silence_events, indent=2), encoding="utf-8")
    (destination / "audio-silence.log").write_text(silence_log, encoding="utf-8")
    return {"sample_rate": rate, "duration_seconds": len(samples) / rate, "onset_count": len(peaks), "onsets": peaks, "silence_events": silence_events, "precision_note": "Numerical labels are milliseconds; energy analysis resolves 5 ms bins and does not identify semantic SFX/beat boundaries. Compression/codec delays can affect alignment."}


def fine_frames(source: Path, destination: Path, ffmpeg: str, centers: list[float], radius: float) -> None:
    for center in centers:
        start = max(0, center - radius)
        folder = destination / "fine-frames" / f"at_{center:.3f}s"
        folder.mkdir(parents=True, exist_ok=True)
        run_ffmpeg(ffmpeg, ["-y", "-ss", f"{start:.6f}", "-i", str(source), "-t", f"{2 * radius:.6f}", "-vf", "fps=60:start_time=0", "-q:v", "2", str(folder / "frame_%04d.jpg")])
        rows = [{"file": frame.name, "seconds": round(start + index / 60, 6), "note": "60 Hz sampling; source frames may repeat"} for index, frame in enumerate(sorted(folder.glob("frame_*.jpg")))]
        write_csv(folder / "frame-index.csv", rows, ["file", "seconds", "note"])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=BASE / "temp" / "ref.mp4")
    parser.add_argument("--output", type=Path, default=BASE / "temp")
    parser.add_argument("--fps", type=float, default=4)
    parser.add_argument("--scene-threshold", type=float, default=.22)
    parser.add_argument("--fine-at", type=float, action="append", default=[], help="Optional second timestamp; repeat for multiple windows")
    parser.add_argument("--fine-radius", type=float, default=.25)
    parser.add_argument("--reuse-frames", action="store_true", help="Reuse a prior extraction at the same fps")
    args = parser.parse_args()
    source = args.input.resolve()
    destination = args.output.resolve()
    if not source.is_file():
        parser.error(f"Reference not found: {source}")
    if args.fps <= 0 or args.fine_radius <= 0:
        parser.error("fps and fine-radius must be positive")
    destination.mkdir(parents=True, exist_ok=True)
    frames_folder = destination / "frames"
    frames_folder.mkdir(exist_ok=True)
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    stream = imageio_ffmpeg.read_frames(str(source), pix_fmt="rgb24")
    metadata = next(stream)
    stream.close()
    metadata.update({"source": str(source), "ffmpeg": ffmpeg, "review_fps": args.fps, "review_rounding": "up", "frame_timestamp_formula": "(frame_number - 1) / review_fps", "review_precision_note": "Nominal 4 fps output times establish 250 ms bins. round=up selects source imagery at/on-before the output timestamp. Source frame/time columns use the reference's constant native frame rate; inspect native frames for 33.333 ms boundaries."})
    (destination / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    if not args.reuse_frames:
        # Remove only previous generated frames inside the verified output folder.
        for old in frames_folder.glob("frame_*.jpg"):
            old.unlink()
        run_ffmpeg(ffmpeg, ["-y", "-i", str(source), "-an", "-vf", f"fps=fps={args.fps}:start_time=0:round=up", "-q:v", "2", str(frames_folder / "frame_%04d.jpg")])
    frames = sorted(frames_folder.glob("frame_*.jpg"))
    source_fps = float(metadata["fps"])
    frame_rows = [{"frame_number": index + 1, "file": frame.name, "seconds": round(index / args.fps, 6), "milliseconds": round(index / args.fps * 1000), "source_frame_0based": math.floor(index / args.fps * source_fps + 1e-7), "source_seconds": round(math.floor(index / args.fps * source_fps + 1e-7) / source_fps, 6)} for index, frame in enumerate(frames)]
    write_csv(destination / "frame-index.csv", frame_rows, ["frame_number", "file", "seconds", "milliseconds", "source_frame_0based", "source_seconds"])
    sheets = contact_sheets(frames, destination / "contact-sheets", args.fps)
    scene_log = run_ffmpeg(ffmpeg, ["-i", str(source), "-an", "-vf", f"select='gt(scene,{args.scene_threshold})',showinfo", "-fps_mode", "vfr", "-f", "null", "-"])
    cuts = sorted(set(float(value) for value in re.findall(r"pts_time:([\d.]+)", scene_log)))
    cut_rows = [{"seconds": value, "milliseconds": round(value * 1000), "threshold": args.scene_threshold, "label": "visual change candidate; manual review needed"} for value in cuts]
    write_csv(destination / "scene-cut-candidates.csv", cut_rows, ["seconds", "milliseconds", "threshold", "label"])
    (destination / "scene-cut-candidates.log").write_text(scene_log, encoding="utf-8")
    audio = analyze_audio(source, destination, ffmpeg)
    fine_frames(source, destination, ffmpeg, args.fine_at, args.fine_radius)
    summary = {"metadata": metadata, "frame_count": len(frames), "contact_sheets": sheets, "scene_cut_candidates": cut_rows, "audio": audio}
    (destination / "analysis.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(destination), "duration_seconds": metadata.get("duration"), "frames": len(frames), "contact_sheets": len(sheets), "scene_cut_candidates": cuts, "estimated_audio_onsets": audio["onset_count"]}, indent=2))


if __name__ == "__main__":
    main()
