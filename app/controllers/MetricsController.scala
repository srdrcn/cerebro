package controllers

import javax.inject.Inject

import controllers.auth.AuthenticationModule
import elastic.ElasticClient
import models.{CerebroResponse, Hosts}

import scala.concurrent.ExecutionContext.Implicits.global

class MetricsController @Inject()(val authentication: AuthenticationModule,
                                  val hosts: Hosts,
                                  client: ElasticClient) extends BaseController {

  // Cumulative counters per node; the browser turns successive samples into rates.
  def nodes = process { request =>
    client.nodeMetrics(request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

}
