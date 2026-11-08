#!/usr/bin/env bash
# Builds the native GTK app and makes it the Facet launcher for the current user.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cargo build --release --manifest-path "$root/app/Cargo.toml"
install -Dm755 "$root/app/target/release/facet" "$HOME/.local/bin/facet"
install -Dm644 "$root/assets/facet.png" "$HOME/.local/share/icons/hicolor/256x256/apps/app.panes.browser.png"
rm -f "$HOME/.local/share/applications/facet-omarchy.desktop"
cat > "$HOME/.local/share/applications/app.panes.browser.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Facet
Comment=Facet browser
Exec=$HOME/.local/bin/facet %U
Icon=app.panes.browser
Terminal=false
Categories=Network;WebBrowser;
MimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;
StartupWMClass=app.panes.browser
EOF
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
