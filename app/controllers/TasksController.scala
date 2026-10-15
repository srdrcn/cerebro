package controllers

import javax.inject.Inject

import controllers.auth.AuthenticationModule
import elastic.ElasticClient
import models.{CerebroResponse, Hosts}

import scala.concurrent.ExecutionContext.Implicits.global

class TasksController @Inject()(val authentication: AuthenticationModule,
                                val hosts: Hosts,
                                client: ElasticClient) extends BaseController {

  def list = process { request =>
    client.getTasks(request.getOpt("parent_task_id").filter(_.nonEmpty), request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

  def get = process { request =>
    client.getTask(request.get("task_id"), request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

  def cancel = process { request =>
    client.cancelTask(request.get("task_id"), request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

}
