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
        label: 'Shard allocation',
        route: '/allocation',
        icon: 'bi-signpost-split',
        description: 'Why a shard is unassigned or where it can move',
        keywords: 'allocation explain unassigned yellow red diagnose',
      },
      {
        label: 'Tasks',
        route: '/tasks',
        icon: 'bi-activity',
        description: 'Running tasks such as reindex and force merge',
        keywords: 'tasks running cancel reindex merge jobs',
      },
      {
        label: 'Recoveries',
        route: '/recovery',
        icon: 'bi-arrow-repeat',
        description: 'Live progress of shard recoveries',
        keywords: 'recovery relocation replica restore progress',
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
        label: 'Index details',
        route: '/index_detail',
        icon: 'bi-box',
        description: 'Settings, mappings, stats, shards and aliases of an index',
        keywords: 'index detail mapping stats shards inspect',
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
        route: '/index_templates',
        icon: 'bi-layers',
        description: 'Composable index templates and component templates',
        keywords: 'template composable component patterns mappings data stream',
      },
      {
        label: 'Legacy templates',
        route: '/templates',
        icon: 'bi-file-earmark-code',
        description: 'Legacy index templates (_template)',
        keywords: 'template legacy patterns mappings',
      },
      {
        label: 'Data streams',
        route: '/data_streams',
        icon: 'bi-water',
        description: 'Data streams and their backing indices',
        keywords: 'data stream rollover backing time series logs',
      },
      {
        label: 'Lifecycle policies',
        route: '/ilm',
        icon: 'bi-hourglass-split',
        description: 'Index lifecycle management (ILM) policies',
        keywords: 'ilm lifecycle policy hot warm cold delete rollover',
      },
      {
        label: 'Ingest pipelines',
        route: '/pipelines',
        icon: 'bi-funnel',
        description: 'Ingest pipelines and simulation',
        keywords: 'ingest pipeline processors simulate grok',
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
