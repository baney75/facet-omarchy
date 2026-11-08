#!/bin/sh
# Installs Facet for the current user: launcher, desktop entry, and local speech and translation runtime.
set -eu
root=$(dirname "$(readlink -f "$0")")
data="${XDG_DATA_HOME:-$HOME/.local/share}/facet-omarchy"
uv venv --quiet --allow-existing --python 3.12 "$data/venv"
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
echo "Installed. Run: facet"
