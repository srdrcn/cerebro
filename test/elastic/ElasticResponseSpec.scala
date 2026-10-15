package elastic

import org.specs2.Specification
import org.specs2.mock.Mockito
import play.api.libs.json.{JsString, Json}
import play.api.libs.ws.WSResponse

object ElasticResponseSpec extends Specification with Mockito {

  def is =
    s2"""
    ElasticResponse should
      parse JSON bodies of successful requests             $json
      keep plain text bodies of successful requests        $text
      wrap plain text errors                               $textError
      """

  private def response(status: Int, body: String) = {
    val response = mock[WSResponse]
    response.status returns status
    response.body returns body
    response.json returns Json.parse(body) // throws for text, like the real response
    response
  }

  private def textResponse(status: Int, body: String) = {
    val response = mock[WSResponse]
    response.status returns status
    response.body returns body
    response.json throws new RuntimeException("not JSON")
    response
  }

  def json = ElasticResponse(response(200, """{"acknowledged":true}""")) mustEqual Success(200, Json.obj("acknowledged" -> true))

  def text = ElasticResponse(textResponse(200, "epoch timestamp cluster status")) mustEqual Success(200, JsString("epoch timestamp cluster status"))

  def textError = ElasticResponse(textResponse(502, "Bad Gateway")) mustEqual Error(502, Json.obj("error" -> "Bad Gateway"))

}
