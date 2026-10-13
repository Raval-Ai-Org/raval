import "server-only";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

/** Prefer the configured worker binary; use an installed browser when developing on Windows. */
export async function launchVisualBrowser() {
  const path = process.env.VISUAL_CAPTURE_BROWSER_PATH;
  const channel = process.env.VISUAL_CAPTURE_BROWSER_CHANNEL as "chrome" | "msedge" | undefined;
  const windowsChannel =
    process.platform === "win32"
      ? existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe")
        ? ("chrome" as const)
        : existsSync("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe")
          ? ("msedge" as const)
          : undefined
      : undefined;
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
