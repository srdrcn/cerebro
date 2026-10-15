package controllers

import javax.inject.Inject

import controllers.auth.AuthenticationModule
import elastic.ElasticClient
import models.{CerebroResponse, Hosts}
import play.api.libs.json.Json

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future

class PerformanceController @Inject()(val authentication: AuthenticationModule,
                                      val hosts: Hosts,
                                      client: ElasticClient) extends BaseController {

  private val Kinds = Set("cpu", "wait", "block", "mem")
  private val Interval = "^[1-9][0-9]{0,4}(ms|s)$".r

  // Elasticsearch answers in plain text; the body comes back as a JSON string.
  def hotThreads = process { request =>
    val node = request.getOpt("node").filter(_.nonEmpty)
    val threads = request.getIntOpt("threads").getOrElse(3)
    val interval = request.getOpt("interval").getOrElse("500ms")
    val kind = request.getOpt("type").getOrElse("cpu")
    val ignoreIdle = request.getBooleanOpt("ignore_idle_threads").getOrElse(true)
    if (threads < 1 || threads > 50) {
      Future.successful(CerebroResponse(400, Json.obj("error" -> "threads must be between 1 and 50")))
    } else if (Interval.findFirstIn(interval).isEmpty) {
      Future.successful(CerebroResponse(400, Json.obj("error" -> "interval must look like 500ms or 2s")))
    } else if (!Kinds.contains(kind)) {
      Future.successful(CerebroResponse(400, Json.obj("error" -> s"type must be one of ${Kinds.toSeq.sorted.mkString(", ")}")))
    } else {
      client.hotThreads(node, threads, interval, kind, ignoreIdle, request.target).map { response =>
        CerebroResponse(response.status, response.body)
      }
    }
  }

  def threadPools = process { request =>
    client.catThreadPools(request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

  def pendingTasks = process { request =>
    client.pendingClusterTasks(request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

  def slowlog = process { request =>
    client.slowlogSettings(request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

}
