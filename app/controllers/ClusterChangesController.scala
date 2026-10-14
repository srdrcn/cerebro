package controllers

import javax.inject.Inject

import controllers.auth.AuthenticationModule
import models.{CerebroResponse, Hosts}
import services.cluster_changes.ClusterChangesDataService

import scala.concurrent.ExecutionContext.Implicits.global

class ClusterChangesController @Inject()(val authentication: AuthenticationModule,
                                         val hosts: Hosts,
                                         service: ClusterChangesDataService) extends BaseController {

  def get = process { request =>
    service.data(request.target).map(CerebroResponse(200, _))
  }

}
