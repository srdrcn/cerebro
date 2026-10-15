import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { failureMessage, readableReason } from '../../core/errors';
import { formatNumber, formatRelative, formatTimestamp, listSample, pluralize } from '../../core/format';
import { healthLabel } from '../../core/health';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { NumberPipe, PluralPipe } from '../../shared/format.pipes';
import { MenuComponent } from '../../shared/menu.component';
import { runChecks } from './doctor.checks';
import {
  CATEGORIES,
  CategoryMeta,
  DoctorCategory,
  DoctorFinding,
  DoctorFix,
  DoctorLink,
  DoctorReport,
  DoctorResource,
  DoctorSeverity,
  HealthIndicatorView,
  SEVERITIES,
  SeverityMeta,
} from './doctor.models';
import {
  countByCategory,
  filterFindings,
  parseCategoryParam,
  parseSeverityParam,
  severityParam,
} from './doctor.utils';

/** Affected items shown before "Show all N". */
const RESOURCE_PREVIEW = 5;
/** How often "Checked 2m ago" is updated. */
const CLOCK_INTERVAL_MS = 15_000;

const RESOURCE_ICONS: Readonly<Record<DoctorResource['kind'], string>> = {
  index: 'bi-box',
  node: 'bi-hdd-stack',
  shard: 'bi-grid-3x3-gap',
  setting: 'bi-sliders',
  template: 'bi-layers',
  policy: 'bi-hourglass-split',
  'data-stream': 'bi-water',
  other: 'bi-dot',
};

/**
 * Cluster doctor: one request (`POST doctor`) gathers everything the checks
 * need; the checks themselves are pure functions (doctor.checks.ts). The
 * report is a point-in-time snapshot, so it is not refreshed on the auto
 * refresh ticks; it runs on demand and after every fix.
 */
@Component({
  selector: 'cerebro-doctor',
  imports: [EmptyStateComponent, MenuComponent, NgTemplateOutlet, NumberPipe, PluralPipe, RouterLink],
  templateUrl: './doctor.component.html',
  styleUrl: './doctor.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DoctorComponent {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(DialogService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly document = inject(DOCUMENT);
  readonly connection = inject(ConnectionService);

  readonly severities = SEVERITIES;
  readonly categories = CATEGORIES;
  readonly resourcePreview = RESOURCE_PREVIEW;
  /** "a, b, c and 17 more". */
  readonly listSample = listSample;

  readonly report = signal<DoctorReport | undefined>(undefined);
  readonly raw = signal<unknown>(undefined);
  readonly running = signal(false);
  /** Sentence explaining the last failed run. */
  readonly loadError = signal<string | undefined>(undefined);
  readonly checkedAt = signal<number | null>(null);
  readonly now = signal(Date.now());
  /** Screen reader announcement after each run. */
  readonly announcement = signal('');
  /** Key of the fix being applied. */
  readonly fixing = signal<string | null>(null);

  readonly severityFilter = signal<ReadonlySet<DoctorSeverity>>(new Set());
  readonly categoryFilter = signal<DoctorCategory | null>(null);
  /** Findings whose full resource list is shown. */
  readonly expandedResources = signal<ReadonlySet<string>>(new Set());
  /** Health report indicators that are open. */
  readonly openIndicators = signal<ReadonlySet<string>>(new Set());
  readonly checksOpen = signal(false);

  readonly findings = computed(() => this.report()?.findings ?? []);

  readonly visibleFindings = computed(() =>
    filterFindings(this.findings(), { severities: this.severityFilter(), category: this.categoryFilter() }),
  );

  readonly filtered = computed(() => this.severityFilter().size > 0 || this.categoryFilter() !== null);

  /** Severity counts within the selected category (the chips filter on top of it). */
  readonly severityCounts = computed(() => {
    const category = this.categoryFilter();
    const counts: Record<DoctorSeverity, number> = { critical: 0, warning: 0, info: 0 };
    for (const finding of this.findings()) {
      if (category === null || finding.category === category) {
        counts[finding.severity] += 1;
      }
    }
    return counts;
  });

  readonly categoryCounts = computed(() =>
    countByCategory(filterFindings(this.findings(), { severities: this.severityFilter(), category: null })),
  );

  readonly passedChecks = computed(() => (this.report()?.outcomes ?? []).filter((outcome) => outcome.status === 'passed'));
  readonly skippedChecks = computed(() => (this.report()?.outcomes ?? []).filter((outcome) => outcome.status === 'skipped'));
  /** Distinct reasons of the checks that could not run (and leave a gap in the report). */
  readonly gapReasons = computed(() => [
    ...new Set(
      this.skippedChecks()
        .filter((outcome) => !outcome.unsupported)
        .map((outcome) => outcome.reason ?? 'Unknown reason'),
    ),
  ]);

  /** "All 12 checks that ran passed. The cluster looks healthy." */
  readonly allPassedText = computed(() => {
    const report = this.report();
    if (!report) {
      return '';
    }
    const passed = report.ran === 1 ? 'The only check that ran passed.' : `All ${formatNumber(report.ran)} checks that ran passed.`;
    return report.gaps > 0
      ? `${passed} ${pluralize(report.gaps, 'check')} could not run, so problems may still be hidden.`
      : `${passed} The cluster looks healthy.`;
  });

  /** Text of the health report card on clusters older than 8.7. */
  readonly unsupportedText = computed(() => {
    const report = this.report();
    if (!report) {
      return '';
    }
    const version = report.version ? `This cluster runs Elasticsearch ${report.version}.` : '';
    // Only claim the other checks cover it when they all ran.
    const covered = report.gaps === 0 ? ' The checks on this page cover the same ground.' : '';
    return `${version}${covered}`.trim();
  });

  /** "just now", "5m ago". */
  readonly checkedAgo = computed(() => {
    const at = this.checkedAt();
    return at === null ? '' : formatRelative(at, this.now());
  });

  readonly checkedLabel = computed(() => (this.checkedAgo() ? `Checked ${this.checkedAgo()}` : ''));

  private readonly injector = inject(Injector);
  private runSequence = 0;
  private destroyed = false;

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => (this.destroyed = true));

    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.severityFilter.set(parseSeverityParam(params.get('severity')));
      this.categoryFilter.set(parseCategoryParam(params.get('category')));
    });

    // Point-in-time report: run when the page opens, not on refresh ticks
    // (another cluster creates the page again).
    void this.run();

    const clock = setInterval(() => this.now.set(Date.now()), CLOCK_INTERVAL_MS);
    destroyRef.onDestroy(() => clearInterval(clock));
  }

  async run(): Promise<void> {
    const sequence = ++this.runSequence;
    this.running.set(true);
    try {
      const raw = await this.api.post<unknown>('doctor');
      if (sequence !== this.runSequence) {
        return;
      }
      const report = runChecks(raw);
      this.raw.set(raw);
      this.report.set(report);
      if (report.findings.length === 0 || report.gaps > 0) {
        // Nothing to fix (what was verified is the interesting part), or
        // checks are missing (what was not verified matters).
        this.checksOpen.set(true);
      }
      this.checkedAt.set(Date.now());
      this.now.set(Date.now());
      this.loadError.set(undefined);
      this.announcement.set(`Checks finished. ${report.verdict.title}: ${report.verdict.text}`);
    } catch (error: unknown) {
      if (sequence !== this.runSequence) {
        return;
      }
      const reason = readableReason(error) ?? 'The cluster did not answer.';
      this.loadError.set(reason);
      this.announcement.set(`Could not run the checks. ${reason}`);
      if (this.report()) {
        this.alerts.error(failureMessage('Could not run the checks', error), error);
      }
    } finally {
      if (sequence === this.runSequence) {
        this.running.set(false);
      }
    }
  }

  async applyFix(fix: DoctorFix, finding?: DoctorFinding): Promise<void> {
    if (this.fixing() !== null) {
      return;
    }
    const confirmed = await this.dialogs.confirm({
      title: fix.confirmTitle,
      message: fix.confirmMessage,
      items: fix.confirmItems,
      confirmLabel: fix.confirmLabel,
      tone: fix.tone,
    });
    if (!confirmed || this.destroyed) {
      return;
    }
    this.fixing.set(fix.key);
    try {
      const response = await this.api.post<unknown>(fix.path, { ...fix.payload });
      this.alerts.success(fix.success, response);
    } catch (error: unknown) {
      this.alerts.error(failureMessage(fix.failure, error), error);
      return;
    } finally {
      this.fixing.set(null);
    }
    if (!this.destroyed) {
      await this.run();
      this.restoreFocus(finding);
    }
  }

  /**
   * The fix button is gone after the re-run (or disabled during it), so move
   * focus to the same finding if it is still there, otherwise to the list.
   */
  private restoreFocus(finding: DoctorFinding | undefined): void {
    afterNextRender(
      () => {
        if (this.destroyed) {
          return;
        }
        const target =
          (finding ? this.document.getElementById(this.findingDomId(finding.id, 'title')) : null) ??
          this.document.getElementById('doctor-findings-title') ??
          this.document.getElementById('doctor-verdict-title');
        target?.focus({ preventScroll: false });
      },
      { injector: this.injector },
    );
  }

  viewRaw(): void {
    const raw = this.raw();
    if (raw === undefined) {
      return;
    }
    const report = this.report();
    const at = this.checkedAt();
    const subtitle = [report?.clusterName, at !== null ? formatTimestamp(at, { seconds: true }) : null]
      .filter((part): part is string => !!part)
      .join(' · ');
    this.dialogs.showJson('Cluster doctor report', raw, subtitle || undefined);
  }

  /** Opens the checks card and moves focus to it (from the "nothing to fix" state). */
  showChecks(): void {
    this.checksOpen.set(true);
    const toggle = this.document.getElementById('doctor-checks-toggle');
    toggle?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toggle?.focus({ preventScroll: true });
  }

  // ---- Filters ----

  toggleSeverity(severity: DoctorSeverity): void {
    const next = new Set(this.severityFilter());
    if (next.has(severity)) {
      next.delete(severity);
    } else {
      next.add(severity);
    }
    this.updateFilters(next, this.categoryFilter());
  }

  selectCategory(value: string): void {
    this.updateFilters(this.severityFilter(), parseCategoryParam(value));
  }

  resetFilters(): void {
    this.updateFilters(new Set(), null);
  }

  private updateFilters(severities: ReadonlySet<DoctorSeverity>, category: DoctorCategory | null): void {
    this.severityFilter.set(severities);
    this.categoryFilter.set(category);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { severity: severityParam(severities), category },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // ---- Template helpers ----

  /** Stable element id for a finding (`finding.id` may hold any character). */
  findingDomId(id: string, part: 'title' | 'resources'): string {
    return `finding-${part}-${id.replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 60)}-${hash(id)}`;
  }

  severityMeta(severity: DoctorSeverity): SeverityMeta {
    return SEVERITIES.find((meta) => meta.key === severity) ?? SEVERITIES[2]!;
  }

  categoryMeta(category: DoctorCategory): CategoryMeta {
    return CATEGORIES.find((meta) => meta.key === category) ?? CATEGORIES[0]!;
  }

  resourceIcon(resource: DoctorResource): string {
    return RESOURCE_ICONS[resource.kind];
  }

  linkParams(link: DoctorLink): Record<string, string | null> {
    return { ...this.connection.hostQuery(), ...(link.params ?? {}) };
  }

  visibleResources(finding: DoctorFinding): readonly DoctorResource[] {
    return this.expandedResources().has(finding.id) ? finding.resources : finding.resources.slice(0, RESOURCE_PREVIEW);
  }

  toggleResources(finding: DoctorFinding): void {
    this.expandedResources.update((current) => toggled(current, finding.id));
  }

  toggleIndicator(indicator: HealthIndicatorView): void {
    this.openIndicators.update((current) => toggled(current, indicator.name));
  }

  canExpand(indicator: HealthIndicatorView): boolean {
    return indicator.impacts.length > 0 || indicator.diagnoses.length > 0;
  }

  timestamp(milliseconds: number | null): string {
    return formatTimestamp(milliseconds, { seconds: true });
  }

  readonly statusLabel = healthLabel;
}

/** Short, stable hash (djb2) to keep sanitized ids unique. */
function hash(value: string): string {
  let result = 5381;
  for (let index = 0; index < value.length; index += 1) {
    result = ((result << 5) + result + value.charCodeAt(index)) | 0;
  }
  return (result >>> 0).toString(36);
}

function toggled(current: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}
