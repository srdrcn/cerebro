package elastic

import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import javax.inject.Singleton

import com.google.inject.Inject
import elastic.HTTPElasticClient._
import models.ElasticServer
import play.api.libs.json._
import play.api.libs.ws.{WSAuthScheme, WSClient}

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future

@Singleton
class HTTPElasticClient @Inject()(client: WSClient) extends ElasticClient {

  def main(target: ElasticServer) =
    execute(s"", "GET", None, target)

  def nodesStats(stats: Seq[String], target: ElasticServer) = {
    val path = s"/_nodes/stats/${stats.mkString(",")}?human=true"
    execute(path, "GET", None, target)
  }

  def indexStats(index: String, target: ElasticServer): Future[ElasticResponse] = {
    val path = s"/${encoded(index)}/_stats?human=true"
    execute(path, "GET", None, target)
  }

  def nodeStats(node: String, target: ElasticServer) = {
    val path = s"/_nodes/${encoded(node)}/stats?human"
    execute(path, "GET", None, target)
  }

  def clusterHealth(target: ElasticServer) = {
    val path = "/_cluster/health"
    execute(path, "GET", None, target)
  }

  def nodes(flags: Seq[String], target: ElasticServer) = {
    val path = s"/_nodes/_all/${flags.mkString(",")}?human=true"
    execute(path, "GET", None, target)
  }

  def closeIndex(index: String, target: ElasticServer) = {
    val path = s"/${encoded(index)}/_close"
    execute(path, "POST", None, target, Seq(JsonContentType))
  }

  def openIndex(index: String, target: ElasticServer) = {
    val path = s"/${encoded(index)}/_open"
    execute(path, "POST", None, target, Seq(JsonContentType))
  }

  def refreshIndex(index: String, target: ElasticServer) = {
    val path = s"/${encoded(index)}/_refresh"
    execute(path, "POST", None, target, Seq(JsonContentType))
  }

  def flushIndex(index: String, target: ElasticServer) = {
    val path = s"/${encoded(index)}/_flush"
    execute(path, "POST", None, target, Seq(JsonContentType))
  }

  def forceMerge(index: String, target: ElasticServer) = {
    val path = s"/${encoded(index)}/_forcemerge"
    execute(path, "POST", None, target, Seq(JsonContentType))
  }

  def clearIndexCache(index: String, target: ElasticServer) = {
    val path = s"/${encoded(index)}/_cache/clear"
    execute(path, "POST", None, target, Seq(JsonContentType))
  }

  def deleteIndex(index: String, target: ElasticServer) = {
    val path = s"/${encoded(index)}"
    execute(path, "DELETE", None, target)
  }

  def getIndexSettings(index: String, target: ElasticServer) = {
    val path = s"/${encoded(index)}/_settings"
    execute(path, "GET", None, target)
  }

  def getIndexSettingsFlat(index: String, target: ElasticServer) = {
    val path = s"/${encoded(index)}/_settings?flat_settings=true&include_defaults=true"
    execute(path, "GET", None, target)
  }

  def getIndexMapping(index: String, target: ElasticServer) = {
    val path = s"/${encoded(index)}/_mapping"
    execute(path, "GET", None, target)
  }

  def enableShardAllocation(target: ElasticServer) =
    saveClusterSettings(allocationSettings(JsNull), target)

  def disableShardAllocation(target: ElasticServer, kind: String) =
    saveClusterSettings(allocationSettings(JsString(kind)), target)

  def getShardStats(index: String, target: ElasticServer) = {
    val path = s"/${encoded(index)}/_stats?level=shards&human=true"
    execute(path, "GET", None, target)
  }

  def relocateShard(shard: Int, index: String, from: String, to: String, target: ElasticServer) = {
    val path = "/_cluster/reroute"
    val commands = Json.obj(
      "commands" -> Json.arr(
        Json.obj(
          "move" -> Json.obj("shard" -> shard, "index" -> index, "from_node" -> from, "to_node" -> to)
        )
      )
    )
    execute(path, "POST", Some(commands.toString), target, Seq(JsonContentType))
  }

  def getIndexRecovery(index: String, target: ElasticServer) = {
    val path = s"/${encoded(index)}/_recovery?active_only=true&human=true"
    execute(path, "GET", None, target)
  }

  def getAliases(target: ElasticServer) = {
    val path = "/_aliases"
    execute(path, "GET", None, target)
  }

  def updateAliases(changes: Seq[JsValue], target: ElasticServer) = {
    val path = "/_aliases"
    val body = Json.obj("actions" -> JsArray(changes))
    execute(path, "POST", Some(body.toString), target, Seq(JsonContentType))
  }

  def getIndexMetadata(index: String, target: ElasticServer) = {
    val path = s"/_cluster/state/metadata/${encoded(index)}?human=true"
    execute(path, "GET", None, target)
  }

  def createIndex(index: String, metadata: JsValue, target: ElasticServer) = {
    val path = s"/${encoded(index)}"
    execute(path, "PUT", Some(metadata.toString), target, Seq(JsonContentType))
  }

  // Index lists only use the names; asking for that column keeps the answer small.
  def getIndices(target: ElasticServer) =
    execute("/_cat/indices?format=json&h=index", "GET", None, target)

  // Names with their status (open or close), for lists that only offer open indices.
  def getIndexStatuses(target: ElasticServer) =
    execute("/_cat/indices?format=json&h=index,status", "GET", None, target)

  def getTemplates(target: ElasticServer) = {
    val path = s"/_template"
    execute(path, "GET", None, target)
  }

  def createTemplate(name: String, template: JsValue, target: ElasticServer) = {
    val path = s"/_template/${encoded(name)}"
    execute(path, "PUT", Some(template.toString), target, Seq(JsonContentType))
  }

  def deleteTemplate(name: String, target: ElasticServer) = {
    val path = s"/_template/${encoded(name)}"
    execute(path, "DELETE", None, target)
  }

  def analyzeTextByField(index: String, field: String, text: String, target: ElasticServer) = {
    val path = s"/${encoded(index)}/_analyze"
    val body = Json.obj("text" -> text, "field" -> field).toString()
    execute(path, "GET", Some(body), target, Seq(JsonContentType))
  }

  def analyzeTextByAnalyzer(index: String, analyzer: String, text: String, target: ElasticServer) = {
    val path = s"/${encoded(index)}/_analyze"
    val body = Json.obj("text" -> text, "analyzer" -> analyzer).toString()
    execute(path, "GET", Some(body), target, Seq(JsonContentType))
  }

  def getClusterSettings(target: ElasticServer) = {
    val path = s"/_cluster/settings?flat_settings=true&include_defaults=true"
    execute(path, "GET", None, target)
  }


  // Repositories
  def getRepositories(target: ElasticServer) = {
    val path = s"/_snapshot"
    execute(path, "GET", None, target)
  }

  def createRepository(name: String, repoType: String, settings: JsValue, target: ElasticServer) = {
    val path = s"/_snapshot/${encoded(name)}"
    val data = Json.obj("type" -> JsString(repoType), "settings" -> settings).toString
    execute(path, "PUT", Some(data), target, Seq(JsonContentType))
  }

  def deleteRepository(name: String, target: ElasticServer) = {
    val path = s"/_snapshot/${encoded(name)}"
    execute(path, "DELETE", None, target)
  }

  // Snapshots
  def getSnapshots(repository: String, target: ElasticServer) = {
    val path = s"/_snapshot/${encoded(repository)}/_all"
    execute(path, "GET", None, target)
  }

  def deleteSnapshot(repository: String, snapshot: String, target: ElasticServer) = {
    val path = s"/_snapshot/${encoded(repository)}/${encoded(snapshot)}"
    execute(path, "DELETE", None, target)
  }

  def createSnapshot(repository: String, snapshot: String, ignoreUnavailable: Boolean,
                     includeGlobalState: Boolean, indices: Option[String], target: ElasticServer) = {
    val path = s"/_snapshot/${encoded(repository)}/${encoded(snapshot)}"
    val data = JsObject(
      Seq(
        ("ignore_unavailable", JsBoolean(ignoreUnavailable)),
        ("include_global_state", JsBoolean(includeGlobalState))
      ) ++ indices.map { i => Seq(("indices", JsString(i))) }.getOrElse(Nil)
    ).toString
    execute(path, "PUT", Some(data), target, Seq(JsonContentType))
  }

  def restoreSnapshot(repository: String, snapshot: String, renamePattern: Option[String],
                      renameReplacement: Option[String], ignoreUnavailable: Boolean, includeAliases: Boolean,
                      includeGlobalState: Boolean, indices: Option[String], target: ElasticServer) = {
    val path = s"/_snapshot/${encoded(repository)}/${encoded(snapshot)}/_restore"
    val data = JsObject(
      Seq(
        ("ignore_unavailable", JsBoolean(ignoreUnavailable)),
        ("include_global_state", JsBoolean(includeGlobalState)),
        ("include_aliases", JsBoolean(includeAliases))
      ) ++
        indices.map { i => Seq(("indices", JsString(i))) }.getOrElse(Nil) ++
        renamePattern.map { r => Seq(("rename_pattern", JsString(r))) }.getOrElse(Nil) ++
        renameReplacement.map { r => Seq(("rename_replacement", JsString(r))) }.getOrElse(Nil)
    ).toString
    execute(path, "POST", Some(data), target, Seq(JsonContentType))
  }

  def saveClusterSettings(settings: JsValue, target: ElasticServer) = {
    val path = s"/_cluster/settings"
    execute(path, "PUT", Some(settings.toString), target, Seq(JsonContentType))
  }

  def updateIndexSettings(index: String, settings: JsValue, target: ElasticServer) = {
    val path = s"/${encoded(index)}/_settings"
    execute(path, "PUT", Some(settings.toString), target, Seq(JsonContentType))
  }

  // Cat requests
  def catRequest(api: String, target: ElasticServer) = {
    val path = s"/_cat/$api"
    execute(s"$path?format=json", "GET", None, target)
  }

  def executeRequest(method: String, path: String, data: Option[JsValue], target: ElasticServer) = {
    val headers = data.map {
      case _: JsString => NdJsonContentType // if it's not a json, it is assumed that bulk or multi-search API is used
      case _ => JsonContentType
    }.toSeq
    
    val body = data.map {
      case JsString(value) => value // needed to handle non valid json requests(multisearch, bulk...)
      case v: JsValue => v.toString
    }
    execute(s"/${path}", method, body, target, headers)
  }

  protected def execute(uri: String,
                        method: String,
                        body: Option[String] = None,
                        target: ElasticServer,
                        headers: Seq[(String, String)] = Seq()): Future[ElasticResponse] = {
    val authentication = target.host.authentication
    val url = s"${target.host.name.replaceAll("/+$", "")}$uri"

    val mergedHeaders = headers ++ target.headers

    val request =
      authentication.foldLeft(client.url(url).withMethod(method).withHttpHeaders(mergedHeaders: _*)) {
      case (request, auth) =>
        request.withAuth(auth.username, auth.password, WSAuthScheme.BASIC)
    }

    body.fold(request)(request.withBody((_))).execute().map { response =>
      ElasticResponse(response)
    }
  }

  override def catMaster(target: ElasticServer): Future[ElasticResponse] = {
    val path = "/_cat/master"
    execute(s"$path?format=json", "GET", None, target)
  }

  def allocationExplain(request: Option[JsValue], target: ElasticServer) = {
    val path = "/_cluster/allocation/explain?include_disk_info=true"
    execute(path, "POST", request.map(_.toString), target, request.map(_ => JsonContentType).toSeq)
  }

  def getIndexTemplates(target: ElasticServer) =
    execute("/_index_template", "GET", None, target)

  def putIndexTemplate(name: String, template: JsValue, target: ElasticServer) =
    execute(s"/_index_template/${encoded(name)}", "PUT", Some(template.toString), target, Seq(JsonContentType))

  def deleteIndexTemplate(name: String, target: ElasticServer) =
    execute(s"/_index_template/${encoded(name)}", "DELETE", None, target)

  def simulateIndexTemplate(name: String, target: ElasticServer) =
    execute(s"/_index_template/_simulate/${encoded(name)}", "POST", None, target)

  def getComponentTemplates(target: ElasticServer) =
    execute("/_component_template", "GET", None, target)

  def putComponentTemplate(name: String, template: JsValue, target: ElasticServer) =
    execute(s"/_component_template/${encoded(name)}", "PUT", Some(template.toString), target, Seq(JsonContentType))

  def deleteComponentTemplate(name: String, target: ElasticServer) =
    execute(s"/_component_template/${encoded(name)}", "DELETE", None, target)

  def getIndexAliases(index: String, target: ElasticServer) =
    execute(s"/${encoded(index)}/_alias", "GET", None, target)

  def getIndexShards(index: String, target: ElasticServer) = {
    val columns = "index,shard,prirep,state,docs,store,ip,node,unassigned.reason,unassigned.for"
    execute(s"/_cat/shards/${encoded(index)}?format=json&bytes=b&h=$columns", "GET", None, target)
  }

  // Not part of the index settings; split targets must divide it.
  def getIndexRoutingShards(index: String, target: ElasticServer) =
    execute(s"/_cluster/state/metadata/${encoded(index)}?filter_path=metadata.indices.*.routing_num_shards", "GET", None, target)

  def getTasks(parentTaskId: Option[String], target: ElasticServer) = {
    val parent = parentTaskId.map(id => s"&parent_task_id=${encoded(id)}").getOrElse("")
    execute(s"/_tasks?detailed=true&group_by=none$parent", "GET", None, target)
  }

  def lookupIndices(expression: String, target: ElasticServer) = {
    val columns = "index,status,health,pri,rep,docs.count,pri.store.size,store.size"
    execute(s"/_cat/indices/${encoded(expression)}?format=json&bytes=b&expand_wildcards=open,closed&h=$columns", "GET", None, target)
  }

  def cancelTask(taskId: String, target: ElasticServer) =
    execute(s"/_tasks/${encoded(taskId)}/_cancel", "POST", None, target)

  def getDataStreams(includeHidden: Boolean, target: ElasticServer) = {
    val path = if (includeHidden) "/_data_stream?expand_wildcards=all" else "/_data_stream"
    execute(path, "GET", None, target)
  }

  def getDataStreamStats(includeHidden: Boolean, target: ElasticServer) = {
    val path = if (includeHidden) "/_data_stream/*/_stats?expand_wildcards=all" else "/_data_stream/_stats"
    execute(path, "GET", None, target)
  }

  def rolloverDataStream(name: String, target: ElasticServer) =
    execute(s"/${encoded(name)}/_rollover", "POST", None, target)

  def deleteDataStream(name: String, target: ElasticServer) =
    execute(s"/_data_stream/${encoded(name)}", "DELETE", None, target)

  def getIlmPolicies(target: ElasticServer) =
    execute("/_ilm/policy", "GET", None, target)

  def putIlmPolicy(name: String, policy: JsValue, target: ElasticServer) = {
    val body = Json.obj("policy" -> policy).toString
    execute(s"/_ilm/policy/${encoded(name)}", "PUT", Some(body), target, Seq(JsonContentType))
  }

  def deleteIlmPolicy(name: String, target: ElasticServer) =
    execute(s"/_ilm/policy/${encoded(name)}", "DELETE", None, target)

  def explainIlm(index: String, target: ElasticServer) =
    execute(s"/${encoded(index)}/_ilm/explain", "GET", None, target)

  def retryIlm(indices: String, target: ElasticServer) =
    execute(s"/${encoded(indices)}/_ilm/retry", "POST", None, target)

  def getPipelines(target: ElasticServer) =
    execute("/_ingest/pipeline", "GET", None, target)

  def putPipeline(id: String, pipeline: JsValue, target: ElasticServer) =
    execute(s"/_ingest/pipeline/${encoded(id)}", "PUT", Some(pipeline.toString), target, Seq(JsonContentType))

  def deletePipeline(id: String, target: ElasticServer) =
    execute(s"/_ingest/pipeline/${encoded(id)}", "DELETE", None, target)

  def simulatePipeline(request: JsValue, verbose: Boolean, target: ElasticServer) =
    execute(s"/_ingest/pipeline/_simulate?verbose=$verbose", "POST", Some(request.toString), target, Seq(JsonContentType))

  def getRecoveries(activeOnly: Boolean, target: ElasticServer) =
    execute(s"/_cat/recovery?format=json&bytes=b&time=ms&active_only=$activeOnly", "GET", None, target)

  def healthReport(target: ElasticServer) =
    execute("/_health_report?verbose=true", "GET", None, target)

  def migrationDeprecations(target: ElasticServer) =
    execute("/_migration/deprecations", "GET", None, target)

  def ilmErrors(target: ElasticServer) =
    execute("/_all/_ilm/explain?only_errors=true&expand_wildcards=all", "GET", None, target)

  // Blocks, plus the store settings that identify mounted searchable snapshots.
  def indexBlocks(target: ElasticServer) = {
    val settings = "index.blocks.*,index.store.type,index.store.snapshot.partial"
    execute(s"/_all/_settings/$settings?flat_settings=true&expand_wildcards=all", "GET", None, target)
  }

  def catIndexSizes(target: ElasticServer) = {
    val columns = "index,health,status,pri,rep,docs.count,store.size,pri.store.size"
    execute(s"/_cat/indices?format=json&bytes=b&expand_wildcards=all&h=$columns", "GET", None, target)
  }

  def catShardSizes(target: ElasticServer) = {
    val columns = "index,shard,prirep,state,store,node,unassigned.reason"
    execute(s"/_cat/shards?format=json&bytes=b&h=$columns", "GET", None, target)
  }

  def retryFailedAllocations(target: ElasticServer) =
    execute("/_cluster/reroute?retry_failed=true&filter_path=acknowledged", "POST", None, target)

  def nodeMetrics(includeIndexingPressure: Boolean, target: ElasticServer) = {
    val pressure = Seq(
      "indexing_pressure.memory.total.coordinating_rejections",
      "indexing_pressure.memory.total.primary_rejections",
      "indexing_pressure.memory.total.replica_rejections"
    )
    val fields = Seq(
      "name", "roles", "timestamp", "jvm.uptime_in_millis",
      "indices.indexing.index_total", "indices.indexing.index_time_in_millis",
      "indices.search.query_total", "indices.search.query_time_in_millis", "indices.search.fetch_total",
      "indices.get.total", "jvm.mem.heap_used_percent",
      "os.cpu.percent", "os.cpu.load_average", "os.load_average", "process.cpu.percent",
      "thread_pool.write", "thread_pool.search", "thread_pool.bulk"
    ) ++ (if (includeIndexingPressure) pressure else Seq.empty)
    val filter = ("_nodes" +: fields.map(field => s"nodes.*.$field")).mkString(",")
    val metrics = "indices,jvm,os,process,thread_pool" + (if (includeIndexingPressure) ",indexing_pressure" else "")
    // Only the index statistics the charts use, and a bound on slow nodes.
    execute(s"/_nodes/stats/$metrics/indexing,search,get?timeout=10s&filter_path=$filter", "GET", None, target)
  }

  def hotThreads(node: Option[String], threads: Int, interval: String, kind: String, ignoreIdle: Boolean,
                 target: ElasticServer) = {
    val nodes = node.map(encoded).getOrElse("_all")
    val params = s"threads=$threads&interval=$interval&type=$kind&ignore_idle_threads=$ignoreIdle"
    execute(s"/_nodes/$nodes/hot_threads?$params", "GET", None, target)
  }

  def catThreadPools(target: ElasticServer) = {
    val columns = "node_id,node_name,name,type,active,queue,rejected,completed,size,core,max,pool_size,queue_size"
    execute(s"/_cat/thread_pool?format=json&h=$columns", "GET", None, target)
  }

  def pendingClusterTasks(target: ElasticServer) =
    execute("/_cluster/pending_tasks", "GET", None, target)

  def slowlogSettings(target: ElasticServer) = {
    val settings = "index.search.slowlog.*,index.indexing.slowlog.*"
    execute(s"/_all/_settings/$settings?flat_settings=true&expand_wildcards=all", "GET", None, target)
  }

  def resizeIndex(kind: String, index: String, targetIndex: String, body: JsValue, target: ElasticServer) =
    execute(s"/${encoded(index)}/_$kind/${encoded(targetIndex)}", "POST", Some(body.toString), target, Seq(JsonContentType))

  def rollover(alias: String, newIndex: Option[String], body: JsValue, dryRun: Boolean, target: ElasticServer) = {
    val path = s"/${encoded(alias)}/_rollover${newIndex.map(name => s"/${encoded(name)}").getOrElse("")}"
    execute(s"$path?dry_run=$dryRun", "POST", Some(body.toString), target, Seq(JsonContentType))
  }

  def reindex(body: JsValue, slices: Option[String], requestsPerSecond: Option[String], target: ElasticServer) = {
    val params = Seq(Some("wait_for_completion=false"), slices.map(s => s"slices=$s"), requestsPerSecond.map(r => s"requests_per_second=$r"))
    execute(s"/_reindex?${params.flatten.mkString("&")}", "POST", Some(body.toString), target, Seq(JsonContentType))
  }

  def getTask(taskId: String, target: ElasticServer) =
    execute(s"/_tasks/${encoded(taskId)}", "GET", None, target)
}

object HTTPElasticClient {
  val JsonContentType: (String, String) = ("Content-type", "application/json")

  val NdJsonContentType: (String, String) = ("Content-type", "application/x-ndjson")

  /** The shard allocation values Elasticsearch accepts for cluster.routing.allocation.enable. */
  val AllocationKinds: Seq[String] = Seq("all", "primaries", "new_primaries", "none")

  /**
    * Persistent cluster.routing.allocation.enable (transient settings are deprecated). The
    * transient value is always cleared: a leftover transient value would silently override
    * the persistent one. JsNull resets both to the default ("all").
    */
  def allocationSettings(value: JsValue): JsObject = {
    val setting = "cluster.routing.allocation.enable"
    Json.obj("persistent" -> Json.obj(setting -> value), "transient" -> Json.obj(setting -> JsNull))
  }

  /**
    * Encodes one URL path segment. URLEncoder implements form encoding, where a space becomes
    * '+', but Elasticsearch reads '+' in a path literally, so spaces are written as %20.
    */
  def encoded(text: String): String = URLEncoder.encode(text, StandardCharsets.UTF_8).replace("+", "%20")
}
