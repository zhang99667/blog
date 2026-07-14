# Nginx 1.28 does not merge parent add_header directives into a location
# that declares its own headers, so cache locations include this file too.
# Proxy responses are normalized here so upstream apps cannot duplicate them.
# The Nginx map preserves an upstream Referrer-Policy when it is stricter.
proxy_hide_header Strict-Transport-Security;
proxy_hide_header X-Content-Type-Options;
proxy_hide_header X-Frame-Options;
proxy_hide_header Referrer-Policy;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy $markz_referrer_policy always;
