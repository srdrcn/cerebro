package controllers

import java.sql.Date
import java.text.SimpleDateFormat

import javax.inject.Inject
import controllers.auth.AuthenticationModule
import dao.{RestHistoryDAO, RestRequest}
import elastic.{ElasticClient, Error, Success}
import models.rest.AutocompletionIndices
import models.{CerebroResponse, Hosts}
import play.api.libs.json.{JsArray, JsString, Json}

import scala.concurrent.ExecutionContext.Implicits.global
import scala.util.control.NonFatal
import play.api.Logger

class RestController @Inject()(val authentication: AuthenticationModule,
                               val hosts: Hosts,
                               client: ElasticClient,
                               restHistoryDAO: RestHistoryDAO) extends BaseController {

  private val logger = Logger("application")

  def request = process { request =>
    val method = request.get("method")
    val path = request.get("path")
    val body = request.getObjOpt("data")
    client.executeRequest(method, path, body, request.target).map {
      case s: Success =>
        val bodyAsString = body.map {
          case JsString(str) => str
          case other => other.toString()
        }.getOrElse("{}")
        val username = request.user.map(_.name).getOrElse("")
        restHistoryDAO.save(RestRequest(path, method, bodyAsString, username, new Date(System.currentTimeMillis)))
          .failed.foreach(e => logger.error("Error saving REST history", e))
        CerebroResponse(s.status, s.body)

      case e: Error => CerebroResponse(e.status, e.body)
    }
  }

  def index = process { request =>
    client.getAliases(request.target).map {
      case Success(status, body) =>
        val data = Json.obj(
          "indices" -> AutocompletionIndices(body),
          "host"    -> request.target.host.name
        )
        CerebroResponse(status, data)

      case Error(status, error) =>
        CerebroResponse(status, error)
    }
  }

  def history = process { request =>
    val dateFormat = new SimpleDateFormat("dd/MM HH:mm:ss")
    restHistoryDAO.all(request.user.map(_.name).getOrElse("")).map {
      case requests =>
        val body = requests.map { request =>
          Json.obj(
            "path" -> JsString(request.path),
            "method" -> JsString(request.method),
            "body" -> JsString(request.body),
            "created_at" -> JsString(dateFormat.format(request.createdAt))
          )
        }
        CerebroResponse(200, JsArray(body))
    }.recover {
      case NonFatal(e) =>
        CerebroResponse(500, Json.obj("error" -> JsString(s"Error while loading requests history: ${e.getMessage}")))
    }
  }

}
