#!/bin/sh
# Production TLS deploy hook. The installed copy on the server lives at
# /etc/letsencrypt/renewal-hooks/deploy/markz-tls-deploy.sh; see
# deploy/certbot/README.md for the install command and the renewal wiring.
#
# certbot renews /etc/letsencrypt/live/markz.fun and then runs every
# executable file in /etc/letsencrypt/renewal-hooks/deploy/. markz-edge reads
# the certificate through a read-only bind mount, so an updated file alone is
# not enough: nginx keeps the previous certificate in memory until it is
# reloaded. Without this reload a successful renewal leaves the public sites
# serving an expired certificate.
set -eu

LIVE_DIR=/etc/letsencrypt/live/markz.fun
CERT_DIR=/www/server/panel/vhost/cert/39.97.237.248
DOCKER=$(command -v docker || echo /usr/bin/docker)

install -o root -g root -m 600 "$LIVE_DIR/fullchain.pem" "$CERT_DIR/fullchain.pem"
install -o root -g root -m 600 "$LIVE_DIR/privkey.pem" "$CERT_DIR/privkey.pem"

# markz-edge terminates public TLS on 80/443 and must pick up the new
# certificate. A failed configuration test or reload must stay loud: a silent
# failure here is exactly what turns a renewed certificate into an outage.
"$DOCKER" exec markz-edge nginx -t
"$DOCKER" exec markz-edge nginx -s reload

# The JSONUtils frontend mounts the same certificate directory for its own
# internal TLS listener and only reads it at startup.
if "$DOCKER" ps --format '{{.Names}}' | grep -qx jsonutil-app-frontend-1; then
  "$DOCKER" restart jsonutil-app-frontend-1 >/dev/null
else
  echo "markz TLS deploy: jsonutil-app-frontend-1 is not running; skipped restart" >&2
fi

echo "markz TLS deploy: certificate installed and markz-edge reloaded"
