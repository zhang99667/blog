#!/usr/bin/env bash

set -euo pipefail
umask 077

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$root/scripts/runtime-backup/age-tool.sh"

if [[ "${1:-}" != "--confirm-create-key" ]]; then
  printf '%s\n' "Refusing to create a backup key without --confirm-create-key" >&2
  exit 1
fi
shift

identity_path="${1:-$HOME/.config/markz/runtime-backup.agekey}"
recipient_path="${2:-$root/deploy/runtime-backup-recipient.txt}"
mkdir -p -m 700 "$(dirname "$identity_path")"
identity_dir="$(cd "$(dirname "$identity_path")" && pwd)"
identity_path="$identity_dir/$(basename "$identity_path")"
recipient_dir="$(cd "$(dirname "$recipient_path")" && pwd)"
recipient_path="$recipient_dir/$(basename "$recipient_path")"

if [[ "$identity_path" == "$root/"* ]]; then
  printf '%s\n' "The private backup identity must stay outside the repository" >&2
  exit 1
fi
if [[ -e "$identity_path" || -e "$recipient_path" ]]; then
  printf '%s\n' "Backup identity or recipient already exists; rotate explicitly instead" >&2
  exit 1
fi

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/markz-runtime-backup-key.XXXXXX")"
cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

markz_install_age "$work_dir/age-tool"
"$MARKZ_AGE_KEYGEN_BIN" -o "$work_dir/identity.txt" >/dev/null 2>&1
"$MARKZ_AGE_KEYGEN_BIN" -y "$work_dir/identity.txt" > "$work_dir/recipient.txt"
install -m 600 "$work_dir/identity.txt" "$identity_path"
install -m 644 "$work_dir/recipient.txt" "$recipient_path"

printf 'Created private identity: %s\n' "$identity_path"
printf 'Created public recipient: %s\n' "$recipient_path"
printf 'Public recipient: %s\n' "$(cat "$recipient_path")"
