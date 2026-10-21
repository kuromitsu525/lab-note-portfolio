// origin/mainの最新コミットに次のバージョンのタグを付けてpushし、リリースを走らせる
// 使い方: node scripts/release.mjs <patch|minor|major>
import { execFileSync } from "node:child_process";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

const bump = process.argv[2];
if (!["patch", "minor", "major"].includes(bump)) {
  console.error("使い方: node scripts/release.mjs <patch|minor|major>");
  process.exit(1);
}

git("fetch", "origin", "main", "--tags", "--force");

const latest = git("tag", "--list", "v*.*.*", "--sort=-v:refname").split("\n")[0] || "v0.0.0";
const [major, minor, patch] = latest.slice(1).split(".").map(Number);
const next = {
  patch: `v${major}.${minor}.${patch + 1}`,
  minor: `v${major}.${minor + 1}.0`,
  major: `v${major + 1}.0.0`,
}[bump];

const target = git("rev-parse", "origin/main");
const tagged = git("tag", "--points-at", target, "--list", "v*.*.*");
if (tagged) {
  console.error(`origin/main (${target.slice(0, 7)}) は ${tagged} でリリース済みです`);
  process.exit(1);
}

git("tag", next, target);
git("push", "origin", next);
console.log(`${latest} → ${next} (${target.slice(0, 7)}) のタグをpushしました`);
