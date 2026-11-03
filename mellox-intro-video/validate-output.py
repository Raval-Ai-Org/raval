"""Decode every rendered frame and measure audio alignment against the master.

python validate-output.py
Optional: --video output/file.mp4 --ffmpeg /path/to/ffmpeg
Uses numpy/scipy from the local reference tools, or normal Python packages.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE.parent / "video-clone" / "tools"))


def ffmpeg_path(explicit: str | None) -> str:
    if explicit or os.environ.get("FFMPEG_PATH"):
        return explicit or os.environ["FFMPEG_PATH"]
    directory = BASE.parent / "video-clone/tools/imageio_ffmpeg/binaries"
    binaries = sorted(directory.glob("ffmpeg*.exe")) if directory.exists() else []
    if binaries:
        return str(binaries[0])
    executable = shutil.which("ffmpeg")
    if executable:
        return executable
    raise RuntimeError("Set FFMPEG_PATH or pass --ffmpeg with your FFmpeg executable.")


def run(ffmpeg: str, *arguments: str) -> subprocess.CompletedProcess:
    result = subprocess.run(
        [ffmpeg, "-hide_banner", "-nostdin", "-xerror", *map(str, arguments)],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.decode("utf-8", "replace")[-12000:])
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, default=BASE / "output/mellox-black-brand-film-1080p60.mp4")
    parser.add_argument("--ffmpeg")
    args = parser.parse_args()
    try:
        import numpy as np
        from scipy.signal import correlate, correlation_lags
    except ImportError as error:
        raise RuntimeError("Validation needs numpy and scipy. Run: python -m pip install numpy scipy") from error

    config = json.loads((BASE / "config.json").read_text(encoding="utf-8-sig"))
    expected_frames = round(config["fps"] * config["duration"])
    ffmpeg = ffmpeg_path(args.ffmpeg)
    video = args.video.resolve()
    master = BASE / "assets/ref_audio.mp3"
    if not video.is_file() or not master.is_file():
        raise RuntimeError("Both the completed MP4 and assets/ref_audio.mp3 must exist.")

    # showinfo provides a decoded frame count, dimensions, and PTS for every frame.
    # This verifies the media itself instead of trusting container metadata.
    decoded = run(ffmpeg, "-v", "info", "-i", video, "-map", "0:v:0", "-an",
                  "-vf", "showinfo", "-fps_mode", "passthrough", "-f", "null", "-")
    log = decoded.stderr.decode("utf-8", "replace")
    frames = re.findall(r"n:\s*(\d+)\s+pts:\s*(-?\d+)\s+pts_time:([\d.eE+-]+).*?\bs:(\d+)x(\d+)", log)
    if len(frames) != expected_frames:
        raise RuntimeError(f"Decoded {len(frames)} frames; expected {expected_frames}.")
    maximum_pts_error = 0.0
    for expected, (index, _pts, seconds, width, height) in enumerate(frames):
        if int(index) != expected or (int(width), int(height)) != (config["width"], config["height"]):
            raise RuntimeError(f"Unexpected frame number/dimensions at decoded frame {expected}.")
        maximum_pts_error = max(maximum_pts_error, abs(float(seconds) - expected / config["fps"]))
    if maximum_pts_error > 0.0001:
        raise RuntimeError(f"Video PTS departs from {config['fps']} fps by {maximum_pts_error}s.")
    input_stream = next((line.strip() for line in log.splitlines() if "Stream #0:" in line and "Video:" in line), "")
    audio_stream = next((line.strip() for line in log.splitlines() if "Stream #0:" in line and "Audio:" in line), "")
    if "h264" not in input_stream or "yuv420p" not in input_stream:
        raise RuntimeError(f"Expected H.264 yuv420p video; found {input_stream}")
    if not re.search(r"\byuv420p\(tv,\s*bt709(?:/bt709/bt709)?(?:,|\))", input_stream):
        raise RuntimeError(f"Expected limited-range BT.709 pixels and color tags; found {input_stream}")
    if "Audio: aac" not in audio_stream:
        raise RuntimeError(f"Expected AAC audio; found {audio_stream}")

    rate = 16000

    def samples(filename: Path):
        result = run(ffmpeg, "-v", "error", "-i", filename, "-map", "0:a:0",
                     "-ac", "1", "-ar", rate, "-f", "f32le", "pipe:1")
        return np.frombuffer(result.stdout, dtype="<f4").astype(np.float64)

    reference, rendered = samples(master), samples(video)
    if not np.isfinite(rendered).all() or len(rendered) == 0:
        raise RuntimeError("Rendered audio has missing or non-finite decoded samples.")

    def alignment(actual, source, limit_ms=250):
        length = min(len(actual), len(source))
        actual = actual[:length] - actual[:length].mean()
        source = source[:length] - source[:length].mean()
        correlation = correlate(actual, source, mode="full", method="fft")
        lags = correlation_lags(length, length, mode="full")
        selected = np.abs(lags) <= round(rate * limit_ms / 1000)
        lag = int(lags[selected][np.argmax(correlation[selected])])
        if lag >= 0:
            a, b = actual[lag:], source[:length-lag]
        else:
            a, b = actual[:length+lag], source[-lag:]
        score = float(np.dot(a, b) / np.sqrt(np.dot(a, a) * np.dot(b, b)))
        return lag, score

    lag, correlation = alignment(rendered, reference)
    windows = []
    for start in (2, 18, 34):
        begin, end = start * rate, (start + 4) * rate
        local_lag, score = alignment(rendered[begin:end], reference[begin:end])
        windows.append({"start_seconds": start, "end_seconds": start + 4,
                        "lag_ms": local_lag * 1000 / rate, "correlation": score})

    # Equal correlation at the head, middle, and tail rules out progressive drift.
    if abs(lag) > 4 or any(abs(window["lag_ms"]) > 0.25 for window in windows):
        raise RuntimeError(f"Audio alignment exceeds 0.25ms: lag={lag * 1000 / rate}ms; windows={windows}")
    if correlation < 0.98 or any(window["correlation"] < 0.98 for window in windows):
        raise RuntimeError(f"Audio differs materially from the master: correlation={correlation}; windows={windows}")
    aligned_rendered = rendered[lag:] if lag >= 0 else rendered
    aligned_reference = reference if lag >= 0 else reference[-lag:]
    common_length = min(len(aligned_reference), len(aligned_rendered))
    segment_correlations = []
    for begin in range(0, common_length - rate + 1, rate):
        a, b = aligned_rendered[begin:begin+rate], aligned_reference[begin:begin+rate]
        rms = float(np.sqrt(np.mean(b*b)))
        if rms < 0.0001:
            continue
        score = float(np.dot(a, b) / np.sqrt(np.dot(a, a) * np.dot(b, b)))
        segment_correlations.append(score)
        if not np.isfinite(score) or score < 0.97:
            raise RuntimeError(f"Possible audio dropout/change at second {begin/rate}: correlation={score}")
    source_audio_duration, rendered_audio_duration = len(reference) / rate, len(rendered) / rate
    if abs(rendered_audio_duration - source_audio_duration) > 0.05:
        raise RuntimeError("Audio duration differs from the master by more than the 50ms codec-padding allowance.")

    report = {
        "passed": True, "video": str(video), "decoded_all_frames": len(frames),
        "width": config["width"], "height": config["height"], "fps": config["fps"],
        "video_duration_seconds": expected_frames / config["fps"],
        "max_frame_pts_error_seconds": maximum_pts_error,
        "input_video_stream": input_stream,
        "input_audio_stream": audio_stream,
        "audio_sample_rate_for_comparison": rate,
        "source_audio_seconds": source_audio_duration, "rendered_audio_seconds": rendered_audio_duration,
        "audio_lag_ms_positive_means_output_late": lag * 1000 / rate,
        "audio_correlation": correlation, "audio_windows": windows,
        "minimum_one_second_audio_correlation": min(segment_correlations),
        "audio_note": "AAC is lossy; correlation measures retained timing/content, not bit identity. Decoder skips codec priming using container edit information.",
    }
    destination = video.with_suffix(".validation.json")
    destination.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError) as error:
        print(f"Validation failed: {error}", file=sys.stderr)
        sys.exit(1)
