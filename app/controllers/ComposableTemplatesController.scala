package controllers

import javax.inject.Inject

import controllers.auth.AuthenticationModule
import elastic.ElasticClient
import models.{CerebroResponse, Hosts}

import scala.concurrent.ExecutionContext.Implicits.global

class ComposableTemplatesController @Inject()(val authentication: AuthenticationModule,
                                              val hosts: Hosts,
                                              client: ElasticClient) extends BaseController {

  def indexTemplates = process { request =>
    client.getIndexTemplates(request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

  def saveIndexTemplate = process { request =>
    val name = request.get("name")
    val template = request.getObj("template")
    client.putIndexTemplate(name, template, request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

  def deleteIndexTemplate = process { request =>
    client.deleteIndexTemplate(request.get("name"), request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

  def simulateIndexTemplate = process { request =>
    client.simulateIndexTemplate(request.get("name"), request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

  def componentTemplates = process { request =>
    client.getComponentTemplates(request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

  def saveComponentTemplate = process { request =>
    val name = request.get("name")
    val template = request.getObj("template")
    client.putComponentTemplate(name, template, request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

  def deleteComponentTemplate = process { request =>
    client.deleteComponentTemplate(request.get("name"), request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

}
