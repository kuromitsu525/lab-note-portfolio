// アプリのバージョンを書き換える(リリース時にCIがタグのバージョンを反映するために使う)
// 使い方: node scripts/set-version.mjs x.y.z
// tauri.conf.json・package.json・Cargo.toml・Cargo.lockを書き換える
import { readFileSync, writeFileSync } from "node:fs";

const TAURI_CONF = "app/src-tauri/tauri.conf.json";
const PACKAGE_JSON = "app/package.json";
const CARGO_TOML = "app/src-tauri/Cargo.toml";
const CARGO_LOCK = "app/src-tauri/Cargo.lock";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("使い方: node scripts/set-version.mjs x.y.z");
  process.exit(1);
}

for (const file of [TAURI_CONF, PACKAGE_JSON]) {
  const json = JSON.parse(readFileSync(file, "utf8"));
  json.version = version;
  writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
}

const replace = (file, pattern) => {
  const text = readFileSync(file, "utf8");
  if (!pattern.test(text)) throw new Error(`${file} のバージョンが見つかりません`);
  writeFileSync(file, text.replace(pattern, `$1"${version}"`));
};
replace(CARGO_TOML, /^(version = )".*?"/m);
replace(CARGO_LOCK, /(name = "lab-note"\nversion = )".*?"/);

console.log(`version: ${version}`);
