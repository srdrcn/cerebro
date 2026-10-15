# Frontend guide

The browser application lives in `src/` and is an Angular 22 application
(standalone components, signals, zoneless change detection). It is built into
`public/js` and served by Play. This guide describes the architecture and the
design system every page must follow.

## Architecture

```text
src/
  main.ts                 bootstraps AppComponent (and rewrites legacy #!/ URLs)
  styles.css              design system entry point (imports styles/*.css)
  styles/
    tokens.css            colors, spacing, radii, shadows — light + dark
    base.css              reset and element defaults
    components.css        reusable classes (buttons, cards, tables, …)
    shell.css             sidebar, top bar, toasts, command palette
    auth.css              connect screen and server-rendered sign-in page
    ace.css               Ace editor theme driven by the tokens
  app/
    app.component.ts      one <router-outlet> inside the shell; the shell hides its
                          chrome on Connect, so pages are never recreated when it appears
    app.routes.ts         lazy loaded routes (paths are kept for old bookmarks)
    core/                 services and pure helpers (no UI)
    shared/               reusable UI components
    features/<name>/      one folder per page
```

### Core services (`src/app/core`)

| Service | Purpose |
| --- | --- |
| `ClusterApiService` | `post<T>(path, payload)` calls a Play endpoint. The connected host and credentials are merged into every payload. Resolves with the inner `body` for 2xx, rejects with `ClusterApiError` (`status`, `body`) otherwise. Network failures are already reported with a toast. An Elasticsearch 401 sends the user to the sign-in form of Connect once (also for concurrent requests), replacing the history entry and passing `returnUrl` so signing in returns to the page; nothing happens while already on Connect. The rejected `ClusterApiError` is marked as reported, so the page's own error toast is skipped. |
| `ConnectionService` | `host()`, `connected()`, `hostQuery()` (query params every in-app link must carry), `connect()`, `disconnect()` (navigates to Connect first and only clears the connection when the navigation was not canceled by unsaved edits), `followUrlHost()`. The `?host=` of the URL always wins: `requireConnection` switches to it (dropping credentials), cluster routes re-run their guards when only `host` changes (`hostOrParamsChange`) and `ClusterRouteReuseStrategy` (`cluster-route-reuse.ts`) then creates the page again, so pages never need to reset themselves for another cluster. |
| `RefreshService` | `tick()` signal increments on every auto refresh / manual refresh. Views that show live data read it inside an `effect` to reload. `refresh()` forces a reload after a mutation. `setInterval()`, and `toggle()` / `resume()` that restore the interval used before pausing. |
| `AlertService` | Toasts: `success(msg, details?)`, `info`, `warn`, `error(msg, error)`. Pass the caught error as the second argument so the user can expand the details. Identical toasts are folded together, and an error already reported by `ClusterApiService` ("Error connecting to the server") is not shown a second time. Errors stay until dismissed; other toasts time out, and hovering a toast or focusing the stack pauses them (`pauseAll()` / `resumeAll()`). The stack rises above sticky action bars (`--toast-offset`, see rule 12). |
| `DialogService` | `confirm({ title, message?, items?, confirmLabel?, tone? })` → `Promise<boolean>`; `showJson(title, value, subtitle?)` opens a read-only JSON viewer (a compact dialog sized to short documents, a tall one from 30 lines). A dialog belongs to its page: a navigation (Back/Forward included) closes it and its confirmation resolves `false`; the discard-changes guard asks after that point. |
| `ClipboardService` | `copyAndNotify(value, what)` copies and toasts with the app-wide wording: "Request body copied to the clipboard" / "Could not copy the request body: <reason>" (`what` in lower case). Use it for every copy action; `copy(text, onSuccess?, onFailure?)` is the low-level form. |
| `ClusterStatusService` | Cluster health/name polled by the shell; also sets the document title and favicon. A new host clears the previous cluster's name, health and user until it answers. |
| `ClusterChangesService` | Announces nodes that joined or left and indices created or deleted outside the app. Index changes made through `overview/delete_indices`, `create_index/create` and `snapshots/restore` are recognized automatically (via `ClusterApiService.onSuccess`); call `expect({ created, deleted })` after other endpoints that create or delete indices so the user is not told twice. |
| `ThemeService` | `preference()`, `resolved()`, `set()`, `cycle()`. |
| `format.ts` | `formatBytes`, `formatNumber`, `formatCompact`, `formatDuration`, `formatDate`, `formatTimestamp`, `formatRelative`, `pluralize` ("3 nodes"), `plural` (the noun alone, for labels that style the number), `sentence`, `humanize`, `severity`, `clampPercent`, `textMatcher(query)` (compiles a filter once: case-insensitive regular expression when valid, substring otherwise; use it for every list or table filter), `listSample(names, limit)` ("logs, metrics and 4 more" in sentences), `sortByName`, `sortIndexNames` (regular indices first, dot-prefixed system and hidden ones last) and `groupIndexNames` (the same split as `{ regular, system }` for `<optgroup>`s). Never filter with a bare `includes()`: all filters accept the same queries. |
| `errors.ts` | `elasticsearchReason(error)` extracts the most specific readable reason from a `ClusterApiError`, an Elasticsearch error body, a string or an `Error` (HTML error pages are ignored); `readableReason(error)` returns it as a sentence for error states; `failureMessage(action, error)` builds "Could not delete index: no such index [logs]"; `isUnknownEndpoint(error, endpoints?)` tells an Elasticsearch that does not know an API (404/405, "no handler found", `_data_stream` read as an invalid index name) from one that is down or refusing, for "needs Elasticsearch x.y" hints. |
| `health.ts` | `healthTone(status)` (`green` / `yellow` / `red` / `gray`, case-insensitive) and `healthLabel(status)` for Elasticsearch health colors; `HealthTone` is the only health union; `healthFromShardCopies(copies)` derives an index's health from its shard copies by Elasticsearch's rules when the statistics do not say it. |
| `json.ts` | `isRecord`, `stringList`, `toNumber` (a number or numeric string, as `_cat` returns them) for defensive parsing of Elasticsearch responses; `stringifyForDisplay` (strings as they are, anything else as indented JSON) for JSON viewers and alert details. |
| `layout.ts` | `STACKED_LAYOUT_QUERY` (the 1180px breakpoint of rule 11), `isStackedLayout()`, `revealWhenStacked(element, { onlyBelowFold? })`: after a pick in a master/detail list, scrolls the editor or detail into view when the layout is stacked. Never repeat the breakpoint in TypeScript. |
| `names.ts` | `validateResourceName(name, noun)` (template, snapshot and repository names), `indexNameFormatError(name)` (the index name format rules, not whether the name is taken) and the invalid character list for index names (`INVALID_INDEX_NAME_CHARACTERS`). ILM policy and pipeline ids follow their own rules in their features. |
| `shards.ts` | `unassignedReason(reason)`: label and explanation of an `unassigned.reason`. |
| `tasks.ts` | `cancelFailure(response)`: why `_tasks/<id>/_cancel` canceled nothing (Elasticsearch answers 200 with `node_failures` / `task_failures`), `null` when it did. |
| `MetricsService` | Live node activity. `attach(destroyRef?)` returns a release function; it samples `metrics/nodes` on refresh ticks only while something is attached, keeps the history across pages and resets it on host change. Signals `history`, `nodes`, `latest`, `ready`, `sampling`, `failed`, `lastError`, `late`, `interval`, `paused`; `sampleNow()`. |
| `metrics.ts` | Pure sampling logic: `parseNodeMetrics`, `buildHistory` (rates from each node's own timestamps, latencies Δtime/Δcount, cluster sums rates and averages gauges, counter resets and gaps give `null`), `METRICS` definitions (their labels are the names every page uses), `formatRate`, `formatLatency`, `metricParts`, `seriesTone`, `metricFormatter(key)` (one stable formatter per metric for chart `[format]` inputs), `answeredLabel(history)` ("2 of 3 nodes answered"). |
| `node-attributes.ts` | `isInternalAttribute` (hides `ml.*`, `xpack.*`, `transform.*`). |
| `pending-changes.guard.ts` | `PendingChangesAware` (`confirmDiscard()`) and the `confirmDiscardPendingChanges` route guard. |
| `preferences.ts` | best-effort `localStorage` helpers for per-browser UI preferences; writes return `false` when the browser refused them. |
| `templates.ts` | `isManagedTemplate(name, meta)`: built-in templates (system `.` names or `_meta.managed: true`) that the template pages hide behind "Show managed templates". |
| `save-mode.ts` | `saveMode(name, selected, existing)` → `create` / `update` / `overwrite` / `copy` for editors that save under a typed name; `saveLabel(mode, noun)` for the save button. |

### Shared components (`src/app/shared`)

| Selector | Usage |
| --- | --- |
| `<cerebro-menu>` | Dropdown rendered in the top layer (never clipped). Project `<i trigger class="bi …">` (or any element with the `trigger` attribute) and `.menu-item` buttons/links, `.menu-label`, `.menu-separator`. Inputs: `label` (aria-label), `align="start\|end"`, `triggerClass` (defaults to an icon button), `minWidth`. Clicking a `.menu-item` closes the menu. |
| `<cerebro-code-editor>` | Ace JSON/text editor. `[(value)]`, `mode`, `readOnly`, `placeholder`, `minLines`/`maxLines` (auto height) or `fill` (fills the CSS height of the host), `flush`, `wrap`, `(submit)` on Ctrl/⌘+Enter. `invalid` and `describedBy` mark it invalid and link its field error. Call `format()` via a template reference to pretty-print. Tab and Shift+Tab move focus out of the editor (it never traps the keyboard); Ctrl+] and Ctrl+[ indent and outdent; Ctrl/⌘+K is left to the command palette. The page scrolls to keep the caret visible and clear of sticky bars (top bar, sticky card footers). `flush` editors draw an inset focus ring (they have no border, and read-only ones no caret). |
| `<cerebro-search>` | Search field with icon and clear button: `[(value)]`, `placeholder`, `ariaLabel`, `small`. |
| `<cerebro-empty>` | Empty/error state: `icon`, `heading`, `text`, optional projected action buttons, `compact`, `tone="success"` (green icon tile for "all good" states). Long reasons wrap. |
| `<cerebro-meter>` | Usage bar: `[value]` (percent), `warn`/`danger` thresholds, `small`, `label`. |
| `<cerebro-pager>` | "1–20 of 143" + previous/next: `[page] [pageSize] [total] noun (pageChange)`; helpers `clampPage()` and `pageSlice()`. |
| `createSort()` | Sortable table state from `shared/sort-state.ts`: `sortBy`, `isActive`, `ariaSort` and `icon` for `.sort-button` headers. |
| `dialog[cerebroModal]` | `ModalDialogDirective` for page-owned native dialogs: opens as a modal after the first render (`(opened)` to focus a field), turns Escape and backdrop clicks into `(dismiss)` so the page decides whether to close. `cerebroModal="manual"` + `open()` / `close()` for dialogs that stay rendered; `[dismissible]="false"` while a request runs keeps it open. |
| `[cerebroScrollTabs]` | `ScrollTabsDirective` for a `.tabs` `role="tablist"` whose tabs may not fit (phones): the strip scrolls sideways (`.tabs--scroll`) and fades the edges that hide tabs (`.is-overflow-start` / `.is-overflow-end`), measured on scroll and whenever the strip or a tab changes size. The selected tab (`aria-selected="true"`) is scrolled clear of the fades after the first render, whenever the selection moves and whenever the layout changes, so the page only renders its tabs; `reveal()` (`#strip="cerebroScrollTabs"`) does it on demand. The fade width is `--tabs-fade` on `.tabs--scroll` in `components.css`, which the directive reads; pages add only their spacing, tab height and scrollbar choice. |
| `<cerebro-sparkline>` | Dependency-free SVG line for a series with gaps: `[points]`, `label` (required, starts the accessible summary), `[format]`, `tone` (`.tone-*` names or `accent`), `[height]`, `[domainMax]` (100 for percentages), `[minDomain]`, `[dot]` (off for inline sparklines under ~80px), `[focusable]` (arrow keys walk the points with a live readout; otherwise `role="img"` with a now/low/high summary). |
| `<cerebro-index-picker>` | Header index select (`.context-picker`) that loads the index list itself, grouped into regular and system/hidden indices: `inputId`, `index`, `(picked)`. Through a template reference: `indices()`, `failed()`, `loadError()`, `groups()`, `retry()`, `focus()`, `revert()` (after a declined pick). |
| `<cerebro-settings-editor>` | Settings table with filter, inline editing, pending changes and add-setting form, shared by cluster and index settings (`shared/settings-editor/`). |
| Pipes | `bytes`, `num`, `compact`, `duration`, `plural` (`{{ n \| plural: 'index' : 'indices' }}`) from `shared/format.pipes`. |

### Component conventions

* Standalone components, `ChangeDetectionStrategy.OnPush`, `inject()` for DI.
* All state lives in signals (`signal`, `computed`). The app is zoneless, so
  any value changed after an `await` **must** be a signal or it will not
  render. Two-way bind form controls with `[(ngModel)]="someSignal"` or
  `[ngModel]="x()" (ngModelChange)="x.set($event)"`.
* Guard async loads against races with a sequence counter (see
  `NodesComponent.load`).
* Load failures keep their reason for the error state:
  `readonly loadError = signal<string | undefined>(undefined)`, set from
  `readableReason(error)` in the `catch` and cleared on success, bound as
  `<cerebro-empty … [text]="loadError() ?? 'The cluster did not answer …'">`.
  Toasts use `failureMessage(action, error)`; a failed index list (`commons/indices`)
  reads `failureMessage('Could not load the index list', error)` on every page. Hints such as "needs
  Elasticsearch 7.8" are shown only when there is no reason or
  `isUnknownEndpoint(error)` says the endpoint is unknown.
* No feature imports another feature: a helper two pages need moves to
  `core/` (pure logic) or `shared/` (UI).
* Live data (counters, health, tasks) reloads on `RefreshService.tick()`.
  Data that only changes when someone edits it (settings, slow log
  thresholds, the index list) loads when the page or tab opens, after a
  change and on an explicit Reload, not on every tick.
* Page load effects read `connection.connected()` (plus ticks or tab
  activity), never `connection.host()`: `ClusterRouteReuseStrategy` creates
  the page again for another cluster.
* Index lists: `commons/indices` (names) for pickers; `commons/indices/lookup`
  with an expression (`'*,.*'` for open, closed and hidden indices) when the
  status or size in bytes is needed. Failures read "Could not load the index
  list", in toasts and error states alike.
* Status text that grows on every tick ("last 3m 5s") stays outside
  `role="status"`, so screen readers are not interrupted.
* After a confirmed change that removes or disables its own button, move
  focus to a stable heading (`tabindex="-1"`); never let it fall to `<body>`.
* A change applied to many indices is verified by reading it back and
  reported as "applied to N of M".
* Deep links: `/nodes?node=`, `/index_detail?index=`, `/allocation?index=&shard=&primary=`,
  `/data_streams?name=`, `/ilm?policy=`, `/pipelines?pipeline=`,
  `/performance?tab=`, `/index_ops?op=&index=`, `/create?name=&from=`.
* Larger pages use `templateUrl` + `styleUrl`; page styles only contain
  layout specific to that page — everything reusable belongs to the design
  system.
* Links inside the app carry the host: `[queryParams]="connection.hostQuery()"`
  (merge extra params: `{ ...connection.hostQuery(), index: name }`).
* Keep pure logic (filtering, sorting, payload building) in
  `<feature>.utils.ts` / `<feature>.models.ts` with Vitest specs next to it.

## Design system

The UI is a calm, data-dense console with a single accent color (cerebro
green) and semantic colors for cluster health. It must look right in **both
light and dark themes** and down to phone width.

### Rules

1. Never hard-code colors, shadows or radii; use the tokens from
   `styles/tokens.css` (`var(--text-2)`, `var(--surface-2)`, `var(--red)`,
   `var(--radius-2xs)` for 2–3px indicator bars, `var(--radius-full)` for
   pills, …).
2. Bootstrap is **not** loaded. Do not use Bootstrap classes (`row`, `col-*`,
   `d-flex`, `mb-3`, `form-control`, `btn-outline-*`, `table-hover` …). Use the
   classes below or a few lines of component CSS.
3. Icons come from Bootstrap Icons (`<i class="bi bi-…" aria-hidden="true">`).
4. Sentence case everywhere ("Create index", not "CREATE INDEX" or
   "create index"). Section labels may use the uppercase `.menu-label` /
   `.stat__label` styles which apply the casing in CSS.
5. Destructive actions always go through `DialogService.confirm` with
   `tone: 'danger'` and a specific confirm label ("Delete index").
6. Forms validate on submit: the primary button stays enabled (disabled only
   while the request is in flight, with `.is-loading`); submitting an invalid
   form shows `.field-error` messages and moves focus to the first invalid
   field. Errors of a field may also show live once the user has edited it.
   Field errors read as one sentence without a final period, start with
   `<i class="bi bi-exclamation-circle" aria-hidden="true"></i>`, and are tied
   to the control with `aria-describedby` and `aria-invalid`.
7. Pages that hold unsaved edits implement `PendingChangesAware` and their
   route declares `canDeactivate: [confirmDiscardPendingChanges]`; closing the
   tab is covered with a `beforeunload` handler while edits are pending.
8. Show Elasticsearch failures with their reason (`failureMessage`,
   `elasticsearchReason`) rather than a generic "request failed".
9. Every page handles four states: loading (`.loading-block` or skeletons),
   empty (`<cerebro-empty>`), error (`<cerebro-empty icon="bi-exclamation-triangle">`
   with a retry button) and data.
10. Accessibility: every control has a label (`<label for>` or `aria-label`),
   icon-only buttons have `aria-label` and `title`, tables use `<th scope>`
   and `aria-sort` on sortable headers, focus styles are never removed.
11. Responsive: layouts collapse to one column under 1180px
   (`.layout-split`, `.layout-sidebar-*`, `STACKED_LAYOUT_QUERY` in code) and
   controls stack under 760px. Wide tables scroll horizontally inside
   `.table-wrap`.
12. Sticky bars never hide keyboard focus (WCAG 2.4.11). Browsers only
   honor the scroll container's `scroll-padding` when focus moves (not the
   field's `scroll-margin`), so `html` carries it: `base.css` clears the top
   bar, and "Sticky bars and keyboard focus" in `components.css` widens it
   with `html:has(…)` while the settings toolbar, the pending-changes bar or
   a `.card--sticky-footer` is rendered. A new sticky bar adds its rule
   there; the same rule sets `--toast-offset`, which lifts the notifications
   above the bar so they never cover its primary action. In-page scroll targets therefore need no top-bar offset
   (`scroll-margin-top: var(--topbar-height)…`) of their own.
13. Links inside running text (paragraphs, hints, callouts, notes) are
   underlined by `base.css`; do not remove it. Standalone links styled as
   buttons, menu items or navigation are not affected.

### Page skeleton

```html
<section class="page" aria-labelledby="x-title">
  <header class="page-header">
    <div class="page-header__text">
      <h1 id="x-title" class="page-title">Title</h1>
      <p class="page-subtitle">One sentence that says what this page is for.</p>
    </div>
    <div class="page-header__actions">
      <button type="button" class="btn btn-primary"><i class="bi bi-plus-lg" aria-hidden="true"></i> Create</button>
    </div>
  </header>

  <div class="layout-sidebar-end">
    <div class="card">
      <div class="card-header">
        <div class="toolbar"><cerebro-search [(value)]="query" placeholder="Filter" /></div>
        <span class="count-label"><strong>{{ total() | num }}</strong> {{ total() | plural: 'item' }}</span>
      </div>
      <div class="table-wrap"><table class="data-table">…</table></div>
    </div>
    <aside class="card">…</aside>
  </div>
</section>
```

Count labels read "12 items", and "3 of 12 items" only while a filter is
active.

Header links to a sibling page ("Index templates" on data streams, "Snapshots"
on repositories) are plain `.btn` with an icon, placed before any primary
button; never `.btn-ghost` or `.btn-primary`.

Menu items and buttons end with an ellipsis ("Restore…", "Rename…") only when
they open a dialog, or a wizard, that collects input before anything runs
("Shrink…"). Actions that only ask for confirmation do not ("Delete",
"Delete index"), nor do items that simply navigate.

### Master/detail editors

Pages that list resources beside an editor (legacy templates, index
templates, lifecycle policies, pipelines, repositories) share one layout:

```html
<div class="layout-sidebar-start">
  <div class="card list-card">
    <div class="card-header">
      <h2 class="card-title spacer"><i class="bi bi-diagram-3" aria-hidden="true"></i> Pipelines</h2>
      <span class="count-label"><strong>{{ shown() | num }}</strong> of {{ total() | num }} {{ total() | plural: 'pipeline' }}</span>
      <button type="button" class="btn btn-sm btn-soft" (click)="newPipeline()">
        <i class="bi bi-plus-lg" aria-hidden="true"></i> New pipeline
      </button>
    </div>
    <div class="list-card__toolbar">
      <cerebro-search [(value)]="query" [small]="true" placeholder="Filter by name" />
      <label class="switch list-card__switch">…Show managed pipelines <span class="count">20</span></label>
    </div>
    <ul class="list list-card__list" aria-label="Pipelines">
      <li><button type="button" class="list-item list-item--interactive" [class.is-selected]="…">
        <span class="list-item__icon" aria-hidden="true"><i class="bi bi-diagram-3"></i></span>
        <span class="list-item__body">…</span>
      </button></li>
    </ul>
    <p class="list-card__note">Optional explanation pinned to the bottom.</p>
  </div>

  <div #editorCard class="card card--sticky-footer">
    <div class="card-header">…</div>
    <div class="card-body">…</div>
    <div class="card-footer card-footer--between">
      <span class="footer-keys"><kbd>Ctrl</kbd><kbd>Enter</kbd> to save</span>
      <div class="row"><button class="btn btn-danger-soft">Delete</button><button class="btn btn-primary">Save pipeline</button></div>
    </div>
  </div>
</div>
```

* The only way to start a new item is the `btn-sm btn-soft` "New <noun>"
  button in the list card header. The page header has no primary button:
  the primary action of the page is the editor footer's Save / Create.
  Empty list states ("No custom policies") repeat no "New …" button: the
  editor beside them is already in New mode.
* The list card header follows the recipe above: icon, title, right-aligned
  `.count-label`, then "New <noun>". Every list item has an icon tile.
  Its shape follows the card's own width (a `list-card` container query),
  never the count or the refresh spinner, so typing in the filter never
  moves the list: up to 480px wide (beside the editor, phones) it has two
  rows, title, spinner and count first and "New <noun>" right-aligned below;
  wider (stacked layouts) one row. The title is never squeezed; an extreme
  count ends in an ellipsis.
* The selection lives in the URL (`?name=`, `?policy=`, `?pipeline=`,
  `?repository=`), written with `replaceUrl` and
  `queryParamsHandling: 'merge'`; an unknown name shows a
  "<Thing> <name> does not exist" warning and drops the parameter.
* The list card has one width on every page (`.layout-sidebar-start` with a
  `.list-card` child, 300–360px); pages never override the columns.
* After a pick, `revealWhenStacked(editorCard)` brings the editor into view
  on narrow screens.
* Built-in items (managed templates, policies, pipelines) are hidden behind
  a "Show managed …" `.switch` under the filter, off by default. A card header with an icon tile:

```html
<div class="card-header">
  <div class="row min-w-0">
    <span class="card-icon" aria-hidden="true"><i class="bi bi-layers"></i></span>
    <div class="min-w-0">
      <h2 class="card-title">Title</h2>
      <p class="card-subtitle">Short description</p>
    </div>
  </div>
  <button type="button" class="btn btn-sm">Action</button>
</div>
```

### Class reference

* Layout: `.page`, `.page--wide`, `.page-header`, `.page-title`,
  `.page-subtitle`, `.page-header__actions`, `.context-picker` (header select
  with a leading icon that picks the page's index or repository),
  `.section-label`, `.layout-split`,
  `.layout-sidebar-start`, `.layout-sidebar-end`, `.stack`, `.stack-sm`,
  `.stack-lg`, `.row`, `.row-wrap`, `.spacer`, `.grid-2`, `.col-span-all`,
  `.section-title`, `.section-subtitle`.
* Text: `.text-muted`, `.text-secondary`, `.text-danger`, `.text-success`,
  `.text-warning`, `.text-sm`, `.text-xs`, `.mono`, `.tabular`, `.truncate`,
  `.break-all`, `.min-w-0`.
* Buttons: `.btn` + `.btn-primary` | `.btn-danger` | `.btn-danger-soft` |
  `.btn-ghost` | `.btn-soft`; size `.btn-sm`; `.btn-icon` for
  square icon buttons; `.btn-block`; `.is-loading` shows a spinner;
  `.btn-group`; `.link-button` for inline text actions.
* Forms: `.field` > `.field-label` + control + `.field-hint` / `.field-error`;
  controls `.input`, `.select`, `.textarea`, sizes `.input-sm`/`.select-sm`,
  `.input-mono` (resource names, with an "e.g. …" placeholder), `.is-invalid`
  (inputs, selects and textareas); `.check` (checkbox/radio label wrapper) with
  `.check-description`; `.switch`; `.segmented` (+ `.segmented-sm`, buttons with
  `aria-pressed` (or `aria-checked` / `aria-selected`));
  `.chip-toggle[aria-pressed]` for filter chips; `.input-group` for icon inputs.
* Surfaces: `.card`, `.card-header`, `.card-icon` (tinted icon
  tile before a card title), `.card-title`,
  `.card-subtitle`, `.card-body`, `.card-footer` (`--between`),
  `.card--sticky-footer` (editor card whose footer stays visible, with focus
  kept above it), `.footer-keys` (keyboard hint in an editor footer, hidden on
  phones);
  `.list-card` (sticky master/detail list card) with `__toolbar`, `__switch`,
  `__list` (scrolls) and `__note`;
  `.callout` + `-info` | `-warning` | `-danger` | `-success`;
  `.stat-grid` > `.stat` > `.stat__label`, `.stat__value`, `.stat__meta`;
  `.stat__value--text` for a word or name in place of a number ("8h ago",
  the elected master): smaller text that keeps the numeric line box, so the
  meta lines stay level across the row.
* Data: `.table-wrap` > `.data-table` (`--compact`), cells `.num`, `.actions`,
  rows `.is-selected`, `.is-muted`; `.sort-button` (`.is-active`), whose sort
  icon (hidden until hover) goes before the label in a right-aligned
  `th.num`, so the label stays flush with the numbers below;
  `.list` > `.list-item` (`--interactive`, `.is-selected`) with
  `__icon`, `__body`, `__title`, `__meta`, `__actions`; `.tabs` with
  `button[aria-selected]`, `.tabs--scroll` (with `.is-overflow-start` /
  `.is-overflow-end` and `--tabs-fade`) set by `[cerebroScrollTabs]` only.
* Indicators: `.badge` + `-green` | `-yellow` | `-red` | `-blue` | `-purple` |
  `-accent` | `-outline`, `.badge-lg`, `.badge-uppercase`; `.tag` (with
  `.tag-key`); `.dot` + `-green` | `-yellow` | `-red` | `-gray`, `.dot-pulse`,
  `-accent`, `.dot-sm` (inside a badge, e.g. "Unsaved changes");
  `.tone-green` | `-yellow` | `-red` | `-blue` | `-purple` | `-gray` set `--tone`,
  `--tone-soft` and `--tone-text` for custom diagnostic visuals;
  `.method` + `.method-GET|POST|PUT|DELETE|HEAD`; `kbd`/`.kbd`; `.spinner`
  (`-lg`); `.skeleton`; `.count-label`; `.toolbar`.

## Building and testing

```sh
npm run typecheck      # strict template + TypeScript checks
npm test               # Vitest unit tests
npm run test:watch     # Vitest in watch mode
npm run build          # production bundle into public/js
npm start              # development build in watch mode
```

Run `sbt run` in parallel with `npm start` to work against a real cluster.
`public/js` is build output and is ignored by git: build it before `sbt run`
or `sbt stage`, and never commit it.
