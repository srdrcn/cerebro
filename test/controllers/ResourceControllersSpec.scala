package controllers

import elastic.{Error, Success}
import models.{ElasticServer, Host}
import play.api.libs.json.{JsObject, Json}
import play.api.test.FakeRequest
import play.api.test.Helpers._

import scala.concurrent.Future

/** Snapshots, repositories, index creation, cat APIs, nodes and the navbar. */
object ResourceControllersSpec extends MockedServices {

  def is =
    s2"""
    Resource controllers should                          ${step(play.api.Play.start(application))}
      list indices and repositories for snapshots        $snapshotsLanding
      pass a snapshot landing error through              $snapshotsLandingError
      pass a repositories error of the landing through   $snapshotsRepositoriesError
      list the snapshots of a repository                 $listSnapshots
      create a snapshot with the form options            $createSnapshot
      create a snapshot of every index                   $createSnapshotOfAll
      restore a snapshot with the form options           $restoreSnapshot
      delete a snapshot                                  $deleteSnapshot
      list repositories                                  $listRepositories
      save a repository                                  $saveRepository
      require the repository settings                    $requireRepositorySettings
      delete a repository                                $deleteRepository
      create an index                                    $createIndex
      create an index without metadata                   $createIndexWithoutMetadata
      read the metadata of an index to copy              $indexMetadata
      run a cat API                                      $cat
      require the cat API                                $requireCatApi
      pass a nodes error through                         $nodesError
      return the cluster health for the navbar           $navbar
      pass a navbar error through                        $navbarError
                                                         ${step(play.api.Play.stop(application))}
      """

  private val server = ElasticServer(Host("somehost", None))
  private val ack = Json.obj("acknowledged" -> true)
  private val unauthorized = Json.obj("error" -> Json.obj("type" -> "security_exception", "reason" -> "unable to authenticate"))

  private def post(path: String, body: JsObject = Json.obj()) =
    route(application, FakeRequest(POST, path).withBody(Json.obj("host" -> "somehost") ++ body)).get

  def snapshotsLanding = {
    client.getIndices(server) returns Future.successful(Success(200, Json.arr(Json.obj("index" -> "logs"), Json.obj("index" -> ".kibana"))))
    client.getRepositories(server) returns Future.successful(Success(200, Json.obj("backups" -> Json.obj("type" -> "fs"))))
    ensure(post("/snapshots"), 200, Json.obj(
      "indices" -> Json.arr(Json.obj("name" -> "logs", "special" -> false), Json.obj("name" -> ".kibana", "special" -> true)),
      "repositories" -> Json.arr("backups")
    ))
  }

  def snapshotsLandingError = {
    client.getIndices(server) returns Future.successful(Error(401, unauthorized))
    client.getRepositories(server) returns Future.successful(Error(401, unauthorized))
    ensure(post("/snapshots"), 401, unauthorized)
  }

  def snapshotsRepositoriesError = {
    val forbidden = Json.obj("error" -> Json.obj("type" -> "security_exception", "reason" -> "action [cluster:admin/repository/get] is unauthorized"))
    client.getIndices(server) returns Future.successful(Success(200, Json.arr(Json.obj("index" -> "logs"))))
    client.getRepositories(server) returns Future.successful(Error(403, forbidden))
    ensure(post("/snapshots"), 403, forbidden)
  }

  def listSnapshots = {
    client.getSnapshots("backups", server) returns Future.successful(Success(200, Json.obj("snapshots" -> Json.arr())))
    ensure(post("/snapshots/load", Json.obj("repository" -> "backups")), 200, Json.arr())
  }

  // The field names the snapshot page sends (snapshots.models.ts).
  def createSnapshot = {
    client.createSnapshot("backups", "nightly", false, true, Some("logs,metrics"), server) returns
      Future.successful(Success(200, Json.obj("accepted" -> true)))
    val form = Json.obj("repository" -> "backups", "snapshot" -> "nightly", "ignoreUnavailable" -> false,
      "includeGlobalState" -> true, "indices" -> Json.arr("logs", "metrics"))
    ensure(post("/snapshots/create", form), 200, Json.obj("accepted" -> true))
  }

  def createSnapshotOfAll = {
    client.createSnapshot("backups", "nightly", true, false, None, server) returns
      Future.successful(Success(200, Json.obj("accepted" -> true)))
    val form = Json.obj("repository" -> "backups", "snapshot" -> "nightly", "ignoreUnavailable" -> true,
      "includeGlobalState" -> false)
    ensure(post("/snapshots/create", form), 200, Json.obj("accepted" -> true))
  }

  def restoreSnapshot = {
    client.restoreSnapshot("backups", "nightly", Some("logs-(.+)"), Some("restored-$1"), true, false, false,
      Some("logs-1"), server) returns Future.successful(Success(200, Json.obj("accepted" -> true)))
    val form = Json.obj("repository" -> "backups", "snapshot" -> "nightly", "renamePattern" -> "logs-(.+)",
      "renameReplacement" -> "restored-$1", "ignoreUnavailable" -> true, "includeAliases" -> false,
      "includeGlobalState" -> false, "indices" -> Json.arr("logs-1"))
    ensure(post("/snapshots/restore", form), 200, Json.obj("accepted" -> true))
  }

  def deleteSnapshot = {
    client.deleteSnapshot("backups", "nightly", server) returns Future.successful(Success(200, ack))
    ensure(post("/snapshots/delete", Json.obj("repository" -> "backups", "snapshot" -> "nightly")), 200, ack)
  }

  def listRepositories = {
    val repositories = Json.obj("backups" -> Json.obj("type" -> "fs", "settings" -> Json.obj("location" -> "/backups")))
    client.getRepositories(server) returns Future.successful(Success(200, repositories))
    ensure(post("/repositories"), 200, Json.arr(
      Json.obj("name" -> "backups", "type" -> "fs", "settings" -> Json.obj("location" -> "/backups"))
    ))
  }

  def saveRepository = {
    val settings = Json.obj("location" -> "/backups")
    client.createRepository("backups", "fs", settings, server) returns Future.successful(Success(200, ack))
    ensure(post("/repositories/create", Json.obj("name" -> "backups", "type" -> "fs", "settings" -> settings)), 200, ack)
  }

  def requireRepositorySettings =
    ensure(post("/repositories/create", Json.obj("name" -> "backups", "type" -> "fs")), 400,
      Json.obj("error" -> "Missing required parameter settings"))

  def deleteRepository = {
    client.deleteRepository("backups", server) returns Future.successful(Success(200, ack))
    ensure(post("/repositories/delete", Json.obj("name" -> "backups")), 200, ack)
  }

  def createIndex = {
    val metadata = Json.obj("settings" -> Json.obj("number_of_shards" -> 1))
    val created = Json.obj("acknowledged" -> true, "index" -> "logs")
    client.createIndex("logs", metadata, server) returns Future.successful(Success(200, created))
    ensure(post("/create_index/create", Json.obj("index" -> "logs", "metadata" -> metadata)), 200, created)
  }

  def createIndexWithoutMetadata = {
    val created = Json.obj("acknowledged" -> true, "index" -> "logs")
    client.createIndex("logs", Json.obj(), server) returns Future.successful(Success(200, created))
    ensure(post("/create_index/create", Json.obj("index" -> "logs")), 200, created)
  }

  def indexMetadata = {
    val entry = Json.obj("mappings" -> Json.obj("properties" -> Json.obj()), "settings" -> Json.obj("index" -> Json.obj()))
    client.getIndexMetadata("logs", server) returns
      Future.successful(Success(200, Json.obj("metadata" -> Json.obj("indices" -> Json.obj("logs" -> entry)))))
    ensure(post("/create_index/get_index_metadata", Json.obj("index" -> "logs")), 200, entry)
  }

  def cat = {
    val rows = Json.arr(Json.obj("alias" -> "catalog", "index" -> "products"))
    client.catRequest("aliases", server) returns Future.successful(Success(200, rows))
    ensure(post("/cat", Json.obj("api" -> "aliases")), 200, rows)
  }

  def requireCatApi =
    ensure(post("/cat"), 400, Json.obj("error" -> "Missing required parameter api"))

  def nodesError = {
    client.nodes(Seq("jvm", "os"), server) returns Future.successful(Error(401, unauthorized))
    client.nodesStats(Seq("jvm", "fs", "os", "process"), server) returns Future.successful(Error(401, unauthorized))
    client.catMaster(server) returns Future.successful(Error(401, unauthorized))
    ensure(post("/nodes"), 401, unauthorized)
  }

  def navbar = {
    val health = Json.obj("cluster_name" -> "demo", "status" -> "yellow")
    client.clusterHealth(server) returns Future.successful(Success(200, health))
    ensure(post("/navbar"), 200, health)
  }

  def navbarError = {
    client.clusterHealth(server) returns Future.successful(Error(401, unauthorized))
    ensure(post("/navbar"), 401, unauthorized)
  }

}
