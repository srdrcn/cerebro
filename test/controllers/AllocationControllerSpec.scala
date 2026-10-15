package controllers

import elastic.Success
import models.{ElasticServer, Host}
import play.api.libs.json.Json
import play.api.test.FakeRequest
import play.api.test.Helpers._

import scala.concurrent.Future

object AllocationControllerSpec extends MockedServices {

  def is =
    s2"""
    AllocationController should                          ${step(play.api.Play.start(application))}
      explain the first unassigned shard without input   $explainAny
      explain a given shard                              $explainShard
      require the shard number with an index             $requireShard
                                                         ${step(play.api.Play.stop(application))}
      """

  private val server = ElasticServer(Host("somehost", None))
  private val explanation = Json.obj("index" -> "logs", "shard" -> 0, "current_state" -> "unassigned")

  def explainAny = {
    client.allocationExplain(None, server) returns Future.successful(Success(200, explanation))
    val response = route(application, FakeRequest(POST, "/allocation/explain").withBody(Json.obj("host" -> "somehost"))).get
    ensure(response, 200, explanation)
  }

  def explainShard = {
    val request = Json.obj("index" -> "logs", "shard" -> 1, "primary" -> false, "current_node" -> "node-1")
    client.allocationExplain(Some(request), server) returns Future.successful(Success(200, explanation))
    val body = Json.obj("host" -> "somehost") ++ request
    val response = route(application, FakeRequest(POST, "/allocation/explain").withBody(body)).get
    ensure(response, 200, explanation)
  }

  def requireShard = {
    val body = Json.obj("host" -> "somehost", "index" -> "logs", "primary" -> true)
    val response = route(application, FakeRequest(POST, "/allocation/explain").withBody(body)).get
    ensure(response, 400, Json.obj("error" -> "Missing required parameter shard"))
  }

}
