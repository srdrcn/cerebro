package controllers

import javax.inject.Inject

import controllers.auth.AuthenticationModule
import elastic.ElasticClient
import models.{CerebroResponse, Hosts}
import play.api.libs.json.Json

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future

class IndexSettingsController @Inject()(val authentication: AuthenticationModule,
                                        val hosts: Hosts,
                                        client: ElasticClient) extends BaseController {

  def get = process { request =>
    client.getIndexSettingsFlat(request.get("index"), request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

  def update = process { request =>
    val index = request.get("index")
    val settings = request.getObj("settings")
    client.updateIndexSettings(index, settings, request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

  // The same settings for many indices, sent in batches (see IndexBatches).
  def bulkUpdate = process { request =>
    val indices = request.getArray("indices").toSeq
    val settings = request.getObj("settings")
    if (indices.isEmpty) {
      Future.successful(CerebroResponse(400, Json.obj("error" -> "No indices given")))
    } else {
      IndexBatches.run(indices)(batch => client.updateIndexSettings(batch, settings, request.target)).map { response =>
        CerebroResponse(response.status, response.body)
      }
    }
  }

}
