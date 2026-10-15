package controllers

import javax.inject.Inject

import controllers.auth.AuthenticationModule
import elastic.{ElasticClient, Error, Success}
import models.snapshot.{Repositories, Snapshots, Indices}
import models.{CerebroResponse, Hosts}
import play.api.libs.json.Json

import scala.concurrent.ExecutionContext.Implicits.global

class SnapshotsController @Inject()(val authentication: AuthenticationModule,
                                    val hosts: Hosts,
                                    client: ElasticClient) extends BaseController {

  // Elasticsearch errors (401, 403, …) are passed through with their reason.
  def get = process { request =>
    val indices = client.getIndices(request.target)
    val repositories = client.getRepositories(request.target)
    for {
      indicesResponse <- indices
      repositoriesResponse <- repositories
    } yield (indicesResponse, repositoriesResponse) match {
      case (Success(_, indicesBody), Success(_, repositoriesBody)) =>
        CerebroResponse(200, Json.obj(
          "indices" -> Indices(indicesBody),
          "repositories" -> Repositories(repositoriesBody)
        ))
      case (Error(status, error), _) => CerebroResponse(status, error)
      case (_, Error(status, error)) => CerebroResponse(status, error)
    }
  }

  def getSnapshots = process { request =>
    val repository = request.get("repository")
    client.getSnapshots(repository, request.target).map {
      case Success(status, snapshots) => CerebroResponse(status, Snapshots(snapshots))
      case Error(status, error) => CerebroResponse(status, error)
    }
  }

  def delete = process { request =>
    val repository = request.get("repository")
    val snapshot = request.get("snapshot")
    client.deleteSnapshot(repository, snapshot, request.target).map { response =>
      CerebroResponse(response.status, response.body)
    }
  }

  def create = process { request =>
    val repository = request.get("repository")
    val snapshot = request.get("snapshot")
    val indices = request.getAsStringArray("indices").map(_.mkString(","))
    val ignoreUnavailable = request.getBoolean("ignoreUnavailable")
    val includeGlobalState = request.getBoolean("includeGlobalState")
    client.createSnapshot(repository, snapshot, ignoreUnavailable,
      includeGlobalState, indices, request.target).map {
      response => CerebroResponse(response.status, response.body)
    }
  }

  def restore = process { request =>
    val repository = request.get("repository")
    val snapshot = request.get("snapshot")
    val renamePattern = request.getOpt("renamePattern")
    val renameReplacement = request.getOpt("renameReplacement")
    val ignoreUnavailable = request.getBoolean("ignoreUnavailable")
    val includeAliases = request.getBoolean("includeAliases")
    val includeGlobalState = request.getBoolean("includeGlobalState")
    val indices = request.getAsStringArray("indices").map(_.mkString(","))
    client.restoreSnapshot(repository, snapshot, renamePattern,
      renameReplacement, ignoreUnavailable, includeAliases, includeGlobalState,
      indices, request.target).map {
      response => CerebroResponse(response.status, response.body)
    }
  }
}
