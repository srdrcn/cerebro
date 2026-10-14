package models

import org.specs2.Specification
import play.api.libs.json.Json

object AliasesSpec extends Specification {

  def is =
    s2"""
    Aliases should

      flatten aliases per index with routing, filter and flags   $flatten
      skip indices without aliases                               $skipEmpty

      """

  def flatten = {
    val aliases = Json.parse(
      """
        |{
        |  "logs-1": {
        |    "aliases": {
        |      "logs": { "is_write_index": true, "is_hidden": true },
        |      "catalog": { "filter": { "term": { "a": 1 } }, "index_routing": "1", "search_routing": "1,2" }
        |    }
        |  }
        |}
      """.stripMargin
    )
    val expected = Json.parse(
      """
        |[
        |  {
        |    "alias": "logs", "index": "logs-1", "filter": null,
        |    "search_routing": null, "index_routing": null,
        |    "is_write_index": true, "is_hidden": true
        |  },
        |  {
        |    "alias": "catalog", "index": "logs-1", "filter": { "term": { "a": 1 } },
        |    "search_routing": "1,2", "index_routing": "1",
        |    "is_write_index": null, "is_hidden": null
        |  }
        |]
      """.stripMargin
    )
    Aliases(aliases).as[Seq[play.api.libs.json.JsObject]].toSet mustEqual
      expected.as[Seq[play.api.libs.json.JsObject]].toSet
  }

  def skipEmpty = {
    val aliases = Json.parse("""{ "a": { "aliases": {} }, "b": {} }""")
    Aliases(aliases) mustEqual Json.arr()
  }
}
