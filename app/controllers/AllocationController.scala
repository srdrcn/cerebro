package controllers

import javax.inject.Inject

import controllers.auth.AuthenticationModule
import elastic.ElasticClient
import models.{CerebroResponse, Hosts}
import play.api.libs.json.{JsBoolean, JsNumber, JsObject, JsString}

import scala.concurrent.ExecutionContext.Implicits.global

class AllocationController @Inject()(val authentication: AuthenticationModule,
                                     val hosts: Hosts,
                                     client: ElasticClient) extends BaseController {

  // Without an index Elasticsearch explains the first unassigned shard it finds.
  def explain = process { request =>
    val shard = request.getOpt("index").map { index =>
      JsObject(
        Seq(
          "index" -> JsString(index),
          "shard" -> JsNumber(request.getInt("shard")),
          "primary" -> JsBoolean(request.getBoolean("primary"))
        ) ++ request.getOpt("current_node").map(node => "current_node" -> JsString(node))
      )
    }
    client.allocationExplain(shard, request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

}
