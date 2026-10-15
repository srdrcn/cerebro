package controllers

import elastic.{ElasticResponse, Error, HTTPElasticClient}

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future

/**
  * Runs an index-level request for many indices without exceeding the HTTP
  * line length Elasticsearch accepts (4 KB by default): indices are sent as
  * comma separated batches, one after the other, stopping at the first error.
  * Batches are measured as they go on the wire: the client encodes the list
  * as one path segment, so each comma becomes %2C and other characters can
  * grow up to nine times.
  */
object IndexBatches {

  val MaxBatchLength = 2000

  def batches(indices: Seq[String]): Seq[String] =
    indices.foldLeft(Vector.empty[Vector[String]]) { (groups, index) =>
      groups.lastOption match {
        case Some(group) if encodedLength(group :+ index) <= MaxBatchLength =>
          groups.init :+ (group :+ index)
        case _ => groups :+ Vector(index)
      }
    }.map(_.mkString(","))

  def encodedLength(indices: Seq[String]): Int = HTTPElasticClient.encoded(indices.mkString(",")).length

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
