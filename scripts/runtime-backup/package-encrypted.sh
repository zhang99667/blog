#!/usr/bin/env bash

set -euo pipefail
umask 077

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$root/scripts/runtime-backup/age-tool.sh"
snapshot_name="${1:?snapshot name is required}"
staging_dir="${BACKUP_STAGING_DIR:?BACKUP_STAGING_DIR is required}"
recipient_file="${MARKZ_BACKUP_AGE_RECIPIENT_FILE:?MARKZ_BACKUP_AGE_RECIPIENT_FILE is required}"
output_dir="${RUNTIME_BACKUP_OUTPUT_DIR:?RUNTIME_BACKUP_OUTPUT_DIR is required}"
runner_temp="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
run_id="${GITHUB_RUN_ID:-local}"

if [[ ! "$snapshot_name" =~ ^reactions-[0-9]{8}T[0-9]{9}Z(-[0-9]+)?\.sqlite$ ]]; then
  printf '%s\n' "Invalid snapshot name" >&2
  exit 1
fi
if [[ ! -f "$staging_dir/$snapshot_name" ]]; then
  printf '%s\n' "Snapshot is missing from staging" >&2
  exit 1
fi
if [[ ! -f "$staging_dir/${snapshot_name%.sqlite}.json" ]]; then
  printf '%s\n' "Snapshot manifest is missing from staging" >&2
  exit 1
fi
if [[ ! -s "$recipient_file" ]] || grep -q "AGE-SECRET-KEY" "$recipient_file"; then
  printf '%s\n' "A public age recipient file is required" >&2
  exit 1
fi

work_dir="$(mktemp -d "$runner_temp/markz-runtime-backup.XXXXXX")"
cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

markz_install_age "$work_dir/age-tool"
age_bin="$MARKZ_AGE_BIN"
age_keygen_bin="$MARKZ_AGE_KEYGEN_BIN"

BACKUP_EXPORTED_AT="${BACKUP_EXPORTED_AT:-$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")}" \
  node "$root/services/reactions/offsite-backup.mjs" prepare "$staging_dir" "$snapshot_name" \
  >/dev/null

manifest_name="${snapshot_name%.sqlite}.json"
plaintext_archive="$work_dir/runtime-backup.tar.gz"
tar -czf "$plaintext_archive" -C "$staging_dir" bundle.json "$manifest_name" "$snapshot_name"

ephemeral_identity="$work_dir/ephemeral-identity.txt"
ephemeral_recipient="$work_dir/ephemeral-recipient.txt"
"$age_keygen_bin" -o "$ephemeral_identity" >/dev/null 2>&1
"$age_keygen_bin" -y "$ephemeral_identity" > "$ephemeral_recipient"

ciphertext_name="markz-runtime-backup-${run_id}.tar.gz.age"
ciphertext="$work_dir/$ciphertext_name"
"$age_bin" -R "$recipient_file" -R "$ephemeral_recipient" \
  -o "$ciphertext" "$plaintext_archive"

roundtrip_archive="$work_dir/roundtrip.tar.gz"
roundtrip_dir="$work_dir/roundtrip"
restored_database="$work_dir/restored.sqlite"
"$age_bin" --decrypt -i "$ephemeral_identity" -o "$roundtrip_archive" "$ciphertext"
mkdir -m 700 "$roundtrip_dir"
tar -xzf "$roundtrip_archive" -C "$roundtrip_dir"
node "$root/services/reactions/offsite-backup.mjs" verify "$roundtrip_dir" >/dev/null
node "$root/services/reactions/offsite-backup.mjs" restore \
  "$roundtrip_dir" "$restored_database" >/dev/null

if [[ -e "$output_dir" ]] && [[ -n "$(find "$output_dir" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  printf '%s\n' "Runtime backup output directory must be empty" >&2
  exit 1
fi
mkdir -p -m 700 "$output_dir"
install -m 600 "$ciphertext" "$output_dir/$ciphertext_name"
printf '%s  %s\n' "$(markz_sha256_file "$output_dir/$ciphertext_name")" "$ciphertext_name" \
  > "$output_dir/$ciphertext_name.sha256"
chmod 600 "$output_dir/$ciphertext_name.sha256"

output_count="$(find "$output_dir" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')"
if [[ "$output_count" -ne 2 ]] || find "$output_dir" -type f ! -name '*.age' ! -name '*.sha256' | grep -q .; then
  printf '%s\n' "Runtime backup output contains an unexpected file" >&2
  exit 1
fi

printf '%s\n' "Created and restore-verified encrypted runtime backup $ciphertext_name"
