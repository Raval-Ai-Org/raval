import "server-only";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

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

/** Prefer the configured worker binary; use an installed browser when developing on Windows. */
export async function launchVisualBrowser() {
  const path = process.env.VISUAL_CAPTURE_BROWSER_PATH;
  const channel = process.env.VISUAL_CAPTURE_BROWSER_CHANNEL as "chrome" | "msedge" | undefined;
  const windowsChannel = installedWindowsBrowser();
  return chromium.launch({
    headless: true,
    timeout: 15_000,
    chromiumSandbox: true,
    ...(path
      ? { executablePath: path }
      : (channel ?? windowsChannel)
        ? { channel: channel ?? windowsChannel }
        : {}),
    args: [
      "--disable-background-networking",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    ],
  });
}
