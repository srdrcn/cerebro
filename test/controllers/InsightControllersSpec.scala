package controllers

import elastic.{Error, Success}
import models.{ElasticServer, Host}
import play.api.libs.json.{JsObject, JsString, Json}
import play.api.test.FakeRequest
import play.api.test.Helpers._

import scala.concurrent.Future

object InsightControllersSpec extends MockedServices {

  def is =
    s2"""
    Metrics, performance and index operation controllers should ${step(play.api.Play.start(application))}
      return node metrics                                $nodeMetrics
      leave out indexing pressure before 7.9             $nodeMetricsBefore79
      return hot threads as text                         $hotThreads
      capture hot threads of one node with options       $hotThreadsOptions
      reject an unknown hot threads type                 $hotThreadsType
      reject an invalid hot threads interval             $hotThreadsInterval
      list thread pools                                  $threadPools
      list pending cluster tasks                         $pendingTasks
      read slow log settings                             $slowlog
      shrink an index                                    $shrink
      reject an unknown resize operation                 $unknownResize
      roll over an alias as a dry run                    $rolloverDryRun
      roll over into a named index                       $rolloverNamed
      start a reindex task                               $reindex
      reject invalid reindex slices                      $reindexSlices
      return a task                                      $getTask
                                                         ${step(play.api.Play.stop(application))}
      """

  private val server = ElasticServer(Host("somehost", None))
  private val ack = Json.obj("acknowledged" -> true)

  private def post(path: String, body: JsObject = Json.obj()) =
    route(application, FakeRequest(POST, path).withBody(Json.obj("host" -> "somehost") ++ body)).get

  def nodeMetrics = {
    val metrics = Json.obj("nodes" -> Json.obj("n1" -> Json.obj("name" -> "es-node-1")))
    client.nodeMetrics(true, server) returns Future.successful(Success(200, metrics))
    ensure(post("/metrics/nodes"), 200, metrics)
  }

  def nodeMetricsBefore79 = {
    val metrics = Json.obj("nodes" -> Json.obj("n1" -> Json.obj("name" -> "es-node-1")))
    val unknownMetric = Json.obj("error" -> Json.obj("reason" -> "request [/_nodes/stats] contains unrecognized metric: [indexing_pressure]"))
    client.nodeMetrics(true, server) returns Future.successful(Error(400, unknownMetric))
    client.nodeMetrics(false, server) returns Future.successful(Success(200, metrics))
    ensure(post("/metrics/nodes"), 200, metrics)
  }

  def hotThreads = {
    val text = JsString("::: {es-node-1}\n   Hot threads at ...")
    client.hotThreads(None, 3, "500ms", "cpu", true, server) returns Future.successful(Success(200, text))
    ensure(post("/performance/hot_threads"), 200, text)
  }

  def hotThreadsOptions = {
    val text = JsString("::: {es-node-2}")
    client.hotThreads(Some("es-node-2"), 10, "2s", "wait", false, server) returns Future.successful(Success(200, text))
    val options = Json.obj("node" -> "es-node-2", "threads" -> 10, "interval" -> "2s", "type" -> "wait", "ignore_idle_threads" -> false)
    ensure(post("/performance/hot_threads", options), 200, text)
  }

  def hotThreadsType =
    ensure(post("/performance/hot_threads", Json.obj("type" -> "gpu")), 400, Json.obj("error" -> "type must be one of block, cpu, mem, wait"))

  def hotThreadsInterval =
    ensure(post("/performance/hot_threads", Json.obj("interval" -> "1h")), 400, Json.obj("error" -> "interval must look like 500ms or 2s"))

  def threadPools = {
    val pools = Json.arr(Json.obj("node_name" -> "es-node-1", "name" -> "search", "rejected" -> "0"))
    client.catThreadPools(server) returns Future.successful(Success(200, pools))
    ensure(post("/performance/thread_pools"), 200, pools)
  }

  def pendingTasks = {
    val tasks = Json.obj("tasks" -> Json.arr())
    client.pendingClusterTasks(server) returns Future.successful(Success(200, tasks))
    ensure(post("/performance/pending_tasks"), 200, tasks)
  }

  def slowlog = {
    val settings = Json.obj("logs" -> Json.obj("settings" -> Json.obj("index.search.slowlog.threshold.query.warn" -> "10s")))
    client.slowlogSettings(server) returns Future.successful(Success(200, settings))
    ensure(post("/performance/slowlog"), 200, settings)
  }

  def shrink = {
    val body = Json.obj("settings" -> Json.obj("index.number_of_shards" -> 1))
    client.resizeIndex("shrink", "logs", "logs-shrunk", body, server) returns Future.successful(Success(200, ack))
    ensure(post("/index_ops/resize", Json.obj("kind" -> "shrink", "index" -> "logs", "target" -> "logs-shrunk", "body" -> body)), 200, ack)
  }

  def unknownResize =
    ensure(post("/index_ops/resize", Json.obj("kind" -> "merge", "index" -> "logs", "target" -> "x")), 400, Json.obj("error" -> "Unknown resize operation merge"))

  def rolloverDryRun = {
    val body = Json.obj("conditions" -> Json.obj("max_age" -> "7d"))
    val result = Json.obj("dry_run" -> true, "rolled_over" -> false)
    client.rollover("logs-write", None, body, true, server) returns Future.successful(Success(200, result))
    ensure(post("/index_ops/rollover", Json.obj("alias" -> "logs-write", "body" -> body, "dry_run" -> true)), 200, result)
  }

  def rolloverNamed = {
    val result = Json.obj("rolled_over" -> true)
    client.rollover("logs-write", Some("logs-000002"), Json.obj(), false, server) returns Future.successful(Success(200, result))
    ensure(post("/index_ops/rollover", Json.obj("alias" -> "logs-write", "new_index" -> "logs-000002")), 200, result)
  }

  def reindex = {
    val body = Json.obj("source" -> Json.obj("index" -> "logs"), "dest" -> Json.obj("index" -> "logs-copy"))
    val task = Json.obj("task" -> "node:42")
    client.reindex(body, Some("auto"), Some("500"), server) returns Future.successful(Success(200, task))
    ensure(post("/index_ops/reindex", Json.obj("body" -> body, "slices" -> "auto", "requests_per_second" -> "500")), 200, task)
  }

  def reindexSlices = {
    val body = Json.obj("source" -> Json.obj("index" -> "logs"), "dest" -> Json.obj("index" -> "logs-copy"))
    ensure(post("/index_ops/reindex", Json.obj("body" -> body, "slices" -> "many")), 400, Json.obj("error" -> "slices must be auto or a positive number"))
  }

  def getTask = {
    val task = Json.obj("completed" -> false, "task" -> Json.obj("status" -> Json.obj("total" -> 10, "created" -> 4)))
    client.getTask("node:42", server) returns Future.successful(Success(200, task))
    ensure(post("/tasks/get", Json.obj("task_id" -> "node:42")), 200, task)
  }

}
