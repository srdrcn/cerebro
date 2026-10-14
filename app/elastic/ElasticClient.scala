package elastic

import com.google.inject.ImplementedBy
import models.ElasticServer
import play.api.libs.json._

import scala.concurrent.Future

@ImplementedBy(classOf[HTTPElasticClient])
trait ElasticClient {

  def main(target: ElasticServer): Future[ElasticResponse]

  def nodesStats(stats: Seq[String], target: ElasticServer): Future[ElasticResponse]

  def nodeStats(node: String, target: ElasticServer): Future[ElasticResponse]

  def indexStats(index: String, target: ElasticServer): Future[ElasticResponse]

  def clusterHealth(target: ElasticServer): Future[ElasticResponse]

  def nodes(flags: Seq[String], target: ElasticServer): Future[ElasticResponse]

  def closeIndex(index: String, target: ElasticServer): Future[ElasticResponse]

  def openIndex(index: String, target: ElasticServer): Future[ElasticResponse]

  def refreshIndex(index: String, target: ElasticServer): Future[ElasticResponse]

  def flushIndex(index: String, target: ElasticServer): Future[ElasticResponse]

  def forceMerge(index: String, target: ElasticServer): Future[ElasticResponse]

  def clearIndexCache(index: String, target: ElasticServer): Future[ElasticResponse]

  def deleteIndex(index: String, target: ElasticServer): Future[ElasticResponse]

  def getIndexSettings(index: String, target: ElasticServer): Future[ElasticResponse]

  def getIndexSettingsFlat(index: String, target: ElasticServer): Future[ElasticResponse]

  def getIndexMapping(index: String, target: ElasticServer): Future[ElasticResponse]

  def putClusterSettings(settings: String, target: ElasticServer): Future[ElasticResponse]

  def enableShardAllocation(target: ElasticServer): Future[ElasticResponse]

  def disableShardAllocation(target: ElasticServer, kind: String): Future[ElasticResponse]

  def getShardStats(index: String, target: ElasticServer): Future[ElasticResponse]

  def relocateShard(shard: Int, index: String, from: String, to: String, target: ElasticServer): Future[ElasticResponse]

  def getIndexRecovery(index: String, target: ElasticServer): Future[ElasticResponse]

  def getAliases(target: ElasticServer): Future[ElasticResponse]

  def updateAliases(changes: Seq[JsValue], target: ElasticServer): Future[ElasticResponse]

  def getIndexMetadata(index: String, target: ElasticServer): Future[ElasticResponse]

  def createIndex(index: String, metadata: JsValue, target: ElasticServer): Future[ElasticResponse]

  def getIndices(target: ElasticServer): Future[ElasticResponse]

  def getTemplates(target: ElasticServer): Future[ElasticResponse]

  def createTemplate(name: String, template: JsValue, target: ElasticServer): Future[ElasticResponse]

  def deleteTemplate(name: String, target: ElasticServer): Future[ElasticResponse]

  def analyzeTextByField(index: String, field: String, text: String, target: ElasticServer): Future[ElasticResponse]

  def analyzeTextByAnalyzer(index: String, analyzer: String, text: String, target: ElasticServer): Future[ElasticResponse]

  def getClusterSettings(target: ElasticServer): Future[ElasticResponse]

  // Repositories
  def getRepositories(target: ElasticServer): Future[ElasticResponse]

  def createRepository(name: String, repoType: String, settings: JsValue, target: ElasticServer): Future[ElasticResponse]

  def deleteRepository(name: String, target: ElasticServer): Future[ElasticResponse]

  // Snapshots
  def getSnapshots(repository: String, target: ElasticServer): Future[ElasticResponse]

  def deleteSnapshot(repository: String, snapshot: String, target: ElasticServer): Future[ElasticResponse]

  def createSnapshot(repository: String, snapshot: String, ignoreUnavailable: Boolean,
                     includeGlobalState: Boolean, indices: Option[String], target: ElasticServer): Future[ElasticResponse]

  def restoreSnapshot(repository: String, snapshot: String, renamePattern: Option[String],
                      renameReplacement: Option[String], ignoreUnavailable: Boolean, includeAliases: Boolean,
                      includeGlobalState: Boolean, indices: Option[String], target: ElasticServer): Future[ElasticResponse]

  def saveClusterSettings(settings: JsValue, target: ElasticServer): Future[ElasticResponse]

  def updateIndexSettings(index: String, settings: JsValue, target: ElasticServer): Future[ElasticResponse]

  // Cat requests
  def catRequest(api: String, target: ElasticServer): Future[ElasticResponse]

  // Cat master
  def catMaster(target: ElasticServer): Future[ElasticResponse]

  def executeRequest(method: String, path: String, data: Option[JsValue], target: ElasticServer): Future[ElasticResponse]

  // Shard allocation explain (explains the first unassigned shard without a request)
  def allocationExplain(request: Option[JsValue], target: ElasticServer): Future[ElasticResponse]

  // Composable index templates and component templates
  def getIndexTemplates(target: ElasticServer): Future[ElasticResponse]

  def putIndexTemplate(name: String, template: JsValue, target: ElasticServer): Future[ElasticResponse]

  def deleteIndexTemplate(name: String, target: ElasticServer): Future[ElasticResponse]

  def simulateIndexTemplate(name: String, target: ElasticServer): Future[ElasticResponse]

  def getComponentTemplates(target: ElasticServer): Future[ElasticResponse]

  def putComponentTemplate(name: String, template: JsValue, target: ElasticServer): Future[ElasticResponse]

  def deleteComponentTemplate(name: String, target: ElasticServer): Future[ElasticResponse]

  // Index details
  def getIndexAliases(index: String, target: ElasticServer): Future[ElasticResponse]

  def getIndexShards(index: String, target: ElasticServer): Future[ElasticResponse]

  // Tasks
  def getTasks(target: ElasticServer): Future[ElasticResponse]

  def cancelTask(taskId: String, target: ElasticServer): Future[ElasticResponse]

  // Data streams; includeHidden also lists hidden and system streams (Elasticsearch 7.11+)
  def getDataStreams(includeHidden: Boolean, target: ElasticServer): Future[ElasticResponse]

  def getDataStreamStats(includeHidden: Boolean, target: ElasticServer): Future[ElasticResponse]

  def rolloverDataStream(name: String, target: ElasticServer): Future[ElasticResponse]

  def deleteDataStream(name: String, target: ElasticServer): Future[ElasticResponse]

  // Index lifecycle management
  def getIlmPolicies(target: ElasticServer): Future[ElasticResponse]

  def putIlmPolicy(name: String, policy: JsValue, target: ElasticServer): Future[ElasticResponse]

  def deleteIlmPolicy(name: String, target: ElasticServer): Future[ElasticResponse]

  def explainIlm(index: String, target: ElasticServer): Future[ElasticResponse]

  def retryIlm(indices: String, target: ElasticServer): Future[ElasticResponse]

  // Ingest pipelines
  def getPipelines(target: ElasticServer): Future[ElasticResponse]

  def putPipeline(id: String, pipeline: JsValue, target: ElasticServer): Future[ElasticResponse]

  def deletePipeline(id: String, target: ElasticServer): Future[ElasticResponse]

  def simulatePipeline(request: JsValue, verbose: Boolean, target: ElasticServer): Future[ElasticResponse]

  // Shard recoveries
  def getRecoveries(activeOnly: Boolean, target: ElasticServer): Future[ElasticResponse]

  // Cluster doctor
  def healthReport(target: ElasticServer): Future[ElasticResponse]

  def migrationDeprecations(target: ElasticServer): Future[ElasticResponse]

  def ilmErrors(target: ElasticServer): Future[ElasticResponse]

  def indexBlocks(target: ElasticServer): Future[ElasticResponse]

  def catIndexSizes(target: ElasticServer): Future[ElasticResponse]

  def catShardSizes(target: ElasticServer): Future[ElasticResponse]

  def retryFailedAllocations(target: ElasticServer): Future[ElasticResponse]

  // Live metrics; indexing pressure exists from Elasticsearch 7.9
  def nodeMetrics(includeIndexingPressure: Boolean, target: ElasticServer): Future[ElasticResponse]

  // Performance diagnosis
  def hotThreads(node: Option[String], threads: Int, interval: String, kind: String, ignoreIdle: Boolean,
                 target: ElasticServer): Future[ElasticResponse]

  def catThreadPools(target: ElasticServer): Future[ElasticResponse]

  def pendingClusterTasks(target: ElasticServer): Future[ElasticResponse]

  def slowlogSettings(target: ElasticServer): Future[ElasticResponse]

  // Index operations
  def resizeIndex(kind: String, index: String, targetIndex: String, body: JsValue, target: ElasticServer): Future[ElasticResponse]

  def rollover(alias: String, newIndex: Option[String], body: JsValue, dryRun: Boolean, target: ElasticServer): Future[ElasticResponse]

  def reindex(body: JsValue, slices: Option[String], requestsPerSecond: Option[String], target: ElasticServer): Future[ElasticResponse]

  def getTask(taskId: String, target: ElasticServer): Future[ElasticResponse]

}
