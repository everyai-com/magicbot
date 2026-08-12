# MagicBot cloud computer image.
#
# Tier 1 (this file, ready now): a headless Linux computer per bot — shell,
# code execution, files, and HTTP service exposure. The base image already
# ships Python 3.11 + Node 20 + common tools.
# -python variant enables the code interpreter (runCode); base has Node too.
FROM docker.io/cloudflare/sandbox:0.7.0-python

# A couple of utilities agents reach for. (Browser/Chromium lives in Tier 2
# with the desktop stack — the base image is Debian-slim without a chromium
# package, and headless code tasks don't need it.)
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Tier 2 (visual desktop — the "watch it work / take over" experience).
# Uncomment to add an X11 desktop streamed over noVNC, then exposePort(6080)
# in the Worker and hand the preview URL to the UI as the "Open desktop" link.
# This is the one piece of genuinely custom infra; keep it off until needed.
# RUN apt-get update && apt-get install -y --no-install-recommends \
#       xvfb x11vnc fluxbox novnc websockify \
#     && rm -rf /var/lib/apt/lists/*
# ENV DISPLAY=:0

EXPOSE 8080
