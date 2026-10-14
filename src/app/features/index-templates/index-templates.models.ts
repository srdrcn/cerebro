/**
 * Shapes of the composable template APIs (`_index_template`,
 * `_component_template`, `_index_template/_simulate`) as returned by
 * Elasticsearch. Every field is optional on purpose: the page must cope with
 * older and newer versions and with hand written bodies.
 */

import { JsonRecord } from '../../core/json';

/** settings / mappings / aliases block of a template. */
export interface TemplateContent {
  readonly settings?: JsonRecord;
  readonly mappings?: JsonRecord;
  readonly aliases?: JsonRecord;
  readonly lifecycle?: JsonRecord;
  readonly [key: string]: unknown;
}

export interface IndexTemplateBody {
  readonly index_patterns?: string | readonly string[];
  readonly template?: TemplateContent;
  readonly composed_of?: readonly string[];
  readonly priority?: number;
  readonly version?: number;
  readonly _meta?: JsonRecord;
  readonly data_stream?: JsonRecord;
  readonly allow_auto_create?: boolean;
  readonly ignore_missing_component_templates?: readonly string[];
  readonly deprecated?: boolean;
  readonly [key: string]: unknown;
}

export interface ComponentTemplateBody {
  readonly template?: TemplateContent;
  readonly version?: number;
  readonly _meta?: JsonRecord;
  readonly deprecated?: boolean;
  readonly [key: string]: unknown;
}

export interface IndexTemplateEntry {
  readonly name: string;
  readonly index_template: IndexTemplateBody;
}

export interface ComponentTemplateEntry {
  readonly name: string;
  readonly component_template: ComponentTemplateBody;
}

export interface IndexTemplatesResponse {
  readonly index_templates?: readonly IndexTemplateEntry[];
}

export interface ComponentTemplatesResponse {
  readonly component_templates?: readonly ComponentTemplateEntry[];
}

export interface SimulateOverlap {
  readonly name: string;
  readonly index_patterns?: readonly string[];
}

export interface SimulateResponse {
  readonly template?: TemplateContent;
  readonly overlapping?: readonly SimulateOverlap[];
}

export type TemplateKind = 'index' | 'component';

/** One row of the template list (index or component template). */
export interface TemplateRow {
  readonly kind: TemplateKind;
  readonly name: string;
  readonly managed: boolean;
  readonly patterns: readonly string[];
  readonly priority: number | null;
  readonly version: number | null;
  readonly dataStream: boolean;
  readonly composedOf: readonly string[];
  /** Index templates that reference a component template. */
  readonly usedBy: readonly string[];
  /** "settings · mappings (4 fields)" for component templates. */
  readonly contents: string;
  readonly description: string | null;
}

export type ProblemLevel = 'error' | 'warning';

export interface BodyProblem {
  readonly level: ProblemLevel;
  readonly message: string;
}

export type BodyCheck =
  | { readonly ok: false; readonly message: string }
  | { readonly ok: true; readonly value: JsonRecord; readonly problems: readonly BodyProblem[] };

export interface SettingEntry {
  readonly key: string;
  readonly value: string;
}

export interface MappingField {
  readonly path: string;
  readonly type: string;
  /** Sub field of a multi-field (`fields`). */
  readonly multi: boolean;
  readonly runtime: boolean;
  readonly depth: number;
}

/** Where a resolved setting / field / alias comes from. */
export type Origin =
  | { readonly kind: 'component'; readonly name: string }
  | { readonly kind: 'self' }
  | { readonly kind: 'default' };

export interface ResolvedSetting extends SettingEntry {
  readonly origin: Origin;
}

export interface ResolvedField extends MappingField {
  readonly origin: Origin;
}

export interface AliasEntry {
  readonly name: string;
  readonly flags: readonly string[];
}

export interface ResolvedAlias extends AliasEntry {
  readonly origin: Origin;
}

export interface ResolvedView {
  readonly settings: readonly ResolvedSetting[];
  readonly fields: readonly ResolvedField[];
  readonly mappingOptions: readonly SettingEntry[];
  readonly aliases: readonly ResolvedAlias[];
  readonly overlapping: readonly { readonly name: string; readonly patterns: string }[];
  readonly lifecycle: string | null;
}

/** Starting point of a new composable index template. */
export const NEW_INDEX_TEMPLATE_BODY = JSON.stringify(
  {
    index_patterns: ['my-index-*'],
    priority: 100,
    composed_of: [],
    template: {
      settings: {
        number_of_shards: 1,
      },
      mappings: {
        properties: {},
      },
      aliases: {},
    },
    _meta: {
      description: 'What this template is for',
    },
  },
  null,
  2,
);

/** Starting point of a new component template. */
export const NEW_COMPONENT_TEMPLATE_BODY = JSON.stringify(
  {
    template: {
      settings: {},
      mappings: {
        properties: {},
      },
    },
    version: 1,
    _meta: {
      description: 'Reusable building block for index templates',
    },
  },
  null,
  2,
);
