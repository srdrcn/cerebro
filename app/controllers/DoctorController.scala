package controllers

import javax.inject.Inject

import controllers.auth.AuthenticationModule
import elastic.{ElasticClient, ElasticResponse, Error, Success}
import models.{CerebroResponse, Hosts}
import play.api.libs.json.{JsNull, JsObject, JsValue, Json}

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future

class DoctorController @Inject()(val authentication: AuthenticationModule,
                                 val hosts: Hosts,
                                 client: ElasticClient) extends BaseController {

  // Cluster health decides whether the cluster answers. Every other source is
  // best effort: it comes back as null and is listed under "unavailable" with
  // the Elasticsearch error (missing privileges, older versions, no X-Pack).
  def check = process { request =>
    val target = request.target
    val health = client.clusterHealth(target)
    val sources: Seq[(String, Future[ElasticResponse])] = Seq(
      "info" -> client.main(target),
      "nodes" -> client.nodesStats(Seq("jvm", "fs", "os", "breaker"), target),
      "settings" -> client.getClusterSettings(target),
      "indices" -> client.catIndexSizes(target),
      "shards" -> client.catShardSizes(target),
      "blocks" -> client.indexBlocks(target),
      "ilm" -> client.ilmErrors(target),
      "deprecations" -> client.migrationDeprecations(target),
      "health_report" -> client.healthReport(target)
    )
    for {
      healthResponse <- health
      responses <- Future.sequence(sources.map { case (name, response) => response.map(name -> _) })
    } yield healthResponse match {
      case Success(_, healthBody) =>
        val bodies = responses.map { case (name, response) => name -> bodyOrNull(response) }
        val unavailable = responses.collect {
          case (name, Error(status, error)) => name -> Json.obj("status" -> status, "error" -> error)
        }
        CerebroResponse(200, JsObject(("health" -> healthBody) +: bodies) + ("unavailable" -> JsObject(unavailable)))
      case Error(status, error) => CerebroResponse(status, error)
    }
  }

  def retryAllocation = process { request =>
    client.retryFailedAllocations(request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

  private def bodyOrNull(response: ElasticResponse): JsValue = response match {
    case Success(_, body) => body
    case Error(_, _) => JsNull
  }

}
