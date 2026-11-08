#!/usr/bin/env bash
# Drives the native app with real keyboard and mouse input in a private X display, then checks the results.
# Usage: scripts/e2e.sh [output-dir]. Exits non-zero if any check fails.
set -uo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$(mktemp -d)}"; rm -rf "$out/data" "$out/config" "$out/cache" "$out/downloads"; mkdir -p "$out/shots" "$out/web" "$out/config" "$out/downloads"
display=:83; fails=0
ok() { echo "PASS $1"; }; bad() { echo "FAIL $1"; fails=$((fails + 1)); }
shot() { ffmpeg -loglevel error -y -f x11grab -video_size 1600x1000 -i "$display" -frames:v 1 "$out/shots/$1.png"; }
key() { xdotool key --clearmodifiers "$@"; }
session() { cat "$out/data/facet/session.json" 2>/dev/null; }

head -c 300000 /dev/urandom > "$out/web/sample.zip"
printf '<!doctype html><title>Glass test page</title><h1>Glass</h1><p>Facet renders this page about windows made of glass.</p><a href="/sample.zip" id=d>download</a>' > "$out/web/index.html"
python3 -I -m http.server 8931 --bind 127.0.0.1 --directory "$out/web" >/dev/null 2>&1 & web=$!
for _ in $(seq 1 50); do [ -e "/tmp/.X11-unix/X${display#:}" ] || break; sleep .2; done
Xvfb "$display" -screen 0 1600x1000x24 >/dev/null 2>&1 & xv=$!
trap 'kill $app $web $xv 2>/dev/null' EXIT
sleep 1; export DISPLAY=$display
echo "XDG_DOWNLOAD_DIR=\"$out/downloads\"" > "$out/config/user-dirs.dirs"
env -u WAYLAND_DISPLAY GDK_BACKEND=x11 GDK_SCALE=1 XDG_CONFIG_HOME="$out/config" XDG_DATA_HOME="$out/data" XDG_CACHE_HOME="$out/cache" \
  FACET_RULES="$root/app/target/content-rules.json" "$root/app/target/release/facet" >"$out/app.log" 2>&1 & app=$!
win=""
for _ in $(seq 1 100); do win=$(xdotool search --onlyvisible --name Facet 2>/dev/null | tail -1); [ -n "$win" ] && break; sleep .2; done
sleep 8
xdotool windowsize "$win" 1600 1000 windowmove "$win" 0 0 windowfocus "$win"; sleep 1.5
shot onboarding
key Return; sleep 1.5
session | grep -q '"onboarded": true' && ok "onboarding completes" || bad "onboarding completes"
shot start

key ctrl+t; sleep 1; xdotool type --delay 25 "127.0.0.1:8931/"; sleep .6; shot palette; key Return; sleep 3
session | grep -q '127.0.0.1:8931' && ok "palette opens a typed address" || bad "palette opens a typed address"
shot page
key ctrl+d; sleep 1.5; session | grep -A2 '"favorites"' | grep -q 8931 && ok "Ctrl+D adds a favorite" || bad "Ctrl+D adds a favorite"
key ctrl+f; sleep .6; xdotool type --delay 25 "glass"; sleep 1; shot find; key Escape; sleep .5
key ctrl+comma; sleep 1.5; shot settings; key Escape; sleep 1
key ctrl+j; sleep 1; xdotool type --delay 20 "In five words, what is this page about?"; key Return
sleep 25; shot ai
key ctrl+j; sleep .8
xdotool mousemove 900 300 click 3; sleep 1; shot context; key Escape; sleep .5
key ctrl+l; sleep .5; xdotool type --delay 15 "127.0.0.1:8931/sample.zip"; key Return; sleep 3
[ -s "$out/downloads/sample.zip" ] && cmp -s "$out/web/sample.zip" "$out/downloads/sample.zip" && ok "download saved intact" || bad "download saved intact"
key ctrl+shift+n; sleep 2.5; shot space2
session | grep -c '"name": "Space' | grep -q 2 && ok "second Space created" || bad "second Space created"
kill -0 "$app" 2>/dev/null && ok "app survived the run" || bad "app survived the run"
grep -E 'panicked|Gtk-CRITICAL.*(assert|failed)|already (mutably )?borrowed' "$out/app.log" | grep -v 'accessibility bus' | head -5 | grep . && bad "no runtime errors" || ok "no runtime errors"
echo "shots: $out/shots"; exit "$fails"
