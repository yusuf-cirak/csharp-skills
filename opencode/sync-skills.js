#!/usr/bin/env node
// Sync the dotnet skills into opencode's global skills dir so opencode discovers them.
//
//   node opencode/sync-skills.js          # copy (default, cross-platform safe)
//   node opencode/sync-skills.js --link   # symlink each skill (true single-source; Windows
//                                          # may need Developer Mode / elevation for symlinks)
//
// Skills are copied with their original folder names (index, csharp, ddd, web-api, validation,
// hardening, observability, testing) so the relative cross-skill links (../index/references/...)
// keep resolving. Idempotent: re-running overwrites the destination.

const fs = require("fs");
const os = require("os");
const path = require("path");

const link = process.argv.includes("--link");

// repo/plugins/dotnet/skills  (this file lives at repo/opencode/sync-skills.js)
const srcRoot = path.resolve(__dirname, "..", "plugins", "dotnet", "skills");
const destRoot = path.join(os.homedir(), ".config", "opencode", "skills");

if (!fs.existsSync(srcRoot)) {
  console.error(`Source skills dir not found: ${srcRoot}`);
  process.exit(1);
}

fs.mkdirSync(destRoot, { recursive: true });

function copyDir(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
}

const skills = fs
  .readdirSync(srcRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

let count = 0;
for (const name of skills) {
  const from = path.join(srcRoot, name);
  const to = path.join(destRoot, name);
  try {
    if (link) {
      fs.rmSync(to, { recursive: true, force: true });
      fs.symlinkSync(from, to, "junction"); // "junction" works on Windows without elevation for dirs
      console.log(`linked  ${name} -> ${to}`);
    } else {
      copyDir(from, to);
      console.log(`copied  ${name} -> ${to}`);
    }
    count++;
  } catch (err) {
    console.error(`failed  ${name}: ${err.message}`);
  }
}

console.log(`\n${count}/${skills.length} skills synced to ${destRoot}`);
console.log("Invoke in opencode via the skill tool by bare name, e.g. skill({ name: \"index\" }).");
