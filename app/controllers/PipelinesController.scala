package controllers

import javax.inject.Inject

import controllers.auth.AuthenticationModule
import elastic.ElasticClient
import models.{CerebroResponse, Hosts}
import play.api.libs.json.Json

import scala.concurrent.ExecutionContext.Implicits.global

class PipelinesController @Inject()(val authentication: AuthenticationModule,
                                    val hosts: Hosts,
                                    client: ElasticClient) extends BaseController {

  def list = process { request =>
    client.getPipelines(request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

  def save = process { request =>
    val id = request.get("id")
    val pipeline = request.getObj("pipeline")
    client.putPipeline(id, pipeline, request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

  def delete = process { request =>
    client.deletePipeline(request.get("id"), request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

  def simulate = process { request =>
    val simulation = Json.obj(
      "pipeline" -> request.getObj("pipeline"),
      "docs" -> request.getArrayValue("docs")
    )
    val verbose = request.getBooleanOpt("verbose").getOrElse(false)
    client.simulatePipeline(simulation, verbose, request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

}
