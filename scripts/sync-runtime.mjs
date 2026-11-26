// Copies the official browser runtime, unchanged, into every site (and the inspector).
//
//   node scripts/sync-runtime.mjs          copy vendor/agentify-website/runtime everywhere
//   node scripts/sync-runtime.mjs --check  verify every copy is byte-identical; exit 1 if not
//
// The official skill says: "Copy the skill's runtime/ folder without changes." This script
// is how ReliefMesh proves it did.
import { createHash } from "node:crypto";
import { cp, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { abs, RUNTIME_COPIES, SKILL } from "./lib/sites.mjs";

const SOURCE = path.join(SKILL, "runtime");

async function listFiles(dir, prefix = "") {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await listFiles(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

async function digest(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function fingerprint(dir) {
  const files = await listFiles(dir);
  const hash = createHash("sha256");
  for (const file of files) hash.update(`${file}\n${await digest(path.join(dir, file))}\n`);
  return { files, hash: hash.digest("hex") };
}

const check = process.argv.includes("--check");
const source = await fingerprint(SOURCE);
let failed = false;

for (const copy of RUNTIME_COPIES) {
  const target = abs(copy);
  if (check) {
    let present = true;
    try { await stat(target); } catch { present = false; }
    if (!present) {
      console.log(`ERROR: ${copy} is missing. Run: npm run runtime:sync`);
      failed = true;
      continue;
    }
    const current = await fingerprint(target);
    if (current.hash !== source.hash) {
      const extra = current.files.filter((file) => !source.files.includes(file));
      const missing = source.files.filter((file) => !current.files.includes(file));
      const changed = [];
      for (const file of source.files) {
        if (current.files.includes(file) && await digest(path.join(SOURCE, file)) !== await digest(path.join(target, file))) changed.push(file);
      }
      console.log(`ERROR: ${copy} differs from the official runtime.`);
      if (changed.length) console.log(`  changed: ${changed.join(", ")}`);
      if (missing.length) console.log(`  missing: ${missing.join(", ")}`);
      if (extra.length) console.log(`  extra:   ${extra.join(", ")}`);
      failed = true;
    } else {
      console.log(`OK: ${copy} is byte-identical to the official runtime (${source.files.length} files).`);
    }
  } else {
    await rm(target, { recursive: true, force: true });
    await cp(SOURCE, target, { recursive: true });
    console.log(`Copied runtime -> ${copy}`);
  }
}

if (check) console.log(failed ? "\nRuntime check FAILED." : `\nRuntime fingerprint: sha256 ${source.hash}`);
process.exitCode = failed ? 1 : 0;
