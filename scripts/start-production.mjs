import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standaloneServer = path.join(projectRoot, ".next", "standalone", "server.js");
const nextCli = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
const command = existsSync(standaloneServer) ? process.execPath : process.execPath;
const args = existsSync(standaloneServer) ? [standaloneServer] : [nextCli, "start"];

const child = spawn(command, args, {
  cwd: projectRoot,
  env: process.env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 1);
  }
});
