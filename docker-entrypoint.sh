#!/bin/sh
# Railway mounts volumes owned by root. Fix ownership of DATA_DIR once, then drop to the
# unprivileged "node" user (setpriv is in util-linux, part of Debian's essential set) and exec the
# app so it receives SIGTERM directly. If dropping privileges is impossible, say so loudly.
set -e
DATA="${DATA_DIR:-/data}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA"
  find "$DATA" ! -user node -exec chown node:node {} + 2>/dev/null || true
  if command -v setpriv >/dev/null 2>&1; then
    exec setpriv --reuid=node --regid=node --init-groups -- "$@"
  fi
  echo '{"level":"warn","event":"running_as_root","reason":"setpriv not available"}'
fi
exec "$@"
