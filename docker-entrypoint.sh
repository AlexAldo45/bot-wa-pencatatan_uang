#!/bin/sh
# docker-entrypoint.sh
# Removes stale Chromium SingletonLock files before starting the app.
# This prevents "profile is in use by another Chromium process" errors
# that occur when a Docker container restarts without a clean Chromium shutdown.

echo "[entrypoint] Cleaning up stale Chromium lock files..."
find /usr/src/app/.wwebjs_auth -name "SingletonLock" -delete 2>/dev/null && echo "[entrypoint] Removed SingletonLock files" || echo "[entrypoint] No SingletonLock files found"
find /usr/src/app/.wwebjs_auth -name "SingletonSocket" -delete 2>/dev/null
find /usr/src/app/.wwebjs_auth -name "SingletonCookie" -delete 2>/dev/null
find /usr/src/app/.wwebjs_cache -name "SingletonLock" -delete 2>/dev/null

echo "[entrypoint] Starting application..."
exec "$@"
