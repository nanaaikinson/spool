#!/usr/bin/env bash
# Prints the next release tag (for example v0.2.0) from Conventional Commits
# since the last release tag reachable from REF, or nothing when no commit
# warrants a release.
#
#   feat:                       minor
#   fix: / perf:                patch
#   type!: or BREAKING CHANGE:  major (minor while below 1.0)
#
# Other types (docs, chore, ci, test, refactor, style, build) don't release.
# Prerelease tags such as v0.2.0-rc.1 are ignored when finding the last release.
#
# Usage: scripts/next-version.sh [REF]
set -euo pipefail

ref=${1:-HEAD}
last=$(git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*' --exclude '*-*' "$ref" 2>/dev/null || true)
range=$ref
[ -n "$last" ] && range=$last..$ref

breaking='^[a-z]+(\([^)]*\))?!:'
feature='^feat(\([^)]*\))?:'
fix='^(fix|perf)(\([^)]*\))?:'

bump=none
while IFS= read -r -d '' message; do
  message=${message#$'\n'}
  subject=${message%%$'\n'*}
  if [[ $subject =~ $breaking ]] || grep -qE '^BREAKING[ -]CHANGE:' <<<"$message"; then
    bump=major
    break
  elif [[ $subject =~ $feature ]]; then
    bump=minor
  elif [[ $subject =~ $fix && $bump == none ]]; then
    bump=patch
  fi
done < <(git log --format='%B%x00' "$range")

[ "$bump" = none ] && exit 0

version=${last#v}
IFS=. read -r major minor patch <<<"${version:-0.0.0}"
# Below 1.0, breaking changes bump the minor version, as the changelog promises.
if [ "$bump" = major ] && [ "$major" = 0 ]; then
  bump=minor
fi
case $bump in
  major) major=$((major + 1)) minor=0 patch=0 ;;
  minor) minor=$((minor + 1)) patch=0 ;;
  patch) patch=$((patch + 1)) ;;
esac
echo "v$major.$minor.$patch"
