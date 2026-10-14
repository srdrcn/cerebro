/**
 * `POST doctor` answer of the demo cluster (Elasticsearch 8.15.3, 3 data
 * nodes, disks ~91% full with disk-based allocation disabled in
 * elasticsearch.yml), captured live with tmp-doctor- conditions in place and
 * trimmed: node stats keep fs/jvm/breakers, cluster settings keep the disk,
 * shard limit and allocation defaults, ILM explain drops `phase_execution`.
 *
 * Conditions: tmp-doctor-ro (read_only_allow_delete), tmp-doctor-write (write
 * block), tmp-doctor-norep and metrics-app (0 replicas), tmp-doctor-overflow
 * (4 replicas) and overflow-test (3 replicas), tmp-doctor-ilm-1 (ILM ERROR in
 * attempt-rollover), tmp-doctor-shards (3 tiny primaries).
 */
export const LIVE_REPORT: Record<string, any> = {
  "health": {
    "cluster_name": "cerebro-demo",
    "status": "yellow",
    "timed_out": false,
    "number_of_nodes": 3,
    "number_of_data_nodes": 3,
    "active_primary_shards": 44,
    "active_shards": 92,
    "relocating_shards": 0,
    "initializing_shards": 0,
    "unassigned_shards": 4,
    "delayed_unassigned_shards": 0,
    "number_of_pending_tasks": 0,
    "number_of_in_flight_fetch": 0,
    "task_max_waiting_in_queue_millis": 0,
    "active_shards_percent_as_number": 95.83333333333334
  },
  "info": {
    "name": "es-node-1",
    "cluster_name": "cerebro-demo",
    "version": {
      "number": "8.15.3",
      "build_flavor": "default"
    }
  },
  "nodes": {
    "_nodes": {
      "total": 3,
      "successful": 3,
      "failed": 0
    },
    "cluster_name": "cerebro-demo",
    "nodes": {
      "I7MELLk0RvSiAPhRW6211Q": {
        "name": "es-node-1",
        "roles": [
          "data",
          "data_cold",
          "data_content",
          "data_frozen",
          "data_hot",
          "data_warm",
          "ingest",
          "master",
          "ml",
          "remote_cluster_client",
          "transform"
        ],
        "fs": {
          "total": {
            "total": "251.9gb",
            "total_in_bytes": 270553174016,
            "free": "236.5gb",
            "free_in_bytes": 254043799552,
            "available": "23.5gb",
            "available_in_bytes": 25314484224
          },
          "data": [
            {
              "path": "/usr/share/elasticsearch/data",
              "total_in_bytes": 270553174016,
              "free_in_bytes": 254043799552,
              "available_in_bytes": 25314484224,
              "low_watermark_free_space_in_bytes": 40582976102,
              "high_watermark_free_space_in_bytes": 27055317401,
              "flood_stage_free_space_in_bytes": 13527658700
            }
          ]
        },
        "jvm": {
          "uptime_in_millis": 14961820,
          "mem": {
            "heap_used_in_bytes": 174799424,
            "heap_used_percent": 41,
            "heap_max_in_bytes": 419430400
          },
          "gc": {
            "collectors": {
              "young": {
                "collection_count": 91,
                "collection_time": "1.2s",
                "collection_time_in_millis": 1298
              },
              "G1 Concurrent GC": {
                "collection_count": 42,
                "collection_time": "516ms",
                "collection_time_in_millis": 516
              },
              "old": {
                "collection_count": 0,
                "collection_time": "0s",
                "collection_time_in_millis": 0
              }
            }
          }
        },
        "breakers": {
          "inflight_requests": {
            "limit_size_in_bytes": 419430400,
            "estimated_size_in_bytes": 0,
            "tripped": 0
          },
          "request": {
            "limit_size_in_bytes": 251658240,
            "estimated_size_in_bytes": 0,
            "tripped": 0
          },
          "fielddata": {
            "limit_size_in_bytes": 167772160,
            "estimated_size_in_bytes": 0,
            "tripped": 0
          },
          "parent": {
            "limit_size_in_bytes": 398458880,
            "estimated_size_in_bytes": 174799424,
            "tripped": 0
          }
        }
      },
      "dmdk_a7-TrKWtlTZ9-ZHzQ": {
        "name": "es-node-3",
        "roles": [
          "data",
          "data_cold",
          "data_content",
          "data_frozen",
          "data_hot",
          "data_warm",
          "ingest",
          "master",
          "ml",
          "remote_cluster_client",
          "transform"
        ],
        "fs": {
          "total": {
            "total": "251.9gb",
            "total_in_bytes": 270553174016,
            "free": "236.5gb",
            "free_in_bytes": 254043799552,
            "available": "23.5gb",
            "available_in_bytes": 25314484224
          },
          "data": [
            {
              "path": "/usr/share/elasticsearch/data",
              "total_in_bytes": 270553174016,
              "free_in_bytes": 254043799552,
              "available_in_bytes": 25314484224,
              "low_watermark_free_space_in_bytes": 40582976102,
              "high_watermark_free_space_in_bytes": 27055317401,
              "flood_stage_free_space_in_bytes": 13527658700
            }
          ]
        },
        "jvm": {
          "uptime_in_millis": 14961759,
          "mem": {
            "heap_used_in_bytes": 298588784,
            "heap_used_percent": 71,
            "heap_max_in_bytes": 419430400
          },
          "gc": {
            "collectors": {
              "young": {
                "collection_count": 62,
                "collection_time": "870ms",
                "collection_time_in_millis": 870
              },
              "G1 Concurrent GC": {
                "collection_count": 10,
                "collection_time": "139ms",
                "collection_time_in_millis": 139
              },
              "old": {
                "collection_count": 0,
                "collection_time": "0s",
                "collection_time_in_millis": 0
              }
            }
          }
        },
        "breakers": {
          "fielddata": {
            "limit_size_in_bytes": 167772160,
            "estimated_size_in_bytes": 0,
            "tripped": 0
          },
          "request": {
            "limit_size_in_bytes": 251658240,
            "estimated_size_in_bytes": 0,
            "tripped": 0
          },
          "inflight_requests": {
            "limit_size_in_bytes": 419430400,
            "estimated_size_in_bytes": 64,
            "tripped": 0
          },
          "parent": {
            "limit_size_in_bytes": 398458880,
            "estimated_size_in_bytes": 298588784,
            "tripped": 0
          }
        }
      },
      "wEqTWTA0T2CktRBr56viXg": {
        "name": "es-node-2",
        "roles": [
          "data",
          "data_cold",
          "data_content",
          "data_frozen",
          "data_hot",
          "data_warm",
          "ingest",
          "master",
          "ml",
          "remote_cluster_client",
          "transform"
        ],
        "fs": {
          "total": {
            "total": "251.9gb",
            "total_in_bytes": 270553174016,
            "free": "236.5gb",
            "free_in_bytes": 254043799552,
            "available": "23.5gb",
            "available_in_bytes": 25314484224
          },
          "data": [
            {
              "path": "/usr/share/elasticsearch/data",
              "total_in_bytes": 270553174016,
              "free_in_bytes": 254043799552,
              "available_in_bytes": 25314484224,
              "low_watermark_free_space_in_bytes": 40582976102,
              "high_watermark_free_space_in_bytes": 27055317401,
              "flood_stage_free_space_in_bytes": 13527658700
            }
          ]
        },
        "jvm": {
          "uptime_in_millis": 14961870,
          "mem": {
            "heap_used_in_bytes": 133722464,
            "heap_used_percent": 31,
            "heap_max_in_bytes": 419430400
          },
          "gc": {
            "collectors": {
              "young": {
                "collection_count": 88,
                "collection_time": "1.1s",
                "collection_time_in_millis": 1111
              },
              "G1 Concurrent GC": {
                "collection_count": 42,
                "collection_time": "607ms",
                "collection_time_in_millis": 607
              },
              "old": {
                "collection_count": 0,
                "collection_time": "0s",
                "collection_time_in_millis": 0
              }
            }
          }
        },
        "breakers": {
          "inflight_requests": {
            "limit_size_in_bytes": 419430400,
            "estimated_size_in_bytes": 64,
            "tripped": 0
          },
          "request": {
            "limit_size_in_bytes": 251658240,
            "estimated_size_in_bytes": 0,
            "tripped": 0
          },
          "fielddata": {
            "limit_size_in_bytes": 167772160,
            "estimated_size_in_bytes": 0,
            "tripped": 0
          },
          "parent": {
            "limit_size_in_bytes": 398458880,
            "estimated_size_in_bytes": 133722464,
            "tripped": 0
          }
        }
      }
    }
  },
  "settings": {
    "persistent": {},
    "transient": {},
    "defaults": {
      "cluster.max_shards_per_node": "1000",
      "cluster.max_shards_per_node.frozen": "3000",
      "cluster.routing.allocation.balance.disk_usage": "2.0E-11",
      "cluster.routing.allocation.disk.reroute_interval": "60s",
      "cluster.routing.allocation.disk.threshold_enabled": "false",
      "cluster.routing.allocation.disk.watermark.enable_for_single_data_node": "true",
      "cluster.routing.allocation.disk.watermark.flood_stage": "95%",
      "cluster.routing.allocation.disk.watermark.flood_stage.frozen": "95%",
      "cluster.routing.allocation.disk.watermark.flood_stage.frozen.max_headroom": "20GB",
      "cluster.routing.allocation.disk.watermark.flood_stage.max_headroom": "100GB",
      "cluster.routing.allocation.disk.watermark.high": "90%",
      "cluster.routing.allocation.disk.watermark.high.max_headroom": "150GB",
      "cluster.routing.allocation.disk.watermark.low": "85%",
      "cluster.routing.allocation.disk.watermark.low.max_headroom": "200GB",
      "cluster.routing.allocation.enable": "all",
      "node.bandwidth.recovery.disk.read": "-1",
      "node.bandwidth.recovery.disk.write": "-1",
      "xpack.ml.min_disk_space_off_heap": "5gb"
    }
  },
  "indices": [
    {
      "index": ".ds-app-events-web-2026.10.14-000002",
      "health": "green",
      "status": "open",
      "pri": "1",
      "rep": "1",
      "docs.count": "0",
      "store.size": "498",
      "pri.store.size": "249"
    },
    {
      "index": ".ds-app-events-web-2026.10.14-000001",
      "health": "green",
      "status": "open",
      "pri": "1",
      "rep": "1",
      "docs.count": "3",
      "store.size": "20607",
      "pri.store.size": "15016"
    },
    {
      "index": "orders-v2",
      "health": "green",
      "status": "open",
      "pri": "4",
      "rep": "1",
      "docs.count": "9000",
      "store.size": "1080311",
      "pri.store.size": "537497"
    },
    {
      "index": "products",
      "health": "green",
      "status": "open",
      "pri": "2",
      "rep": "2",
      "docs.count": "4200",
      "store.size": "2338014",
      "pri.store.size": "779338"
    },
    {
      "index": ".ds-ilm-history-7-2026.10.14-000001",
      "health": "green",
      "status": "open",
      "pri": "1",
      "rep": "1",
      "docs.count": "69",
      "store.size": "319714",
      "pri.store.size": "163910"
    },
    {
      "index": "archive-2025",
      "health": "green",
      "status": "close",
      "pri": "1",
      "rep": "1",
      "docs.count": null,
      "store.size": null,
      "pri.store.size": null
    },
    {
      "index": ".ds-app-events-worker-2026.10.14-000001",
      "health": "green",
      "status": "open",
      "pri": "1",
      "rep": "1",
      "docs.count": "3",
      "store.size": "11155",
      "pri.store.size": "5572"
    },
    {
      "index": "audit-trail",
      "health": "green",
      "status": "open",
      "pri": "2",
      "rep": "1",
      "docs.count": "3000",
      "store.size": "268064",
      "pri.store.size": "134032"
    },
    {
      "index": "tmp-doctor-overflow",
      "health": "yellow",
      "status": "open",
      "pri": "1",
      "rep": "4",
      "docs.count": "0",
      "store.size": "681",
      "pri.store.size": "227"
    },
    {
      "index": ".tasks",
      "health": "green",
      "status": "open",
      "pri": "1",
      "rep": "1",
      "docs.count": "5",
      "store.size": "80426",
      "pri.store.size": "40213"
    },
    {
      "index": "tmp-doctor-write",
      "health": "green",
      "status": "open",
      "pri": "1",
      "rep": "1",
      "docs.count": "0",
      "store.size": "454",
      "pri.store.size": "227"
    },
    {
      "index": ".kibana-demo",
      "health": "green",
      "status": "open",
      "pri": "1",
      "rep": "1",
      "docs.count": "0",
      "store.size": "498",
      "pri.store.size": "249"
    },
    {
      "index": "tmp-doctor-ilm-1",
      "health": "green",
      "status": "open",
      "pri": "1",
      "rep": "1",
      "docs.count": "0",
      "store.size": "454",
      "pri.store.size": "227"
    },
    {
      "index": ".ds-.logs-deprecation.elasticsearch-default-2026.10.14-000001",
      "health": "green",
      "status": "open",
      "pri": "1",
      "rep": "1",
      "docs.count": "7",
      "store.size": "149883",
      "pri.store.size": "74936"
    },
    {
      "index": "metrics-app",
      "health": "green",
      "status": "open",
      "pri": "1",
      "rep": "0",
      "docs.count": "2500",
      "store.size": "198960",
      "pri.store.size": "198960"
    },
    {
      "index": "logs-2026.10.14",
      "health": "green",
      "status": "open",
      "pri": "3",
      "rep": "1",
      "docs.count": "7725",
      "store.size": "2586534",
      "pri.store.size": "1293267"
    },
    {
      "index": "search-sessions",
      "health": "green",
      "status": "open",
      "pri": "5",
      "rep": "1",
      "docs.count": "0",
      "store.size": "2490",
      "pri.store.size": "1245"
    },
    {
      "index": "logs-2026.10.12",
      "health": "green",
      "status": "open",
      "pri": "3",
      "rep": "1",
      "docs.count": "8513",
      "store.size": "2883775",
      "pri.store.size": "1463406"
    },
    {
      "index": "tmp-doctor-norep",
      "health": "green",
      "status": "open",
      "pri": "1",
      "rep": "0",
      "docs.count": "0",
      "store.size": "227",
      "pri.store.size": "227"
    },
    {
      "index": "logs-2026.10.13",
      "health": "green",
      "status": "open",
      "pri": "3",
      "rep": "1",
      "docs.count": "9956",
      "store.size": "3298756",
      "pri.store.size": "1649378"
    },
    {
      "index": "customers",
      "health": "green",
      "status": "open",
      "pri": "1",
      "rep": "1",
      "docs.count": "1800",
      "store.size": "275606",
      "pri.store.size": "137803"
    },
    {
      "index": "overflow-test",
      "health": "yellow",
      "status": "open",
      "pri": "2",
      "rep": "3",
      "docs.count": "0",
      "store.size": "1494",
      "pri.store.size": "498"
    },
    {
      "index": "tmp-demo-reindex",
      "health": "green",
      "status": "open",
      "pri": "1",
      "rep": "1",
      "docs.count": "9956",
      "store.size": "3181424",
      "pri.store.size": "1577989"
    },
    {
      "index": "tmp-doctor-ro",
      "health": "green",
      "status": "open",
      "pri": "1",
      "rep": "1",
      "docs.count": "0",
      "store.size": "454",
      "pri.store.size": "227"
    },
    {
      "index": "tmp-doctor-shards",
      "health": "green",
      "status": "open",
      "pri": "3",
      "rep": "1",
      "docs.count": "0",
      "store.size": "1362",
      "pri.store.size": "681"
    },
    {
      "index": "inventory",
      "health": "green",
      "status": "open",
      "pri": "1",
      "rep": "2",
      "docs.count": "1200",
      "store.size": "203757",
      "pri.store.size": "67919"
    }
  ],
  "shards": [
    {
      "index": "tmp-doctor-ro",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "store": "227",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "tmp-doctor-ro",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "store": "227",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "orders-v2",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "store": "142621",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "orders-v2",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "store": "137304",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "orders-v2",
      "shard": "1",
      "prirep": "r",
      "state": "STARTED",
      "store": "131482",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "orders-v2",
      "shard": "1",
      "prirep": "p",
      "state": "STARTED",
      "store": "131482",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "orders-v2",
      "shard": "2",
      "prirep": "r",
      "state": "STARTED",
      "store": "134340",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "orders-v2",
      "shard": "2",
      "prirep": "p",
      "state": "STARTED",
      "store": "134340",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "orders-v2",
      "shard": "3",
      "prirep": "p",
      "state": "STARTED",
      "store": "134371",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "orders-v2",
      "shard": "3",
      "prirep": "r",
      "state": "STARTED",
      "store": "134371",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": ".ds-app-events-worker-2026.10.14-000001",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "store": "5572",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": ".ds-app-events-worker-2026.10.14-000001",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "store": "5583",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "archive-2025",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "store": "27326",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "archive-2025",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "store": "27326",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": ".kibana-demo",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "store": "249",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": ".kibana-demo",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "store": "249",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "tmp-demo-reindex",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "store": "1603435",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "tmp-demo-reindex",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "store": "1577989",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "logs-2026.10.12",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "store": "483690",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "logs-2026.10.12",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "store": "466488",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "logs-2026.10.12",
      "shard": "1",
      "prirep": "p",
      "state": "STARTED",
      "store": "494708",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "logs-2026.10.12",
      "shard": "1",
      "prirep": "r",
      "state": "STARTED",
      "store": "482810",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "logs-2026.10.12",
      "shard": "2",
      "prirep": "r",
      "state": "STARTED",
      "store": "471071",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "logs-2026.10.12",
      "shard": "2",
      "prirep": "p",
      "state": "STARTED",
      "store": "485008",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": ".ds-app-events-web-2026.10.14-000001",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "store": "15016",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": ".ds-app-events-web-2026.10.14-000001",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "store": "5591",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "logs-2026.10.13",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "store": "547112",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "logs-2026.10.13",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "store": "547112",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "logs-2026.10.13",
      "shard": "1",
      "prirep": "r",
      "state": "STARTED",
      "store": "554277",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "logs-2026.10.13",
      "shard": "1",
      "prirep": "p",
      "state": "STARTED",
      "store": "554277",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "logs-2026.10.13",
      "shard": "2",
      "prirep": "p",
      "state": "STARTED",
      "store": "547989",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "logs-2026.10.13",
      "shard": "2",
      "prirep": "r",
      "state": "STARTED",
      "store": "547989",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "audit-trail",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "store": "66822",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "audit-trail",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "store": "66822",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "audit-trail",
      "shard": "1",
      "prirep": "p",
      "state": "STARTED",
      "store": "67210",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "audit-trail",
      "shard": "1",
      "prirep": "r",
      "state": "STARTED",
      "store": "67210",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": ".ds-ilm-history-7-2026.10.14-000001",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "store": "163910",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": ".ds-ilm-history-7-2026.10.14-000001",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "store": "155804",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "tmp-doctor-write",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "store": "227",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "tmp-doctor-write",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "store": "227",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "logs-2026.10.14",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "store": "425201",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "logs-2026.10.14",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "store": "425201",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "logs-2026.10.14",
      "shard": "1",
      "prirep": "p",
      "state": "STARTED",
      "store": "431088",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "logs-2026.10.14",
      "shard": "1",
      "prirep": "r",
      "state": "STARTED",
      "store": "431088",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "logs-2026.10.14",
      "shard": "2",
      "prirep": "p",
      "state": "STARTED",
      "store": "436978",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "logs-2026.10.14",
      "shard": "2",
      "prirep": "r",
      "state": "STARTED",
      "store": "436978",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "tmp-doctor-overflow",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "store": "227",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "tmp-doctor-overflow",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "store": "227",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "tmp-doctor-overflow",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "store": "227",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "tmp-doctor-overflow",
      "shard": "0",
      "prirep": "r",
      "state": "UNASSIGNED",
      "store": null,
      "node": null,
      "unassigned.reason": "INDEX_CREATED"
    },
    {
      "index": "tmp-doctor-overflow",
      "shard": "0",
      "prirep": "r",
      "state": "UNASSIGNED",
      "store": null,
      "node": null,
      "unassigned.reason": "INDEX_CREATED"
    },
    {
      "index": "tmp-doctor-shards",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "store": "227",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "tmp-doctor-shards",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "store": "227",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "tmp-doctor-shards",
      "shard": "1",
      "prirep": "r",
      "state": "STARTED",
      "store": "227",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "tmp-doctor-shards",
      "shard": "1",
      "prirep": "p",
      "state": "STARTED",
      "store": "227",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "tmp-doctor-shards",
      "shard": "2",
      "prirep": "p",
      "state": "STARTED",
      "store": "227",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "tmp-doctor-shards",
      "shard": "2",
      "prirep": "r",
      "state": "STARTED",
      "store": "227",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "overflow-test",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "store": "249",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "overflow-test",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "store": "249",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "overflow-test",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "store": "249",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "overflow-test",
      "shard": "0",
      "prirep": "r",
      "state": "UNASSIGNED",
      "store": null,
      "node": null,
      "unassigned.reason": "CLUSTER_RECOVERED"
    },
    {
      "index": "overflow-test",
      "shard": "1",
      "prirep": "r",
      "state": "STARTED",
      "store": "249",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "overflow-test",
      "shard": "1",
      "prirep": "r",
      "state": "STARTED",
      "store": "249",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "overflow-test",
      "shard": "1",
      "prirep": "p",
      "state": "STARTED",
      "store": "249",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "overflow-test",
      "shard": "1",
      "prirep": "r",
      "state": "UNASSIGNED",
      "store": null,
      "node": null,
      "unassigned.reason": "CLUSTER_RECOVERED"
    },
    {
      "index": "inventory",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "store": "67919",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "inventory",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "store": "67919",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "inventory",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "store": "67919",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "customers",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "store": "137803",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "customers",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "store": "137803",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "metrics-app",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "store": "198960",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": ".ds-app-events-web-2026.10.14-000002",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "store": "249",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": ".ds-app-events-web-2026.10.14-000002",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "store": "249",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": ".tasks",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "store": "40213",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": ".tasks",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "store": "40213",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": ".ds-.logs-deprecation.elasticsearch-default-2026.10.14-000001",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "store": "74947",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": ".ds-.logs-deprecation.elasticsearch-default-2026.10.14-000001",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "store": "74936",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "search-sessions",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "store": "249",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "search-sessions",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "store": "249",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "search-sessions",
      "shard": "1",
      "prirep": "r",
      "state": "STARTED",
      "store": "249",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "search-sessions",
      "shard": "1",
      "prirep": "p",
      "state": "STARTED",
      "store": "249",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "search-sessions",
      "shard": "2",
      "prirep": "p",
      "state": "STARTED",
      "store": "249",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "search-sessions",
      "shard": "2",
      "prirep": "r",
      "state": "STARTED",
      "store": "249",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "search-sessions",
      "shard": "3",
      "prirep": "r",
      "state": "STARTED",
      "store": "249",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "search-sessions",
      "shard": "3",
      "prirep": "p",
      "state": "STARTED",
      "store": "249",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "search-sessions",
      "shard": "4",
      "prirep": "r",
      "state": "STARTED",
      "store": "249",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "search-sessions",
      "shard": "4",
      "prirep": "p",
      "state": "STARTED",
      "store": "249",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "tmp-doctor-norep",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "store": "227",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "tmp-doctor-ilm-1",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "store": "227",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "tmp-doctor-ilm-1",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "store": "227",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "products",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "store": "387780",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "products",
      "shard": "0",
      "prirep": "p",
      "state": "STARTED",
      "store": "387780",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "products",
      "shard": "0",
      "prirep": "r",
      "state": "STARTED",
      "store": "387780",
      "node": "es-node-2",
      "unassigned.reason": null
    },
    {
      "index": "products",
      "shard": "1",
      "prirep": "p",
      "state": "STARTED",
      "store": "391558",
      "node": "es-node-3",
      "unassigned.reason": null
    },
    {
      "index": "products",
      "shard": "1",
      "prirep": "r",
      "state": "STARTED",
      "store": "391558",
      "node": "es-node-1",
      "unassigned.reason": null
    },
    {
      "index": "products",
      "shard": "1",
      "prirep": "r",
      "state": "STARTED",
      "store": "391558",
      "node": "es-node-2",
      "unassigned.reason": null
    }
  ],
  "blocks": {
    "tmp-doctor-write": {
      "settings": {
        "index.blocks.write": "true"
      }
    },
    "tmp-doctor-ro": {
      "settings": {
        "index.blocks.read_only_allow_delete": "true"
      }
    }
  },
  "ilm": {
    "indices": {
      "tmp-doctor-ilm-1": {
        "index": "tmp-doctor-ilm-1",
        "managed": true,
        "policy": "tmp-doctor-policy",
        "index_creation_date_millis": 1792008124450,
        "time_since_index_creation": "37.04s",
        "lifecycle_date_millis": 1792008124450,
        "age": "37.04s",
        "phase": "hot",
        "phase_time_millis": 1792008153412,
        "action": "rollover",
        "action_time_millis": 1792008124578,
        "step": "ERROR",
        "step_time_millis": 1792008153412,
        "failed_step": "attempt-rollover",
        "is_auto_retryable_error": true,
        "step_info": {
          "type": "illegal_argument_exception",
          "reason": "setting [index.lifecycle.rollover_alias] for index [tmp-doctor-ilm-1] is empty or not defined, it must be set to the name of the alias pointing to the group of indices being rolled over"
        }
      }
    }
  },
  "deprecations": {
    "cluster_settings": [],
    "node_settings": [],
    "index_settings": {},
    "ml_settings": []
  },
  "health_report": {
    "status": "red",
    "cluster_name": "cerebro-demo",
    "indicators": {
      "master_is_stable": {
        "status": "green",
        "symptom": "The cluster has a stable master node",
        "details": {
          "current_master": {
            "node_id": "wEqTWTA0T2CktRBr56viXg",
            "name": "es-node-2"
          },
          "recent_masters": [
            {
              "node_id": "wEqTWTA0T2CktRBr56viXg",
              "name": "es-node-2"
            }
          ]
        }
      },
      "repository_integrity": {
        "status": "green",
        "symptom": "All repositories are healthy.",
        "details": {
          "total_repositories": 1
        }
      },
      "disk": {
        "status": "red",
        "symptom": "1 index is not allowed to be updated. 3 nodes are out of disk or running low on disk space.",
        "details": {
          "indices_with_readonly_block": 1,
          "nodes_with_enough_disk_space": 0,
          "nodes_with_unknown_disk_status": 0,
          "nodes_over_high_watermark": 3,
          "nodes_over_flood_stage_watermark": 0
        },
        "impacts": [
          {
            "id": "elasticsearch:health:disk:impact:ingest_capability_unavailable",
            "severity": 1,
            "description": "Cannot insert or update documents in the affected indices [tmp-doctor-ro].",
            "impact_areas": [
              "ingest"
            ]
          },
          {
            "id": "elasticsearch:health:disk:impact:cluster_stability_at_risk",
            "severity": 1,
            "description": "Cluster stability might be impaired.",
            "impact_areas": [
              "deployment_management"
            ]
          },
          {
            "id": "elasticsearch:health:disk:impact:cluster_functionality_unavailable",
            "severity": 3,
            "description": "The [ingest, ml, remote_cluster_client, transform] functionality might be impaired.",
            "impact_areas": [
              "deployment_management"
            ]
          }
        ],
        "diagnosis": [
          {
            "id": "elasticsearch:health:disk:diagnosis:add_disk_capacity_data_nodes",
            "cause": "26 indices reside on nodes that have run or are likely to run out of disk space, this can temporarily disable writing on these indices.",
            "action": "Enable autoscaling (if applicable), add disk capacity or free up disk space to resolve this. If you have already taken action please wait for the rebalancing to complete.",
            "help_url": "https://ela.st/fix-data-disk",
            "affected_resources": {
              "nodes": [
                {
                  "id": "I7MELLk0RvSiAPhRW6211Q",
                  "name": "es-node-1"
                },
                {
                  "id": "wEqTWTA0T2CktRBr56viXg",
                  "name": "es-node-2"
                },
                {
                  "id": "dmdk_a7-TrKWtlTZ9-ZHzQ",
                  "name": "es-node-3"
                }
              ],
              "indices": [
                ".tasks",
                ".ds-app-events-web-2026.10.14-000001",
                ".ds-app-events-web-2026.10.14-000002",
                ".ds-app-events-worker-2026.10.14-000001",
                ".ds-.logs-deprecation.elasticsearch-default-2026.10.14-000001",
                ".ds-ilm-history-7-2026.10.14-000001",
                ".kibana-demo",
                "archive-2025",
                "audit-trail",
                "customers",
                "inventory",
                "logs-2026.10.12",
                "logs-2026.10.13",
                "logs-2026.10.14",
                "metrics-app",
                "orders-v2",
                "overflow-test",
                "products",
                "search-sessions",
                "tmp-demo-reindex",
                "tmp-doctor-ilm-1",
                "tmp-doctor-norep",
                "tmp-doctor-overflow",
                "tmp-doctor-ro",
                "tmp-doctor-shards",
                "tmp-doctor-write"
              ]
            }
          }
        ]
      },
      "shards_capacity": {
        "status": "green",
        "symptom": "The cluster has enough room to add new shards.",
        "details": {
          "data": {
            "max_shards_in_cluster": 3000
          },
          "frozen": {
            "max_shards_in_cluster": 9000
          }
        }
      },
      "shards_availability": {
        "status": "yellow",
        "symptom": "This cluster has 4 unavailable replica shards.",
        "details": {
          "restarting_replicas": 0,
          "creating_primaries": 0,
          "initializing_replicas": 0,
          "unassigned_replicas": 4,
          "started_primaries": 44,
          "restarting_primaries": 0,
          "initializing_primaries": 0,
          "creating_replicas": 0,
          "started_replicas": 48,
          "unassigned_primaries": 0
        },
        "impacts": [
          {
            "id": "elasticsearch:health:shards_availability:impact:replica_unassigned",
            "severity": 2,
            "description": "Searches might be slower than usual. Fewer redundant copies of the data exist on 2 indices [overflow-test, tmp-doctor-overflow].",
            "impact_areas": [
              "search"
            ]
          }
        ],
        "diagnosis": [
          {
            "id": "elasticsearch:health:shards_availability:diagnosis:increase_tier_capacity_for_allocations:tier:data_content",
            "cause": "Elasticsearch isn't allowed to allocate some shards from these indices to any of the nodes in the desired data tier because there are not enough nodes in the [data_content] tier to allocate each shard copy on a different node.",
            "action": "Increase the number of nodes in this tier or decrease the number of replica shards in the affected indices.",
            "help_url": "https://ela.st/tier-capacity",
            "affected_resources": {
              "indices": [
                "overflow-test",
                "tmp-doctor-overflow"
              ]
            }
          }
        ]
      },
      "data_stream_lifecycle": {
        "status": "green",
        "symptom": "Data streams are executing their lifecycles without issues",
        "details": {
          "stagnating_backing_indices_count": 0,
          "total_backing_indices_in_error": 0
        }
      },
      "slm": {
        "status": "green",
        "symptom": "No Snapshot Lifecycle Management policies configured",
        "details": {
          "slm_status": "RUNNING",
          "policies": 0
        }
      },
      "ilm": {
        "status": "green",
        "symptom": "Index Lifecycle Management is running",
        "details": {
          "policies": 28,
          "stagnating_indices": 0,
          "ilm_status": "RUNNING"
        }
      }
    }
  },
  "unavailable": {}
};

/** A deep, mutable copy of the live report to derive variations from. */
export function liveReport(): Record<string, any> {
  return structuredClone(LIVE_REPORT);
}

/**
 * `_migration/deprecations` as Elasticsearch 8.x answers it (shape from the
 * reference documentation, values from a 7.17 cluster preparing for 8.0).
 */
export const DEPRECATIONS = {
  cluster_settings: [
    {
      level: 'critical',
      message: 'Cluster name cannot contain \':\'',
      url: 'https://www.elastic.co/guide/en/elasticsearch/reference/7.0/breaking-changes-7.0.html#_literal_literal_is_no_longer_allowed_in_cluster_name',
      details: 'This cluster is named [mycompany:logging], which contains the illegal character \':\'.',
      resolve_during_rolling_upgrade: false,
    },
  ],
  node_settings: [
    {
      level: 'warning',
      message: 'Setting [xpack.monitoring.collection.enabled] is deprecated',
      url: 'https://ela.st/es-deprecation-7-monitoring-settings',
      details: 'Remove the [xpack.monitoring.collection.enabled] setting. (nodes impacted: [es-node-1, es-node-2])',
      resolve_during_rolling_upgrade: true,
    },
  ],
  index_settings: {
    'logs:apache': [
      {
        level: 'warning',
        message: 'Index name cannot contain \':\'',
        url: 'https://www.elastic.co/guide/en/elasticsearch/reference/7.0/breaking-changes-7.0.html#_literal_literal_is_no_longer_allowed_in_index_name',
        details: 'This index is named [logs:apache], which contains the illegal character \':\'.',
        resolve_during_rolling_upgrade: false,
      },
    ],
    'old-index': [
      {
        level: 'critical',
        message: 'Old index with a compatibility version < 7.0',
        url: 'https://www.elastic.co/guide/en/elasticsearch/reference/master/migrating-8.0.html',
        details: 'This index has version: 6.8.0',
        resolve_during_rolling_upgrade: false,
        _meta: { reindex_required: true },
      },
    ],
    'older-index': [
      {
        level: 'critical',
        message: 'Old index with a compatibility version < 7.0',
        url: 'https://www.elastic.co/guide/en/elasticsearch/reference/master/migrating-8.0.html',
        details: 'This index has version: 6.5.0',
        resolve_during_rolling_upgrade: false,
      },
    ],
  },
  data_streams: {},
  templates: {
    'legacy-logs': [
      {
        level: 'warning',
        message: 'Legacy index templates are deprecated',
        url: 'https://ela.st/es-deprecation-8-legacy-templates',
        details: 'One or more legacy index templates exist.',
        resolve_during_rolling_upgrade: false,
      },
    ],
  },
  ilm_policies: {
    'logs-policy': [
      {
        level: 'warning',
        message: 'ILM policy [logs-policy] contains the action \'freeze\' that is deprecated',
        url: 'https://ela.st/es-deprecation-7-frozen-indices',
        details: 'Remove the action \'freeze\' from ILM policy [logs-policy]',
        resolve_during_rolling_upgrade: false,
      },
    ],
  },
  ml_settings: [],
};
