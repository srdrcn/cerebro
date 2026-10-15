package controllers

import elastic.{Error, Success}
import models.{ElasticServer, Host}
import play.api.libs.json.{JsNull, JsObject, Json}
import play.api.test.FakeRequest
import play.api.test.Helpers._

import scala.concurrent.Future

/** Tasks, recoveries, data streams, ILM and ingest pipeline endpoints. */
object OperationsControllersSpec extends MockedServices {

  def is =
    s2"""
    Operations controllers should                        ${step(play.api.Play.start(application))}
      list tasks                                         $listTasks
      list the sub-tasks of a task                       $listSubTasks
      cancel a task                                      $cancelTask
      require the task id to cancel                      $requireTaskId
      list active recoveries by default                  $activeRecoveries
      list all recoveries on request                     $allRecoveries
      list data streams with their stats                 $listDataStreams
      list data streams when stats are unavailable       $dataStreamsWithoutStats
      fall back to visible streams on older clusters     $dataStreamsWithoutHiddenSupport
      roll over a data stream                            $rollover
      delete a data stream                               $deleteDataStream
      list ILM policies                                  $ilmPolicies
      save an ILM policy                                 $saveIlmPolicy
      delete an ILM policy                               $deleteIlmPolicy
      explain the lifecycle of an index                  $explainIlm
      retry the failed lifecycle step of indices         $retryIlm
      require indices to retry                           $retryIlmEmpty
      list ingest pipelines                              $listPipelines
      save an ingest pipeline                            $savePipeline
      delete an ingest pipeline                          $deletePipeline
      simulate an ingest pipeline                        $simulatePipeline
      require documents to simulate                      $requireDocs
                                                         ${step(play.api.Play.stop(application))}
      """

  private val server = ElasticServer(Host("somehost", None))
  private val ack = Json.obj("acknowledged" -> true)

  private def post(path: String, body: JsObject = Json.obj()) =
    route(application, FakeRequest(POST, path).withBody(Json.obj("host" -> "somehost") ++ body)).get

  def listTasks = {
    val tasks = Json.obj("tasks" -> Json.arr(Json.obj("node" -> "n1", "id" -> 7, "action" -> "indices:data/write/reindex")))
    client.getTasks(None, server) returns Future.successful(Success(200, tasks))
    ensure(post("/tasks"), 200, tasks)
  }

  def listSubTasks = {
    val tasks = Json.obj("tasks" -> Json.arr())
    client.getTasks(Some("n1:7"), server) returns Future.successful(Success(200, tasks))
    ensure(post("/tasks", Json.obj("parent_task_id" -> "n1:7")), 200, tasks)
  }

  def cancelTask = {
    val cancelled = Json.obj("nodes" -> Json.obj())
    client.cancelTask("n1:7", server) returns Future.successful(Success(200, cancelled))
    ensure(post("/tasks/cancel", Json.obj("task_id" -> "n1:7")), 200, cancelled)
  }

  def requireTaskId =
    ensure(post("/tasks/cancel"), 400, Json.obj("error" -> "Missing required parameter task_id"))

  def activeRecoveries = {
    val recoveries = Json.arr(Json.obj("index" -> "logs", "stage" -> "index"))
    client.getRecoveries(true, server) returns Future.successful(Success(200, recoveries))
    ensure(post("/recovery"), 200, recoveries)
  }

  def allRecoveries = {
    client.getRecoveries(false, server) returns Future.successful(Success(200, Json.arr()))
    ensure(post("/recovery", Json.obj("active_only" -> false)), 200, Json.arr())
  }

  def listDataStreams = {
    val streams = Json.obj("data_streams" -> Json.arr(Json.obj("name" -> "logs-app")))
    val stats = Json.obj("data_stream_count" -> 1)
    client.getDataStreams(true, server) returns Future.successful(Success(200, streams))
    client.getDataStreamStats(true, server) returns Future.successful(Success(200, stats))
    ensure(post("/data_streams"), 200, Json.obj("data_streams" -> Json.arr(Json.obj("name" -> "logs-app")), "stats" -> stats))
  }

  def dataStreamsWithoutStats = {
    client.getDataStreams(true, server) returns Future.successful(Success(200, Json.obj("data_streams" -> Json.arr())))
    client.getDataStreamStats(true, server) returns Future.successful(Error(403, Json.obj("error" -> "forbidden")))
    ensure(post("/data_streams"), 200, Json.obj("data_streams" -> Json.arr(), "stats" -> JsNull))
  }

  def dataStreamsWithoutHiddenSupport = {
    val unrecognized = Json.obj("error" -> Json.obj("reason" -> "request [/_data_stream] contains unrecognized parameter: [expand_wildcards]"))
    val streams = Json.obj("data_streams" -> Json.arr(Json.obj("name" -> "logs-app")))
    val stats = Json.obj("data_stream_count" -> 1)
    client.getDataStreams(true, server) returns Future.successful(Error(400, unrecognized))
    client.getDataStreamStats(true, server) returns Future.successful(Error(400, unrecognized))
    client.getDataStreams(false, server) returns Future.successful(Success(200, streams))
    client.getDataStreamStats(false, server) returns Future.successful(Success(200, stats))
    ensure(post("/data_streams"), 200, Json.obj("data_streams" -> Json.arr(Json.obj("name" -> "logs-app")), "stats" -> stats))
  }

  def rollover = {
    val rolled = Json.obj("rolled_over" -> true)
    client.rolloverDataStream("logs-app", server) returns Future.successful(Success(200, rolled))
    ensure(post("/data_streams/rollover", Json.obj("name" -> "logs-app")), 200, rolled)
  }

  def deleteDataStream = {
    client.deleteDataStream("logs-app", server) returns Future.successful(Success(200, ack))
    ensure(post("/data_streams/delete", Json.obj("name" -> "logs-app")), 200, ack)
  }

  def ilmPolicies = {
    val policies = Json.obj("hot-warm" -> Json.obj("policy" -> Json.obj("phases" -> Json.obj())))
    client.getIlmPolicies(server) returns Future.successful(Success(200, policies))
    ensure(post("/ilm/policies"), 200, policies)
  }

  def saveIlmPolicy = {
    val policy = Json.obj("phases" -> Json.obj("delete" -> Json.obj("min_age" -> "30d")))
    client.putIlmPolicy("hot-warm", policy, server) returns Future.successful(Success(200, ack))
    ensure(post("/ilm/policies/save", Json.obj("name" -> "hot-warm", "policy" -> policy)), 200, ack)
  }

  def deleteIlmPolicy = {
    client.deleteIlmPolicy("hot-warm", server) returns Future.successful(Success(200, ack))
    ensure(post("/ilm/policies/delete", Json.obj("name" -> "hot-warm")), 200, ack)
  }

  def explainIlm = {
    val explanation = Json.obj("indices" -> Json.obj())
    client.explainIlm("logs", server) returns Future.successful(Success(200, explanation))
    ensure(post("/ilm/explain", Json.obj("index" -> "logs")), 200, explanation)
  }

  def retryIlm = {
    client.retryIlm("logs,metrics", server) returns Future.successful(Success(200, ack))
    ensure(post("/ilm/retry", Json.obj("indices" -> Json.arr("logs", "metrics"))), 200, ack)
  }

  def retryIlmEmpty =
    ensure(post("/ilm/retry", Json.obj("indices" -> Json.arr())), 400, Json.obj("error" -> "No indices given"))

  def listPipelines = {
    val pipelines = Json.obj("enrich" -> Json.obj("processors" -> Json.arr()))
    client.getPipelines(server) returns Future.successful(Success(200, pipelines))
    ensure(post("/pipelines"), 200, pipelines)
  }

  def savePipeline = {
    val pipeline = Json.obj("processors" -> Json.arr(Json.obj("lowercase" -> Json.obj("field" -> "level"))))
    client.putPipeline("enrich", pipeline, server) returns Future.successful(Success(200, ack))
    ensure(post("/pipelines/save", Json.obj("id" -> "enrich", "pipeline" -> pipeline)), 200, ack)
  }

  def deletePipeline = {
    client.deletePipeline("enrich", server) returns Future.successful(Success(200, ack))
    ensure(post("/pipelines/delete", Json.obj("id" -> "enrich")), 200, ack)
  }

  def simulatePipeline = {
    val pipeline = Json.obj("processors" -> Json.arr())
    val docs = Json.arr(Json.obj("_source" -> Json.obj("level" -> "INFO")))
    val result = Json.obj("docs" -> Json.arr())
    client.simulatePipeline(Json.obj("pipeline" -> pipeline, "docs" -> docs), true, server) returns
      Future.successful(Success(200, result))
    ensure(post("/pipelines/simulate", Json.obj("pipeline" -> pipeline, "docs" -> docs, "verbose" -> true)), 200, result)
  }

  def requireDocs =
    ensure(post("/pipelines/simulate", Json.obj("pipeline" -> Json.obj())), 400,
      Json.obj("error" -> "Missing required parameter docs"))

}
