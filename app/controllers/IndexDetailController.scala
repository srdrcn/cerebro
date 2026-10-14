package controllers

import javax.inject.Inject

import controllers.auth.AuthenticationModule
import elastic.{ElasticClient, ElasticResponse, Error, Success}
import models.{CerebroResponse, Hosts}
import play.api.libs.json.{JsNull, JsValue, Json}

import scala.concurrent.ExecutionContext.Implicits.global

class IndexDetailController @Inject()(val authentication: AuthenticationModule,
                                      val hosts: Hosts,
                                      client: ElasticClient) extends BaseController {

  // Settings decide whether the index exists; the other sections are best
  // effort and come back as null when Elasticsearch refuses them.
  def get = process { request =>
    val index = request.get("index")
    val target = request.target
    val settings = client.getIndexSettings(index, target)
    val mappings = client.getIndexMapping(index, target)
    val stats = client.indexStats(index, target)
    val aliases = client.getIndexAliases(index, target)
    val shards = client.getIndexShards(index, target)
    val routing = client.getIndexRoutingShards(index, target)
    for {
      settingsResponse <- settings
      mappingsResponse <- mappings
      statsResponse <- stats
      aliasesResponse <- aliases
      shardsResponse <- shards
      routingResponse <- routing
    } yield settingsResponse match {
      case Success(_, settingsBody) =>
        CerebroResponse(200, Json.obj(
          "settings" -> settingsBody,
          "mappings" -> bodyOrNull(mappingsResponse),
          "stats" -> bodyOrNull(statsResponse),
          "aliases" -> bodyOrNull(aliasesResponse),
          "shards" -> bodyOrNull(shardsResponse),
          "routing_num_shards" -> routingShards(index, routingResponse)
        ))
      case Error(status, error) => CerebroResponse(status, error)
    }
  }

  // GET _cluster/state/metadata/<index> → metadata.indices.<index>.routing_num_shards
  private def routingShards(index: String, response: ElasticResponse): JsValue = response match {
    case Success(_, body) => (body \ "metadata" \ "indices" \ index \ "routing_num_shards").asOpt[JsValue].getOrElse(JsNull)
    case Error(_, _) => JsNull
  }

  private def bodyOrNull(response: ElasticResponse): JsValue = response match {
    case Success(_, body) => body
    case Error(_, _) => JsNull
  }

}
