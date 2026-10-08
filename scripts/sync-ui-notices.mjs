import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const entry = fileURLToPath(import.meta.resolve("kabuda-kit/components/button"));
const packageRoot = path.resolve(path.dirname(entry), "../..");
const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
if (manifest.name !== "kabuda-kit" || manifest.license !== "MIT") {
  throw new Error(
    "Shared UI must use the audited MIT release; review a license change before distribution.",
  );
}
const destination = path.join(root, "public/licenses");
await mkdir(destination, { recursive: true });
for (const [source, target] of [
  ["LICENSE", "kabuda-kit.LICENSE.txt"],
  ["THIRD_PARTY_NOTICES.md", "kabuda-kit.THIRD_PARTY_NOTICES.txt"],
]) {
  await copyFile(path.join(packageRoot, source), path.join(destination, target));
}
await copyFile(
  path.join(root, "LICENSE"),
  path.join(destination, "one-click-distributor.LICENSE.txt"),
);
console.log(`Synced kabuda-kit ${manifest.version} copyright notices for the extension bundle.`);
