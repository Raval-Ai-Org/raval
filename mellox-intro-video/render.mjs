import { spawn } from 'node:child_process';
import { access, mkdir, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { projectDir, startServer } from './server.mjs';

const defaultOutput = path.join(projectDir, 'output/mellox-black-brand-film-1080p60.mp4');
const outputDir = path.join(projectDir, 'output');
const assetsDir = path.join(projectDir, 'assets');

function optionsFromArgs(args) {
  const options = { output: defaultOutput, fromFrame: 0, frames: undefined, stills: undefined, check: false };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--help' || flag === '-h') return { help: true };
    if (flag === '--check') { options.check = true; continue; }
    const value = args[++index];
    if (value === undefined) throw new Error(`Missing value after ${flag}`);
    if (flag === '--output') options.output = path.resolve(process.cwd(), value);
    else if (flag === '--from-frame') options.fromFrame = Number(value);
    else if (flag === '--frames') options.frames = Number(value);
    else if (flag === '--stills') options.stills = value.split(',').map(Number);
    else throw new Error(`Unknown option ${flag}`);
  }
  for (const name of ['fromFrame', 'frames']) {
    if (options[name] !== undefined && (!Number.isSafeInteger(options[name]) || options[name] < (name === 'frames' ? 1 : 0))) {
      throw new Error(`${name} must be a ${name === 'frames' ? 'positive' : 'nonnegative'} integer.`);
    }
  }
  if (options.stills?.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Still timestamps must be comma-separated nonnegative seconds.');
  return options;
}

async function findFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const bundled = path.resolve(projectDir, '../video-clone/tools/imageio_ffmpeg/binaries');
  try {
    const entries = await readdir(bundled);
    const binary = entries.find(name => /^ffmpeg.*\.exe$/i.test(name)) || entries.find(name => /^ffmpeg.*(?:linux|osx|mac)/i.test(name));
    if (binary) return path.join(bundled, binary);
  } catch { /* A standard FFmpeg on PATH is supported for standalone use. */ }
  return 'ffmpeg';
}

async function launchBrowser() {
  const common = { headless: true, args: ['--autoplay-policy=no-user-gesture-required'] };
  if (process.env.CHROME_PATH) return chromium.launch({ ...common, executablePath: process.env.CHROME_PATH });
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) return chromium.launch({ ...common, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  try { return await chromium.launch({ ...common, channel: 'chrome' }); }
  catch (chromeError) {
    try { return await chromium.launch(common); }
    catch (bundledError) {
      throw new Error(`Chrome is unavailable. Set CHROME_PATH, or run npx playwright install chromium.\n${chromeError.message}\n${bundledError.message}`);
    }
  }
}

function validateConfig(config) {
  if (config?.width !== 1920 || config?.height !== 1080 || config?.fps !== 60) throw new Error('FILM_CONFIG must declare width:1920, height:1080, fps:60.');
  if (!Number.isFinite(config.duration) || Math.round(config.duration * config.fps) !== 2451) throw new Error('FILM_CONFIG duration must preserve the full audio tail: 2451 frames (40.85 seconds at 60 fps).');
}

function jpegBuffer(result) {
  const buffer = Buffer.from(String(result).replace(/^data:image\/jpeg;base64,/, ''), 'base64');
  if (buffer.length < 1000 || buffer[0] !== 0xff || buffer[1] !== 0xd8) throw new Error('exportFilmFrame did not return a valid JPEG base64 string.');
  return buffer;
}

async function main() {
  const options = optionsFromArgs(process.argv.slice(2));
  if (options.help) {
    console.log('node render.mjs [--output file.mp4] [--from-frame N] [--frames N]\nnode render.mjs --stills 1.4,5.4,11\nnode render.mjs --check\nEnvironment: FFMPEG_PATH, CHROME_PATH (optional).');
    return;
  }
  await access(path.join(assetsDir, 'ref_audio.mp3'));
  let instance;
  let browser;
  let encoder;
  let partialOutput;
  let interrupted = false;
  const onSignal = () => { interrupted = true; encoder?.kill(); void browser?.close(); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    instance = await startServer();
    browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const pageErrors = [];
    const requests = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('requestfailed', request => {
      const failure = request.failure()?.errorText;
      // Chromium cancels superseded video/audio byte-range requests during seeks.
      // This is expected buffering behavior; HTMLMediaElement.error below still
      // catches real network, codec, decode, and source failures.
      if (request.resourceType() === 'media' && failure === 'net::ERR_ABORTED') return;
      requests.push(`${request.url()}: ${failure}`);
    });
    page.on('response', response => { if (response.status() >= 400) requests.push(`${response.status()} ${response.url()}`); });
    await page.goto(`${instance.url}/?render=1`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.filmReady !== undefined, undefined, { timeout: 60000 });
    await page.evaluate(async () => {
      await window.filmReady;
      await document.fonts.ready;
      for (const media of document.querySelectorAll('video,audio')) {
        if (media.error) throw new Error(`Media error ${media.error.code}: ${media.currentSrc}: ${media.error.message}`);
      }
    });
    const config = await page.evaluate(() => ({ ...window.FILM_CONFIG }));
    validateConfig(config);
    const assertPage = () => {
      if (interrupted) throw new Error('Render interrupted.');
      if (pageErrors.length || requests.length) throw new Error(`Preview errors:\n${[...pageErrors, ...requests].join('\n')}`);
    };
    assertPage();
    const capture = async seconds => {
      const result = await page.evaluate(async time => {
        for (const media of document.querySelectorAll('video,audio')) {
          if (media.error) throw new Error(`Media error ${media.error.code}: ${media.currentSrc}: ${media.error.message}`);
        }
        return window.exportFilmFrame(time);
      }, seconds);
      assertPage();
      return jpegBuffer(result);
    };
    const totalFrames = Math.round(config.duration * config.fps);
    if (options.stills) {
      await mkdir(path.join(outputDir, 'stills'), { recursive: true });
      for (const seconds of options.stills) {
        if (seconds >= totalFrames / config.fps) throw new Error(`Still ${seconds}s falls outside the film.`);
        const filename = path.join(outputDir, 'stills', `frame-${seconds.toFixed(3).replace('.', '-')}.jpg`);
        await writeFile(filename, await capture(seconds));
        console.log(`Saved ${filename}`);
      }
      return;
    }
    if (options.check) {
      for (const seconds of [0, 1.4, 5.4, 11, 19.5, 29, 38.5, (totalFrames - 1) / config.fps]) await capture(seconds);
      console.log(`Film check passed: ${config.width}x${config.height}, ${config.fps} fps, ${totalFrames} frames; 8 seek/export samples; no browser or asset errors.`);
      return;
    }
    const frames = options.frames ?? totalFrames - options.fromFrame;
    if (options.fromFrame >= totalFrames || options.fromFrame + frames > totalFrames) throw new Error(`Selected frames must fall within 0..${totalFrames - 1}.`);
    const startSeconds = options.fromFrame / config.fps;
    const duration = frames / config.fps;
    await mkdir(path.dirname(options.output), { recursive: true });
    // Encode to a separate file, preserving a prior complete render if this run fails.
    partialOutput = options.output.replace(/\.mp4$/i, '') + '.rendering.mp4';
    const ffmpeg = await findFfmpeg();
    const args = [
      '-hide_banner', '-loglevel', 'warning', '-y',
      '-f', 'image2pipe', '-framerate', String(config.fps), '-vcodec', 'mjpeg', '-i', 'pipe:0',
      '-ss', startSeconds.toFixed(9), '-i', path.join(assetsDir, 'ref_audio.mp3'),
      '-map', '0:v:0', '-map', '1:a:0', '-frames:v', String(frames), '-t', duration.toFixed(9),
      // Canvas JPEGs carry full-range BT.601 matrix values. Convert the actual
      // pixels and declare limited-range BT.709 for a standard HD H.264 file.
      '-vf', 'scale=in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '15', '-pix_fmt', 'yuv420p',
      '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-r', String(config.fps), '-s', `${config.width}x${config.height}`,
      '-bsf:v', 'h264_metadata=video_full_range_flag=0:colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1',
      '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-movflags', '+faststart+write_colr',
      '-metadata', 'title=Mellox AI', partialOutput,
    ];
    let encoderLog = '';
    let encoderFailure;
    encoder = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    encoder.stderr.on('data', data => { encoderLog = (encoderLog + data.toString()).slice(-40000); });
    encoder.stdin.on('error', error => { encoderFailure = error; });
    const completed = new Promise((resolve, reject) => {
      encoder.once('error', error => { encoderFailure = error; reject(error); });
      encoder.once('close', code => {
        if (code === 0) resolve();
        else { encoderFailure = new Error(`FFmpeg exited ${code}.\n${encoderLog}`); reject(encoderFailure); }
      });
    });
    // Capture the rejection immediately so an early FFmpeg failure cannot be unhandled.
    completed.catch(() => {});
    console.log(`Rendering ${frames} frames at ${config.fps} fps (${duration.toFixed(3)}s), starting at frame ${options.fromFrame}.`);
    const started = Date.now();
    for (let index = 0; index < frames; index++) {
      if (encoderFailure) throw encoderFailure;
      const frame = await capture((options.fromFrame + index) / config.fps);
      await new Promise((resolve, reject) => encoder.stdin.write(frame, error => error ? reject(error) : resolve()));
      if (index === 0 || (index + 1) % 120 === 0 || index + 1 === frames) {
        console.log(`Frames ${index + 1}/${frames} (${((index + 1) / frames * 100).toFixed(1)}%); elapsed ${((Date.now() - started) / 1000).toFixed(1)}s`);
      }
    }
    encoder.stdin.end();
    await completed;
    assertPage();
    await page.evaluate(() => {
      for (const media of document.querySelectorAll('video,audio')) {
        if (media.error) throw new Error(`Media error ${media.error.code}: ${media.currentSrc}: ${media.error.message}`);
      }
    });
    await rename(partialOutput, options.output);
    partialOutput = undefined;
    const manifest = { width: config.width, height: config.height, fps: config.fps, frames, fromFrame: options.fromFrame, duration, audio: 'ref_audio.mp3', audioStartSeconds: startSeconds, output: path.basename(options.output), renderedAt: new Date().toISOString() };
    await writeFile(options.output.replace(/\.mp4$/i, '') + '.json', JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Rendered ${options.output}`);
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    if (encoder && encoder.exitCode === null) encoder.kill();
    await browser?.close().catch(() => {});
    await instance?.close().catch(() => {});
    if (partialOutput) await unlink(partialOutput).catch(() => {});
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
