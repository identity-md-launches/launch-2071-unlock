FROM node:24-alpine
WORKDIR /app
COPY services/labs/server.mjs services/labs/store.mjs services/labs/security.mjs services/labs/upstream.mjs services/labs/audits.mjs services/labs/pdf.mjs services/labs/markets.mjs services/labs/indexer.mjs ./services/labs/
COPY web/vendor/runtime/c5e656ecf7fbe34e412c.mjs ./web/vendor/runtime/
RUN mkdir -p /data && chown node:node /data
ENV LABS_HOST=0.0.0.0 LABS_PORT=8787 LABS_DB_PATH=/data/labs.sqlite
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=60s --timeout=10s CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "services/labs/server.mjs"]
