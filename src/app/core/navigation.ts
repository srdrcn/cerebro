/**
 * Single source of truth for the application's sections. The sidebar, the
 * breadcrumb and the command palette are all generated from this list.
 */
export interface NavigationItem {
  readonly label: string;
  readonly route: string;
  readonly icon: string;
  readonly description: string;
  /** Extra words the command palette should match. */
  readonly keywords?: string;
}

export interface NavigationGroup {
  readonly label: string;
  readonly items: readonly NavigationItem[];
}

export const NAVIGATION: readonly NavigationGroup[] = [
  {
    label: 'Cluster',
    items: [
      {
        label: 'Overview',
        route: '/overview',
        icon: 'bi-grid-1x2',
        description: 'Indices, nodes and shard allocation',
        keywords: 'home shards allocation health dashboard',
      },
      {
        label: 'Nodes',
        route: '/nodes',
        icon: 'bi-hdd-stack',
        description: 'Resource usage of every node',
        keywords: 'heap cpu disk load jvm servers',
      },
      {
        label: 'Cluster settings',
        route: '/cluster_settings',
        icon: 'bi-sliders',
        description: 'Persistent and transient cluster settings',
        keywords: 'configuration routing allocation',
      },
    ],
  },
  {
    label: 'Indices',
    items: [
      {
        label: 'Create index',
        route: '/create',
        icon: 'bi-plus-square',
        description: 'Create a new index',
        keywords: 'new add mappings',
      },
      {
        label: 'Aliases',
        route: '/aliases',
        icon: 'bi-tags',
        description: 'Manage index aliases',
        keywords: 'alias routing filter',
      },
      {
        label: 'Index templates',
        route: '/templates',
        icon: 'bi-file-earmark-code',
        description: 'Legacy index templates',
        keywords: 'template patterns mappings',
      },
      {
        label: 'Index settings',
        route: '/index_settings',
        icon: 'bi-gear',
        description: 'Edit the settings of an index',
        keywords: 'replicas refresh interval',
      },
    ],
  },
  {
    label: 'Snapshots',
    items: [
      {
        label: 'Snapshots',
        route: '/snapshot',
        icon: 'bi-camera',
        description: 'Create, restore and delete snapshots',
        keywords: 'backup restore',
      },
      {
        label: 'Repositories',
        route: '/repository',
        icon: 'bi-database',
        description: 'Snapshot repositories',
        keywords: 'fs s3 gcs azure hdfs url backup',
      },
    ],
  },
  {
    label: 'Tools',
    items: [
      {
        label: 'REST console',
        route: '/rest',
        icon: 'bi-terminal',
        description: 'Send requests to the cluster',
        keywords: 'api query search curl request',
      },
      {
        label: 'Analysis',
        route: '/analysis',
        icon: 'bi-text-paragraph',
        description: 'Inspect analyzers and tokens',
        keywords: 'analyzer tokenizer tokens field',
      },
      {
        label: 'CAT APIs',
        route: '/cat',
        icon: 'bi-table',
        description: 'Tabular cluster information',
        keywords: 'cat shards allocation recovery thread pool segments',
      },
    ],
  },
];

export const NAVIGATION_ITEMS: readonly NavigationItem[] = NAVIGATION.flatMap(
  (group) => group.items,
);

export function navigationItemFor(url: string): NavigationItem | undefined {
  const path = url.split(/[?#]/, 1)[0] ?? '';
  return NAVIGATION_ITEMS.find((item) => item.route === path);
}
