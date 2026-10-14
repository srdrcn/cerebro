/**
 * Responses captured from the demo cluster (Elasticsearch 8.15, three nodes)
 * through the Play endpoints the wizard calls, trimmed to the fields it reads.
 */
import {
  CatIndexRow,
  DataStreamsResponse,
  IndexDetailResponse,
  RawAliasRow,
  RawNode,
  ReindexStartResponse,
  ResizeResponse,
  RolloverResponse,
  TaskGetResponse,
} from './index-ops.models';

/** orders-v2: 4 primaries and 4 replicas spread so that no node holds every shard. */
export const DETAIL_SPREAD: IndexDetailResponse = {
  "settings": {
    "orders-v2": {
      "settings": {
        "index": {
          "number_of_shards": "4",
          "number_of_replicas": "1",
          "creation_date": "1791983838560",
          "version": {
            "created": "8512000"
          },
          "uuid": "Nn5PN7x9RWu-KFGj_7xvgw"
        }
      }
    }
  },
  "stats": {
    "indices": {
      "orders-v2": {
        "health": "green",
        "status": "open",
        "primaries": {
          "docs": {
            "count": 9000,
            "deleted": 0
          },
          "store": {
            "size_in_bytes": 537497
          }
        },
        "total": {
          "docs": {
            "count": 18000,
            "deleted": 0
          },
          "store": {
            "size_in_bytes": 1080311
          }
        }
      }
    }
  },
  "aliases": {
    "orders-v2": {
      "aliases": {
        "orders": {
          "index_routing": "1",
          "search_routing": "1,2"
        }
      }
    }
  },
  "shards": [
    {
      "index": "orders-v2",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "docs": "2301",
      "store": "142621",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "orders-v2",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "docs": "2301",
      "store": "137304",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "orders-v2",
      "shard": "1",
      "prirep": "r",
      "state": "STARTED",
      "docs": "2195",
      "store": "131482",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "orders-v2",
      "shard": "1",
      "prirep": "p",
      "state": "STARTED",
      "docs": "2195",
      "store": "131482",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "orders-v2",
      "shard": "2",
      "prirep": "r",
      "state": "STARTED",
      "docs": "2250",
      "store": "134340",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "orders-v2",
      "shard": "2",
      "prirep": "p",
      "state": "STARTED",
      "docs": "2250",
      "store": "134340",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "orders-v2",
      "shard": "3",
      "prirep": "p",
      "state": "STARTED",
      "docs": "2254",
      "store": "134371",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "orders-v2",
      "shard": "3",
      "prirep": "r",
      "state": "STARTED",
      "docs": "2254",
      "store": "134371",
      "node": "es-node-2",
      "unassigned.reason": null
    }
  ]
};

/** tmp-index-ops-src right after "Prepare source" on es-node-1: two replicas relocating there. */
export const DETAIL_RELOCATING: IndexDetailResponse = {
  "settings": {
    "tmp-index-ops-src": {
      "settings": {
        "index": {
          "number_of_shards": "4",
          "number_of_replicas": "1",
          "blocks": {
            "write": "true"
          },
          "routing": {
            "allocation": {
              "require": {
                "_name": "es-node-1"
              }
            }
          },
          "creation_date": "1792013276464",
          "version": {
            "created": "8512000"
          },
          "uuid": "O4v2ynbxTb6DO7Xj4jetsg"
        }
      }
    }
  },
  "stats": {
    "indices": {
      "tmp-index-ops-src": {
        "health": "green",
        "status": "open",
        "primaries": {
          "docs": {
            "count": 3000,
            "deleted": 0
          },
          "store": {
            "size_in_bytes": 122948
          }
        },
        "total": {
          "docs": {
            "count": 6000,
            "deleted": 0
          },
          "store": {
            "size_in_bytes": 252434
          }
        }
      }
    }
  },
  "aliases": {
    "tmp-index-ops-src": {
      "aliases": {}
    }
  },
  "shards": [
    {
      "index": "tmp-index-ops-src",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "docs": "779",
      "store": "34676",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "tmp-index-ops-src",
      "shard": "0",
      "prirep": "r",
      "state": "RELOCATING",
      "docs": "779",
      "store": "30159",
      "node": "es-node-2 -> 127.0.0.1 I7MELLk0RvSiAPhRW6211Q es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "tmp-index-ops-src",
      "shard": "1",
      "prirep": "r",
      "state": "STARTED",
      "docs": "766",
      "store": "41735",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "tmp-index-ops-src",
      "shard": "1",
      "prirep": "p",
      "state": "STARTED",
      "docs": "766",
      "store": "50810",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "tmp-index-ops-src",
      "shard": "2",
      "prirep": "r",
      "state": "STARTED",
      "docs": "764",
      "store": "29843",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "tmp-index-ops-src",
      "shard": "2",
      "prirep": "p",
      "state": "STARTED",
      "docs": "764",
      "store": "39664",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "tmp-index-ops-src",
      "shard": "3",
      "prirep": "p",
      "state": "STARTED",
      "docs": "691",
      "store": "32284",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "tmp-index-ops-src",
      "shard": "3",
      "prirep": "r",
      "state": "RELOCATING",
      "docs": "691",
      "store": "27749",
      "node": "es-node-2 -> 127.0.0.1 I7MELLk0RvSiAPhRW6211Q es-node-1",
      "unassigned.reason": null
    }
  ]
};

/** tmp-index-ops-src once prepared: write block, require._name es-node-1, a copy of every shard there. */
export const DETAIL_PREPARED: IndexDetailResponse = {
  "settings": {
    "tmp-index-ops-src": {
      "settings": {
        "index": {
          "number_of_shards": "4",
          "number_of_replicas": "1",
          "blocks": {
            "write": "true"
          },
          "routing": {
            "allocation": {
              "require": {
                "_name": "es-node-1"
              }
            }
          },
          "creation_date": "1792013276464",
          "version": {
            "created": "8512000"
          },
          "uuid": "O4v2ynbxTb6DO7Xj4jetsg"
        }
      }
    }
  },
  "stats": {
    "indices": {
      "tmp-index-ops-src": {
        "health": "green",
        "status": "open",
        "primaries": {
          "docs": {
            "count": 3000,
            "deleted": 0
          },
          "store": {
            "size_in_bytes": 157434
          }
        },
        "total": {
          "docs": {
            "count": 6000,
            "deleted": 0
          },
          "store": {
            "size_in_bytes": 256761
          }
        }
      }
    }
  },
  "aliases": {
    "tmp-index-ops-src": {
      "aliases": {}
    }
  },
  "shards": [
    {
      "index": "tmp-index-ops-src",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "docs": "779",
      "store": "34676",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "tmp-index-ops-src",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "docs": "779",
      "store": "0",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "tmp-index-ops-src",
      "shard": "1",
      "prirep": "r",
      "state": "STARTED",
      "docs": "766",
      "store": "41735",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "tmp-index-ops-src",
      "shard": "1",
      "prirep": "p",
      "state": "STARTED",
      "docs": "766",
      "store": "50810",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "tmp-index-ops-src",
      "shard": "2",
      "prirep": "r",
      "state": "STARTED",
      "docs": "764",
      "store": "29843",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "tmp-index-ops-src",
      "shard": "2",
      "prirep": "p",
      "state": "STARTED",
      "docs": "764",
      "store": "39664",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "tmp-index-ops-src",
      "shard": "3",
      "prirep": "p",
      "state": "STARTED",
      "docs": "691",
      "store": "32284",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "tmp-index-ops-src",
      "shard": "3",
      "prirep": "r",
      "state": "STARTED",
      "docs": "691",
      "store": "27749",
      "node": "es-node-1",
      "unassigned.reason": null
    }
  ]
};

/** tmp-index-ops-shrunk right after the shrink: primaries started on es-node-1, replicas unassigned. */
export const DETAIL_TARGET_INITIALIZING: IndexDetailResponse = {
  "settings": {
    "tmp-index-ops-shrunk": {
      "settings": {
        "index": {
          "number_of_shards": "2",
          "number_of_replicas": "1",
          "blocks": {
            "write": null
          },
          "routing": {
            "allocation": {
              "require": {
                "_name": null
              }
            }
          },
          "creation_date": "1792013337841",
          "version": {
            "created": "8512000"
          },
          "uuid": "3q9GgHHITtiYWDOCuaMktw"
        }
      }
    }
  },
  "stats": {
    "indices": {
      "tmp-index-ops-shrunk": {
        "health": "yellow",
        "status": "open",
        "primaries": {
          "docs": {
            "count": 3000,
            "deleted": 0
          },
          "store": {
            "size_in_bytes": 57316
          }
        },
        "total": {
          "docs": {
            "count": 3000,
            "deleted": 0
          },
          "store": {
            "size_in_bytes": 57316
          }
        }
      }
    }
  },
  "aliases": {
    "tmp-index-ops-shrunk": {
      "aliases": {}
    }
  },
  "shards": [
    {
      "index": "tmp-index-ops-shrunk",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "docs": "1545",
      "store": "0",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "tmp-index-ops-shrunk",
      "shard": "0",
      "prirep": "r",
      "state": "UNASSIGNED",
      "docs": null,
      "store": null,
      "node": null,
      "unassigned.reason": "INDEX_CREATED"
    },
    {
      "index": "tmp-index-ops-shrunk",
      "shard": "1",
      "prirep": "p",
      "state": "STARTED",
      "docs": "1455",
      "store": "0",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "tmp-index-ops-shrunk",
      "shard": "1",
      "prirep": "r",
      "state": "UNASSIGNED",
      "docs": null,
      "store": null,
      "node": null,
      "unassigned.reason": "INDEX_CREATED"
    }
  ]
};

/** `archive-2025,customers`: naming a closed index makes the stats call fail (stats null). */
export const DETAIL_CLOSED: IndexDetailResponse = {
  "settings": {
    "customers": {
      "settings": {
        "index": {
          "number_of_shards": "1",
          "number_of_replicas": "1",
          "creation_date": "1791983838383",
          "version": {
            "created": "8512000"
          },
          "uuid": "KXHd-7XAQh6o0EUziUB8xQ"
        }
      }
    },
    "archive-2025": {
      "settings": {
        "index": {
          "number_of_shards": "1",
          "number_of_replicas": "1",
          "creation_date": "1791983839172",
          "version": {
            "created": "8512000"
          },
          "verified_before_close": "true",
          "uuid": "_WtvSg0XSEaD5IHXNxszdg"
        }
      }
    }
  },
  "stats": null,
  "aliases": {
    "customers": {
      "aliases": {}
    },
    "archive-2025": {
      "aliases": {}
    }
  },
  "shards": [
    {
      "index": "archive-2025",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "docs": "700",
      "store": "27326",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "archive-2025",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "docs": "700",
      "store": "27326",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "customers",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "docs": "1800",
      "store": "137803",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "customers",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "docs": "1800",
      "store": "137803",
      "node": "es-node-1",
      "unassigned.reason": null
    }
  ]
};

/** tmp-index-ops-roll-000001, write index of the alias tmp-index-ops-roll, 5 documents. */
export const DETAIL_ROLLOVER_WRITE_INDEX: IndexDetailResponse = {
  "settings": {
    "tmp-index-ops-roll-000001": {
      "settings": {
        "index": {
          "number_of_shards": "1",
          "number_of_replicas": "1",
          "creation_date": "1792013319266",
          "version": {
            "created": "8512000"
          },
          "uuid": "Rj6DmnJBQvqPQQPmU4ojYA"
        }
      }
    }
  },
  "stats": {
    "indices": {
      "tmp-index-ops-roll-000001": {
        "health": "green",
        "status": "open",
        "primaries": {
          "docs": {
            "count": 5,
            "deleted": 0
          },
          "store": {
            "size_in_bytes": 7000
          }
        },
        "total": {
          "docs": {
            "count": 10,
            "deleted": 0
          },
          "store": {
            "size_in_bytes": 17278
          }
        }
      }
    }
  },
  "aliases": {
    "tmp-index-ops-roll-000001": {
      "aliases": {
        "tmp-index-ops-roll": {
          "is_write_index": true
        }
      }
    }
  },
  "shards": [
    {
      "index": "tmp-index-ops-roll-000001",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "docs": "5",
      "store": "6813",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "tmp-index-ops-roll-000001",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "docs": "5",
      "store": "10278",
      "node": "es-node-2",
      "unassigned.reason": null
    }
  ]
};

export const NODES: readonly RawNode[] = [
  {
    "id": "I7MELLk0RvSiAPhRW6211Q",
    "name": "es-node-1",
    "data": true,
    "disk": {
      "total": 270553174016,
      "available": 25116098560,
      "percent": 91
    }
  },
  {
    "id": "wEqTWTA0T2CktRBr56viXg",
    "name": "es-node-2",
    "data": true,
    "disk": {
      "total": 270553174016,
      "available": 25116098560,
      "percent": 91
    }
  },
  {
    "id": "dmdk_a7-TrKWtlTZ9-ZHzQ",
    "name": "es-node-3",
    "data": true,
    "disk": {
      "total": 270553174016,
      "available": 25116098560,
      "percent": 91
    }
  }
];

/** `aliases/get_aliases` (seed aliases plus tmp-index-ops-roll). */
export const ALIAS_ROWS: readonly RawAliasRow[] = [
  {
    "alias": "catalog",
    "index": "products",
    "is_write_index": null,
    "is_hidden": null
  },
  {
    "alias": "logs",
    "index": "logs-2026.10.13",
    "is_write_index": null,
    "is_hidden": null
  },
  {
    "alias": "logs",
    "index": "logs-2026.10.12",
    "is_write_index": null,
    "is_hidden": null
  },
  {
    "alias": "orders",
    "index": "orders-v2",
    "is_write_index": null,
    "is_hidden": null
  },
  {
    "alias": "tmp-index-ops-roll",
    "index": "tmp-index-ops-roll-000001",
    "is_write_index": true,
    "is_hidden": null
  },
  {
    "alias": "logs",
    "index": "logs-2026.10.14",
    "is_write_index": null,
    "is_hidden": null
  },
  {
    "alias": "logs-current",
    "index": "logs-2026.10.14",
    "is_write_index": null,
    "is_hidden": null
  }
];

export const DATA_STREAMS: DataStreamsResponse = {
  "data_streams": [
    {
      "name": ".logs-deprecation.elasticsearch-default",
      "indices": [
        {
          "index_name": ".ds-.logs-deprecation.elasticsearch-default-2026.10.14-000001"
        }
      ],
      "hidden": true,
      "system": false,
      "status": "GREEN"
    },
    {
      "name": "app-events-web",
      "indices": [
        {
          "index_name": ".ds-app-events-web-2026.10.14-000001"
        },
        {
          "index_name": ".ds-app-events-web-2026.10.14-000002"
        }
      ],
      "hidden": false,
      "system": false,
      "status": "GREEN"
    },
    {
      "name": "app-events-worker",
      "indices": [
        {
          "index_name": ".ds-app-events-worker-2026.10.14-000001"
        }
      ],
      "hidden": false,
      "system": false,
      "status": "GREEN"
    },
    {
      "name": "ilm-history-7",
      "indices": [
        {
          "index_name": ".ds-ilm-history-7-2026.10.14-000001"
        }
      ],
      "hidden": true,
      "system": false,
      "status": "GREEN"
    }
  ]
};

/** Dry run of tmp-index-ops-roll with all five conditions (max_docs 3 met). */
export const ROLLOVER_DRY_RUN: RolloverResponse = {
  "acknowledged": false,
  "shards_acknowledged": false,
  "old_index": "tmp-index-ops-roll-000001",
  "new_index": "tmp-index-ops-roll-000002",
  "rolled_over": false,
  "dry_run": true,
  "lazy": false,
  "conditions": {
    "[max_docs: 3]": true,
    "[max_primary_shard_size: 1gb]": false,
    "[max_size: 5gb]": false,
    "[max_primary_shard_docs: 100]": false,
    "[max_age: 7d]": false
  }
};

export const ROLLOVER_DATA_STREAM_DRY_RUN: RolloverResponse = {
  "acknowledged": false,
  "shards_acknowledged": false,
  "old_index": ".ds-app-events-web-2026.10.14-000002",
  "new_index": ".ds-app-events-web-2026.10.14-000003",
  "rolled_over": false,
  "dry_run": true,
  "lazy": false,
  "conditions": {
    "[max_docs: 1000]": false
  }
};

export const RESIZE_RESPONSE: ResizeResponse = {
  "acknowledged": true,
  "shards_acknowledged": true,
  "index": "tmp-index-ops-shrunk"
};

export const REINDEX_STARTED: ReindexStartResponse = {
  "task": "I7MELLk0RvSiAPhRW6211Q:96204"
};

/** Reindex of tmp-index-ops-src throttled to 500 docs/s, 1.5s in. */
export const TASK_RUNNING: TaskGetResponse = {
  "completed": false,
  "task": {
    "node": "I7MELLk0RvSiAPhRW6211Q",
    "id": 96204,
    "type": "transport",
    "action": "indices:data/write/reindex",
    "status": {
      "total": 3000,
      "updated": 0,
      "created": 600,
      "deleted": 0,
      "batches": 3,
      "version_conflicts": 0,
      "noops": 0,
      "retries": {
        "bulk": 0,
        "search": 0
      },
      "throttled_millis": 799,
      "requests_per_second": 500,
      "throttled_until_millis": 393
    },
    "description": "reindex from [tmp-index-ops-src] to [tmp-index-ops-dst]",
    "start_time_in_millis": 1792013282574,
    "running_time_in_nanos": 1567137901,
    "cancellable": true,
    "cancelled": false,
    "headers": {}
  }
};

export const TASK_DONE: TaskGetResponse = {
  "completed": true,
  "task": {
    "node": "I7MELLk0RvSiAPhRW6211Q",
    "id": 96204,
    "type": "transport",
    "action": "indices:data/write/reindex",
    "status": {
      "total": 3000,
      "updated": 0,
      "created": 3000,
      "deleted": 0,
      "batches": 15,
      "version_conflicts": 0,
      "noops": 0,
      "retries": {
        "bulk": 0,
        "search": 0
      },
      "throttled_millis": 5999,
      "requests_per_second": 500,
      "throttled_until_millis": 0
    },
    "description": "reindex from [tmp-index-ops-src] to [tmp-index-ops-dst]",
    "start_time_in_millis": 1792013282574,
    "running_time_in_nanos": 7135296131,
    "cancellable": true,
    "cancelled": false,
    "headers": {}
  },
  "response": {
    "took": 7134,
    "timed_out": false,
    "total": 3000,
    "updated": 0,
    "created": 3000,
    "deleted": 0,
    "batches": 15,
    "version_conflicts": 0,
    "noops": 0,
    "retries": {
      "bulk": 0,
      "search": 0
    },
    "throttled": "5.9s",
    "throttled_millis": 5999,
    "requests_per_second": 500,
    "throttled_until": "0s",
    "throttled_until_millis": 0,
    "failures": []
  }
};

/** op_type create into an index that has the documents: aborted on version conflicts (failures trimmed to 2). */
export const TASK_CONFLICTS: TaskGetResponse = {
  "completed": true,
  "task": {
    "node": "I7MELLk0RvSiAPhRW6211Q",
    "id": 96412,
    "type": "transport",
    "action": "indices:data/write/reindex",
    "status": {
      "total": 3000,
      "updated": 0,
      "created": 0,
      "deleted": 0,
      "batches": 1,
      "version_conflicts": 1000,
      "noops": 0,
      "retries": {
        "bulk": 0,
        "search": 0
      },
      "throttled_millis": 0,
      "requests_per_second": -1,
      "throttled_until_millis": 0
    },
    "description": "reindex from [tmp-index-ops-src] to [tmp-index-ops-dst]",
    "start_time_in_millis": 1792013298882,
    "running_time_in_nanos": 85417133,
    "cancellable": true,
    "cancelled": false,
    "headers": {}
  },
  "response": {
    "took": 84,
    "timed_out": false,
    "total": 3000,
    "updated": 0,
    "created": 0,
    "deleted": 0,
    "batches": 1,
    "version_conflicts": 1000,
    "noops": 0,
    "retries": {
      "bulk": 0,
      "search": 0
    },
    "throttled": "0s",
    "throttled_millis": 0,
    "requests_per_second": -1,
    "throttled_until": "0s",
    "throttled_until_millis": 0,
    "failures": [
      {
        "index": "tmp-index-ops-dst",
        "id": "11",
        "cause": {
          "type": "version_conflict_engine_exception",
          "reason": "[11]: version conflict, document already exists (current version [1])",
          "index_uuid": "ZYQu0eNbRsWN7BiJYLpNvg",
          "shard": "0",
          "index": "tmp-index-ops-dst"
        },
        "status": 409
      },
      {
        "index": "tmp-index-ops-dst",
        "id": "5",
        "cause": {
          "type": "version_conflict_engine_exception",
          "reason": "[5]: version conflict, document already exists (current version [1])",
          "index_uuid": "ZYQu0eNbRsWN7BiJYLpNvg",
          "shard": "0",
          "index": "tmp-index-ops-dst"
        },
        "status": 409
      }
    ]
  }
};

/** slices=auto, 2s in: the parent only reports finished slices (none yet). */
export const TASK_SLICED_RUNNING: TaskGetResponse = {
  "completed": false,
  "task": {
    "node": "I7MELLk0RvSiAPhRW6211Q",
    "id": 96433,
    "type": "transport",
    "action": "indices:data/write/reindex",
    "status": {
      "total": 0,
      "updated": 0,
      "created": 0,
      "deleted": 0,
      "batches": 0,
      "version_conflicts": 0,
      "noops": 0,
      "retries": {
        "bulk": 0,
        "search": 0
      },
      "throttled_millis": 0,
      "requests_per_second": 0,
      "throttled_until_millis": 0,
      "slices": [
        null,
        null,
        null,
        null
      ]
    },
    "description": "reindex from [tmp-index-ops-src] to [tmp-index-ops-dst2]",
    "start_time_in_millis": 1792013302043,
    "running_time_in_nanos": 2119136724,
    "cancellable": true,
    "cancelled": false,
    "headers": {}
  }
};

/** The sliced reindex after tasks/cancel. */
export const TASK_CANCELLED: TaskGetResponse = {
  "completed": true,
  "task": {
    "node": "I7MELLk0RvSiAPhRW6211Q",
    "id": 96433,
    "type": "transport",
    "action": "indices:data/write/reindex",
    "status": {
      "total": 3000,
      "updated": 0,
      "created": 800,
      "deleted": 0,
      "batches": 8,
      "version_conflicts": 0,
      "noops": 0,
      "retries": {
        "bulk": 0,
        "search": 0
      },
      "throttled_millis": 5333,
      "requests_per_second": -1,
      "canceled": "by user request",
      "throttled_until_millis": 0,
      "slices": [
        {
          "slice_id": 0,
          "total": 779,
          "updated": 0,
          "created": 200,
          "deleted": 0,
          "batches": 2,
          "version_conflicts": 0,
          "noops": 0,
          "retries": {
            "bulk": 0,
            "search": 0
          },
          "throttled_millis": 1333,
          "requests_per_second": -1,
          "canceled": "by user request",
          "throttled_until_millis": 0
        },
        {
          "slice_id": 1,
          "total": 766,
          "updated": 0,
          "created": 200,
          "deleted": 0,
          "batches": 2,
          "version_conflicts": 0,
          "noops": 0,
          "retries": {
            "bulk": 0,
            "search": 0
          },
          "throttled_millis": 1333,
          "requests_per_second": -1,
          "canceled": "by user request",
          "throttled_until_millis": 0
        },
        {
          "slice_id": 2,
          "total": 764,
          "updated": 0,
          "created": 200,
          "deleted": 0,
          "batches": 2,
          "version_conflicts": 0,
          "noops": 0,
          "retries": {
            "bulk": 0,
            "search": 0
          },
          "throttled_millis": 1333,
          "requests_per_second": -1,
          "canceled": "by user request",
          "throttled_until_millis": 0
        },
        {
          "slice_id": 3,
          "total": 691,
          "updated": 0,
          "created": 200,
          "deleted": 0,
          "batches": 2,
          "version_conflicts": 0,
          "noops": 0,
          "retries": {
            "bulk": 0,
            "search": 0
          },
          "throttled_millis": 1333,
          "requests_per_second": -1,
          "canceled": "by user request",
          "throttled_until_millis": 0
        }
      ]
    },
    "description": "reindex from [tmp-index-ops-src] to [tmp-index-ops-dst2]",
    "start_time_in_millis": 1792013302043,
    "running_time_in_nanos": 2163505128,
    "cancellable": true,
    "cancelled": false,
    "headers": {}
  },
  "response": {
    "took": 2115,
    "timed_out": false,
    "total": 3000,
    "updated": 0,
    "created": 800,
    "deleted": 0,
    "batches": 8,
    "version_conflicts": 0,
    "noops": 0,
    "retries": {
      "bulk": 0,
      "search": 0
    },
    "throttled": "5.3s",
    "throttled_millis": 5333,
    "requests_per_second": -1,
    "canceled": "by user request",
    "throttled_until": "0s",
    "throttled_until_millis": 0,
    "slices": [
      {
        "slice_id": 0,
        "total": 779,
        "updated": 0,
        "created": 200,
        "deleted": 0,
        "batches": 2,
        "version_conflicts": 0,
        "noops": 0,
        "retries": {
          "bulk": 0,
          "search": 0
        },
        "throttled": "1.3s",
        "throttled_millis": 1333,
        "requests_per_second": -1,
        "canceled": "by user request",
        "throttled_until": "0s",
        "throttled_until_millis": 0
      },
      {
        "slice_id": 1,
        "total": 766,
        "updated": 0,
        "created": 200,
        "deleted": 0,
        "batches": 2,
        "version_conflicts": 0,
        "noops": 0,
        "retries": {
          "bulk": 0,
          "search": 0
        },
        "throttled": "1.3s",
        "throttled_millis": 1333,
        "requests_per_second": -1,
        "canceled": "by user request",
        "throttled_until": "0s",
        "throttled_until_millis": 0
      },
      {
        "slice_id": 2,
        "total": 764,
        "updated": 0,
        "created": 200,
        "deleted": 0,
        "batches": 2,
        "version_conflicts": 0,
        "noops": 0,
        "retries": {
          "bulk": 0,
          "search": 0
        },
        "throttled": "1.3s",
        "throttled_millis": 1333,
        "requests_per_second": -1,
        "canceled": "by user request",
        "throttled_until": "0s",
        "throttled_until_millis": 0
      },
      {
        "slice_id": 3,
        "total": 691,
        "updated": 0,
        "created": 200,
        "deleted": 0,
        "batches": 2,
        "version_conflicts": 0,
        "noops": 0,
        "retries": {
          "bulk": 0,
          "search": 0
        },
        "throttled": "1.3s",
        "throttled_millis": 1333,
        "requests_per_second": -1,
        "canceled": "by user request",
        "throttled_until": "0s",
        "throttled_until_millis": 0
      }
    ],
    "failures": []
  }
};

/** `cluster_settings` (flat, with defaults), trimmed to the disk settings: the demo cluster turns the watermarks off. */
export const CLUSTER_SETTINGS_DISK = {
  "persistent": {},
  "transient": {},
  "defaults": {
    "cluster.routing.allocation.disk.threshold_enabled": "false",
    "cluster.routing.allocation.disk.watermark.flood_stage": "95%",
    "cluster.routing.allocation.disk.watermark.flood_stage.max_headroom": "100GB",
    "cluster.routing.allocation.disk.watermark.high": "90%",
    "cluster.routing.allocation.disk.watermark.high.max_headroom": "150GB",
    "cluster.routing.allocation.disk.watermark.low": "85%",
    "cluster.routing.allocation.disk.watermark.low.max_headroom": "200GB"
  }
};

/** `cat` with `indices/logs-*,metrics-app,archive-2025,app-events-web` (human sizes; a closed index has no counts). */
export const CAT_INDICES: readonly CatIndexRow[] = [
  { "health": "green", "status": "open", "index": "logs-2026.10.13", "pri": "3", "rep": "1", "docs.count": "9956", "docs.deleted": "0", "store.size": "3.1mb", "pri.store.size": "1.5mb" },
  { "health": "green", "status": "open", "index": "metrics-app", "pri": "1", "rep": "0", "docs.count": "2500", "docs.deleted": "0", "store.size": "194.2kb", "pri.store.size": "194.2kb" },
  { "health": "green", "status": "close", "index": "archive-2025", "pri": "1", "rep": "1", "docs.count": null, "docs.deleted": null, "store.size": null, "pri.store.size": null },
  { "health": "green", "status": "open", "index": ".ds-app-events-web-2026.10.14-000002", "pri": "1", "rep": "1", "docs.count": "0", "docs.deleted": "0", "store.size": "498b", "pri.store.size": "249b" },
  { "health": "green", "status": "open", "index": ".kibana-demo", "pri": "1", "rep": "1", "docs.count": "0", "docs.deleted": "0", "store.size": "498b", "pri.store.size": "249b" }
];

/** `cat` with `shards/orders-v2`, first rows (human store sizes). */
export const CAT_SHARDS: readonly Record<string, unknown>[] = [
  { "index": "orders-v2", "shard": "0", "prirep": "r", "state": "STARTED", "docs": "2301", "store": "139.2kb", "dataset": "139.2kb", "ip": "127.0.0.1", "node": "es-node-3" },
  { "index": "orders-v2", "shard": "0", "prirep": "p", "state": "STARTED", "docs": "2301", "store": "134kb", "dataset": "134kb", "ip": "127.0.0.1", "node": "es-node-2" },
  { "index": "orders-v2", "shard": "1", "prirep": "p", "state": "RELOCATING", "docs": "2205", "store": "130kb", "dataset": "130kb", "ip": "127.0.0.1", "node": "es-node-2 -> 127.0.0.1 I7MELLk0RvSiAPhRW6211Q es-node-1" },
  { "index": "orders-v2", "shard": "1", "prirep": "r", "state": "UNASSIGNED", "docs": null, "store": null, "dataset": null, "ip": null, "node": null }
];

/**
 * `.ds-app-events-web-2026.10.14-000001`: a backing index after the stream rolled over (hidden, managed by ILM).
 * The write block was added for the checks; stats and shards are trimmed.
 */
export const DETAIL_BACKING_INDEX: IndexDetailResponse = {
  "settings": {
    ".ds-app-events-web-2026.10.14-000001": {
      "settings": {
        "index": {
          "lifecycle": { "name": "app-events-policy", "indexing_complete": "true" },
          "routing": { "allocation": { "include": { "_tier_preference": "data_hot" } } },
          "hidden": "true",
          "number_of_shards": "1",
          "provided_name": ".ds-app-events-web-2026.10.14-000001",
          "creation_date": "1791994121486",
          "priority": "100",
          "number_of_replicas": "1",
          "uuid": "oCcsEaP_SA2FaVURCEsC_g",
          "version": { "created": "8512000" },
          "blocks": { "write": "true" }
        }
      }
    }
  },
  "stats": {
    "indices": {
      ".ds-app-events-web-2026.10.14-000001": {
        "health": "green",
        "status": "open",
        "primaries": { "docs": { "count": 3, "deleted": 0 }, "store": { "size_in_bytes": 14950 } },
        "total": { "docs": { "count": 6, "deleted": 0 }, "store": { "size_in_bytes": 20582 } }
      }
    }
  },
  "aliases": { ".ds-app-events-web-2026.10.14-000001": { "aliases": {} } },
  "shards": [
    { "index": ".ds-app-events-web-2026.10.14-000001", "shard": "0", "prirep": "p", "state": "STARTED", "docs": "3", "store": "14950", "node": "es-node-2" },
    { "index": ".ds-app-events-web-2026.10.14-000001", "shard": "0", "prirep": "r", "state": "STARTED", "docs": "3", "store": "5632", "node": "es-node-1" }
  ]
};

/** `tasks/get` of a task whose node left the cluster (the 404 body). */
export const TASK_LOST_ERROR = {
  "error": {
    "root_cause": [{ "type": "resource_not_found_exception", "reason": "task [abc:1] isn't running and hasn't stored its results" }],
    "type": "resource_not_found_exception",
    "reason": "task [abc:1] belongs to the node [abc] which isn't part of the cluster and there is no record of the task",
    "caused_by": { "type": "resource_not_found_exception", "reason": "task [abc:1] isn't running and hasn't stored its results" }
  },
  "status": 404
};
