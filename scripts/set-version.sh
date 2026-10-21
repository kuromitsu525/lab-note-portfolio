#!/usr/bin/env bash
# アプリのバージョンを書き換える(リリース時にCIがタグのバージョンを反映するために使う)
# 使い方: scripts/set-version.sh x.y.z
# tauri.conf.json・package.json・Cargo.toml・Cargo.lockを書き換える
set -euo pipefail

version=${1:-}
if [[ ! $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "使い方: $0 x.y.z" >&2
  exit 1
fi
export VERSION=$version

# 最初に出てくるバージョンだけを書き換える
perl -0pi -e 's/"version": ".*?"/"version": "$ENV{VERSION}"/ or die "$ARGV のバージョンが見つかりません\n"' \
  app/src-tauri/tauri.conf.json app/package.json
perl -0pi -e 's/^version = ".*?"/version = "$ENV{VERSION}"/m or die "$ARGV のバージョンが見つかりません\n"' \
  app/src-tauri/Cargo.toml
perl -0pi -e 's/(name = "lab-note"\nversion = )".*?"/$1"$ENV{VERSION}"/ or die "$ARGV のバージョンが見つかりません\n"' \
  app/src-tauri/Cargo.lock

echo "version: $version"
