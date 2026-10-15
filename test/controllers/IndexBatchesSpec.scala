package controllers

import elastic.{ElasticResponse, Error, HTTPElasticClient, Success}
import org.specs2.Specification
import play.api.libs.json.Json

import scala.collection.mutable.ArrayBuffer
import scala.concurrent.Await
import scala.concurrent.Future
import scala.concurrent.duration._

object IndexBatchesSpec extends Specification {

  def is =
    s2"""
    IndexBatches should
      keep short lists in one batch                      $short
      split long lists below the length limit            $long
      measure batches as they are encoded in the URL     $encodedLength
      stop at the first failing batch                    $stopOnError
      """

  def short = IndexBatches.batches(Seq("logs", "metrics")) must equalTo(Seq("logs,metrics"))

  def long = {
    val indices = (1 to 300).map(n => f"logs-2026.10.$n%03d-000001")
    val batches = IndexBatches.batches(indices)
    (batches.size must beGreaterThan(1)) and
      (batches.forall(batch => HTTPElasticClient.encoded(batch).length <= IndexBatches.MaxBatchLength) must beTrue) and
      (batches.flatMap(_.split(",")) must equalTo(indices))
  }

  // Commas become %2C and each non-ASCII character up to nine characters.
  def encodedLength = {
    val indices = (1 to 200).map(n => s"journal-économie-$n")
    val batches = IndexBatches.batches(indices)
    (batches.size must beGreaterThan(2)) and
      (batches.forall(batch => HTTPElasticClient.encoded(batch).length <= IndexBatches.MaxBatchLength) must beTrue) and
      (batches.flatMap(_.split(",")) must equalTo(indices))
  }

  def stopOnError = {
    val indices = (1 to 300).map(n => f"logs-2026.10.$n%03d-000001")
    val calls = ArrayBuffer.empty[String]
    val error = Error(400, Json.obj("error" -> "boom"))
    val result = IndexBatches.run(indices) { batch =>
      calls += batch
      Future.successful[ElasticResponse](if (calls.size == 1) error else Success(200, Json.obj()))
    }
    (Await.result(result, 5.seconds) must equalTo(error)) and (calls.size must equalTo(1))
  }

}
