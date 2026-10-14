package controllers

import javax.inject.Inject

import controllers.auth.AuthenticationModule
import elastic.{ElasticClient, ElasticResponse, Error, Success}
import models.{CerebroResponse, ElasticServer, Hosts}
import play.api.libs.json.{JsArray, JsNull, JsValue, Json}

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future

class DataStreamsController @Inject()(val authentication: AuthenticationModule,
                                      val hosts: Hosts,
                                      client: ElasticClient) extends BaseController {

  def list = process { request =>
    // Clusters older than 7.11 reject expand_wildcards; they have no hidden streams to list.
    fetch(includeHidden = true, request.target).flatMap {
      case (Error(400, _), _) => fetch(includeHidden = false, request.target)
      case responses => Future.successful(responses)
    }.map {
      case (Success(_, body), statsResponse) =>
        val dataStreams: JsValue = (body \ "data_streams").asOpt[JsArray].getOrElse(Json.arr())
        val statsBody: JsValue = statsResponse match {
          case Success(_, value) => value
          case Error(_, _) => JsNull
        }
        CerebroResponse(200, Json.obj("data_streams" -> dataStreams, "stats" -> statsBody))
      case (Error(status, error), _) => CerebroResponse(status, error)
    }
  }

  private def fetch(includeHidden: Boolean, target: ElasticServer): Future[(ElasticResponse, ElasticResponse)] = {
    val streams = client.getDataStreams(includeHidden, target)
    val stats = client.getDataStreamStats(includeHidden, target)
    for {
      streamsResponse <- streams
      statsResponse <- stats
    } yield (streamsResponse, statsResponse)
  }

  def rollover = process { request =>
    client.rolloverDataStream(request.get("name"), request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

  def delete = process { request =>
    client.deleteDataStream(request.get("name"), request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

}
