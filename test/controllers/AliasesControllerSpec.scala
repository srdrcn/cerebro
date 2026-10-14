package controllers

import elastic.{Error, Success}
import models.{ElasticServer, Host}
import play.api.libs.json.Json
import play.api.test.FakeRequest
import play.api.test.Helpers._

import scala.concurrent.Future

object AliasesControllerSpec extends MockedServices {

  def is =
    s2"""
    AliasesController should                            ${step(play.api.Play.start(application))}
      return the aliases of every index                 $getAliases
      pass Elasticsearch errors through                 $getAliasesError
      apply alias changes                               $updateAliases
      send an empty action list without changes         $updateWithoutChanges
      require the host parameter                        $missingHost
                                                        ${step(play.api.Play.stop(application))}
      """

  val server = ElasticServer(Host("somehost", None))

  def getAliases = {
    val esResponse = Json.parse(
      """
        |{
        |  "logs-2026": {"aliases": {"logs": {"is_write_index": true}}},
        |  "metrics": {"aliases": {}}
        |}
      """.stripMargin
    )
    client.getAliases(server) returns Future.successful(Success(200, esResponse))
    val response = route(application, FakeRequest(POST, "/aliases/get_aliases").withBody(Json.obj("host" -> "somehost"))).get
    val aliases = (contentAsJson(response) \ "body").as[Seq[play.api.libs.json.JsObject]]
    (aliases.map(alias => ((alias \ "alias").as[String], (alias \ "index").as[String])) mustEqual Seq("logs" -> "logs-2026")) and
      ((aliases.head \ "is_write_index").as[Boolean] mustEqual true) and
      ((contentAsJson(response) \ "status").as[Int] mustEqual 200)
  }

  def getAliasesError = {
    val error = Json.obj("error" -> "cluster unavailable")
    client.getAliases(server) returns Future.successful(Error(503, error))
    val response = route(application, FakeRequest(POST, "/aliases/get_aliases").withBody(Json.obj("host" -> "somehost"))).get
    ensure(response, 503, error)
  }

  def updateAliases = {
    val changes = Seq(
      Json.obj("add" -> Json.obj("index" -> "logs-2026", "alias" -> "logs")),
      Json.obj("remove" -> Json.obj("index" -> "logs-2025", "alias" -> "logs"))
    )
    val acknowledged = Json.obj("acknowledged" -> true)
    client.updateAliases(changes, server) returns Future.successful(Success(200, acknowledged))
    val body = Json.obj("host" -> "somehost", "changes" -> changes)
    val response = route(application, FakeRequest(POST, "/aliases/update_aliases").withBody(body)).get
    ensure(response, 200, acknowledged)
  }

  def updateWithoutChanges = {
    val acknowledged = Json.obj("acknowledged" -> true)
    client.updateAliases(Seq(), server) returns Future.successful(Success(200, acknowledged))
    val response = route(application, FakeRequest(POST, "/aliases/update_aliases").withBody(Json.obj("host" -> "somehost"))).get
    ensure(response, 200, acknowledged) and (there was one(client).updateAliases(Seq(), server))
  }

  def missingHost = {
    val response = route(application, FakeRequest(POST, "/aliases/get_aliases").withBody(Json.obj())).get
    ensure(response, 400, Json.obj("error" -> "Missing required parameter host"))
  }

}
