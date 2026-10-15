Cerebro
------------
[![Docker Pulls](https://img.shields.io/docker/pulls/chosenwar/cerebro.svg)](https://hub.docker.com/r/chosenwar/cerebro)
[![build and security](https://github.com/srdrcn/cerebro/actions/workflows/scala.yml/badge.svg?branch=main)](https://github.com/srdrcn/cerebro/actions/workflows/scala.yml)

cerebro is an open source (MIT License) Elasticsearch administration tool built with Scala, Play Framework and Angular.

### Features

- Cluster overview with the shard allocation map: open, close, refresh, flush, force merge and delete indices, relocate shards and toggle shard allocation, plus live indexing, search, latency, heap and CPU charts.
- Cluster doctor: one click health check that finds disk watermark, shard, replica, read-only block, ILM, JVM, settings and upgrade deprecation problems, explains them and offers a fix (including Elasticsearch's own health report on 8.7+).
- Nodes view with roles, versions, heap, disk, CPU and load usage, and live per-node activity charts with thread pool queues and rejections.
- Performance: readable hot threads, live thread pools, the master's pending tasks and a slow log threshold editor with presets.
- REST console with JSON editor, request history, saved requests (with export and import) and "copy as cURL".
- Index details (settings, mappings, statistics, aliases, shards, lifecycle), index creation, aliases, cluster and index settings editors.
- Index operations wizard: shrink, split, clone, roll over and reindex with live preflight checks, a review of the exact requests and progress tracking.
- Composable index templates, component templates and legacy templates.
- Data streams, index lifecycle (ILM) policies and ingest pipelines with simulation.
- Shard allocation explain, live shard recoveries and a task manager with cancellation.
- Snapshot and repository management, text analysis and CAT API browser.
- Light and dark themes (following the operating system by default), a command palette (`Ctrl`/`⌘` + `K`) and layouts that work down to phone width.

### Requirements

cerebro needs Java 17 or newer to run. Building the web application from source also requires a Node.js version supported by Angular 22 (`^22.22.3`, `^24.15.0`, or `>=26`).

### Building from source

```sh
npm ci
npm run typecheck
npm test
npm run build
sbt test
sbt stage
```

The Angular build writes the browser bundle to `public/js`; Play packages that output with the backend distribution. The bundle is build output and is not kept in git, so run `npm run build` (or `npm start` while developing) before `sbt run` or `sbt stage`. The frontend architecture and design system are described in [docs/FRONTEND.md](docs/FRONTEND.md).

### Installation
- Download from [https://github.com/lmenezes/cerebro/releases](https://github.com/lmenezes/cerebro/releases)
- Extract files
- Run bin/cerebro(or bin/cerebro.bat if on Windows)
- Access on http://localhost:9000

### Chocolatey (Windows)

You can install `cerebro` using [Chocolatey](https://chocolatey.org/):

```sh
choco install cerebro-es
```

Package creates windows service ```cerebro```.
Access on http://localhost:9000

### Docker

The hardened multi-architecture image is published at [chosenwar/cerebro](https://hub.docker.com/r/chosenwar/cerebro/):

```sh
docker volume create cerebro-data
docker run --rm \
  -p 9000:9000 \
  -v cerebro-data:/var/lib/cerebro \
  -e CEREBRO_SECRET='replace-with-a-long-random-secret' \
  chosenwar/cerebro:0.9.4-secure
```

Both `linux/amd64` and `linux/arm64` are published. The final Wolfi/OpenJDK 17 image runs as UID/GID `65532`, includes SBOM/provenance attestations, and was scanned with Trivy 0.74.0 at all severities with zero known OS or Java-library findings on August 26, 2026.

To build the image yourself from this repository (the [Dockerfile](Dockerfile) builds the web application and the backend, and runs their tests):

```sh
docker build -t chosenwar/cerebro:0.9.4-secure .
```

The [examples folder](./examples) has Docker Compose files for basic auth and LDAP.

### Configuration

#### HTTP server address and port
You can run cerebro listening on a different host and port(defaults to 0.0.0.0:9000):

```
bin/cerebro -Dhttp.port=1234 -Dhttp.address=127.0.0.1
```

#### LDAP config

LDAP can be configured using environment variables. If you typically run cerebro using docker,
you can pass a file with all the env vars. The file would look like:

```bash
# Application secret, required by the Docker image
CEREBRO_SECRET=replace-with-a-long-random-secret

# Set it to ldap to activate ldap authorization
AUTH_TYPE=ldap

# Your ldap url
LDAP_URL=ldap://exammple.com:389

LDAP_BASE_DN=OU=users,DC=example,DC=com

# Usually method should  be "simple" otherwise, set it to the SASL mechanisms
LDAP_METHOD=simple

# user-template executes a string.format() operation where
# username is passed in first, followed by base-dn. Some examples
#  - %s => leave user untouched
#  - %s@domain.com => append "@domain.com" to username
#  - uid=%s,%s => usual case of OpenLDAP
LDAP_USER_TEMPLATE=%s@example.com

# User identifier that can perform searches
LDAP_BIND_DN=admin@example.com
LDAP_BIND_PWD=adminpass

# Group membership settings (optional)

# If left unset LDAP_BASE_DN will be used
# LDAP_GROUP_BASE_DN=OU=users,DC=example,DC=com

# Attribute that represent the user, for example uid or mail
# LDAP_USER_ATTR=mail

# If left unset LDAP_USER_TEMPLATE will be used
# LDAP_USER_ATTR_TEMPLATE=%s

# Filter that tests membership of the group. If this property is empty then there is no group membership check
# AD example => memberOf=CN=mygroup,ou=ouofthegroup,DC=domain,DC=com
# OpenLDAP example => CN=mygroup
# LDAP_GROUP=memberOf=memberOf=CN=mygroup,ou=ouofthegroup,DC=domain,DC=com

```

You can the pass this file as argument using:

```bash
docker run -p 9000:9000 --env-file env-ldap chosenwar/cerebro:0.9.4-secure
```

There are some examples of configuration in the [examples folder](./examples).

#### Other settings

Other settings are exposed through the **conf/application.conf** file found on the application directory.

Production deployments must provide a unique application secret through `CEREBRO_SECRET` or `-Dplay.http.secret.key`. When Cerebro is served through HTTPS, also set `CEREBRO_COOKIE_SECURE=true`. If the external hostname is not one of Play's local defaults, set `CEREBRO_ALLOWED_HOST` to that hostname.

It is also possible to use an alternate configuration file defined on a different location:

```
bin/cerebro -Dconfig.file=/some/other/dir/alternate.conf
```
