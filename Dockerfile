# HitLights Ad Builder: one container, Node server + Python finishing.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Finishing libraries (numpy + Pillow), pinned in requirements.txt, in a venv.
COPY requirements.txt ./
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt
ENV PYTHON=/opt/venv/bin/python

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY core ./core
COPY server ./server
COPY finishing ./finishing
COPY web ./web
COPY assets ./assets
COPY reference ./reference

# Runs, finished files and the Higgsfield sign-in live here: mount a persistent volume.
ENV DATA_DIR=/data PORT=8080 NODE_ENV=production
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
