package controllers

import javax.inject.Inject

import controllers.auth.AuthenticationModule
import elastic.ElasticClient
import models.{CerebroResponse, Hosts}

import scala.concurrent.ExecutionContext.Implicits.global

class IlmController @Inject()(val authentication: AuthenticationModule,
                              val hosts: Hosts,
                              client: ElasticClient) extends BaseController {

  def policies = process { request =>
    client.getIlmPolicies(request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

  def save = process { request =>
    val name = request.get("name")
    val policy = request.getObj("policy")
    client.putIlmPolicy(name, policy, request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

  def delete = process { request =>
    client.deleteIlmPolicy(request.get("name"), request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

  def explain = process { request =>
    client.explainIlm(request.get("index"), request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

}
