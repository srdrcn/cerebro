package elastic

import play.api.libs.json.{JsString, JsValue, Json}
import play.api.libs.ws.WSResponse

import scala.util.Try

sealed trait ElasticResponse {

  val status: Int

  val body: JsValue

}

case class Success(status: Int, body: JsValue) extends ElasticResponse

case class Error(status: Int, body: JsValue) extends ElasticResponse

object ElasticResponse {

  def isSuccess(status: Int): Boolean = status >= 200 && status < 300

  def apply(response: WSResponse): ElasticResponse = {
    if (isSuccess(response.status)) {
      // Text APIs (hot threads, _cat without format=json) answer plain text.
      Success(response.status, Try(response.json).getOrElse(JsString(response.body)))
    } else {
      val body = Try(response.json).getOrElse(Json.obj("error" -> JsString(response.body)))
      Error(response.status, body)
    }
  }

}
