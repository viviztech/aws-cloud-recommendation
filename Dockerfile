FROM nginxinc/nginx-unprivileged:stable-alpine

COPY --chown=101:101 index.html script.js styles.css viviz-logo.jpeg /usr/share/nginx/html/
COPY --chown=101:101 lib/ /usr/share/nginx/html/lib/
COPY --chown=101:101 data/ /usr/share/nginx/html/data/

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/index.html || exit 1
