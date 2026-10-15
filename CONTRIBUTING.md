# Contributing to cerebro

Thank you for your interest in cerebro. This guide explains how to report
problems, propose changes, set up a development environment and get a pull
request merged.

This repository, [srdrcn/cerebro](https://github.com/srdrcn/cerebro), is a fork
of [lmenezes/cerebro](https://github.com/lmenezes/cerebro) with a rewritten web
interface and many new features. It has its own issues, releases and Docker
image, so report problems with this version here, not in the original project.

Everyone who takes part is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- Report bugs and behavior that confuses you.
- Propose features and improvements.
- Fix open issues or implement accepted features.
- Improve the documentation: the [README](README.md),
  [docs/FRONTEND.md](docs/FRONTEND.md) and the [examples](examples).
- Try cerebro with the Elasticsearch versions and setups you use (security
  enabled, many nodes, data streams, snapshots) and report what does not work.
- Review open pull requests.

Do not report security vulnerabilities in public issues. Follow
[SECURITY.md](SECURITY.md) instead.

## Reporting bugs

Search the [existing issues](https://github.com/srdrcn/cerebro/issues) first.
If one already describes your problem, add your details there.

Otherwise, [open a new issue](https://github.com/srdrcn/cerebro/issues/new/choose)
and choose the bug report form. A useful report includes:

- The cerebro version (shown at the bottom of the connect screen) and how you
  run it: Docker image and tag, release package, or built from source.
- The Elasticsearch version, and whether security is enabled.
- For problems in the web interface: the browser, the operating system, and
  whether it happens in the light theme, the dark theme or at phone width.
- Steps to reproduce, what you expected and what happened instead.
- Error messages: the details of the error notification, the browser console,
  and the server log. The server logs to its console (`docker logs` for a
  container) and to `logs/application.log` in the application directory.
- A screenshot if the problem is visual.

Remove passwords, tokens, internal host names and any data you do not want to
publish before you post.

## Proposing features

For anything larger than a small fix,
[open an issue](https://github.com/srdrcn/cerebro/issues/new/choose) with the
feature request form before you write code. Describe the problem you want to
solve, who it helps and how you would solve it. This lets us agree on the
approach before you spend time on it.

Small changes, such as typo fixes or an obvious bug with a clear fix, can go
straight to a pull request.

## Development setup

### Requirements

- Node.js `^22.22.3`, `^24.15.0` or `>=26.0.0`, with npm 10 or newer (the
  `engines` field of [package.json](package.json)). CI uses Node.js 24.15.0.
- A JDK, version 17 or newer. CI uses Eclipse Temurin 17.
- [sbt](https://www.scala-sbt.org/). The launcher downloads the sbt version set
  in [project/build.properties](project/build.properties) and the libraries
  pinned in [build.sbt](build.sbt).
- Docker (optional), to run a local Elasticsearch and to build the image.

### Run cerebro from source

Clone your fork and install the frontend dependencies:

```sh
git clone https://github.com/<your-user>/cerebro.git
cd cerebro
npm ci
```

Start the frontend build in watch mode. It writes the bundle to `public/js` and
rebuilds it when a file in `src/` changes:

```sh
npm start
```

In a second terminal, start the Play server in development mode:

```sh
sbt run
```

Open <http://localhost:9000>. Play compiles the backend on the first request
and again after you change a file in `app/` or `conf/` and reload the page.
After the frontend has rebuilt, reload the browser to see your change.

`public/js` is build output and is ignored by git. A fresh clone does not have
it, so let `npm start` (or `npm run build`) finish once before you open
cerebro, and never commit the folder.

Development mode needs no `CEREBRO_SECRET`: Play uses its development secret,
which it refuses in production.

### A local Elasticsearch

The quickest way to get a cluster to work against is a single node in Docker:

```sh
docker run --rm --name cerebro-es -p 9200:9200 \
  -e discovery.type=single-node \
  -e xpack.security.enabled=false \
  -e ES_JAVA_OPTS="-Xms1g -Xmx1g" \
  elasticsearch:8.15.3
```

Then enter `http://localhost:9200` on the connect screen. Use the Elasticsearch
version you want to test against.

This node has security turned off, so only run it on your own machine. To test
signing in to a secured cluster, start it with
`-e xpack.security.enabled=true -e xpack.security.http.ssl.enabled=false -e ELASTIC_PASSWORD=<password>`
instead and sign in as `elastic`.

Some features need a cluster with several nodes, for example shard
relocation. On a single node, replicas stay unassigned.

### Package and image

To build what a release ships:

```sh
npm run build   # production bundle in public/js
sbt stage       # runnable server in target/universal/stage
CEREBRO_SECRET="$(openssl rand -base64 48)" target/universal/stage/bin/cerebro
```

The [Dockerfile](Dockerfile) builds the frontend and the backend and runs their
tests on the way:

```sh
docker build -t cerebro:dev .
docker run --rm -p 9000:9000 -e CEREBRO_SECRET="$(openssl rand -base64 48)" cerebro:dev
```

## Project layout

| Path | Contents |
| --- | --- |
| `app/` | Play backend in Scala: `controllers/` (one per page or API area; `auth/` holds basic and LDAP sign-in), `elastic/` (the HTTP client for Elasticsearch), `models/`, `services/`, `dao/` (the REST console history in SQLite) and `views/` (the page shell and the sign-in page). |
| `conf/` | `routes`, [application.conf](conf/application.conf) (settings and their environment variables), [reference.conf](conf/reference.conf) (defaults), `logback.xml` and `evolutions/` (the SQLite schema). |
| `src/` | The Angular application: `main.ts`, `styles/` (the design system CSS) and `app/`. |
| `src/app/core/` | Services and pure helpers, without UI. |
| `src/app/shared/` | Reusable UI: components, directives, pipes and the application shell. |
| `src/app/features/<name>/` | One folder per page. |
| `public/` | Static files served by Play. `public/js` is the generated bundle. |
| `test/` | Backend tests (specs2), in the same packages as the code in `app/`. |
| [docs/FRONTEND.md](docs/FRONTEND.md) | Frontend architecture, design system and rules for new pages. |
| [examples/](examples) | Docker Compose setups for basic auth and LDAP. |
| `project/` | The sbt version and sbt plugins. |
| [Dockerfile](Dockerfile), [.github/workflows/scala.yml](.github/workflows/scala.yml) | The container image and CI. |

## Before you open a pull request

Run the same checks as CI:

```sh
npm run typecheck   # strict TypeScript and template checks
npm test            # frontend unit tests (Vitest)
npm run build       # production build into public/js
npm run audit       # npm advisories, fails on high and critical
sbt test            # backend tests (specs2)
```

Use `npm run test:watch` to rerun the frontend tests while you work.

`npm run audit` checks the whole dependency tree against the current advisory
database, so it can fail because of an advisory published after your branch
was created. If that happens and your change does not touch dependencies, say
so in the pull request.

CI also rejects AngularJS or Bootstrap 3 code in the bundle, and builds the
linux/amd64 and linux/arm64 images and scans each with Trivy, including the
Java libraries of the server. You do not need to repeat those locally unless
you change dependencies or the Dockerfile (see
[Updating dependencies](#updating-dependencies)).

## Coding conventions

- Frontend code follows [docs/FRONTEND.md](docs/FRONTEND.md): standalone
  components with signals, design tokens instead of fixed colors, no Bootstrap
  classes, sentence case, the four page states (loading, empty, error and
  data) and its accessibility rules. A feature never imports another feature; shared
  code moves to `core/` or `shared/`.
- Tests live next to the code. A frontend file `name.ts` gets its Vitest spec
  in `name.spec.ts` in the same folder; keep pure logic in
  `<feature>.utils.ts` or `<feature>.models.ts` so it is easy to test. Backend
  specs go under `test/`, in the package of the code they test.
- For changes to the web interface, check the light and the dark theme and a
  phone-width window, and add screenshots to the pull request.
- The repository has no automatic formatter. Match the style of the code
  around your change.

## Commits and pull requests

1. Fork the repository and create a branch from `main`.
2. Keep a pull request to one topic. Unrelated fixes go in their own pull
   request.
3. Make focused commits with clear messages: a short summary line in the
   imperative mood ("Fix the shard menu on phones"), and a body that explains
   why when it is not obvious. Squash fixup commits such as "fix typo" before
   the pull request is merged.
4. Rebase your branch on the latest `main` before you open the pull request,
   and again when it has conflicts. Do not merge `main` into your branch.
5. Add or update tests for your change.
6. Add a line to the unreleased section at the end of
   [CHANGES.md](CHANGES.md) (the one headed `### vX.Y.Z - Unreleased`), under
   the matching `####` heading, for example "New features" or "Bug fixes". Do
   not add or change headings.
7. Update the documentation when behavior or configuration changes.
8. In the description, explain what the change does and why, link the issue
   ("Fixes #123"), and say how you tested it.

The `build-and-security` workflow runs on every pull request to `main`. It must
pass before a pull request is merged.

## Updating dependencies

Dependabot proposes weekly version updates for npm packages, GitHub Actions,
the Dockerfile's base images and the sbt build (`build.sbt`,
`project/plugins.sbt`, `project/build.properties`). Review its pull requests
like any other: the same checks and security gates apply. For sbt it raises no
security alerts, so backend advisories come from the Trivy scans in CI.

When you update these by hand, keep them consistent:

- [build.sbt](build.sbt) sets the backend library versions: Play
  (`playVersion`), play-json, Play Slick (`playSlickVersion`), the SQLite
  driver and specs2. Play's `filters`, `ws` and `guice` modules follow the
  version of the Play sbt plugin. The `dependencyOverrides` keep Jackson
  (`jacksonVersion`), Logback (`logbackVersion`) and lz4-java on patched
  versions that are newer than the ones Play brings in transitively. Keep
  every Jackson module on the same version.
- [project/plugins.sbt](project/plugins.sbt) holds the sbt plugins. Keep the
  Play sbt plugin on the same version as Play.
- [project/build.properties](project/build.properties) sets the sbt version.
- The three base images of the [Dockerfile](Dockerfile) are pinned by digest
  on their `FROM` lines. To update one by hand, replace the whole reference,
  digest included; `docker buildx imagetools inspect <image>:<tag>` prints the
  current digest of a tag. The `sbtscala/scala-sbt` tag names the JDK, sbt and
  Scala versions the backend is built with. Keep sbt and Scala in line with
  `project/build.properties` and `build.sbt`.
- Other versions are pinned in places Dependabot does not read: the JDK
  package of the runtime image (`openjdk-17-default-jvm` in the Dockerfile),
  the Trivy image used by CI (`aquasec/trivy` in the workflow) and the Node.js
  version CI sets up.

Every update must keep the security gates green:

- `npm run audit` uses [audit-ci](audit-ci.jsonc) and fails on any advisory of
  high or critical severity in the complete npm tree, development dependencies
  included. The allowlist is empty. An exception must name the exact advisory
  (GHSA) and path, with notes and an expiry date.
- Trivy fails the build on any vulnerability in either image, in the
  operating system packages or in the Java libraries of the server
  (`/opt/cerebro/lib`), at every severity and including those without a fix.
  An operating system that has reached its end of life also fails the build.
  The scans use no ignore file, so the only fix is an upgrade or an override.

To scan an image locally the way CI does (the exact commands are in
[.github/workflows/scala.yml](.github/workflows/scala.yml)):

```sh
docker buildx build --platform linux/amd64 --provenance=false --sbom=false \
  --output type=docker,dest=/tmp/cerebro-amd64.tar .
docker run --rm -v /tmp/cerebro-amd64.tar:/scan/image.tar:ro aquasec/trivy:0.74.0 image \
  --input /scan/image.tar --scanners vuln --pkg-types os,library \
  --detection-priority comprehensive --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL \
  --ignore-unfixed=false --ignorefile /dev/null --exit-on-eol 1 --exit-code 1
```

Writing the image to a file needs a builder that supports tarball output. The
default `docker` builder does so only when Docker uses the containerd image
store. Otherwise, create a `docker-container` builder first with
`docker buildx create --use`.

## Releasing

This section is for maintainers.

### One-time setup

Add two repository secrets under Settings, Secrets and variables, Actions:

- `DOCKERHUB_USERNAME`: the Docker Hub user that pushes the image.
- `DOCKERHUB_TOKEN`: a Docker Hub access token with Read & Write permission.

The publish job checks for both before it builds anything, and fails on every
push to `main` and every version tag while they are missing.

When the repository is public, turn on **Private vulnerability reporting** in
the security settings of the repository. [SECURITY.md](SECURITY.md) tells
reporters to use it, and it does not work until a maintainer turns it on.
GitHub offers it only for public repositories.

### What CI publishes

The `publish` job runs only on pushes to srdrcn/cerebro, and only after the
`verify` job has passed. It builds the linux/amd64 and linux/arm64 image with
SBOM and provenance attestations and pushes it to Docker Hub as
[chosenwar/cerebro](https://hub.docker.com/r/chosenwar/cerebro):

| Event | Image tags |
| --- | --- |
| Push to `main` | `latest` and `sha-<short commit>` |
| Tag `vX.Y.Z` | `X.Y.Z` and `X.Y` |

`latest` follows `main`, not the latest release.

For a version tag, the `release` job then builds `cerebro-X.Y.Z.zip` and
`cerebro-X.Y.Z.tgz` and creates the GitHub release "cerebro X.Y.Z" with them.
The release notes are the section of [CHANGES.md](CHANGES.md) whose heading
starts with `### vX.Y.Z`, up to the next `### ` heading. The job fails if
CHANGES.md has no such heading. It does not check that the section has any
text, so make sure it does before you tag.

### Steps

1. On a branch, set the new version in `build.sbt`:

   ```scala
   version := "X.Y.Z"
   ```

   and in `package.json` and `package-lock.json`:

   ```sh
   npm version X.Y.Z --no-git-tag-version
   ```

   If `build.sbt`, `package.json` and `package-lock.json` already have the
   version, as they do for v0.10.0, skip this step: `npm version` refuses a
   version that has not changed.

2. In `CHANGES.md`, check that the unreleased section heading names the
   version you release, and replace `Unreleased` with the release date:

   ```markdown
   ### vX.Y.Z - Month day, year
   ```

3. Open a pull request, wait for CI to pass and merge it into `main`.
4. Once these changes are on `main`, tag `main` and push the tag:

   ```sh
   git checkout main
   git pull
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

5. Follow the workflow run in the Actions tab. When it is done, check the new
   tags on Docker Hub and the release page.
6. Add a new `### vX.Y.Z - Unreleased` section, with the next version, at the
   end of `CHANGES.md` for the changes that follow.

The tag must equal the version in `build.sbt`: `v0.10.0` for
`version := "0.10.0"`. Otherwise the publish job stops before it pushes
anything. To fix a wrong tag, delete it (`git tag -d vX.Y.Z` and
`git push origin :refs/tags/vX.Y.Z`), correct the version on `main` and tag
again.
