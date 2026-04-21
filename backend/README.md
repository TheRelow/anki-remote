JWT_SECRET='moj-super-sekret-2026-anki' npm run dev
JWT_SECRET='moj-super-sekret-2026-anki' npm run mint-token

# LAN access

Default host is 0.0.0.0, so backend is reachable from local network.

Optionally set explicit host/port:
HOST=0.0.0.0 PORT=8787 JWT_SECRET='...' npm run dev

# HTTPS (local network)

# 1) Create certs (example with mkcert):
# mkcert -install
# mkcert localhost 127.0.0.1 ::1 172.20.10.3
#
# 2) Run backend with TLS:
# HOST=0.0.0.0 PORT=8787 \
# SSL_CERT_PATH='./certs/localhost+3.pem' \
# SSL_KEY_PATH='./certs/localhost+3-key.pem' \
# CORS_ORIGINS='https://dixie-test.ru,http://localhost:5173' \
# JWT_SECRET='...' npm run dev
#
# Backend will start on https://<host>:8787

# Shortcut script (expects certs at ./certs/local.pem and ./certs/local-key.pem):
# JWT_SECRET='...' npm run dev:https