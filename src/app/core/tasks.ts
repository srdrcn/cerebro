import { elasticsearchReason } from './errors';
import { sentence } from './format';
import { isRecord } from './json';

/**
 * Why `POST _tasks/<id>/_cancel` did not cancel anything, or `null` when it
 * did. Elasticsearch answers 200 even then (an unknown or finished task, a
 * task that is not cancellable, a node that left); the reason sits in
 * `task_failures` / `node_failures`.
 */
export function cancelFailure(response: unknown): string | null {
  if (!isRecord(response)) {
    return null;
  }
  for (const key of ['task_failures', 'node_failures']) {
    const failures = response[key];
    if (Array.isArray(failures) && failures.length > 0) {
      const reason = elasticsearchReason(failures[0]);
      return reason ? sentence(reason) : 'Elasticsearch reported a failure while cancelling the task.';
    }
  }
  return null;
}
