import { TestBed } from '@angular/core/testing';
import { AlertService } from './alert.service';
import { ClipboardService } from './clipboard.service';

describe('ClipboardService', () => {
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(
    Navigator.prototype,
    'clipboard',
  );
  const execCommandDescriptor = Object.getOwnPropertyDescriptor(
    Document.prototype,
    'execCommand',
  );

  afterEach(() => {
    if (clipboardDescriptor) {
      Object.defineProperty(Navigator.prototype, 'clipboard', clipboardDescriptor);
    } else {
      Reflect.deleteProperty(Navigator.prototype, 'clipboard');
    }
    if (execCommandDescriptor) {
      Object.defineProperty(Document.prototype, 'execCommand', execCommandDescriptor);
    } else {
      delete (Document.prototype as Partial<Document>).execCommand;
    }
    document.querySelectorAll('textarea[aria-hidden="true"]').forEach((node) =>
      node.remove(),
    );
  });

  it('uses the modern Clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(Navigator.prototype, 'clipboard', {
      configurable: true,
      get: () => ({ writeText }),
    });
    const execCommand = vi.fn();
    Object.defineProperty(Document.prototype, 'execCommand', {
      configurable: true,
      value: execCommand,
    });

    const copied = await TestBed.inject(ClipboardService).copy('cluster data');

    expect(copied).toBe(true);
    expect(writeText).toHaveBeenCalledWith('cluster data');
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('falls back to a temporary textarea when the modern API is absent', async () => {
    Reflect.deleteProperty(Navigator.prototype, 'clipboard');
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(Document.prototype, 'execCommand', {
      configurable: true,
      value: execCommand,
    });

    const copied = await TestBed.inject(ClipboardService).copy('request body');

    expect(copied).toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea[aria-hidden="true"]')).toBeNull();
  });

  it('reports failure and always removes the fallback textarea', async () => {
    Reflect.deleteProperty(Navigator.prototype, 'clipboard');
    Object.defineProperty(Document.prototype, 'execCommand', {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    });
    const success = vi.fn();
    const failure = vi.fn();

    const copied = await TestBed.inject(ClipboardService).copy(
      'request body',
      success,
      failure,
    );

    expect(copied).toBe(false);
    expect(success).not.toHaveBeenCalled();
    expect(failure).toHaveBeenCalledOnce();
    expect(document.querySelector('textarea[aria-hidden="true"]')).toBeNull();
  });

  describe('copyAndNotify', () => {
    const success = vi.fn();
    const error = vi.fn();

    beforeEach(() => {
      success.mockClear();
      error.mockClear();
      TestBed.configureTestingModule({
        providers: [{ provide: AlertService, useValue: { success, error } }],
      });
    });

    it('reports a copy with the shared wording', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(Navigator.prototype, 'clipboard', {
        configurable: true,
        get: () => ({ writeText }),
      });

      const service = TestBed.inject(ClipboardService);
      await expect(service.copyAndNotify('http://localhost:9200', 'host address')).resolves.toBe(true);
      await service.copyAndNotify('curl -XGET', 'cURL command');

      expect(writeText).toHaveBeenCalledWith('http://localhost:9200');
      expect(success.mock.calls.map(([message]) => message)).toEqual([
        'Host address copied to the clipboard',
        'cURL command copied to the clipboard',
      ]);
      expect(error).not.toHaveBeenCalled();
    });

    it('reports a failure with its reason', async () => {
      const failure = new Error('Document is not focused');
      Object.defineProperty(Navigator.prototype, 'clipboard', {
        configurable: true,
        get: () => ({ writeText: vi.fn().mockRejectedValue(failure) }),
      });

      const copied = await TestBed.inject(ClipboardService).copyAndNotify('{}', 'JSON document');

      expect(copied).toBe(false);
      expect(success).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(
        'Could not copy the JSON document: Document is not focused',
        failure,
      );
    });
  });
});
