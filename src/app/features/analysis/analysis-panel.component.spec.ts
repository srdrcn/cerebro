import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from '../../core/alert.service';
import { ClusterApiError } from '../../core/api-envelope';
import { ClusterApiService } from '../../core/cluster-api.service';
import { DialogService } from '../../core/dialog.service';
import { AnalysisPanelComponent } from './analysis-panel.component';
import { AnalysisMode } from './analysis.models';

describe('AnalysisPanelComponent', () => {
  const post = vi.fn();
  const alerts = { error: vi.fn() };
  const dialogs = { showJson: vi.fn() };

  beforeEach(() => {
    post.mockReset();
    alerts.error.mockReset();
    dialogs.showJson.mockReset();
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [AnalysisPanelComponent],
      providers: [
        { provide: ClusterApiService, useValue: { post } },
        { provide: AlertService, useValue: alerts },
        { provide: DialogService, useValue: dialogs },
      ],
    });
  });

  afterEach(() => localStorage.clear());

  async function create(
    mode: AnalysisMode,
    indices: readonly string[] = ['products', 'logs'],
  ): Promise<ComponentFixture<AnalysisPanelComponent>> {
    const fixture = TestBed.createComponent(AnalysisPanelComponent);
    fixture.componentRef.setInput('mode', mode);
    fixture.componentRef.setInput('indices', indices);
    await fixture.whenStable();
    return fixture;
  }

  it('loads the fields of the selected index and analyzes by field', async () => {
    const fixture = await create('field');
    const panel = fixture.componentInstance;
    post.mockResolvedValueOnce(['title']);

    panel.selectIndex('products');
    await fixture.whenStable();

    expect(post).toHaveBeenCalledWith('analysis/fields', { index: 'products' });
    // A single field is preselected.
    expect(panel.target()).toBe('title');

    post.mockResolvedValueOnce([
      { token: 'wireless', position: 0, start_offset: 0, end_offset: 8, type: '<ALPHANUM>' },
    ]);
    panel.text.set('Wireless');
    await panel.analyze();
    await fixture.whenStable();

    expect(post).toHaveBeenLastCalledWith('analysis/analyze/field', {
      index: 'products',
      field: 'title',
      text: 'Wireless',
    });
    expect(panel.run()?.tokens.map((token) => token.token)).toEqual(['wireless']);
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelectorAll('.token-chip')).toHaveLength(1);
    expect(element.querySelector('.token-table tbody th')?.textContent?.trim()).toBe('wireless');
  });

  it('defaults the analyzer to standard and sends the analyzer parameter', async () => {
    const fixture = await create('analyzer');
    const panel = fixture.componentInstance;
    post.mockResolvedValueOnce([]);

    panel.selectIndex('logs');
    await fixture.whenStable();
    expect(post).toHaveBeenCalledWith('analysis/analyzers', { index: 'logs' });
    expect(panel.target()).toBe('standard');

    post.mockResolvedValueOnce([]);
    panel.text.set('the');
    await panel.analyze();

    expect(post).toHaveBeenLastCalledWith('analysis/analyze/analyzer', {
      index: 'logs',
      analyzer: 'standard',
      text: 'the',
    });
    expect(panel.run()?.tokens).toEqual([]);
  });

  it('validates the form instead of sending an incomplete request', async () => {
    const fixture = await create('field');
    const panel = fixture.componentInstance;

    await panel.analyze();
    await fixture.whenStable();

    expect(post).not.toHaveBeenCalled();
    expect(panel.submitted()).toBe(true);
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelectorAll('.field-error').length).toBeGreaterThan(0);
  });

  it('shows the Elasticsearch reason when the analysis fails', async () => {
    const fixture = await create('analyzer');
    const panel = fixture.componentInstance;
    post.mockResolvedValueOnce(['my_analyzer']);
    panel.selectIndex('products');
    await fixture.whenStable();

    post.mockRejectedValueOnce(
      new ClusterApiError(400, { error: { reason: 'failed to find analyzer [x]' } }),
    );
    panel.text.set('x');
    await panel.analyze();

    expect(panel.runError()).toBe('Failed to find analyzer [x]');
    expect(panel.run()).toBeNull();
    expect(alerts.error).toHaveBeenCalledOnce();
  });

  it('ignores options of an index that is no longer selected', async () => {
    const fixture = await create('field');
    const panel = fixture.componentInstance;
    let resolveSlow: (value: unknown) => void = () => undefined;
    post.mockImplementationOnce(() => new Promise((resolve) => (resolveSlow = resolve)));
    post.mockResolvedValueOnce(['message']);

    panel.selectIndex('products');
    panel.selectIndex('logs');
    await fixture.whenStable();
    resolveSlow(['title']);
    await fixture.whenStable();

    expect(panel.index()).toBe('logs');
    expect(panel.options()).toEqual(['message']);
  });

  it('remembers the index and field but never the text', async () => {
    const fixture = await create('field');
    const panel = fixture.componentInstance;
    post.mockResolvedValueOnce(['description', 'title']);
    panel.selectIndex('products');
    await fixture.whenStable();
    panel.target.set('title');
    panel.text.set('secret');
    await fixture.whenStable();

    const stored = localStorage.getItem('cerebro.analysis.field') ?? '';
    expect(JSON.parse(stored)).toEqual({ index: 'products', target: 'title' });
    expect(stored).not.toContain('secret');

    // A new panel restores the selection once the indices are known.
    post.mockResolvedValueOnce(['description', 'title']);
    const restored = await create('field');
    await restored.whenStable();
    expect(restored.componentInstance.index()).toBe('products');
    expect(restored.componentInstance.target()).toBe('title');
    expect(restored.componentInstance.text()).toBe('');
  });

  it('keeps the remembered field when its index fails to list its fields', async () => {
    localStorage.setItem('cerebro.analysis.field', JSON.stringify({ index: 'products', target: 'title' }));
    post.mockRejectedValueOnce(new ClusterApiError(500, { error: 'kaput' }));

    const fixture = await create('field');
    const panel = fixture.componentInstance;
    await fixture.whenStable();

    expect(panel.index()).toBe('products');
    expect(panel.optionsFailed()).toBe(true);
    expect(JSON.parse(localStorage.getItem('cerebro.analysis.field') ?? 'null')).toEqual({
      index: 'products',
      target: 'title',
    });

    // Trying again still restores the remembered field.
    post.mockResolvedValueOnce(['description', 'title']);
    panel.retryOptions();
    await fixture.whenStable();
    expect(panel.target()).toBe('title');
  });

  it('keeps a remembered custom analyzer while only built-in analyzers are available', async () => {
    localStorage.setItem(
      'cerebro.analysis.analyzer',
      JSON.stringify({ index: 'products', target: 'my_shingle' }),
    );
    post.mockRejectedValueOnce(new Error('offline'));

    const fixture = await create('analyzer');
    const panel = fixture.componentInstance;
    await fixture.whenStable();

    // Built-in analyzers still work, the custom choice stays remembered.
    expect(panel.target()).toBe('standard');
    expect(JSON.parse(localStorage.getItem('cerebro.analysis.analyzer') ?? 'null')).toEqual({
      index: 'products',
      target: 'my_shingle',
    });

    // Choosing another analyzer replaces the remembered one.
    panel.selectTarget('english');
    await fixture.whenStable();
    expect(JSON.parse(localStorage.getItem('cerebro.analysis.analyzer') ?? 'null')).toEqual({
      index: 'products',
      target: 'english',
    });
  });

  it('announces only a summary of the outcome', async () => {
    const fixture = await create('analyzer');
    const panel = fixture.componentInstance;
    post.mockResolvedValueOnce([]);
    panel.selectIndex('logs');
    await fixture.whenStable();

    post.mockResolvedValueOnce([
      { token: 'quick', position: 0, start_offset: 0, end_offset: 5 },
      { token: 'fox', position: 1, start_offset: 6, end_offset: 9 },
    ]);
    panel.text.set('quick fox');
    await panel.analyze();
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement;
    const status = element.querySelector('p[role="status"]');
    expect(status?.textContent?.trim()).toBe('2 tokens for logs › standard');
    expect(element.querySelector('.analysis-results')?.hasAttribute('aria-live')).toBe(false);
  });
});
