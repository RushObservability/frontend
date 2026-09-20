#!/usr/bin/env bash
set -euo pipefail

# Only promote the immutable digest that passed the release job's checks.
: "${IMAGE_REPOSITORY:?}"
: "${INDEX_DIGEST:?}"
: "${RELEASE_TAGS:?}"
[[ "$INDEX_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 1
args=()
while IFS= read -r tag; do
  [[ -n "$tag" ]] || continue
  [[ "$tag" == "${IMAGE_REPOSITORY}:"* ]] || exit 1
  suffix=${tag#"${IMAGE_REPOSITORY}:"}
  [[ "$suffix" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || exit 1
  args+=(--tag "$tag")
done <<< "$RELEASE_TAGS"
[[ ${#args[@]} -gt 0 ]] || exit 1
docker buildx imagetools create "${args[@]}" "${IMAGE_REPOSITORY}@${INDEX_DIGEST}"
