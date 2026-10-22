# syntax=docker/dockerfile:1.7

# Base images are pinned by digest on their FROM lines, where Dependabot
# finds and updates them.
FROM --platform=$BUILDPLATFORM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d AS frontend
WORKDIR /workspace

COPY package.json package-lock.json angular.json tsconfig.json tsconfig.app.json tsconfig.spec.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY src ./src
RUN npm run typecheck && npm test && npm run build

FROM --platform=$BUILDPLATFORM sbtscala/scala-sbt:eclipse-temurin-17.0.20_8_1.13.0_2.13.18@sha256:d4792233706cda29a9c39569d915fc782c49268f25b9c72ac5b29f3002eb6959 AS backend
USER root
WORKDIR /workspace

COPY . .
COPY --from=frontend /workspace/public/js ./public/js

RUN --mount=type=cache,target=/root/.cache/coursier \
    --mount=type=cache,target=/root/.ivy2 \
    --mount=type=cache,target=/root/.sbt \
    sbt -batch test stage

# A fixed name, so the entry point does not change with the version.
RUN mv target/universal/stage/lib/cerebro.cerebro-*-launcher.jar target/universal/stage/lib/cerebro-launcher.jar

FROM cgr.dev/chainguard/wolfi-base@sha256:bc76fa39ddd1482dd56a761b3331e03ba8f0e093ebb525618a56d014b480da88 AS runtime

# Set by CI from build.sbt when it publishes the image.
ARG APP_VERSION=dev
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

# Vendor and authors replace the base image's Chainguard values.
LABEL org.opencontainers.image.title="Cerebro" \
      org.opencontainers.image.description="CVE-gated Elasticsearch administration console" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="cerebro" \
      org.opencontainers.image.authors="cerebro maintainers <https://github.com/srdrcn/cerebro>"

ENV JAVA_HOME=/usr/lib/jvm/default-jvm \
    PATH=/usr/lib/jvm/default-jvm/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    HOME=/tmp

VOLUME ["/var/lib/cerebro"]
EXPOSE 9000
STOPSIGNAL SIGTERM
USER 65532:65532

# JVM options from $JAVA_OPTS (split at spaces) and the arguments after the
# image name come after the image's defaults, so they can override them, for
# example -Ddata.path, -Dconfig.file, -Dhttp.port or -Dhosts.0.host. exec keeps
# java as PID 1, so docker stop's SIGTERM reaches it.
ENTRYPOINT ["/bin/sh", "-c", "exec /usr/lib/jvm/default-jvm/bin/java -XX:MaxRAMPercentage=75.0 -XX:+ExitOnOutOfMemoryError -Dfile.encoding=UTF-8 -Duser.timezone=UTC -Duser.dir=/opt/cerebro -Dapplication.home=/opt/cerebro -Ddata.path=/var/lib/cerebro/cerebro.db -Dorg.sqlite.tmpdir=/tmp/sqlite -Dpidfile.path=/dev/null $JAVA_OPTS \"$@\" -jar /opt/cerebro/lib/cerebro-launcher.jar", "cerebro"]
