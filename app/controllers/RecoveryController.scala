package controllers

import javax.inject.Inject

import controllers.auth.AuthenticationModule
import elastic.ElasticClient
import models.{CerebroResponse, Hosts}

import scala.concurrent.ExecutionContext.Implicits.global

class RecoveryController @Inject()(val authentication: AuthenticationModule,
                                   val hosts: Hosts,
                                   client: ElasticClient) extends BaseController {

  def list = process { request =>
    val activeOnly = request.getBooleanOpt("active_only").getOrElse(true)
    client.getRecoveries(activeOnly, request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

}
