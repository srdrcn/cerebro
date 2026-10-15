package controllers

import elastic.{Error, Success}
import models.{ElasticServer, Host}
import play.api.libs.json.{JsNull, Json}
import play.api.test.FakeRequest
import play.api.test.Helpers._

import scala.concurrent.Future

object IndexDetailControllerSpec extends MockedServices {

  def is =
    s2"""
    IndexDetailController should                         ${step(play.api.Play.start(application))}
      combine the sections of an index                   $combine
      return the settings error for a missing index      $missing
      read routing shards of an index opened by alias    $alias
      require the index                                  $requireIndex
                                                         ${step(play.api.Play.stop(application))}
      """

  private val server = ElasticServer(Host("somehost", None))
  private val settings = Json.obj("logs" -> Json.obj("settings" -> Json.obj()))
  private val mappings = Json.obj("logs" -> Json.obj("mappings" -> Json.obj()))
  private val stats = Json.obj("_all" -> Json.obj())
  private val shards = Json.arr(Json.obj("index" -> "logs", "shard" -> "0"))
  private val routing = Json.obj("metadata" -> Json.obj("indices" -> Json.obj("logs" -> Json.obj("routing_num_shards" -> 640))))

  private def mockSections(settingsResponse: elastic.ElasticResponse) = {
    client.getIndexSettings("logs", server) returns Future.successful(settingsResponse)
    client.getIndexMapping("logs", server) returns Future.successful(Success(200, mappings))
    client.indexStats("logs", server) returns Future.successful(Success(200, stats))
    client.getIndexAliases("logs", server) returns Future.successful(Error(403, Json.obj("error" -> "forbidden")))
    client.getIndexShards("logs", server) returns Future.successful(Success(200, shards))
    client.getIndexRoutingShards("logs", server) returns Future.successful(Success(200, routing))
  }

  def combine = {
    mockSections(Success(200, settings))
    val response = route(application, FakeRequest(POST, "/index_detail").withBody(Json.obj("host" -> "somehost", "index" -> "logs"))).get
    ensure(response, 200, Json.obj(
      "settings" -> settings,
      "mappings" -> mappings,
      "stats" -> stats,
      "aliases" -> JsNull,
      "shards" -> shards,
      "routing_num_shards" -> 640
    ))
  }

  def missing = {
    val error = Json.obj("error" -> Json.obj("type" -> "index_not_found_exception"))
    mockSections(Error(404, error))
    val response = route(application, FakeRequest(POST, "/index_detail").withBody(Json.obj("host" -> "somehost", "index" -> "logs"))).get
    ensure(response, 404, error)
  }

  // The cluster state is keyed by the concrete index, not by the alias asked for.
  def alias = {
    val target = Json.obj("logs-000002" -> Json.obj("settings" -> Json.obj()))
    client.getIndexSettings("logs-write", server) returns Future.successful(Success(200, target))
    client.getIndexMapping("logs-write", server) returns Future.successful(Success(200, mappings))
    client.indexStats("logs-write", server) returns Future.successful(Success(200, stats))
    client.getIndexAliases("logs-write", server) returns Future.successful(Success(200, Json.obj()))
    client.getIndexShards("logs-write", server) returns Future.successful(Success(200, shards))
    client.getIndexRoutingShards("logs-write", server) returns Future.successful(Success(200,
      Json.obj("metadata" -> Json.obj("indices" -> Json.obj("logs-000002" -> Json.obj("routing_num_shards" -> 1024))))))
    val response = route(application, FakeRequest(POST, "/index_detail").withBody(Json.obj("host" -> "somehost", "index" -> "logs-write"))).get
    (contentAsJson(response) \ "body" \ "routing_num_shards").as[Int] mustEqual 1024
  }

  def requireIndex = {
    val response = route(application, FakeRequest(POST, "/index_detail").withBody(Json.obj("host" -> "somehost"))).get
    ensure(response, 400, Json.obj("error" -> "Missing required parameter index"))
  }

}
