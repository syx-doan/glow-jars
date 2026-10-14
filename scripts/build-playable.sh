#!/bin/sh
# Packages playable/ into the Google Ads HTML5 ZIP (index.html + icon.png at the ZIP root).
set -e
cd "$(dirname "$0")/.."
sips -Z 144 play/icon-512.png --out playable/icon.png >/dev/null
rm -f play/glowjars-playable.zip
(cd playable && zip -X -q ../play/glowjars-playable.zip index.html icon.png)
ls -la play/glowjars-playable.zip
unzip -l play/glowjars-playable.zip
