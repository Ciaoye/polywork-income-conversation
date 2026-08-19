import { cp, mkdir, writeFile } from "node:fs/promises";

const root = new URL("../github-pages-dist/", import.meta.url);
const index = new URL("index.html", root);

for (const route of ["join", "host", "archive"]) {
  const directory = new URL(`${route}/`, root);
  await mkdir(directory, { recursive: true });
  await cp(index, new URL("index.html", directory));
}

await cp(index, new URL("404.html", root));
await writeFile(new URL(".nojekyll", root), "", "utf8");
