#!/bin/sh
# Installs Facet for the current user: launcher, desktop entry, and local speech and translation runtime.
set -eu
root=$(dirname "$(readlink -f "$0")")
data="${XDG_DATA_HOME:-$HOME/.local/share}/facet-omarchy"
mkdir -p "$data/profile/NativeMessagingHosts" "$HOME/.local/bin"
uv venv --quiet --allow-existing --python 3.12 "$data/venv"
# CPU torch first, or Argos pulls in several GB of CUDA libraries the host never uses.
uv pip install --quiet --python "$data/venv/bin/python" --index-url https://download.pytorch.org/whl/cpu torch
uv pip install --quiet --python "$data/venv/bin/python" -r "$root/native/requirements.txt"
cat > "$data/facet-host" <<EOF
#!/bin/sh
exec "$data/venv/bin/python" -I "$root/native/facet_host.py"
EOF
chmod +x "$data/facet-host"
cat > "$data/profile/NativeMessagingHosts/app.facet_omarchy.host.json" <<EOF
{"name":"app.facet_omarchy.host","description":"Facet local speech and translation","path":"$data/facet-host","type":"stdio","allowed_origins":["chrome-extension://$(cat "$root/native/extension-id")/"]}
EOF
ln -sf "$root/bin/facet" "$HOME/.local/bin/facet"
install -Dm644 "$root/assets/facet.png" "$HOME/.local/share/icons/hicolor/256x256/apps/facet-omarchy.png"
install -d "$HOME/.local/share/applications"
cat > "$HOME/.local/share/applications/facet-omarchy.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Facet
Comment=Facet browser
Exec=$root/bin/facet %U
Icon=facet-omarchy
Terminal=false
Categories=Network;WebBrowser;
MimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;x-scheme-handler/facet;
StartupWMClass=facet-omarchy
EOF
echo "Installed. Run: facet"
