package controllers

import javax.inject.Inject

import controllers.auth.AuthenticationModule
import elastic.{ElasticClient, Error}
import models.{CerebroResponse, Hosts}

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future

class MetricsController @Inject()(val authentication: AuthenticationModule,
                                  val hosts: Hosts,
                                  client: ElasticClient) extends BaseController {

  // Cumulative counters per node; the browser turns successive samples into rates.
  // Clusters older than 7.9 reject the indexing_pressure metric.
  def nodes = process { request =>
    client.nodeMetrics(includeIndexingPressure = true, request.target).flatMap {
      case Error(400, _) => client.nodeMetrics(includeIndexingPressure = false, request.target)
      case response => Future.successful(response)
    }.map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

}
