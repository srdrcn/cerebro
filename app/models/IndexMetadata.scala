package models

import play.api.libs.json.{JsObject, JsValue, Json}

object IndexMetadata {

  /**
    * Mappings and settings of `index` from `_cluster/state/metadata/<index>`.
    * On 8.x a data stream backing index brings its sibling backing indices
    * along, so the index is picked by name; an alias falls back to its first
    * index.
    */
  def apply(index: String, metadata: JsValue): JsObject = {
    val indices = (metadata \ "metadata" \ "indices").asOpt[JsObject].getOrElse(Json.obj())
    val entry = (indices \ index).asOpt[JsObject]
      .orElse(indices.values.collectFirst { case found: JsObject => found })
      .getOrElse(Json.obj())
    Json.obj("mappings" -> section(entry, "mappings"), "settings" -> section(entry, "settings"))
  }

  private def section(entry: JsObject, name: String): JsValue =
    (entry \ name).asOpt[JsValue].getOrElse(Json.obj())

}
