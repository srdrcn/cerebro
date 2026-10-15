package controllers

import javax.inject.Inject

import controllers.auth.AuthenticationModule
import elastic.ElasticClient
import models.{CerebroResponse, Hosts}
import play.api.libs.json.Json

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future

class IndexOpsController @Inject()(val authentication: AuthenticationModule,
                                   val hosts: Hosts,
                                   client: ElasticClient) extends BaseController {

  private val ResizeKinds = Set("shrink", "split", "clone")
  private val Slices = "^(auto|[1-9][0-9]{0,3})$".r
  private val RequestsPerSecond = "^(-1|[0-9]+(\\.[0-9]+)?)$".r

  // Shrink, split or clone `index` into `target`; `body` carries settings and aliases.
  def resize = process { request =>
    val kind = request.get("kind")
    if (!ResizeKinds.contains(kind)) {
      Future.successful(CerebroResponse(400, Json.obj("error" -> s"Unknown resize operation $kind")))
    } else {
      val body = request.getObjOpt("body").getOrElse(Json.obj())
      client.resizeIndex(kind, request.get("index"), request.get("target"), body, request.target).map { response =>
        CerebroResponse(response.status, response.body)
      }
    }
  }

  def rollover = process { request =>
    val body = request.getObjOpt("body").getOrElse(Json.obj())
    val dryRun = request.getBooleanOpt("dry_run").getOrElse(false)
    val newIndex = request.getOpt("new_index").filter(_.nonEmpty)
    client.rollover(request.get("alias"), newIndex, body, dryRun, request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

  // Always runs as a background task: the response carries the task id to follow.
  def reindex = process { request =>
    val body = request.getObj("body")
    val slices = request.getOpt("slices").filter(_.nonEmpty)
    val requestsPerSecond = request.getOpt("requests_per_second").filter(_.nonEmpty)
    if (slices.exists(value => Slices.findFirstIn(value).isEmpty)) {
      Future.successful(CerebroResponse(400, Json.obj("error" -> "slices must be auto or a positive number")))
    } else if (requestsPerSecond.exists(value => RequestsPerSecond.findFirstIn(value).isEmpty)) {
      Future.successful(CerebroResponse(400, Json.obj("error" -> "requests_per_second must be a positive number or -1")))
    } else {
      client.reindex(body, slices, requestsPerSecond, request.target).map { response =>
        CerebroResponse(response.status, response.body)
      }
    }
  }

}
