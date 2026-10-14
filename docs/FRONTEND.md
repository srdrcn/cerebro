# Frontend guide

The browser application lives in `src/` and is an Angular 22 application
(standalone components, signals, zoneless change detection). It is built into
`public/js` and served by Play. This guide describes the architecture and the
design system every page must follow.

## Architecture

```
src/
  main.ts                 bootstraps AppComponent (and rewrites legacy #!/ URLs)
  styles.css              design system entry point (imports styles/*.css)
  styles/
    tokens.css            colours, spacing, radii, shadows — light + dark
    base.css              reset and element defaults
    components.css        reusable classes (buttons, cards, tables, …)
    shell.css             sidebar, top bar, toasts, command palette
    auth.css              connect screen and server-rendered sign-in page
    ace.css               Ace editor theme driven by the tokens
  app/
    app.routes.ts         lazy loaded routes (paths are kept for old bookmarks)
    core/                 services and pure helpers (no UI)
    shared/               reusable UI components
    features/<name>/      one folder per page
```

### Core services (`src/app/core`)

| Service | Purpose |
| --- | --- |
| `ClusterApiService` | `post<T>(path, payload)` calls a Play endpoint. The connected host and credentials are merged into every payload. Resolves with the inner `body` for 2xx, rejects with `ClusterApiError` (`status`, `body`) otherwise. Network failures are already reported with a toast. |
| `ConnectionService` | `host()`, `connected()`, `hostQuery()` (query params every in-app link must carry), `connect()`, `disconnect()` (navigates to Connect first and only clears the connection when the navigation was not cancelled by unsaved edits), `followUrlHost()`. The `?host=` of the URL always wins: `requireConnection` switches to it (dropping credentials) and cluster routes re-run their guards when only `host` changes (`hostOrParamsChange`). |
| `RefreshService` | `tick()` signal increments on every auto refresh / manual refresh. Views that show live data read it inside an `effect` to reload. `refresh()` forces a reload after a mutation. `setInterval()`, and `toggle()` / `resume()` that restore the interval used before pausing. |
| `AlertService` | Toasts: `success(msg, details?)`, `info`, `warn`, `error(msg, error)`. Pass the caught error as the second argument so the user can expand the details. Identical toasts are folded together, and an error already reported by `ClusterApiService` ("Error connecting to the server") is not shown a second time. Errors stay until dismissed; other toasts time out, and hovering or focusing the toasts pauses them (`pauseAll()` / `resumeAll()`). |
| `DialogService` | `confirm({ title, message?, items?, confirmLabel?, tone? })` → `Promise<boolean>`; `showJson(title, value, subtitle?)` opens a read-only JSON viewer. |
| `ClipboardService` | `copy(text, onSuccess?, onFailure?)`. |
| `ClusterStatusService` | Cluster health/name polled by the shell; also sets the document title and favicon. |
| `ClusterChangesService` | Announces nodes that joined or left and indices created or deleted outside the app. Index changes made through `overview/delete_indices`, `create_index/create` and `snapshots/restore` are recognised automatically (via `ClusterApiService.onSuccess`); call `expect({ created, deleted })` after other endpoints that create or delete indices so the user is not told twice. |
| `ThemeService` | `preference()`, `resolved()`, `set()`, `cycle()`. |
| `format.ts` | `formatBytes`, `formatNumber`, `formatCompact`, `formatDuration`, `formatDate`, `formatTimestamp`, `formatRelative`, `pluralize` ("3 nodes"), `plural` (the noun alone, for labels that style the number), `sentence`, `humanize`, `severity`, `clampPercent`, `matchesText` (regex-or-substring filter), `sortByName`. |
| `errors.ts` | `elasticsearchReason(error)` extracts the most specific readable reason from a `ClusterApiError`, an Elasticsearch error body, a string or an `Error` (HTML error pages are ignored); `readableReason(error)` returns it as a sentence for error states; `failureMessage(action, error)` builds "Could not delete index: no such index [logs]". |
| `health.ts` | `healthTone(status)` (`green` / `yellow` / `red` / `gray`, case-insensitive) and `healthLabel(status)` for Elasticsearch health colours. |
| `json.ts` | `isRecord`, `stringList` for defensive parsing of Elasticsearch responses. |
| `names.ts` | `validateResourceName(name, noun)` (template, snapshot and repository names) and the invalid character lists for resource and index names. ILM policy and pipeline ids follow their own rules in their features. |
| `node-attributes.ts` | `isInternalAttribute` (hides `ml.*`, `xpack.*`, `transform.*`). |
| `pending-changes.guard.ts` | `PendingChangesAware` (`confirmDiscard()`) and the `confirmDiscardPendingChanges` route guard. |
| `preferences.ts` | best-effort `localStorage` helpers for per-browser UI preferences; writes return `false` when the browser refused them. |
| `save-mode.ts` | `saveMode(name, selected, existing)` → `create` / `update` / `overwrite` / `copy` for editors that save under a typed name; `saveLabel(mode, noun)` for the save button. |

### Shared components (`src/app/shared`)

| Selector | Usage |
| --- | --- |
| `<cerebro-menu>` | Dropdown rendered in the top layer (never clipped). Project `<i trigger class="bi …">` (or any element with the `trigger` attribute) and `.menu-item` buttons/links, `.menu-label`, `.menu-separator`. Inputs: `label` (aria-label), `align="start|end"`, `triggerClass` (defaults to an icon button), `minWidth`. Clicking a `.menu-item` closes the menu. |
| `<cerebro-code-editor>` | Ace JSON/text editor. `[(value)]`, `mode`, `readOnly`, `placeholder`, `minLines`/`maxLines` (auto height) or `fill` (fills the CSS height of the host), `flush`, `wrap`, `(submit)` on Ctrl/⌘+Enter. `invalid` and `describedBy` mark it invalid and link its field error. Call `format()` via a template reference to pretty-print. Tab and Shift+Tab move focus out of the editor (it never traps the keyboard); Ctrl+] and Ctrl+[ indent and outdent; Ctrl/⌘+K is left to the command palette. The page scrolls to keep the caret visible and clear of sticky bars (top bar, sticky card footers). |
| `<cerebro-search>` | Search field with icon and clear button: `[(value)]`, `placeholder`, `ariaLabel`, `small`. |
| `<cerebro-empty>` | Empty/error state: `icon`, `heading`, `text`, optional projected action buttons, `compact`. |
| `<cerebro-meter>` | Usage bar: `[value]` (percent), `warn`/`danger` thresholds, `small`, `label`. |
| `<cerebro-pager>` | "1–20 of 143" + previous/next: `[page] [pageSize] [total] noun (pageChange)`; helpers `clampPage()` and `pageSlice()`. |
| `createSort()` | Sortable table state from `shared/sort-state.ts`: `sortBy`, `isActive`, `ariaSort` and `icon` for `.sort-button` headers. |
| `dialog[cerebroModal]` | `ModalDialogDirective` for page-owned native dialogs: opens as a modal after the first render (`(opened)` to focus a field), turns Escape and backdrop clicks into `(dismiss)` so the page decides whether to close. `cerebroModal="manual"` + `open()` / `close()` for dialogs that stay rendered; `[dismissible]="false"` while a request runs keeps it open. |
| `<cerebro-index-picker>` | Header index select (`.context-picker`) that loads the index list itself, grouped into regular and system/hidden indices: `inputId`, `index`, `label`, `(picked)`. Through a template reference: `indices()`, `failed()`, `loadError()`, `groups()`, `retry()`, `focus()`, `revert()` (after a declined pick). |
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
* Larger pages use `templateUrl` + `styleUrl`; page styles only contain
  layout specific to that page — everything reusable belongs to the design
  system.
* Links inside the app carry the host: `[queryParams]="connection.hostQuery()"`
  (merge extra params: `{ ...connection.hostQuery(), index: name }`).
* Keep pure logic (filtering, sorting, payload building) in
  `<feature>.utils.ts` / `<feature>.models.ts` with Vitest specs next to it.

## Design system

The UI is a calm, data-dense console with a single accent colour (cerebro
green) and semantic colours for cluster health. It must look right in **both
light and dark themes** and down to phone width.

### Rules

1. Never hard-code colours, shadows or radii; use the tokens from
   `styles/tokens.css` (`var(--text-2)`, `var(--surface-2)`, `var(--red)`, …).
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
   (`.layout-split`, `.layout-sidebar-*`) and controls stack under 760px.
   Wide tables scroll horizontally inside `.table-wrap`.

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
active. A card header with an icon tile:

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
  `.stack-lg`, `.row`, `.row-wrap`, `.spacer`, `.grid-2`, `.grid-3`,
  `.col-span-all`, `.section-title`, `.section-subtitle`.
* Text: `.text-muted`, `.text-secondary`, `.text-danger`, `.text-success`,
  `.text-warning`, `.text-sm`, `.text-xs`, `.mono`, `.tabular`, `.truncate`,
  `.break-all`, `.min-w-0`.
* Buttons: `.btn` + `.btn-primary` | `.btn-danger` | `.btn-danger-soft` |
  `.btn-ghost` | `.btn-soft`; sizes `.btn-sm`, `.btn-lg`; `.btn-icon` for
  square icon buttons; `.btn-block`; `.is-loading` shows a spinner;
  `.btn-group`; `.link-button` for inline text actions.
* Forms: `.field` > `.field-label` + control + `.field-hint` / `.field-error`;
  controls `.input`, `.select`, `.textarea`, sizes `.input-sm`/`.select-sm`,
  `.input-mono` (resource names, with an "e.g. …" placeholder), `.is-invalid`
  (inputs, selects and textareas); `.check` (checkbox/radio label wrapper) with
  `.check-description`; `.switch`; `.segmented` (+ `.segmented-sm`, buttons with
  `aria-pressed` / `.is-active`); `.chip-toggle[aria-pressed]` for filter
  chips; `.input-group` for icon inputs.
* Surfaces: `.card`, `.card-header` (`--plain`), `.card-icon` (tinted icon
  tile before a card title), `.card-title`,
  `.card-subtitle`, `.card-body` (`--flush`), `.card-footer` (`--between`);
  `.callout` + `-info` | `-warning` | `-danger` | `-success`;
  `.stat-grid` > `.stat` > `.stat__label`, `.stat__value`, `.stat__meta`.
* Data: `.table-wrap` > `.data-table` (`--compact`), cells `.num`, `.actions`,
  rows `.is-selected`, `.is-muted`; `.sort-button` (`.is-active`);
  `.list` > `.list-item` (`--interactive`, `.is-selected`) with
  `__icon`, `__body`, `__title`, `__meta`, `__actions`; `.tabs` with
  `button[aria-selected]`.
* Indicators: `.badge` + `-green` | `-yellow` | `-red` | `-blue` | `-purple` |
  `-accent` | `-outline`, `.badge-lg`, `.badge-uppercase`; `.tag` (with
  `.tag-key`); `.dot` + `-green` | `-yellow` | `-red` | `-gray`, `.dot-pulse`,
  `-accent`, `.dot-sm` (inside a badge, e.g. "Unsaved changes");
  `.method` + `.method-GET|POST|PUT|DELETE|HEAD`; `kbd`/`.kbd`; `.spinner`
  (`-lg`); `.skeleton`; `.count-label`; `.toolbar`, `.toolbar-divider`.

## Building and testing

```sh
npm run typecheck      # strict template + TypeScript checks
npm test               # Vitest unit tests
npm run build          # production bundle into public/js
npm start              # development build in watch mode
```

Run `sbt run` in parallel with `npm start` to work against a real cluster.
`public/js` is build output and is ignored by git: build it before `sbt run`
or `sbt stage`, and never commit it.
