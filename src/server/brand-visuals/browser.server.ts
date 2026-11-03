import "server-only";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type LaunchOptions } from "playwright-core";

function installedWindowsBrowser(): "chrome" | "msedge" | undefined {
  if (process.platform !== "win32") return undefined;
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  const chrome = programFiles
    ? join(programFiles, "Google", "Chrome", "Application", "chrome.exe")
    : undefined;
  const edgeRoots = [programFiles, programFilesX86].filter((root): root is string => Boolean(root));
  if (chrome && existsSync(chrome)) return "chrome";
  if (
    edgeRoots.some((root) =>
      existsSync(join(root, "Microsoft", "Edge", "Application", "msedge.exe")),
    )
  ) {
    return "msedge";
  }
  return undefined;
}

const truthy = (v: string | undefined) => /^(1|true|yes)$/i.test((v ?? "").trim());

// Set once a sandboxed launch has failed on this server: containers without
// user namespaces can never start Chromium's sandbox, so later launches skip
// straight to the one that works instead of failing first every time.
let sandboxUnavailable = false;

function launchOptions(sandbox: boolean): LaunchOptions {
  const path = process.env.VISUAL_CAPTURE_BROWSER_PATH;
  const channel = process.env.VISUAL_CAPTURE_BROWSER_CHANNEL as "chrome" | "msedge" | undefined;
  const windowsChannel = installedWindowsBrowser();
  return {
    headless: true,
    timeout: 15_000,
    chromiumSandbox: sandbox,
    ...(path
      ? { executablePath: path }
      : (channel ?? windowsChannel)
        ? { channel: channel ?? windowsChannel }
        : {}),
    args: [
      "--disable-background-networking",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      // Docker gives /dev/shm 64 MB; Chromium crashes on real pages without this.
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--no-first-run",
      "--mute-audio",
    ],
  };
}

/**
 * Prefer the configured worker binary; use an installed browser when
 * developing on Windows. The sandbox is tried first; where the server can't
 * start it (most unprivileged containers: the browser closes at launch) the
 * launch is repeated once without it. Every page the capture opens still goes
 * through the SSRF-guarded network (`guardCaptureNetwork`), and video frames are
 * decoded offline. `VISUAL_CAPTURE_NO_SANDBOX=true` skips the first attempt.
 */
export async function launchVisualBrowser(): Promise<Browser> {
  if (sandboxUnavailable || truthy(process.env.VISUAL_CAPTURE_NO_SANDBOX)) {
    return chromium.launch(launchOptions(false));
  }
  try {
    return await chromium.launch(launchOptions(true));
  } catch (error) {
    console.warn(
      "[brand-visuals] sandboxed browser launch failed; retrying without the sandbox",
      error instanceof Error ? error.message.split("\n")[0] : error,
    );
    sandboxUnavailable = true;
    return chromium.launch(launchOptions(false));
  }
}
