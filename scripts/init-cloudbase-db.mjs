import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const config = JSON.parse(await readFile(path.join(projectRoot, "cloudbaserc.json"), "utf8"));
const runTcb = (args) => {
  const forwardedArgs = args.map((arg) =>
    typeof arg === "string" && (arg.startsWith("{") || arg.startsWith("["))
      ? arg.replaceAll('"', '\\"')
      : arg,
  );
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(path.dirname(process.execPath), "npx.ps1"), "-y", "--package", "@cloudbase/cli@latest", "tcb", ...forwardedArgs],
    { cwd: projectRoot, encoding: "utf8" },
  );
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (output) process.stdout.write(output);
  if (result.error) throw result.error;
  return { status: result.status ?? 1, output };
};

const createResult = runTcb([
  "-e",
  config.envId,
  "-r",
  "ap-shanghai",
  "api",
  "tcb",
  "CreateTable",
  "--api-version",
  "2018-06-08",
  "--body",
  JSON.stringify({ EnvId: config.envId, TableName: "polywork_events" }),
  "--json",
]);
if (createResult.status !== 0 && !createResult.output.includes("ResourceExist")) process.exit(createResult.status);
