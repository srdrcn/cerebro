# Security policy

## Supported versions

Security fixes go into `main` and into the next release. Older releases do not
get backported fixes.

| Version | Supported |
| --- | --- |
| The latest release (image tags `X.Y.Z` and `X.Y`) | Yes |
| `main` (image tags `latest` and `sha-<commit>`) | Yes |
| Older releases | No |
| Releases of the original project, [lmenezes/cerebro](https://github.com/lmenezes/cerebro) | No, they are not maintained here |

Until the first release (v0.10.0) is published, only `main` is supported.

## Reporting a vulnerability

Do not report security vulnerabilities in public issues, pull requests or
discussions.

Use GitHub's private vulnerability reporting instead: open the repository's
**Security** tab and choose **Report a vulnerability**, or go directly to
<https://github.com/srdrcn/cerebro/security/advisories/new>. Only you and the
maintainers can see the report.

## What to include

- The affected version: release, image tag or commit.
- How cerebro is deployed: Docker image, release package or built from source,
  the authentication type (none, `basic` or `ldap`), and the settings that
  matter, for example `CEREBRO_COOKIE_SECURE`, `CEREBRO_ALLOWED_HOST`,
  `basePath` or a reverse proxy in front.
- The Elasticsearch version, if it matters.
- What the problem is and what an attacker can do with it, including the access
  they need first (network access only, a signed-in user, access to the host).
- Steps to reproduce or a proof of concept, with the requests and responses.
- A suggested fix, if you have one.
- Whether you want to be credited, and under which name.

Use test data. Do not send real passwords, tokens or data from production
clusters.

## What to expect

- The maintainer acknowledges the report and may ask follow-up questions in the
  private advisory.
- The maintainer confirms the problem, or explains why it is not treated as a
  vulnerability.
- A confirmed problem is fixed in private, then released: the fix goes into
  `main` and a new release, and the advisory is published with credit to you
  unless you prefer otherwise. A CVE is requested through GitHub when it
  applies.
- Please keep the details confidential until the advisory is published.

This project is maintained on a best-effort basis, so there are no guaranteed
response times. You will be kept informed in the advisory.

## Scope

Reports about the code in this repository, the Docker image
[chosenwar/cerebro](https://hub.docker.com/r/chosenwar/cerebro) and the release
packages are in scope.

Some behavior is intended. cerebro is an administration tool: it connects to
whatever Elasticsearch address a user enters, and its REST console sends any
request with that user's credentials. Credentials configured for a host in
`hosts` are used for every cerebro user who connects to that host. Limit who
can reach cerebro: turn on authentication (`AUTH_TYPE`), serve it over HTTPS
with `CEREBRO_COOKIE_SECURE=true`, and keep it off public networks.

Report vulnerabilities in Elasticsearch to Elastic, and vulnerabilities in a
dependency to its project. If a dependency makes cerebro itself exploitable,
report it here as well.

## Supply-chain checks

The `build-and-security` workflow
([.github/workflows/scala.yml](.github/workflows/scala.yml)) runs on every push
and pull request to `main` and on every version tag. Any of these checks fails
the build:

- **npm advisories.** [audit-ci](audit-ci.jsonc) checks the complete npm
  dependency tree, development dependencies included, and fails on any
  advisory of high or critical severity. Its allowlist is empty.
- **Legacy frontend code.** The packaged web assets must not contain AngularJS
  or Bootstrap 3, which the old interface used.
- **Tests.** The frontend type check, the frontend tests and the backend tests
  must pass.
- **Container images.** The linux/amd64 and linux/arm64 images are built and
  each one is scanned with Trivy: the operating system packages and the Java
  libraries of the server (`/opt/cerebro/lib`), at every severity, including
  vulnerabilities without a fix and with no ignore file. Any finding fails
  the build, and so does an operating system that has reached its end of
  life.

Images are published only after these checks pass, only from pushes to this
repository, and with SBOM and provenance attestations.

The image itself:

- runs as the non-root user and group `65532`;
- uses a Wolfi base image pinned by digest, adds OpenJDK 17, and upgrades its
  operating system packages at build time to pick up security fixes;
- runs the frontend and backend tests while it is built.

Backend dependencies are pinned in [build.sbt](build.sbt), which overrides the
Jackson, Logback and lz4-java versions that Play brings in to keep them on
patched releases.
