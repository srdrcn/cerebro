package controllers

import elastic.Success
import models.{ElasticServer, Host}
import play.api.libs.json.Json
import play.api.test.FakeRequest
import play.api.test.Helpers._

import scala.concurrent.Future

object ComposableTemplatesControllerSpec extends MockedServices {

  def is =
    s2"""
    ComposableTemplatesController should                 ${step(play.api.Play.start(application))}
      list index templates                               $listIndexTemplates
      save an index template                             $saveIndexTemplate
      require a template body                            $requireTemplate
      delete an index template                           $deleteIndexTemplate
      simulate an index template                         $simulateIndexTemplate
      list component templates                           $listComponentTemplates
      save a component template                          $saveComponentTemplate
      delete a component template                        $deleteComponentTemplate
                                                         ${step(play.api.Play.stop(application))}
      """

  private val server = ElasticServer(Host("somehost", None))
  private val ack = Json.obj("acknowledged" -> true)
  private val template = Json.obj("index_patterns" -> Json.arr("logs-*"), "composed_of" -> Json.arr("base"))

  private def post(path: String, body: play.api.libs.json.JsObject) =
    route(application, FakeRequest(POST, path).withBody(Json.obj("host" -> "somehost") ++ body)).get

  def listIndexTemplates = {
    val templates = Json.obj("index_templates" -> Json.arr(Json.obj("name" -> "logs", "index_template" -> template)))
    client.getIndexTemplates(server) returns Future.successful(Success(200, templates))
    ensure(post("/index_templates", Json.obj()), 200, templates)
  }

  def saveIndexTemplate = {
    client.putIndexTemplate("logs", template, server) returns Future.successful(Success(200, ack))
    ensure(post("/index_templates/save", Json.obj("name" -> "logs", "template" -> template)), 200, ack)
  }

  def requireTemplate =
    ensure(post("/index_templates/save", Json.obj("name" -> "logs")), 400,
      Json.obj("error" -> "Missing required parameter template"))

  def deleteIndexTemplate = {
    client.deleteIndexTemplate("logs", server) returns Future.successful(Success(200, ack))
    ensure(post("/index_templates/delete", Json.obj("name" -> "logs")), 200, ack)
  }

  def simulateIndexTemplate = {
    val simulated = Json.obj("template" -> Json.obj("settings" -> Json.obj()))
    client.simulateIndexTemplate("logs", server) returns Future.successful(Success(200, simulated))
    ensure(post("/index_templates/simulate", Json.obj("name" -> "logs")), 200, simulated)
  }

  def listComponentTemplates = {
    val templates = Json.obj("component_templates" -> Json.arr())
    client.getComponentTemplates(server) returns Future.successful(Success(200, templates))
    ensure(post("/component_templates", Json.obj()), 200, templates)
  }

  def saveComponentTemplate = {
    val component = Json.obj("template" -> Json.obj("settings" -> Json.obj("number_of_shards" -> 1)))
    client.putComponentTemplate("base", component, server) returns Future.successful(Success(200, ack))
    ensure(post("/component_templates/save", Json.obj("name" -> "base", "template" -> component)), 200, ack)
  }

  def deleteComponentTemplate = {
    client.deleteComponentTemplate("base", server) returns Future.successful(Success(200, ack))
    ensure(post("/component_templates/delete", Json.obj("name" -> "base")), 200, ack)
  }

}
