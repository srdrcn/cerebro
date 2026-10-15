package models.analysis

import org.specs2.Specification
import play.api.libs.json.Json

object OpenIndicesSpec extends Specification {

  def is =
    s2"""
    OpenIndices should
      keep the names of open indices                 $openOnly

      """

  // The rows `_cat/indices?format=json&h=index,status` returns.
  def openOnly = {
    val data = Json.parse(
      """
        |[
        |  {"index": "some_index", "status": "open"},
        |  {"index": "some_other_index", "status": "close"}
        |]
      """.stripMargin
    )
    OpenIndices(data) mustEqual Json.arr("some_index")
  }

}
