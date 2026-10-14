import { isRecord } from './json';

/**
 * Built-in templates installed by Elasticsearch, Fleet or Kibana: system
 * names (".") and everything that carries `_meta.managed: true`. Shared by the
 * legacy, index and component template pages, which hide them by default
 * behind a "Show managed templates" switch.
 */
export function isManagedTemplate(name: string, meta: unknown): boolean {
  return name.startsWith('.') || (isRecord(meta) && meta['managed'] === true);
}
