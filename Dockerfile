# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d
ARG SBT_IMAGE=sbtscala/scala-sbt:eclipse-temurin-17.0.20_8_1.13.0_2.13.18@sha256:d4792233706cda29a9c39569d915fc782c49268f25b9c72ac5b29f3002eb6959
ARG RUNTIME_IMAGE=cgr.dev/chainguard/wolfi-base@sha256:9cfb1be07b73a25a2a310d384cab6a9b6b74b6532f4892be9dccdc104eaf2628

FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS frontend
WORKDIR /workspace

COPY package.json package-lock.json angular.json tsconfig.json tsconfig.app.json tsconfig.spec.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY src ./src
RUN npm run typecheck && npm test && npm run build

FROM --platform=$BUILDPLATFORM ${SBT_IMAGE} AS backend
USER root
WORKDIR /workspace

COPY . .
COPY --from=frontend /workspace/public/js ./public/js

RUN --mount=type=cache,target=/root/.cache/coursier \
    --mount=type=cache,target=/root/.ivy2 \
    --mount=type=cache,target=/root/.sbt \
    sbt -batch test stage

FROM ${RUNTIME_IMAGE} AS runtime

ARG APP_VERSION=0.9.4-secure
# The pinned base image fixes the starting point, and its /etc/apk/world
# pins every package to the version it shipped with. Drop those pins and
# upgrade from Chainguard's repository and Wolfi's own, so the image gets
# the OS security fixes released since (glibc, zlib, ...).
RUN sed -i 's/[<>=~].*//' /etc/apk/world \
    && echo "https://packages.wolfi.dev/os" >> /etc/apk/repositories \
    && if [ ! -f /etc/apk/keys/wolfi-signing.rsa.pub ]; then \
         wget -q -O /etc/apk/keys/wolfi-signing.rsa.pub https://packages.wolfi.dev/os/wolfi-signing.rsa.pub; \
       fi \
    && apk upgrade --no-cache \
    && apk add --no-cache openjdk-17-default-jvm=17.0.20.1-r0 \
    && mkdir -p /opt/cerebro/logs /var/lib/cerebro /tmp/sqlite \
    && chown -R 65532:65532 /opt/cerebro /var/lib/cerebro /tmp/sqlite \
    && chmod 700 /tmp/sqlite

WORKDIR /opt/cerebro
COPY --from=backend --chown=65532:65532 /workspace/target/universal/stage/conf ./conf
COPY --from=backend --chown=65532:65532 /workspace/target/universal/stage/lib ./lib

LABEL org.opencontainers.image.title="Cerebro" \
      org.opencontainers.image.description="CVE-gated Elasticsearch administration console" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.licenses="MIT"

ENV JAVA_HOME=/usr/lib/jvm/default-jvm \
    PATH=/usr/lib/jvm/default-jvm/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    HOME=/tmp \
    CEREBRO_PORT=9000

VOLUME ["/var/lib/cerebro"]
EXPOSE 9000
STOPSIGNAL SIGTERM
USER 65532:65532

ENTRYPOINT ["/usr/lib/jvm/default-jvm/bin/java", "-XX:MaxRAMPercentage=75.0", "-XX:+ExitOnOutOfMemoryError", "-Dfile.encoding=UTF-8", "-Duser.timezone=UTC", "-Duser.dir=/opt/cerebro", "-Dapplication.home=/opt/cerebro", "-Ddata.path=/var/lib/cerebro/cerebro.db", "-Dorg.sqlite.tmpdir=/tmp/sqlite", "-Dpidfile.path=/dev/null", "-jar", "/opt/cerebro/lib/cerebro.cerebro-0.9.4-launcher.jar"]
