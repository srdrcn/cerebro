package controllers

import javax.inject.Inject

import controllers.auth.AuthenticationModule
import elastic.{ElasticClient, Error, Success}
import models.{CerebroResponse, Hosts}
import play.api.libs.json.{JsArray, JsNull, JsValue, Json}

import scala.concurrent.ExecutionContext.Implicits.global

class DataStreamsController @Inject()(val authentication: AuthenticationModule,
                                      val hosts: Hosts,
                                      client: ElasticClient) extends BaseController {

  def list = process { request =>
    val streams = client.getDataStreams(request.target)
    val stats = client.getDataStreamStats(request.target)
    for {
      streamsResponse <- streams
      statsResponse <- stats
    } yield streamsResponse match {
      case Success(_, body) =>
        val dataStreams: JsValue = (body \ "data_streams").asOpt[JsArray].getOrElse(Json.arr())
        val statsBody: JsValue = statsResponse match {
          case Success(_, value) => value
          case Error(_, _) => JsNull
        }
        CerebroResponse(200, Json.obj("data_streams" -> dataStreams, "stats" -> statsBody))
      case Error(status, error) => CerebroResponse(status, error)
    }
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
