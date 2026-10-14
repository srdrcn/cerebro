Cerebro Releases
------------

### v0.1.0 - July 14th, 2016

First cerebro release.

#### Features
- cluster overview
- rest client
- aliases management
- index creation

### v0.2.0 - August 25th, 2016

#### New features
- analysis api
- index template api
- cluster settings api
- notify regarding created/deleted indices and joining/leaving nodes

### v0.3.0 - November 3rd, 2016

#### Bug fixes
- rest client format body button
- only display cluster changes if cluster name hasnt changed

#### Enhancements
- load default cluster settings values

#### New features
- added index settings module

### v0.3.1 - November 17th, 2016

#### Bug fixes
- displayed node roles

### v0.4.0 - December 2nd, 2016

#### Bug fixes
- fix favicon for
- handle cpu / load info from both 2.X and 5.X

#### Enhancements
- pagination buttons unselectable
- display relocating / initializing shards on overview

#### New features
- copy to curl to rest client
- repositories / snapshots module

### v0.4.1 - December 6th, 2016

#### Bug fixes
- fix indices selection on snapshot creation

### v0.4.2 - January 4th, 2017

#### Bug fixes
- fixed issue that prevent alias removal
- only display unassigned shard count when count is > 0

#### New features
- support shard relocation
- support edit index template
- added cat module

### v0.5.0 - January 19th, 2017

#### Bug fixes
- fixed stuck shard state

#### New features
- added authentication support

### v0.5.1 - February 11th, 2017

#### Enhancements
- consistent node sorting on cluster overview
- support host name on lists of known hosts

#### Bug fixes
- avoid parsing errors when ES requests fail
- fixes select shard for relocation menu entry

### v0.6.0 - March 9th, 2017

#### Enhancements
- support aws clusters
- order list of clusters alphabetically
- count primary and replicas on cluster overview
- use password input field

#### New features
- support rest client history
- nodes module

### v0.6.1 - March 10th, 2017

#### Bug fixes
- correct play.i18n.langs format
- set an application.home default

### v0.6.2 - March 21st, 2017

#### Bug fixes
- consider initializing/relocating/unassigned shards as unhealthy
- fixed showSpecialIndices toggle on snapshot
- recognise roles set with yes/no

#### Enhancements
- moved internal play settings from config file
- overview tooltips on node stats
- do not require user-domain on LDAP login
- shorter classpath for init script

#### New features
- support for custom base path
- added index stats action to overview

### v0.6.3 - March 22nd, 2017

#### Bug fixes
- fixed node stats danger indication in overview

#### Enhancements
- display all index aliases on overview
- improved error messages

### v0.6.4 - March 30th, 2017

#### Bug fixes
- use relative path for authentication action

#### Enhancements
- support indices with special characters (for ES < 2.X))

### v0.6.5 - April 6th, 2017

#### Bug fixes
- logout action to use relative path
- correctly handle an empty cat api response
- consider both string and text types on field analysis

#### Enhancements
- updated known node types(included ingest, renamed client to coordinating)
- support changing refresh interval

### v0.6.6 - July 26th, 2017

#### Bug fixes
- support non valid json requests through rest client
- consistent icon for coordinating nodes

#### Enhancements
- remove trailing / from ES hosts
- fix nodes tab to handle aws nodes
- order indices alphabetically on aliases page
- ensure unassigned shards ordering
- max width to alerts
- display single alias on overview
- improve performance of overview index filtering

### v0.6.7 - September 23rd, 2017

#### Bug fixes
- use correct host when copying rest request for curl
- fixed restore snapshot with multiple selected indices

#### Enhancements
- send content-type to ES
- hide closed indices by default on cluster overview
- display both source and target for relocating shards
- confirmation dialogs displayed over alert notifications

#### New features
- support flush index from cluster overview

### v0.6.8 - September 30th, 2017

#### Bug fixes
- fixed heading text on cat apis page
- fixed ordering for a few select components
- correctly display 0% disk usage
- fixed rendering of escaped content in rest client

#### Enhancements
- add missing settings for s3 repositories
- display alias filter/routing on aliases listing
- support linux aarch64 (https://github.com/lmenezes/cerebro/issues/207)

### v0.7.0 - October 13th, 2017

#### Bug fixes
- fixed rest url autocompletion
- fixed snapshot creation with selected list of indices
- fixes 'show onlly affected indices' filter

#### Enhancements
- overview section optimised for big clusters
- cluster changes alerts optimised for big clusters
- gzip enabled for all api calls
- avoid piling up of slow requests

### v0.7.1 - October 17th, 2017

#### Bug fixes
- fixes mass actions on selected indices
- fixes error connecting to cluster with more docs than Integer.MAX_VALUE

#### Enhancements
- enabled gzip when requesting data from ES
- optimised ES response parsing
- dropped internal usage of _cat apis in favor of faster alternatives

### v0.7.2 - November 28th, 2017

#### Bug fixes
- fixes unhealty indices filter
- analyse module to work with ES 6.X

### v0.7.3 - April 14th, 2018

#### New features
- allow saving cluster settings as persistent/transient

#### Bug fixes
- fix index and repo sorting in snapshot module #236
- fixes missing initializing shard when relocating shard #250
- fix restoring snapshots with dots on name #254
- ignore_unavailable indices for overview stats #247

### v0.8.0 - June 20th, 2018

#### New features
- cluster status text added to navbar and tab title
- available cluster/index settings now read from ES
- added dockerfile and published to dockerhub

### v0.8.1 - June 20th, 2018

#### Enhancements
- Fix markdown headers of CHANGES.md #240
- Add username formatting option to support OpenLDAP and others #246
- Simplify dockerfile #301

#### Bug Fixes
- Remove firefox specific rules incompatible with firefox Quantum #235

### v0.8.2 - April 2nd, 2019

#### Enhancements
- Move docker file to its [own repo](https://github.com/lmenezes/cerebro-docker) #306
- Add LDAP group search #307

### v0.8.3 - April 5th, 2019

#### Enhancements

- Sbt configuration for creating rpm and deb packages #308
- Fix markdown headers of CHANGES.md #328
- Fix snapshot view for snapshot that contains `:` #351
- Update scala and main libs to the latest versions #352
- Travis CI integration #353
- Stop logging sensible data #354

#### Bug fixes

- Show host in nodes overview #346

### v0.8.4 - July 23rd, 2019

#### Enhancements

- Support user-attr-template for LDAP auth
- Allow forwarding proxy headers to ES

### v0.8.5 - September 18th, 2019

#### Enhancements

- Update json-tree to 0.3.0 #405

#### Bug fixes

- Read closed indices from routing table
- Use full setting name for index settings updates #382
- Use openjdk8 instead of oraclejdk8 for travis testing
- Update json-tree to 0.3.0 #405

### v0.9.0 - April 24th, 2020

#### Enhancements

- GET as default verb in the REST console #437
- Upgrade to the latest Play and other core libraries #439
- Added possibility of configuring port using CEREBRO_PORT environment var. #438
- Allow selecting kind of shard allocation in overview #423
- Sort indices on snapshot restore (5317ddd54de574708dbf02e713b5e2d0865441e0). Closes #419
- Change login user input tooltip (66b73ddd5ab818534760bc64895899825a20ec62). Closes #424
- Add content-type to copied curl command (e93ab9948c3c650a9fcdd5be2a7edbe1976cab05). Closes #426
- Include aliases in rest autocompletion (abb8ab73992dfe9708b2b34f8ba2b75924d4d7ec)
- Drop support for deprecated endpoints.
- Drop type support on rest autocomplete. 

#### Bug fixes

- Tolerate missing settings for repositories (2bed3327b056295b215e6a809dcbf50e8b0e7926). Closes #409
- Handle post typeless indices mappings on analysis (9dbece339a014971307506977ec71045e977d576). Closes #412

### v0.9.1 - May 20th, 2020

#### Enhancements
- Display node attributes on overview / nodes view

### v0.9.2 - June 18th, 2020

#### Bug fixes
- Handle node info for nodes without defined attributes Closes #448

### v0.9.3 - December 27th, 2020

#### Improvements
- Support elasticsearch 7.10 data tiers

### v0.9.4 - April 10th, 2021

#### Security updates
- Bump socket.io to 2.4.1

### Unreleased

#### New features

- Live activity: the overview shows indexing and search rates, search latency, heap and CPU over the last minutes, and the nodes page adds per-node charts with thread pool queues and rejections (`/nodes?node=` opens a node).
- Performance page: hot threads parsed into readable cards with the busiest pool explained, live thread pools with new rejections highlighted, the master's pending tasks, and a slow log threshold editor with presets that verifies what it applied.
- Index operations wizard: shrink, split, clone, roll over and reindex with live preflight checks (write block, shard placement, disk, document limits, exact split counts), a review of the exact requests, and progress tracking with cancel and finishing actions; reachable from the Actions menu of index details.
- Cluster doctor: a one click health check of the whole cluster. It finds unassigned shards, replicas that can never be allocated, indices without replicas, nodes above the disk watermarks (with headroom), read-only blocks, oversized and over-sharded indices, the shard limit, ILM errors, heap and old-generation memory pressure, garbage collection, tripped circuit breakers, disabled allocation, transient settings and upgrade deprecations, shows Elasticsearch's health report on 8.7+, explains each problem and offers a confirmed one-click fix or a link to the page that handles it.
- Shard allocation explain: why a shard is unassigned or stays on its node, with every node's deciders, reachable from the overview's shard menus and the unassigned-shards warning.
- Index details page with overview, settings, mappings, statistics, aliases and shards tabs.
- Composable index templates and component templates: list, edit, delete and preview the settings, mappings and aliases a template resolves to.
- Data streams (backing indices, generation, lifecycle, rollover, delete) and index lifecycle (ILM) policies with a phase timeline, a JSON editor and per-index lifecycle status (current phase, step and errors).
- Ingest pipelines: list, edit, delete and simulate against sample documents, with per-processor results.
- Tasks: running tasks with sub-tasks nested under their parent, details, and cancellation of cancellable tasks.
- Recoveries: live progress of shard recoveries (files, bytes, translog, stage and source).
- REST console saved requests: name, rename, duplicate and update favourites, with JSON export and import.

#### User interface

- Rebuild every screen from scratch on a dedicated design system (see `docs/FRONTEND.md`): sidebar navigation, light and dark themes that follow the operating system, bundled Inter / JetBrains Mono fonts and responsive layouts down to phone width.
- New command palette (Ctrl/⌘ + K) to jump to any page, action or index.
- Auto-refresh can be paused, remembers its interval and skips polling while the tab is hidden.
- Repeated notifications are folded together, error notifications stay until they are dismissed, and hovering or focusing the notifications pauses their countdown.
- Index creations and deletions made in cerebro are no longer announced a second time by the cluster change notifications.
- Pausing and resuming auto-refresh from the command palette keeps the chosen interval.
- Connect screen remembers recently used cluster addresses (never credentials).
- JSON is edited and displayed with a themed, searchable code editor with folding.
- Editors ask before in-app navigation discards unsaved changes.
- Accessibility: visible focus ring, AA text contrast in both themes (including editor line numbers), Tab leaves the code editor (Ctrl + ] / [ indent), the page follows the editor caret, Ctrl/⌘ + K opens the command palette from an editor, keyboard-friendly menus and mobile navigation.
- Drop Bootstrap CSS; feature pages are lazy loaded to keep the initial bundle small.

#### Bug fixes

- Snapshot creation now honours "ignore unavailable indices" and "include global state" (the options were sent with the wrong field names and ignored by Elasticsearch).
- Aliases report their write index and hidden flags.
- The overview computes disk usage from the space available to Elasticsearch, matching the nodes view and the disk allocation thresholds.
- Repeated identical errors (for example while the cluster is unreachable) no longer flood the screen.
- Disabling and enabling shard allocation from the overview writes the persistent setting and clears the transient one, so no leftover transient value overrides later persistent changes. Unknown allocation kinds are rejected.
- Pipelines, ILM policies, templates and other resources whose name contains a space can be updated and deleted (the space was sent as "+").
- Text responses (for example `GET _cat/health` in the REST console) no longer fail with a JSON parse error.
- "Copy settings and mappings from" on create index copies the chosen index; for a data stream backing index it could pick a sibling backing index on 8.x.
- Index lists ask Elasticsearch for names only and the index picker no longer reloads them on every refresh.
- The `?host=` of the URL now always decides which cluster is shown (Back/Forward, bookmarks, pasted links).
- Cancelling "Switch cluster" because of unsaved edits keeps the page connected.
- Requests without a target host are answered with 400 "Missing required parameter host" instead of a 500.

#### Maintenance

- Remove the unused `zone.js` dependency, the legacy logo image and the obsolete Travis CI configuration (CI runs on GitHub Actions).
- Remove the unused `/commons/nodes` endpoint and unused Elasticsearch client methods.
- `public/js` is build output and no longer tracked in git; run `npm run build` before `sbt run` / `sbt stage`.
- Docker examples and documentation use the in-repository image (`chosenwar/cerebro`).

#### Security updates

- Migrate the backend to Play 3.0.11, Pekko, Scala 2.13.18 and a Java 17 baseline.
- Align Jackson 2.18.10, Logback 1.5.38 and SQLite JDBC 3.53.2.1 to patched releases.
- Replace AngularJS, Bootstrap 3, Grunt, Karma and PhantomJS with Angular 22 and Vitest.
- Restore Play CSRF, allowed-host and security-header filters; require a production application secret.
- Harden session cookies, redirects and LDAP filter construction.
- Add npm, staged-JAR and legacy-bundle security gates to CI.
- Add a non-root Wolfi/OpenJDK 17 multiarch image and zero-finding container gates for amd64 and arm64.
- Upgrade transitive `lz4-java` to 1.11.1 for CVE-2026-59949.

#### Compatibility

- Preserve the existing cluster endpoints, response envelopes, SQLite REST history and all 13 UI workflows.
- Preserve legacy `#!/...` bookmarks by rewriting them to Angular hash routes before startup.
