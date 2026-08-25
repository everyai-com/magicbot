# Official Cloudflare Computer runtime. computerd projects the Durable Object's
# SQLite-backed Workspace into this full Linux container at /workspace.
FROM ghcr.io/cloudflare/computer-computerd-linux-x64:0.2.1 AS computerd

FROM debian:stable-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      fuse3 libfuse2t64 ca-certificates curl gnupg git python3 \
 && mkdir -p /etc/apt/keyrings \
 && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends nodejs \
 && npm install -g @openai/codex@0.149.1 \
 && npm cache clean --force \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g @openai/codex-linux-x64@npm:@openai/codex@0.149.1-linux-x64 \
 && ln -s ../../../codex-linux-x64 /usr/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64 \
 && codex --version \
 && npm cache clean --force

COPY --from=computerd /usr/local/bin/computerd /usr/local/bin/computerd

ENV PORT=8080
ENV MOUNT_POINT=/workspace
ENV FUSE_MOUNT=auto
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/computerd"]
