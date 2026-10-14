package controllers

import elastic.{ElasticResponse, Error}

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future

/**
  * Runs an index-level request for many indices without exceeding the HTTP
  * line length Elasticsearch accepts (4 KB by default): indices are sent as
  * comma separated batches, one after the other, stopping at the first error.
  */
object IndexBatches {

  val MaxBatchLength = 2000

  def batches(indices: Seq[String]): Seq[String] =
    indices.foldLeft(Vector.empty[Vector[String]]) { (groups, index) =>
      groups.lastOption match {
        case Some(group) if (group :+ index).mkString(",").length <= MaxBatchLength =>
          groups.init :+ (group :+ index)
        case _ => groups :+ Vector(index)
      }
    }.map(_.mkString(","))

  /** `indices` must not be empty; the response of the last batch, or the first error. */
  def run(indices: Seq[String])(call: String => Future[ElasticResponse]): Future[ElasticResponse] = {
    val all = batches(indices)
    all.tail.foldLeft(call(all.head)) { (previous, batch) =>
      previous.flatMap {
        case error: Error => Future.successful(error)
        case _ => call(batch)
      }
    }
  }

}
