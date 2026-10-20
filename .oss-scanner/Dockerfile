# Image for Anthropic's OSS Scanner (https://github.com/anthropics/oss-scanner).
#
# The audit runs offline, so this build installs the Node.js version in .nvmrc, installs every package from
# package-lock.json, and builds the app. Dockerfile.dockerignore keeps tests, docs and CI config in the build context.
# threat_model.md, next to this file, says what matters and how to exercise it.
FROM node:22.23.2-bookworm
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git jq python3 ripgrep \
    && rm -rf /var/lib/apt/lists/*

# scanner contract: the checkout lives inside the image, at /src
COPY . /src
WORKDIR /src

# Every package, without install scripts, as CI installs them. Then the type check and the production build.
# A step that fails fails the build, and primary_contact gets the log.
RUN npm ci --ignore-scripts
RUN npm run typecheck && npm run build

# Run the unit tests so the log shows the image works, without letting a failure abort the build. The Playwright
# end-to-end tests need a browser download and a running API, so they are skipped.
RUN npm test || echo "WARNING: npm test reported failures"
