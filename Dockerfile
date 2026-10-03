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

# Background-removal model for product cutouts (IS-Net general use, from rembg's releases),
# downloaded at build time and verified against its pinned SHA-256.
ENV CUTOUT_MODEL=/opt/models/isnet-general-use.onnx
RUN mkdir -p /opt/models && /opt/venv/bin/python -c "import hashlib,sys,urllib.request; \
u='https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx'; \
d=urllib.request.urlopen(u, timeout=300).read(); h=hashlib.sha256(d).hexdigest(); \
sys.exit('model hash mismatch: '+h) if h!='60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a' else open('/opt/models/isnet-general-use.onnx','wb').write(d)"

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Chromium renders the brand layer of composed templates (composer/). Use the build Playwright pins
# for its own version (Debian's packaged chromium doesn't launch reliably under Playwright), plus
# its system libraries. Fonts are bundled with the app, so no system fonts are needed.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
RUN npx --no-install playwright-core install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* \
 && chmod -R a+rX /opt/pw-browsers

COPY core ./core
COPY composer ./composer
COPY server ./server
COPY finishing ./finishing
COPY web ./web
COPY assets ./assets
COPY reference ./reference

# Runs, finished files and the Higgsfield sign-in live here: mount a persistent volume at /data.
ENV DATA_DIR=/data PORT=8080 NODE_ENV=production
RUN mkdir -p /data && chown node:node /data
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# The entrypoint starts as root only to fix the volume's ownership, then drops to "node".
ENTRYPOINT ["docker-entrypoint.sh"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
