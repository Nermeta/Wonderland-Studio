#!/bin/bash
# Used by the desktop shortcut. Finds Node even when it is set up in ~/.bashrc (nvm, etc.),
# and keeps the window open with the reason if anything goes wrong.
cd "$(dirname "$0")/.." || exit 1
for f in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.nvm/nvm.sh"; do [ -f "$f" ] && . "$f" >/dev/null 2>&1; done
pause() { echo; read -r -p "  Press Enter to close this window. " _; }
if ! command -v npm >/dev/null 2>&1; then
  echo "  Could not find npm. Open Ubuntu and run:  command -v npm"
  echo "  If that prints nothing, install Node there first (https://nodejs.org)."
  pause; exit 1
fi
npm run launch
code=$?
if [ $code -ne 0 ]; then echo; echo "  The Studio stopped with an error (code $code). See above."; pause; fi
exit $code
