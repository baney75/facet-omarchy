#!/bin/sh
# Installs the Tor expert bundle for this user, checked against the published SHA-256 list.
set -eu
data="${XDG_DATA_HOME:-$HOME/.local/share}/facet-omarchy/tor"
base=https://dist.torproject.org/torbrowser
version=$(curl -fsSL "$base/" | grep -oE 'href="[0-9]+\.[0-9]+(\.[0-9]+)?/"' | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | sort -V | tail -1)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL -o "$tmp/sums" "$base/$version/sha256sums-signed-build.txt"
name=$(grep -oE 'tor-expert-bundle-linux-x86_64-[0-9.]+\.tar\.gz' "$tmp/sums" | head -1)
curl -fsSL -o "$tmp/$name" "$base/$version/$name"
(cd "$tmp" && grep " $name\$" sums | sha256sum -c -)
mkdir -p "$data"
tar -xzf "$tmp/$name" -C "$data"
echo "Tor $version installed in $data"
