package controllers

import elastic.{Error, Success}
import models.{ElasticServer, Host}
import play.api.libs.json.{JsNull, JsObject, Json}
import play.api.test.FakeRequest
import play.api.test.Helpers._

import scala.concurrent.Future

object DoctorControllerSpec extends MockedServices {

  def is =
    s2"""
    DoctorController should                              ${step(play.api.Play.start(application))}
      combine every diagnostic source                    $combine
      report sources Elasticsearch refused               $unavailable
      fail when the cluster health is unavailable        $healthFailure
      update the settings of several indices             $updateSettings
      reject an empty list of indices                    $emptyIndices
      retry failed shard allocations                     $retryAllocation
                                                         ${step(play.api.Play.stop(application))}
      """

  private val server = ElasticServer(Host("somehost", None))
  private val health = Json.obj("status" -> "yellow")
  private val nodes = Json.obj("nodes" -> Json.obj())
  private val ack = Json.obj("acknowledged" -> true)

  private def post(path: String, body: JsObject = Json.obj()) =
    route(application, FakeRequest(POST, path).withBody(Json.obj("host" -> "somehost") ++ body)).get

  private def mockSources(deprecations: elastic.ElasticResponse, healthReport: elastic.ElasticResponse) = {
    client.clusterHealth(server) returns Future.successful(Success(200, health))
    client.main(server) returns Future.successful(Success(200, Json.obj("version" -> Json.obj("number" -> "8.15.3"))))
    client.nodesStats(Seq("jvm", "fs", "os", "breaker"), server) returns Future.successful(Success(200, nodes))
    client.getClusterSettings(server) returns Future.successful(Success(200, Json.obj("defaults" -> Json.obj())))
    client.catIndexSizes(server) returns Future.successful(Success(200, Json.arr()))
    client.catShardSizes(server) returns Future.successful(Success(200, Json.arr()))
    client.indexBlocks(server) returns Future.successful(Success(200, Json.obj()))
    client.ilmErrors(server) returns Future.successful(Success(200, Json.obj("indices" -> Json.obj())))
    client.migrationDeprecations(server) returns Future.successful(deprecations)
    client.healthReport(server) returns Future.successful(healthReport)
  }

  def combine = {
    val report = Json.obj("status" -> "green", "indicators" -> Json.obj())
    mockSources(Success(200, Json.obj("cluster_settings" -> Json.arr())), Success(200, report))
    ensure(post("/doctor"), 200, Json.obj(
      "health" -> health,
      "info" -> Json.obj("version" -> Json.obj("number" -> "8.15.3")),
      "nodes" -> nodes,
      "settings" -> Json.obj("defaults" -> Json.obj()),
      "indices" -> Json.arr(),
      "shards" -> Json.arr(),
      "blocks" -> Json.obj(),
      "ilm" -> Json.obj("indices" -> Json.obj()),
      "deprecations" -> Json.obj("cluster_settings" -> Json.arr()),
      "health_report" -> report,
      "unavailable" -> Json.obj()
    ))
  }

  def unavailable = {
    val forbidden = Json.obj("error" -> Json.obj("type" -> "security_exception"))
    val missing = Json.obj("error" -> "no handler found for uri [/_health_report]")
    mockSources(Error(403, forbidden), Error(400, missing))
    val response = post("/doctor")
    val body = contentAsJson(response) \ "body"
    ((contentAsJson(response) \ "status").as[Int] must equalTo(200)) and
      ((body \ "deprecations").get must equalTo(JsNull)) and
      ((body \ "health_report").get must equalTo(JsNull)) and
      ((body \ "unavailable").get must equalTo(Json.obj(
        "deprecations" -> Json.obj("status" -> 403, "error" -> forbidden),
        "health_report" -> Json.obj("status" -> 400, "error" -> missing)
      )))
  }

  def healthFailure = {
    mockSources(Success(200, Json.obj()), Success(200, Json.obj()))
    val error = Json.obj("error" -> "unavailable")
    client.clusterHealth(server) returns Future.successful(Error(503, error))
    ensure(post("/doctor"), 503, error)
  }

  def updateSettings = {
    val settings = Json.obj("index.number_of_replicas" -> 1)
    client.updateIndexSettings("logs,metrics", settings, server) returns Future.successful(Success(200, ack))
    ensure(post("/doctor/index_settings", Json.obj("indices" -> Json.arr("logs", "metrics"), "settings" -> settings)), 200, ack)
  }

  def emptyIndices = {
    ensure(post("/doctor/index_settings", Json.obj("indices" -> Json.arr(), "settings" -> Json.obj())), 400, Json.obj("error" -> "No indices given"))
  }

  def retryAllocation = {
    client.retryFailedAllocations(server) returns Future.successful(Success(200, ack))
    ensure(post("/doctor/retry_allocation"), 200, ack)
  }

}
