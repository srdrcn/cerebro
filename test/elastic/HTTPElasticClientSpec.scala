package elastic

import models.{ElasticServer, Host}
import org.specs2.Specification
import play.api.libs.json._

import scala.concurrent.Future

object HTTPElasticClientSpec extends Specification {

  def is =
    s2"""
    HTTPElasticClient should
      encode spaces in path segments as %20                 $space
      encode '+', ':', ',' and '/' in path segments         $reserved
      address pipelines, ILM policies and templates by id   $resourcePaths
      write disabled allocation as a persistent setting     $disableAllocation
      reset allocation to the default on enable             $enableAllocation
      build reroute commands as JSON                        $relocate
      build insight and index operation paths               $insightPaths
      ask _cat/indices for the columns callers read         $indexLists
      """

  private case class Call(uri: String, method: String, body: Option[String])

  /** Records the requests instead of sending them. */
  private class RecordingClient extends HTTPElasticClient(null) {
    var calls: Vector[Call] = Vector.empty

    override protected def execute(uri: String,
                                   method: String,
                                   body: Option[String],
                                   target: ElasticServer,
                                   headers: Seq[(String, String)]): Future[ElasticResponse] = {
      calls :+= Call(uri, method, body)
      Future.successful(Success(200, Json.obj()))
    }
  }

  private val server = ElasticServer(Host("http://localhost:9200", None))

  private def record(request: RecordingClient => Any): Call = {
    val client = new RecordingClient
    request(client)
    client.calls.last
  }

  def space = {
    (HTTPElasticClient.encoded("tmp a b") mustEqual "tmp%20a%20b") and
      (record(_.deletePipeline("tmp a b", server)) mustEqual Call("/_ingest/pipeline/tmp%20a%20b", "DELETE", None))
  }

  def reserved = {
    (HTTPElasticClient.encoded("a+b") mustEqual "a%2Bb") and
      (record(_.cancelTask("oTUltX4IQMOUUVeiohTt8A:12345", server)).uri mustEqual "/_tasks/oTUltX4IQMOUUVeiohTt8A%3A12345/_cancel") and
      (record(_.closeIndex("logs-1,logs-2", server)).uri mustEqual "/logs-1%2Clogs-2/_close") and
      (record(_.deleteIndex("a/b", server)).uri mustEqual "/a%2Fb") and
      (record(_.explainIlm("logs-*", server)).uri mustEqual "/logs-*/_ilm/explain")
  }

  def resourcePaths = {
    (record(_.deleteIlmPolicy("hot warm", server)).uri mustEqual "/_ilm/policy/hot%20warm") and
      (record(_.deleteIndexTemplate("app events", server)).uri mustEqual "/_index_template/app%20events") and
      (record(_.deleteComponentTemplate("app+settings", server)).uri mustEqual "/_component_template/app%2Bsettings") and
      (record(_.deleteDataStream("logs-app-web", server)).uri mustEqual "/_data_stream/logs-app-web")
  }

  def disableAllocation = {
    val call = record(_.disableShardAllocation(server, "primaries"))
    (call.uri mustEqual "/_cluster/settings") and
      (call.method mustEqual "PUT") and
      (Json.parse(call.body.get) mustEqual Json.obj(
        "persistent" -> Json.obj("cluster.routing.allocation.enable" -> "primaries"),
        "transient" -> Json.obj("cluster.routing.allocation.enable" -> JsNull)
      ))
  }

  def enableAllocation = {
    val call = record(_.enableShardAllocation(server))
    Json.parse(call.body.get) mustEqual Json.obj(
      "persistent" -> Json.obj("cluster.routing.allocation.enable" -> JsNull),
      "transient" -> Json.obj("cluster.routing.allocation.enable" -> JsNull)
    )
  }

  def relocate = {
    val call = record(_.relocateShard(2, "logs \"q\"", "node-1", "node-2", server))
    (call.uri mustEqual "/_cluster/reroute") and
      (Json.parse(call.body.get) mustEqual Json.obj(
        "commands" -> Json.arr(Json.obj(
          "move" -> Json.obj("shard" -> 2, "index" -> "logs \"q\"", "from_node" -> "node-1", "to_node" -> "node-2")
        ))
      ))
  }

  def insightPaths = {
    (record(_.hotThreads(None, 3, "500ms", "cpu", true, server)).uri mustEqual
      "/_nodes/_all/hot_threads?threads=3&interval=500ms&type=cpu&ignore_idle_threads=true") and
      (record(_.hotThreads(Some("es node"), 5, "2s", "wait", false, server)).uri mustEqual
        "/_nodes/es%20node/hot_threads?threads=5&interval=2s&type=wait&ignore_idle_threads=false") and
      (record(_.nodeMetrics(true, server)).uri must startWith("/_nodes/stats/indices,jvm,os,process,thread_pool,indexing_pressure/indexing,search,get?timeout=10s&filter_path=_nodes,nodes.*.name,")) and
      (record(_.nodeMetrics(false, server)).uri must not(contain("indexing_pressure"))) and
      (record(_.resizeIndex("shrink", "logs", "logs small", Json.obj(), server)) mustEqual Call("/logs/_shrink/logs%20small", "POST", Some("{}"))) and
      (record(_.rollover("logs-write", None, Json.obj(), true, server)).uri mustEqual "/logs-write/_rollover?dry_run=true") and
      (record(_.rollover("logs-write", Some("logs-000002"), Json.obj(), false, server)).uri mustEqual "/logs-write/_rollover/logs-000002?dry_run=false") and
      (record(_.reindex(Json.obj(), Some("auto"), None, server)).uri mustEqual "/_reindex?wait_for_completion=false&slices=auto") and
      (record(_.getTask("node:42", server)).uri mustEqual "/_tasks/node%3A42") and
      (record(_.getTasks(Some("node:42"), server)).uri mustEqual "/_tasks?detailed=true&group_by=none&parent_task_id=node%3A42") and
      (record(_.getIndexRoutingShards("logs", server)).uri mustEqual "/_cluster/state/metadata/logs?filter_path=metadata.indices.*.routing_num_shards") and
      (record(_.lookupIndices("logs-*,orders", server)).uri must startWith("/_cat/indices/logs-*%2Corders?format=json&bytes=b&expand_wildcards=open,closed&h="))
  }

  def indexLists = {
    (record(_.getIndices(server)).uri mustEqual "/_cat/indices?format=json&h=index") and
      (record(_.getIndexStatuses(server)).uri mustEqual "/_cat/indices?format=json&h=index,status")
  }

}
