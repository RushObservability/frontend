#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

version="${VERSION:-}"
version="${version#v}"
dry_run="${DRY_RUN:-0}"

if [[ -z "$version" ]]; then
  echo "Usage: make release VERSION=0.1.13" >&2
  exit 2
fi

if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid version: $version" >&2
  echo "Use a semantic version such as 0.1.13 or 0.2.0-rc.1." >&2
  exit 2
fi

for required_command in git npm node gh; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "Required command not found: $required_command" >&2
    exit 1
  fi
done

package_version="$(node -p "require('./package.json').version")"
lock_version="$(node -p "require('./package-lock.json').version")"
release_tag="v${version}"
release_branch="release/${release_tag}"

if [[ "$package_version" == "$version" && "$lock_version" == "$version" ]]; then
  echo "Both package files already use $version. Choose a new version." >&2
  exit 1
fi

echo "Release plan"
echo "  Current version: package.json=$package_version package-lock.json=$lock_version"
echo "  New version:     $version"
echo "  Branch:          $release_branch"
echo "  Tag after merge: $release_tag"

if [[ "$dry_run" == "1" ]]; then
  echo "Dry run complete. No files, branches, commits, or pull requests were changed."
  exit 0
fi

current_branch="$(git branch --show-current)"
if [[ "$current_branch" != "main" ]]; then
  echo "Run this target from main. Current branch: ${current_branch:-detached HEAD}" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "The working tree is not clean. Commit or stash your changes before creating a release PR." >&2
  exit 1
fi

git fetch origin main --tags

if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  echo "Local main does not match origin/main. Pull the latest main branch and try again." >&2
  exit 1
fi

if git rev-parse --verify --quiet "refs/tags/${release_tag}" >/dev/null; then
  echo "Tag $release_tag already exists. Choose a new version." >&2
  exit 1
fi

if git show-ref --verify --quiet "refs/heads/${release_branch}"; then
  echo "Local branch $release_branch already exists." >&2
  exit 1
fi

if git ls-remote --exit-code --heads origin "refs/heads/${release_branch}" >/dev/null 2>&1; then
  echo "Remote branch $release_branch already exists." >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated. Run: gh auth login" >&2
  exit 1
fi

git switch -c "$release_branch"
npm version "$version" --no-git-tag-version --allow-same-version --ignore-scripts

npm test
npm run build

git add package.json package-lock.json
if git diff --cached --quiet; then
  echo "The version command did not change either package file." >&2
  exit 1
fi

git commit -m "Release $release_tag"
git push --set-upstream origin "$release_branch"

pr_url="$(
  gh pr create \
    --base main \
    --head "$release_branch" \
    --title "Release $release_tag" \
    --body "Updates the frontend package version to $version. After this PR merges, the release workflow will test and publish the image, create $release_tag, and generate release notes from merged pull requests."
)"

echo "Release PR created: $pr_url"
