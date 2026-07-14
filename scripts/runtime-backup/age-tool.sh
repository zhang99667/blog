#!/usr/bin/env bash

MARKZ_AGE_VERSION="1.3.1"

markz_sha256_file() {
  local file="${1:?file is required}"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    shasum -a 256 "$file" | awk '{print $1}'
  fi
}

markz_install_age() {
  local destination="${1:?destination is required}"
  local platform
  local expected_sha256

  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64)
      platform="linux-amd64"
      expected_sha256="bdc69c09cbdd6cf8b1f333d372a1f58247b3a33146406333e30c0f26e8f51377"
      ;;
    Darwin-arm64)
      platform="darwin-arm64"
      expected_sha256="01120ea2cbf0463d4c6bd767f99f3271bbed1cdc8a9aa718a76ba1fe4f01998b"
      ;;
    Darwin-x86_64)
      platform="darwin-amd64"
      expected_sha256="2b233301ad21ab7b1eabd9ae1198a164005fa4928fcdd745d47c39f8593209d7"
      ;;
    *)
      printf '%s\n' "Unsupported age platform: $(uname -s)-$(uname -m)" >&2
      return 1
      ;;
  esac

  mkdir -p -m 700 "$destination"
  local archive_name="age-v${MARKZ_AGE_VERSION}-${platform}.tar.gz"
  local archive_path="$destination/$archive_name"
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    "https://github.com/FiloSottile/age/releases/download/v${MARKZ_AGE_VERSION}/${archive_name}" \
    --output "$archive_path"
  if [[ "$(markz_sha256_file "$archive_path")" != "$expected_sha256" ]]; then
    printf '%s\n' "age release checksum mismatch" >&2
    return 1
  fi

  local extract_dir="$destination/extracted"
  mkdir -m 700 "$extract_dir"
  tar -xzf "$archive_path" -C "$extract_dir"
  local age_source
  local keygen_source
  age_source="$(find "$extract_dir" -type f -name age -perm -u+x | head -n 1)"
  keygen_source="$(find "$extract_dir" -type f -name age-keygen -perm -u+x | head -n 1)"
  if [[ -z "$age_source" || -z "$keygen_source" ]]; then
    printf '%s\n' "age release does not contain the required binaries" >&2
    return 1
  fi

  MARKZ_AGE_BIN="$destination/age"
  MARKZ_AGE_KEYGEN_BIN="$destination/age-keygen"
  install -m 700 "$age_source" "$MARKZ_AGE_BIN"
  install -m 700 "$keygen_source" "$MARKZ_AGE_KEYGEN_BIN"
  export MARKZ_AGE_BIN MARKZ_AGE_KEYGEN_BIN
}
