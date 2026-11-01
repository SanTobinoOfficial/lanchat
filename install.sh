#!/bin/sh
# LanChat - instalator Linux/macOS. Bez sudo, bez zaleznosci poza curl.
#   curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/install.sh | sh
set -e
REPO="${LANCHAT_REPO:-OWNER/REPO}"
case "$(uname -s)" in Linux) os=linux;; Darwin) os=macos;; *) echo "Nieobslugiwany system: $(uname -s)"; exit 1;; esac
case "$(uname -m)" in x86_64|amd64) arch=x64;; arm64|aarch64) arch=arm64;; *) echo "Nieobslugiwana architektura: $(uname -m)"; exit 1;; esac
dir="$HOME/.local/bin"; mkdir -p "$dir"
base="${LANCHAT_BASE:-https://github.com/$REPO/releases/latest/download}"   # LANCHAT_BASE: wlasne lustro/test
url="${base%/}/lanchat-$os-$arch"
echo "Pobieram LanChat: $url"
if ! curl -fL --progress-bar "$url" -o "$dir/lanchat.tmp"; then rm -f "$dir/lanchat.tmp"; echo "Nie udalo sie pobrac - czy wydanie istnieje dla $os-$arch?"; exit 1; fi
chmod +x "$dir/lanchat.tmp"; mv -f "$dir/lanchat.tmp" "$dir/lanchat"
if [ "$os" = macos ]; then xattr -d com.apple.quarantine "$dir/lanchat" 2>/dev/null || true; fi
case ":$PATH:" in *":$dir:"*) ;; *) echo "Wskazowka: dodaj do PATH:  export PATH=\"$dir:\$PATH\"";; esac
if [ -n "$LANCHAT_NO_LAUNCH" ]; then echo "Gotowe! Zainstalowano w $dir/lanchat"; exit 0; fi
echo "Gotowe! Uruchamiam LanChat..."
exec "$dir/lanchat"
