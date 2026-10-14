package models

import org.specs2.Specification
import play.api.libs.json.Json


object IndexMetadataSpec extends Specification {

  def is =
    s2"""
    IndexMetadata should
        should extract mappings and settings from metadata          $parse
        pick the requested index among sibling backing indices      $siblings
        fall back to the first index for an alias                   $alias

      """


  def parse = {
    val data = Json.parse(
      """
        |{
        |  "cluster_name": "elasticsearch",
        |  "metadata": {
        |    "cluster_uuid": "_na_",
        |    "templates": {},
        |    "indices": {
        |      "index_name": {
        |        "state": "open",
        |        "settings": {
        |          "some_settings": {
        |
        |          }
        |        },
        |        "mappings": {
        |          "some_mappings": {
        |
        |          }
        |        },
        |        "aliases": [
        |          "alias_1",
        |          "alias_2"
        |        ]
        |      }
        |    }
        |  }
        |}
      """.stripMargin
    )
    IndexMetadata("index_name", data) mustEqual Json.obj(
      "mappings" -> Json.obj("some_mappings" -> Json.obj()),
      "settings" -> Json.obj("some_settings" -> Json.obj())
    )
  }

  private val siblingsMetadata = Json.obj("metadata" -> Json.obj("indices" -> Json.obj(
    ".ds-logs-000001" -> Json.obj("settings" -> Json.obj("generation" -> 1), "mappings" -> Json.obj("first" -> true)),
    ".ds-logs-000002" -> Json.obj("settings" -> Json.obj("generation" -> 2), "mappings" -> Json.obj("second" -> true))
  )))

  def siblings =
    IndexMetadata(".ds-logs-000002", siblingsMetadata) mustEqual Json.obj(
      "mappings" -> Json.obj("second" -> true),
      "settings" -> Json.obj("generation" -> 2)
    )

  def alias =
    IndexMetadata("logs", siblingsMetadata) mustEqual Json.obj(
      "mappings" -> Json.obj("first" -> true),
      "settings" -> Json.obj("generation" -> 1)
    )

}
