#!/usr/bin/env bash

set -euo pipefail
umask 077

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$root/scripts/runtime-backup/age-tool.sh"

artifact_dir="${1:?artifact directory is required}"
identity_path="${2:?age identity path is required}"
destination_path="${3:?new SQLite destination path is required}"
if [[ ! -r "$identity_path" ]] || ! grep -q '^AGE-SECRET-KEY-' "$identity_path"; then
  printf '%s\n' "A readable age private identity is required" >&2
  exit 1
fi
if [[ -e "$destination_path" ]]; then
  printf '%s\n' "Restore destination already exists" >&2
  exit 1
fi

artifact_entry_count="$(find "$artifact_dir" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')"
if [[ "$artifact_entry_count" -ne 2 ]] || \
  find "$artifact_dir" -mindepth 1 -maxdepth 1 -type f ! -name '*.age' ! -name '*.sha256' | grep -q .; then
  printf '%s\n' "Artifact directory contains an unexpected file" >&2
  exit 1
fi

ciphertexts=("$artifact_dir"/*.age)
if [[ "${#ciphertexts[@]}" -ne 1 ]] || [[ ! -f "${ciphertexts[0]}" ]]; then
  printf '%s\n' "Artifact directory must contain exactly one age ciphertext" >&2
  exit 1
fi
ciphertext="${ciphertexts[0]}"
checksum_path="$ciphertext.sha256"
if [[ ! -f "$checksum_path" ]]; then
  printf '%s\n' "Artifact checksum is missing" >&2
  exit 1
fi

read -r expected_checksum expected_name < "$checksum_path"
expected_name="${expected_name#\*}"
if [[ "$expected_name" != "$(basename "$ciphertext")" ]] || \
  [[ "$expected_checksum" != "$(markz_sha256_file "$ciphertext")" ]]; then
  printf '%s\n' "Encrypted artifact checksum does not match" >&2
  exit 1
fi

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/markz-runtime-backup-restore.XXXXXX")"
cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

markz_install_age "$work_dir/age-tool"
"$MARKZ_AGE_BIN" --decrypt -i "$identity_path" -o "$work_dir/bundle.tar.gz" "$ciphertext"
mkdir -m 700 "$work_dir/bundle"
tar -xzf "$work_dir/bundle.tar.gz" -C "$work_dir/bundle"
node "$root/services/reactions/offsite-backup.mjs" verify "$work_dir/bundle" >/dev/null
node "$root/services/reactions/offsite-backup.mjs" restore \
  "$work_dir/bundle" "$destination_path"
