param([string]$Url = 'https://www.youtube.com/watch?v=36wf2HBD3GE')
$ErrorActionPreference = 'Stop'
$base = $PSScriptRoot
$toolFolder = Join-Path $base 'tools'
New-Item -ItemType Directory -Force -Path $toolFolder,(Join-Path $base 'temp/frames') | Out-Null
python -m pip install --disable-pip-version-check --target $toolFolder yt-dlp imageio-ffmpeg pillow numpy scipy
if ($LASTEXITCODE -ne 0) { throw 'Media tool installation failed.' }
$env:PYTHONPATH = $toolFolder
$ffmpeg = python -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'
python -m yt_dlp --js-runtimes node --no-playlist --write-info-json --ffmpeg-location $ffmpeg -f 'bv[height<=1080][ext=mp4]+ba[ext=m4a]/bv[height<=1080]+ba' --merge-output-format mp4 -o (Join-Path $base 'temp/ref.%(ext)s') $Url
if ($LASTEXITCODE -ne 0) { throw 'Reference download failed.' }
& $ffmpeg -hide_banner -nostdin -y -i (Join-Path $base 'temp/ref.mp4') -vn -c:a libmp3lame -q:a 0 (Join-Path $base 'temp/ref_audio.mp3')
if ($LASTEXITCODE -ne 0) { throw 'Audio extraction failed.' }
python (Join-Path $base 'analyze.py')
if ($LASTEXITCODE -ne 0) { throw 'Reference analysis failed.' }
