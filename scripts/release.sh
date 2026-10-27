#!/usr/bin/env bash
# origin/mainの最新コミットに次のバージョンのタグを付けてpushし、リリースを走らせる
# 使い方: scripts/release.sh <patch|minor|major>
set -euo pipefail

bump=${1:-}
case $bump in
  patch | minor | major) ;;
  *)
    echo "使い方: $0 <patch|minor|major>" >&2
    exit 1
    ;;
esac

git fetch origin main --tags --force

latest=$(git tag --list 'v*.*.*' --sort=-v:refname | head -n 1)
latest=${latest:-v0.0.0}
IFS=. read -r major minor patch <<<"${latest#v}"
case $bump in
  patch) next="v$major.$minor.$((patch + 1))" ;;
  minor) next="v$major.$((minor + 1)).0" ;;
  major) next="v$((major + 1)).0.0" ;;
esac

target=$(git rev-parse origin/main)
tagged=$(git tag --points-at "$target" --list 'v*.*.*')
if [ -n "$tagged" ]; then
  echo "origin/main (${target:0:7}) は $tagged でリリース済みです" >&2
  exit 1
fi

git tag "$next" "$target"
git push origin "$next"
echo "$latest → $next (${target:0:7}) のタグをpushしました"
