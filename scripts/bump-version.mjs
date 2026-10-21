// アプリのバージョンを上げる
// 使い方: node scripts/bump-version.mjs <patch|minor|major|x.y.z>
// tauri.conf.json・package.json・Cargo.toml・Cargo.lockを書き換える
import { readFileSync, writeFileSync } from "node:fs";

const TAURI_CONF = "app/src-tauri/tauri.conf.json";
const PACKAGE_JSON = "app/package.json";
const CARGO_TOML = "app/src-tauri/Cargo.toml";
const CARGO_LOCK = "app/src-tauri/Cargo.lock";

const arg = process.argv[2];
const current = JSON.parse(readFileSync(TAURI_CONF, "utf8")).version;
const [major, minor, patch] = current.split(".").map(Number);

let next;
switch (arg) {
  case "patch":
    next = `${major}.${minor}.${patch + 1}`;
    break;
  case "minor":
    next = `${major}.${minor + 1}.0`;
    break;
  case "major":
    next = `${major + 1}.0.0`;
    break;
  default:
    if (!/^\d+\.\d+\.\d+$/.test(arg ?? "")) {
      console.error("使い方: node scripts/bump-version.mjs <patch|minor|major|x.y.z>");
      process.exit(1);
    }
    next = arg;
}

for (const file of [TAURI_CONF, PACKAGE_JSON]) {
  const json = JSON.parse(readFileSync(file, "utf8"));
  json.version = next;
  writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
}

const replace = (file, pattern) => {
  const text = readFileSync(file, "utf8");
  if (!pattern.test(text)) throw new Error(`${file} のバージョンが見つかりません`);
  writeFileSync(file, text.replace(pattern, `$1"${next}"`));
};
replace(CARGO_TOML, /^(version = )".*?"/m);
replace(CARGO_LOCK, /(name = "lab-note"\nversion = )".*?"/);

console.log(`${current} → ${next}`);
