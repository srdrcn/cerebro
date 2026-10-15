package controllers

import javax.inject.Inject

import controllers.auth.AuthenticationModule
import elastic.{ElasticClient, ElasticResponse, Error, HTTPElasticClient}
import exceptions.{InvalidParamException, MissingRequiredParamException}
import models.{CerebroRequest, CerebroResponse, Hosts, ShardStats}
import play.api.mvc.Result
import services.overview.OverviewDataService

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future

class ClusterOverviewController @Inject()(val authentication: AuthenticationModule,
                                          val hosts: Hosts,
                                          val service: OverviewDataService,
                                          client: ElasticClient) extends BaseController {

  def index = process { request =>
    service.overview(request.target).map(CerebroResponse(200, _))
  }

  def disableShardAllocation = process { request =>
    val kind = request.get("kind")
    if (!HTTPElasticClient.AllocationKinds.contains(kind)) {
      throw InvalidParamException("kind", HTTPElasticClient.AllocationKinds)
    }
    client.disableShardAllocation(request.target, kind).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

  def enableShardAllocation = process { request =>
    client.enableShardAllocation(request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

  def closeIndices = process { request =>
    inBatches(request)(batch => client.closeIndex(batch, request.target))
  }

  def openIndices = process { request =>
    inBatches(request)(batch => client.openIndex(batch, request.target))
  }

  def forceMerge = process { request =>
    inBatches(request)(batch => client.forceMerge(batch, request.target))
  }

  def clearIndexCache = process { request =>
    inBatches(request)(batch => client.clearIndexCache(batch, request.target))
  }

  def refreshIndex = process { request =>
    inBatches(request)(batch => client.refreshIndex(batch, request.target))
  }

  def flushIndex = process { request =>
    inBatches(request)(batch => client.flushIndex(batch, request.target))
  }

  def deleteIndex = process { request =>
    inBatches(request)(batch => client.deleteIndex(batch, request.target))
  }

  /**
    * `indices` is a comma separated list. Bulk actions on the overview can name
    * hundreds of indices, which would not fit in one request line, so they are
    * sent in batches (see IndexBatches); the answer is the last batch's, or the
    * first error.
    */
  private def inBatches(request: CerebroRequest)(call: String => Future[ElasticResponse]): Future[Result] = {
    val indices = request.get("indices").split(",").map(_.trim).filter(_.nonEmpty).toSeq
    if (indices.isEmpty) throw MissingRequiredParamException("indices")
    IndexBatches.run(indices)(call).map(response => CerebroResponse(response.status, response.body))
  }

  def getShardStats = process { request =>
    val index = request.get("index")
    val shard = request.getInt("shard")
    val node = request.get("node")
    Future.sequence(
      Seq(
        client.getShardStats(index, request.target),
        client.getIndexRecovery(index, request.target)
      )
    ).map { responses =>
      val failed = responses.find(_.isInstanceOf[Error])
      failed match {
        case None =>
          val stats = responses(0).body
          val recovery = responses(1).body
          CerebroResponse(200, ShardStats(index, node, shard, stats, recovery))
        case Some(f) =>
          CerebroResponse(f.status, f.body)
      }
    }
  }

  def relocateShard = process { request =>
    val index = request.get("index")
    val shard = request.getInt("shard")
    val from = request.get("from")
    val to = request.get("to")
    val server = request.target
    client.relocateShard(shard, index, from, to, server).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

}
