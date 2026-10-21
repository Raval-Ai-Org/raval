"""Rebuild local film media from the extracted reference; Python stdlib only."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, default=ROOT.parent / 'video-clone/temp/ref.mp4')
parser.add_argument('--audio', type=Path, default=ROOT.parent / 'video-clone/temp/ref_audio.mp3')
args = parser.parse_args()
bundled = list((ROOT.parent / 'video-clone/tools/imageio_ffmpeg/binaries').glob('ffmpeg*.exe'))
ffmpeg = os.environ.get('FFMPEG_PATH') or (str(bundled[0]) if bundled else shutil.which('ffmpeg'))
if not ffmpeg:
    parser.error('Install FFmpeg or set FFMPEG_PATH.')
assets = ROOT / 'assets'
assets.mkdir(exist_ok=True)
shutil.copy2(args.source, assets / 'reference.mp4')
shutil.copy2(args.audio, assets / 'ref_audio.mp3')
# A genuine RGB color matrix, then the navy pedestal. Neutral studio grays
# become navy; the original gold bevels become bright yellow-green.
matrix = "colorchannelmixer=rr=0.9:rg=0.18:rb=-1.06:gr=0.8:gg=0.5:gb=-1.25:br=0.2:bg=0.2:bb=-0.3,lutrgb=r='val+2':g='val+13':b='val+22'"
subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'warning', '-y', '-i', str(args.source), '-an', '-vf', matrix,
                '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
                str(assets / 'reference-graded.mp4')], check=True)
print('Prepared local source, master audio, and matrix-graded countdown plate.')
