import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import {
  readJsonPreference,
  readPreference,
  removePreference,
  writePreference,
} from '../../core/preferences';
import type {
  ImportOutcome,
  ImportStrategy,
  SavedRequest,
  StoredSavedRequests,
} from './rest-saved.models';
import {
  applyImport,
  parseSavedList,
  duplicateSaved,
  findSaved,
  markSavedUsed,
  parseStoredSavedRequests,
  removeSaved,
  renameSaved,
  sameName,
  savedFromDraft,
  storedDocument,
  upsertSaved,
} from './rest-saved.utils';
import type { RestDraft } from './rest.models';

/** Saved requests are global: one list per browser, for every cluster. */
export const SAVED_REQUESTS_KEY = 'cerebro.rest-saved';
/** Name of the saved request the editor was loaded from. */
export const SAVED_LINK_KEY = 'cerebro.rest.saved-link';

/**
 * Saved requests of the REST console, kept in localStorage. Every write
 * returns whether the browser actually stored it (storage can be full or
 * disabled) so the page can warn instead of silently losing a request.
 * Provided by the REST console.
 */
@Injectable()
export class RestSavedStore {
  private readonly destroyRef = inject(DestroyRef);

  private readonly initial = this.read();
  private readonly state = signal<readonly SavedRequest[]>(this.initial.requests);
  private readonly newerVersion = signal<number | null>(this.initial.newerVersion);
  private readonly linkState = signal<string | null>(readPreference(SAVED_LINK_KEY));

  /**
   * A newer Cerebro stored the saved requests: they can be used, but changes
   * are kept on this page only so that nothing this version does not know
   * about is lost.
   */
  readonly readOnly = computed(() => this.newerVersion() !== null);
  /** Why a change was not stored (shown under the warning). */
  readonly notStoredDetail = computed(() =>
    this.readOnly()
      ? `The saved requests were stored by a newer version of Cerebro (format version ${this.newerVersion()}). This version does not change them so that nothing is lost: the change is gone when the page is reloaded.`
      : 'Local storage is full or disabled: the change is lost when the page is reloaded.',
  );

  /** Every saved request, in storage order. */
  readonly requests = this.state.asReadonly();
  readonly count = computed(() => this.state().length);
  /** The saved request the editor was loaded from (or last saved as). */
  readonly linked = computed(() => findSaved(this.state(), this.linkState()) ?? null);

  constructor() {
    // Keep several open consoles in step.
    const view = globalThis.window;
    const onStorage = (event: StorageEvent) => {
      if (event.key === SAVED_REQUESTS_KEY || event.key === null) {
        const stored = this.read();
        this.state.set(stored.requests);
        this.newerVersion.set(stored.newerVersion);
      }
    };
    view?.addEventListener?.('storage', onStorage);
    this.destroyRef.onDestroy(() => view?.removeEventListener?.('storage', onStorage));
  }

  find(name: string): SavedRequest | undefined {
    return findSaved(this.state(), name);
  }

  /** Saves the draft under `name` (replacing a request with that name) and links it. */
  save(name: string, draft: RestDraft, now = Date.now()): { saved: SavedRequest; stored: boolean } {
    const previous = this.find(name);
    const saved = savedFromDraft(name, draft, now, previous);
    const stored = this.commit(upsertSaved(this.state(), saved));
    this.link(saved.name);
    return { saved, stored };
  }

  rename(from: string, to: string, now = Date.now()): boolean {
    const wasLinked = this.isLinked(from);
    const stored = this.commit(renameSaved(this.state(), from, to, now));
    if (wasLinked) {
      this.link(this.find(to)?.name ?? null);
    }
    return stored;
  }

  duplicate(name: string, now = Date.now()): { copy: SavedRequest | null; stored: boolean } {
    const result = duplicateSaved(this.state(), name, now);
    return { copy: result.copy, stored: result.copy ? this.commit(result.requests) : true };
  }

  remove(name: string): boolean {
    if (this.isLinked(name)) {
      this.link(null);
    }
    return this.commit(removeSaved(this.state(), name));
  }

  markUsed(name: string, now = Date.now()): boolean {
    return this.commit(markSavedUsed(this.state(), name, now));
  }

  import(
    incoming: readonly SavedRequest[],
    strategy: ImportStrategy,
    now = Date.now(),
  ): { outcome: ImportOutcome; stored: boolean } {
    const outcome = applyImport(this.state(), incoming, strategy, now);
    const changed = outcome.added + outcome.overwritten > 0;
    return { outcome, stored: changed ? this.commit(outcome.requests) : true };
  }

  link(name: string | null): void {
    this.linkState.set(name);
    if (name === null) {
      removePreference(SAVED_LINK_KEY);
    } else {
      writePreference(SAVED_LINK_KEY, name);
    }
  }

  isLinked(name: string): boolean {
    const linked = this.linked();
    return linked !== null && sameName(linked.name, name);
  }

  private read(): StoredSavedRequests {
    return parseStoredSavedRequests(readJsonPreference<unknown>(SAVED_REQUESTS_KEY, null), Date.now());
  }

  /**
   * Updates the list and stores it. Returns false when the browser did not
   * keep it: storage full or disabled, a document written by a newer version
   * (left untouched), or an entry that would be dropped when read back
   * (which is refused rather than written and silently lost later).
   */
  private commit(next: readonly SavedRequest[]): boolean {
    this.state.set(next);
    if (this.readOnly()) {
      return false;
    }
    const document = storedDocument(next);
    if (parseSavedList(document.requests, Date.now()).requests.length !== next.length) {
      return false;
    }
    return writePreference(SAVED_REQUESTS_KEY, JSON.stringify(document));
  }
}
