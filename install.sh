#!/bin/bash
# One-time setup on a new computer (Linux, or Ubuntu inside WSL). Safe to run again.
#   bash install.sh                 install what is missing, then check everything
#   bash install.sh --with-preview  also install Ruby so the Preview button works
#   bash install.sh --no-shortcut   skip the desktop icon
set -u
cd "$(dirname "$0")" || exit 1
PREVIEW=0; SHORTCUT=1
for a in "$@"; do case "$a" in --with-preview) PREVIEW=1;; --no-shortcut) SHORTCUT=0;; esac; done
say() { printf '\n  ♠ %s\n' "$*"; }
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"

say "Checking the basics"
need=()
for c in git curl; do command -v "$c" >/dev/null 2>&1 || need+=("$c"); done
[ -f /etc/ssl/certs/ca-certificates.crt ] || need+=(ca-certificates)
if [ ${#need[@]} -gt 0 ]; then
  if command -v apt-get >/dev/null 2>&1; then
    echo "  Installing: ${need[*]} (you may be asked for your Linux password)"
    $SUDO apt-get update -y && $SUDO apt-get install -y "${need[@]}" || { echo "  Could not install ${need[*]}."; exit 1; }
  else echo "  Please install: ${need[*]}, then run this again."; exit 1; fi
fi

# Node: load nvm if it is there, install it if Node is missing or too old
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
node_ok() { command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ]; }
if ! node_ok; then
  say "Installing Node.js (through nvm, in your home folder)"
  curl -fsSo- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash || { echo "  Could not download nvm. Check your internet connection."; exit 1; }
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
  nvm install --lts || { echo "  Node install failed."; exit 1; }
fi
node_ok || { echo "  Node 18 or newer is still missing."; exit 1; }

if [ "$PREVIEW" = 1 ]; then
  say "Installing Ruby for the Preview button"
  $SUDO apt-get install -y ruby-full build-essential zlib1g-dev && $SUDO gem install bundler || echo "  Ruby install failed; the Studio still works without Preview."
fi

say "Installing the Studio and fetching the website"
node scripts/doctor.js --fix
status=$?

if [ $status -eq 0 ] && [ "$SHORTCUT" = 1 ] && { [ -n "${WSL_DISTRO_NAME:-}" ] || [ "$(uname)" = Darwin ]; }; then
  say "Making the desktop icon"
  npm run shortcut --silent || echo "  Could not make the icon. You can still run: npm run launch"
fi
[ $status -eq 0 ] && say "Done. Double-click the icon, or run: npm run launch"
exit $status
