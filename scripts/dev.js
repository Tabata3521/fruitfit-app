import { spawn } from "node:child_process";

const api = spawn(process.execPath, ["server.js"], {
  stdio: "inherit",
  shell: false,
});

const vite = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev:vite", "--", "--port", "5175"], {
  stdio: "inherit",
  shell: false,
});

function shutdown(signal) {
  api.kill(signal);
  vite.kill(signal);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

api.on("exit", (code) => {
  if (code) process.exitCode = code;
});

vite.on("exit", (code) => {
  if (code) process.exitCode = code;
});
