export interface NodesNode {
  readonly id: string;
  readonly current_master: boolean;
  readonly name: string;
  readonly host: string | null;
  readonly master: boolean;
  readonly data: boolean;
  readonly ingest: boolean;
  readonly coordinating: boolean;
  readonly cpu: {
    readonly load: number | null;
    readonly process: number | null;
    readonly os: number | null;
  };
  readonly heap: {
    readonly percent: number;
    readonly used: string;
    readonly max: string;
  };
  readonly disk: {
    readonly percent: number;
    readonly available: number;
    readonly total: number;
  } | null;
  readonly uptime: number;
  readonly jvm: string | null;
  readonly version: string;
  readonly attributes: Readonly<Record<string, unknown>>;
}

export interface NodesFilter {
  readonly name: string;
  readonly master: boolean;
  readonly data: boolean;
  readonly ingest: boolean;
  readonly coordinating: boolean;
}

export type NodeSortField =
  | 'name'
  | 'cpu.load'
  | 'cpu.process'
  | 'heap.percent'
  | 'disk.percent'
  | 'uptime';
