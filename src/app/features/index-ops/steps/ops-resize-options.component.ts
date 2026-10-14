import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ConnectionService } from '../../../core/connection.service';
import { formatNumber, pluralize } from '../../../core/format';
import { BytesPipe, NumberPipe } from '../../../shared/format.pipes';
import { MeterComponent } from '../../../shared/meter.component';
import { CheckFix } from '../index-ops.models';
import { IndexOpsStore } from '../index-ops.store';
import { MAX_SHARDS_PER_INDEX, colocatedNodes, shrinkDiskNeed, suggestedShrinkNode, tierNote } from '../index-ops.utils';
import { OpsChecksComponent } from './ops-checks.component';

type ResizeField = 'target' | 'shards' | 'replicas' | 'aliases';

/** Step 3 of shrink, split and clone: preparation, target and checks. */
@Component({
  selector: 'cerebro-ops-resize-options',
  imports: [BytesPipe, MeterComponent, NumberPipe, OpsChecksComponent, RouterLink],
  templateUrl: './ops-resize-options.component.html',
  styleUrls: ['./ops-steps.css', './ops-resize-options.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OpsResizeOptionsComponent {
  readonly store = inject(IndexOpsStore);
  readonly connection = inject(ConnectionService);
  private readonly preparePanel = viewChild<ElementRef<HTMLElement>>('preparePanel');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly maxShards = MAX_SHARDS_PER_INDEX;
  private readonly touched = signal<ReadonlySet<ResizeField>>(new Set());

  readonly source = this.store.sourceIndex;
  readonly kind = computed(() => this.store.operation());

  /** The node the preparation gathers the copies on, once set. */
  readonly preparedOn = computed(() => this.source()?.requiredNode ?? null);
  /** A node that already holds every shard without a requirement. */
  readonly naturallyColocated = computed(() => {
    const source = this.source();
    return source && !source.requiredNode && source.primaries ? (colocatedNodes(source.shards, source.primaries)[0] ?? null) : null;
  });
  readonly suggestedNode = computed(() => {
    const options = this.store.nodeOptions();
    return options ? (suggestedShrinkNode(options)?.name ?? null) : null;
  });
  /** The tier the preference of the source places the shards on. */
  readonly tierNote = computed(() => {
    const source = this.source();
    const nodes = this.store.nodes();
    return source && nodes ? tierNote(source.tierPreference, nodes) : null;
  });
  readonly movingCopies = computed(() => {
    const source = this.source();
    const node = source?.requiredNode;
    return source && node ? source.shards.filter((copy) => copy.state === 'relocating' && copy.relocatingTo === node) : [];
  });
  /** A copy of the first shard missing on the required node, to explain in Shard allocation. */
  readonly stuckCopy = computed(() => {
    const source = this.source();
    const node = source?.requiredNode;
    if (!source || !node) {
      return null;
    }
    const here = new Set(source.shards.filter((copy) => copy.node === node && copy.state === 'started').map((copy) => copy.shard));
    return source.shards.find((copy) => !here.has(copy.shard) && copy.node) ?? null;
  });

  readonly explainParams = computed(() => {
    const copy = this.stuckCopy();
    const source = this.source();
    return copy && source
      ? { host: this.connection.host(), index: source.name, shard: String(copy.shard), primary: String(copy.primary), node: copy.node }
      : { host: this.connection.host() };
  });

  readonly prepareProgress = computed(() => {
    const state = this.store.colocation();
    return state ? (state.covered / Math.max(1, state.total)) * 100 : 0;
  });
  readonly customSelected = computed(() => {
    const shards = this.store.shards();
    return shards !== null && !this.store.shardOptions().includes(shards);
  });

  readonly shardsHint = computed(() => {
    const source = this.source();
    const primaries = source?.primaries ?? 0;
    switch (this.kind()) {
      case 'shrink':
        return primaries <= 1
          ? 'An index with one primary shard cannot be shrunk.'
          : `The target must have a number of shards that divides ${formatNumber(primaries)}.`;
      case 'split': {
        const routing = source?.routingShards;
        if (!routing || routing.origin === 'single-shard') {
          return 'An index with one shard can be split into any number of shards (up to 1,024).';
        }
        if (routing.origin === 'metadata') {
          return `Multiples of ${formatNumber(primaries)} that divide the ${formatNumber(routing.value)} routing shards of ${source?.name ?? 'the index'} (from the cluster state).`;
        }
        if (routing.origin === 'resized') {
          return `Multiples of ${formatNumber(primaries)} that divide ${formatNumber(routing.value)}: an estimate, since ${source?.name ?? 'the index'} keeps the routing shards of ${source?.resizedFrom ?? 'the index it was resized from'}.`;
        }
        return routing.origin === 'setting'
          ? `Multiples of ${formatNumber(primaries)} that divide index.number_of_routing_shards (${formatNumber(routing.value)}).`
          : `Multiples of ${formatNumber(primaries)} that divide ${formatNumber(routing.value)}, the routing shards Elasticsearch gives an index with ${pluralize(primaries, 'shard')} (index.number_of_routing_shards is not set explicitly).`;
      }
      default:
        return `A clone keeps the ${pluralize(primaries, 'primary shard')} of the source.`;
    }
  });

  diskNeed(node: string): number {
    const source = this.source();
    return source ? shrinkDiskNeed(source, node).need : 0;
  }

  showError(field: ResizeField): string | undefined {
    const error = this.store.fieldErrors()[field];
    return error && (this.store.submitted() || this.touched().has(field)) ? error : undefined;
  }

  private touch(field: ResizeField): void {
    this.store.touch();
    this.touched.update((fields) => new Set([...fields, field]));
  }

  setTarget(value: string): void {
    this.store.setTarget(value);
    this.touch('target');
  }

  pickShards(value: number): void {
    this.store.shards.set(value);
    this.store.customShards.set('');
    this.touch('shards');
  }

  setCustomShards(value: string): void {
    this.store.customShards.set(value);
    const text = value.trim();
    this.store.shards.set(/^\d+$/.test(text) ? Number(text) : text ? Number.NaN : null);
    this.touch('shards');
  }

  setReplicas(value: string): void {
    this.store.replicas.set(value);
    this.touch('replicas');
  }

  setAliases(value: string): void {
    this.store.aliasesText.set(value);
    this.touch('aliases');
  }

  setCompression(value: boolean): void {
    this.store.bestCompression.set(value);
    this.store.touch();
  }

  pickNode(name: string): void {
    this.store.prepareNode.set(name);
    this.store.touch();
  }

  /** The wizard blocked writes on this source (and may have pinned it): it can lift that again. */
  readonly canUndo = computed(() => !!this.store.ownChanges());

  async onFix(fix: CheckFix): Promise<void> {
    switch (fix) {
      case 'write-block':
        if (await this.store.blockWrites()) {
          this.focus('#ops-checks-title');
        }
        return;
      case 'open-index':
        if (await this.store.openSource()) {
          this.focus('#ops-checks-title');
        }
        return;
      case 'prepare': {
        const panel = this.preparePanel()?.nativeElement;
        panel?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        // The checked node first (the suggestion), else the first node, else the button.
        const target =
          panel?.querySelector<HTMLElement>('input[type="radio"]:checked') ??
          panel?.querySelector<HTMLElement>('input[type="radio"]:not(:disabled)') ??
          panel?.querySelector<HTMLElement>('button');
        target?.focus({ preventScroll: true });
        return;
      }
      default:
        return;
    }
  }

  async prepare(): Promise<void> {
    if (await this.store.prepareSource()) {
      this.focus('#ops-prepare-title');
    }
  }

  async undo(): Promise<void> {
    if (await this.store.releaseSource()) {
      this.focus(this.kind() === 'shrink' && this.preparePanel() ? '#ops-prepare-title' : '#ops-checks-title');
    }
  }

  /** Keeps the keyboard in place when the control that was used disappears. */
  private focus(selector: string): void {
    afterNextRender(
      () => {
        const element = this.host.nativeElement.querySelector<HTMLElement>(selector);
        if (element) {
          const top = element.getBoundingClientRect().top;
          element.focus({ preventScroll: top >= 0 && top < window.innerHeight });
        }
      },
      { injector: this.injector },
    );
  }

  checksBusy(): CheckFix | null {
    const busy = this.store.sourceBusy();
    return busy === 'write-block' ? 'write-block' : busy === 'open' ? 'open-index' : null;
  }

  diskLevelLabel(level: string | null): string | null {
    switch (level) {
      case 'low':
        return 'Past the low disk watermark: copies do not move here';
      case 'high':
        return 'Past the high disk watermark';
      case 'flood':
        return 'Past the flood-stage disk watermark';
      default:
        return null;
    }
  }
}
