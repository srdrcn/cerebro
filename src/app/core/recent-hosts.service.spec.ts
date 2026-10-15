import { TestBed } from '@angular/core/testing';
import {
  MAX_RECENT_HOSTS,
  RECENT_HOSTS_STORAGE_KEY,
  RecentHostsService,
} from './recent-hosts.service';

describe('RecentHostsService', () => {
  beforeEach(() => localStorage.clear());

  it('keeps the most recent hosts first without duplicates', () => {
    const service = TestBed.inject(RecentHostsService);
    service.remember('http://a:9200');
    service.remember('http://b:9200');
    service.remember('http://a:9200');

    expect(service.hosts()).toEqual(['http://a:9200', 'http://b:9200']);
    expect(JSON.parse(localStorage.getItem(RECENT_HOSTS_STORAGE_KEY) ?? '[]')).toEqual([
      'http://a:9200',
      'http://b:9200',
    ]);
  });

  it('caps the list and forgets hosts on request', () => {
    const service = TestBed.inject(RecentHostsService);
    for (let index = 0; index < MAX_RECENT_HOSTS + 2; index++) {
      service.remember(`http://node-${index}:9200`);
    }
    expect(service.hosts()).toHaveLength(MAX_RECENT_HOSTS);

    service.forget(`http://node-${MAX_RECENT_HOSTS + 1}:9200`);
    expect(service.hosts()).not.toContain(`http://node-${MAX_RECENT_HOSTS + 1}:9200`);
  });

  it('ignores malformed stored data', () => {
    localStorage.setItem(RECENT_HOSTS_STORAGE_KEY, '{"not":"a list"}');
    expect(TestBed.inject(RecentHostsService).hosts()).toEqual([]);
  });
});
