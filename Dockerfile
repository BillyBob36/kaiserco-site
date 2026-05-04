# Static site server for KAISER CO
# Coolify builds this and serves public/ via nginx.
FROM nginx:1.27-alpine

# Custom nginx config — caching + gzip + SPA fallback (single-page).
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the static site.
COPY public/ /usr/share/nginx/html/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q --spider http://127.0.0.1/ || exit 1
