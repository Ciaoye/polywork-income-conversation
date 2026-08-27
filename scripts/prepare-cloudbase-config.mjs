import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const envSource = await readFile(path.join(projectRoot, ".env"), "utf8");
const hostKeyLine = envSource
  .split(/\r?\n/)
  .find((line) => line.startsWith("HOST_KEY="));
const hostKey = hostKeyLine?.slice("HOST_KEY=".length).trim();

if (!hostKey) throw new Error(".env 中缺少 HOST_KEY");

const publicConfig = JSON.parse(await readFile(path.join(projectRoot, "cloudbaserc.json"), "utf8"));
const secureConfig = {
  ...publicConfig,
  // Keep this relative because the CloudBase CLI resolves functionRoot from
  // the current project directory when a config file is passed explicitly.
  functionRoot: "cloudbase-functions",
  functions: publicConfig.functions.map((fn) =>
    fn.name === "polywork-event-api"
      ? { ...fn, envVariables: { ...(fn.envVariables || {}), HOST_KEY: hostKey } }
      : fn,
  ),
};

const outputDirectory = path.join(projectRoot, "work", "cloudbase-deploy");
const outputPath = path.join(outputDirectory, "cloudbaserc.json");
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(secureConfig, null, 2)}\n`, "utf8");
console.log(outputPath);
