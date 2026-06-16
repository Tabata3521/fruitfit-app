#!/usr/bin/env bash
set -euo pipefail

nginx_conf="/etc/nginx/sites-available/fruitfit-domains"
downloads_dir="/var/www/fruitfit-downloads"
temporary_downloads="/var/www/fruitfit-client/current/downloads"
backup="${nginx_conf}.bak.$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$downloads_dir"
chown fruitfit:fruitfit "$downloads_dir"
chmod 0755 "$downloads_dir"

if [ -d "$temporary_downloads" ]; then
  cp -n "$temporary_downloads"/*.apk "$downloads_dir"/ 2>/dev/null || true
  chown fruitfit:fruitfit "$downloads_dir"/*.apk 2>/dev/null || true
fi

cp "$nginx_conf" "$backup"

python3 - <<'PY'
from pathlib import Path

path = Path("/etc/nginx/sites-available/fruitfit-domains")
text = path.read_text()
location = """    location ^~ /downloads/ {
        alias /var/www/fruitfit-downloads/;
        default_type application/octet-stream;
        types { application/vnd.android.package-archive apk; }
        add_header X-Content-Type-Options nosniff always;
        add_header Cache-Control "public, max-age=300";
        try_files $uri =404;
    }

"""

if "alias /var/www/fruitfit-downloads/" in text:
    raise SystemExit(0)

needle = "server_name client.tagirfruit.ru;"
server_index = text.index(needle)
insert_before = text.index("    location ^~ /api/ {", server_index)
text = text[:insert_before] + location + text[insert_before:]
path.write_text(text)
PY

nginx -t
systemctl reload nginx

echo "Downloads folder: $downloads_dir"
echo "Nginx backup: $backup"
