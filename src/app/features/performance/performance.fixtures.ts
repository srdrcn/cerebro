/**
 * Answers of the demo cluster (Elasticsearch 8.15.3, nodes es-node-1..3),
 * captured live and trimmed for the performance specs.
 */

/** `type=cpu&threads=4&interval=1s` under a wildcard search load: es-node-3 idle (no thread), three search_worker threads on es-node-2 with several stacks, the busiest es-node-1 search thread with a unique snapshot. */
export const BUSY_CPU_CAPTURE = "::: {es-node-3}{dmdk_a7-TrKWtlTZ9-ZHzQ}{gqH15Zf4TKOjKCGHn3zj6A}{es-node-3}{127.0.0.1}{127.0.0.1:9302}{cdfhilmrstw}{8.15.3}{7000099-8512000}{transform.config_version=10.0.0, rack=r3, ml.config_version=12.0.0, zone=zone-1, xpack.installed=true}\n   Hot threads at 2026-10-14T21:25:04.783Z, interval=1s, busiestThreads=4, ignoreIdleThreads=true:\n\n::: {es-node-2}{wEqTWTA0T2CktRBr56viXg}{LePZvWKVS2e3SN1Nkg6biA}{es-node-2}{127.0.0.1}{127.0.0.1:9301}{cdfhilmrstw}{8.15.3}{7000099-8512000}{rack=r2, transform.config_version=10.0.0, ml.config_version=12.0.0, zone=zone-2, xpack.installed=true}\n   Hot threads at 2026-10-14T21:25:04.715Z, interval=1s, busiestThreads=4, ignoreIdleThreads=true:\n   \n   90.9% [cpu=6.9%, other=84.0%] (909ms out of 1s) cpu usage by thread 'elasticsearch[es-node-2][search_worker][T#6]'\n     2/10 snapshots sharing following 12 elements\n       java.base@22.0.1/jdk.internal.misc.Unsafe.unpark(Native Method)\n       java.base@22.0.1/java.util.concurrent.locks.LockSupport.unpark(LockSupport.java:181)\n       java.base@22.0.1/java.util.concurrent.FutureTask.finishCompletion(FutureTask.java:422)\n       java.base@22.0.1/java.util.concurrent.FutureTask.set(FutureTask.java:285)\n       java.base@22.0.1/java.util.concurrent.FutureTask.run(FutureTask.java:325)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.TimedRunnable.doRun(TimedRunnable.java:33)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.ThreadContext$ContextPreservingAbstractRunnable.doRun(ThreadContext.java:984)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.AbstractRunnable.run(AbstractRunnable.java:26)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1144)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n     2/10 snapshots sharing following 25 elements\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.codecs.lucene90.blocktree.IntersectTermsEnum.next(IntersectTermsEnum.java:377)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.index.FilterLeafReader$FilterTermsEnum.next(FilterLeafReader.java:201)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ExitableDirectoryReader$ExitableTermsEnum.next(ExitableDirectoryReader.java:252)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.MultiTermQueryConstantScoreBlendedWrapper$1.rewriteInner(MultiTermQueryConstantScoreBlendedWrapper.java:111)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.AbstractMultiTermQueryConstantScoreWrapper$RewritingWeight.rewrite(AbstractMultiTermQueryConstantScoreWrapper.java:179)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.AbstractMultiTermQueryConstantScoreWrapper$RewritingWeight$1.get(AbstractMultiTermQueryConstantScoreWrapper.java:269)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.DisjunctionMaxQuery$DisjunctionMaxWeight$1.get(DisjunctionMaxQuery.java:154)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.Weight.bulkScorer(Weight.java:173)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.BooleanWeight.optionalBulkScorer(BooleanWeight.java:234)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.BooleanWeight.booleanScorer(BooleanWeight.java:373)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.BooleanWeight.bulkScorer(BooleanWeight.java:443)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.searchLeaf(ContextIndexSearcher.java:430)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.search(ContextIndexSearcher.java:365)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.lambda$search$3(ContextIndexSearcher.java:350)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher$$Lambda/0x00007f8f5c491138.call(Unknown Source)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.TaskExecutor$TaskGroup.lambda$createTask$0(TaskExecutor.java:117)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.TaskExecutor$TaskGroup$$Lambda/0x00007f8f5c396238.call(Unknown Source)\n       java.base@22.0.1/java.util.concurrent.FutureTask.run(FutureTask.java:317)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.TimedRunnable.doRun(TimedRunnable.java:33)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.ThreadContext$ContextPreservingAbstractRunnable.doRun(ThreadContext.java:984)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.AbstractRunnable.run(AbstractRunnable.java:26)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1144)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n     6/10 snapshots sharing following 3 elements\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n   \n   88.5% [cpu=11.4%, other=77.1%] (885ms out of 1s) cpu usage by thread 'elasticsearch[es-node-2][search_worker][T#5]'\n     2/10 snapshots sharing following 19 elements\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.DisjunctionMaxQuery$DisjunctionMaxWeight$1.get(DisjunctionMaxQuery.java:154)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.Weight.bulkScorer(Weight.java:173)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.BooleanWeight.optionalBulkScorer(BooleanWeight.java:234)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.BooleanWeight.booleanScorer(BooleanWeight.java:373)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.BooleanWeight.bulkScorer(BooleanWeight.java:443)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.searchLeaf(ContextIndexSearcher.java:430)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.search(ContextIndexSearcher.java:365)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.lambda$search$3(ContextIndexSearcher.java:350)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher$$Lambda/0x00007f8f5c491138.call(Unknown Source)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.TaskExecutor$TaskGroup.lambda$createTask$0(TaskExecutor.java:117)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.TaskExecutor$TaskGroup$$Lambda/0x00007f8f5c396238.call(Unknown Source)\n       java.base@22.0.1/java.util.concurrent.FutureTask.run(FutureTask.java:317)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.TimedRunnable.doRun(TimedRunnable.java:33)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.ThreadContext$ContextPreservingAbstractRunnable.doRun(ThreadContext.java:984)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.AbstractRunnable.run(AbstractRunnable.java:26)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1144)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n     3/10 snapshots sharing following 19 elements\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.BooleanScorer.scoreWindowMultipleScorers(BooleanScorer.java:309)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.BooleanScorer.scoreWindow(BooleanScorer.java:362)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.BooleanScorer.score(BooleanScorer.java:374)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.CancellableBulkScorer.score(CancellableBulkScorer.java:45)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.BulkScorer.score(BulkScorer.java:38)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.searchLeaf(ContextIndexSearcher.java:436)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.search(ContextIndexSearcher.java:365)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.lambda$search$3(ContextIndexSearcher.java:350)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher$$Lambda/0x00007f8f5c491138.call(Unknown Source)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.TaskExecutor$TaskGroup.lambda$createTask$0(TaskExecutor.java:117)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.TaskExecutor$TaskGroup$$Lambda/0x00007f8f5c396238.call(Unknown Source)\n       java.base@22.0.1/java.util.concurrent.FutureTask.run(FutureTask.java:317)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.TimedRunnable.doRun(TimedRunnable.java:33)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.ThreadContext$ContextPreservingAbstractRunnable.doRun(ThreadContext.java:984)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.AbstractRunnable.run(AbstractRunnable.java:26)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1144)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n     4/10 snapshots sharing following 10 elements\n       java.base@22.0.1/jdk.internal.misc.Unsafe.park(Native Method)\n       java.base@22.0.1/java.util.concurrent.locks.LockSupport.park(LockSupport.java:371)\n       java.base@22.0.1/java.util.concurrent.LinkedTransferQueue$DualNode.await(LinkedTransferQueue.java:458)\n       java.base@22.0.1/java.util.concurrent.LinkedTransferQueue.xfer(LinkedTransferQueue.java:613)\n       java.base@22.0.1/java.util.concurrent.LinkedTransferQueue.take(LinkedTransferQueue.java:1257)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.getTask(ThreadPoolExecutor.java:1070)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1130)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n   \n   88.4% [cpu=9.2%, other=79.2%] (884ms out of 1s) cpu usage by thread 'elasticsearch[es-node-2][search_worker][T#7]'\n     2/10 snapshots sharing following 13 elements\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.search(ContextIndexSearcher.java:365)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.lambda$search$3(ContextIndexSearcher.java:350)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher$$Lambda/0x00007f8f5c491138.call(Unknown Source)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.TaskExecutor$TaskGroup.lambda$createTask$0(TaskExecutor.java:117)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.TaskExecutor$TaskGroup$$Lambda/0x00007f8f5c396238.call(Unknown Source)\n       java.base@22.0.1/java.util.concurrent.FutureTask.run(FutureTask.java:317)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.TimedRunnable.doRun(TimedRunnable.java:33)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.ThreadContext$ContextPreservingAbstractRunnable.doRun(ThreadContext.java:984)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.AbstractRunnable.run(AbstractRunnable.java:26)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1144)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n     5/10 snapshots sharing following 10 elements\n       java.base@22.0.1/jdk.internal.misc.Unsafe.park(Native Method)\n       java.base@22.0.1/java.util.concurrent.locks.LockSupport.park(LockSupport.java:371)\n       java.base@22.0.1/java.util.concurrent.LinkedTransferQueue$DualNode.await(LinkedTransferQueue.java:458)\n       java.base@22.0.1/java.util.concurrent.LinkedTransferQueue.xfer(LinkedTransferQueue.java:613)\n       java.base@22.0.1/java.util.concurrent.LinkedTransferQueue.take(LinkedTransferQueue.java:1257)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.getTask(ThreadPoolExecutor.java:1070)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1130)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n     2/10 snapshots sharing following 3 elements\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n\n::: {es-node-1}{I7MELLk0RvSiAPhRW6211Q}{PmMqJWbnQNSpiMldpxbnjA}{es-node-1}{127.0.0.1}{127.0.0.1:9300}{cdfhilmrstw}{8.15.3}{7000099-8512000}{transform.config_version=10.0.0, rack=r1, ml.config_version=12.0.0, zone=zone-1, xpack.installed=true}\n   Hot threads at 2026-10-14T21:25:04.709Z, interval=1s, busiestThreads=4, ignoreIdleThreads=true:\n   \n   82.4% [cpu=6.7%, other=75.7%] (824ms out of 1s) cpu usage by thread 'elasticsearch[es-node-1][search][T#1]'\n     5/10 snapshots sharing following 26 elements\n       java.base@22.0.1/jdk.internal.misc.Unsafe.park(Native Method)\n       java.base@22.0.1/java.util.concurrent.locks.LockSupport.park(LockSupport.java:221)\n       java.base@22.0.1/java.util.concurrent.FutureTask.awaitDone(FutureTask.java:500)\n       java.base@22.0.1/java.util.concurrent.FutureTask.get(FutureTask.java:190)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.TaskExecutor$TaskGroup.invokeAll(TaskExecutor.java:159)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.TaskExecutor.invokeAll(TaskExecutor.java:76)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.search(ContextIndexSearcher.java:354)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.search(ContextIndexSearcher.java:318)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.query.QueryPhase.addCollectorsAndSearch(QueryPhase.java:205)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.query.QueryPhase.executeQuery(QueryPhase.java:135)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.query.QueryPhase.execute(QueryPhase.java:62)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService.loadOrExecuteQueryPhase(SearchService.java:531)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService.executeQueryPhase(SearchService.java:689)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService.lambda$executeQueryPhase$2(SearchService.java:558)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService$$Lambda/0x00007f2c44035d40.get(Unknown Source)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.action.ActionRunnable$3.accept(ActionRunnable.java:78)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.action.ActionRunnable$3.accept(ActionRunnable.java:75)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.action.ActionRunnable$4.doRun(ActionRunnable.java:100)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.AbstractRunnable.run(AbstractRunnable.java:26)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.TimedRunnable.doRun(TimedRunnable.java:33)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.ThreadContext$ContextPreservingAbstractRunnable.doRun(ThreadContext.java:984)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.AbstractRunnable.run(AbstractRunnable.java:26)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1144)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n     2/10 snapshots sharing following 46 elements\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.util.Sorter.binarySort(Sorter.java:230)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.util.Sorter.binarySort(Sorter.java:212)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.util.InPlaceMergeSorter.mergeSort(InPlaceMergeSorter.java:42)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.util.InPlaceMergeSorter.mergeSort(InPlaceMergeSorter.java:46)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.util.InPlaceMergeSorter.mergeSort(InPlaceMergeSorter.java:46)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.util.InPlaceMergeSorter.mergeSort(InPlaceMergeSorter.java:46)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.util.InPlaceMergeSorter.sort(InPlaceMergeSorter.java:37)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.util.automaton.Automaton$Builder.finish(Automaton.java:872)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.util.automaton.Operations.getLiveStatesToAccept(Operations.java:976)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.util.automaton.Operations.getLiveStates(Operations.java:928)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.util.automaton.Operations.removeDeadStates(Operations.java:1009)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.util.automaton.Operations.getCommonSuffixBytesRef(Operations.java:1206)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.util.automaton.CompiledAutomaton.<init>(CompiledAutomaton.java:244)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.AutomatonQuery.<init>(AutomatonQuery.java:124)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.WildcardQuery.<init>(WildcardQuery.java:75)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.index.mapper.StringFieldType.wildcardQuery(StringFieldType.java:176)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.index.mapper.StringFieldType.normalizedWildcardQuery(StringFieldType.java:147)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.index.mapper.KeywordFieldMapper$KeywordFieldType.normalizedWildcardQuery(KeywordFieldMapper.java:779)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.index.search.QueryStringQueryParser.getWildcardQuerySingle(QueryStringQueryParser.java:707)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.index.search.QueryStringQueryParser.getWildcardQuery(QueryStringQueryParser.java:677)\n       app/org.apache.lucene.queryparser@9.11.1/org.apache.lucene.queryparser.classic.QueryParserBase.handleBareTokenQuery(QueryParserBase.java:815)\n       app/org.apache.lucene.queryparser@9.11.1/org.apache.lucene.queryparser.classic.QueryParser.Term(QueryParser.java:492)\n       app/org.apache.lucene.queryparser@9.11.1/org.apache.lucene.queryparser.classic.QueryParser.Clause(QueryParser.java:364)\n       app/org.apache.lucene.queryparser@9.11.1/org.apache.lucene.queryparser.classic.QueryParser.Query(QueryParser.java:249)\n       app/org.apache.lucene.queryparser@9.11.1/org.apache.lucene.queryparser.classic.QueryParser.TopLevelQuery(QueryParser.java:221)\n       app/org.apache.lucene.queryparser@9.11.1/org.apache.lucene.queryparser.classic.QueryParserBase.parse(QueryParserBase.java:137)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.index.search.QueryStringQueryParser.parse(QueryStringQueryParser.java:833)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.index.query.QueryStringQueryBuilder.doToQuery(QueryStringQueryBuilder.java:943)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.index.query.AbstractQueryBuilder.toQuery(AbstractQueryBuilder.java:117)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.index.query.SearchExecutionContext.toQuery(SearchExecutionContext.java:540)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService.parseSource(SearchService.java:1287)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService.createContext(SearchService.java:1081)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService.executeQueryPhase(SearchService.java:684)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService.lambda$executeQueryPhase$2(SearchService.java:558)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService$$Lambda/0x00007f2c44035d40.get(Unknown Source)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.action.ActionRunnable$3.accept(ActionRunnable.java:78)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.action.ActionRunnable$3.accept(ActionRunnable.java:75)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.action.ActionRunnable$4.doRun(ActionRunnable.java:100)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.AbstractRunnable.run(AbstractRunnable.java:26)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.TimedRunnable.doRun(TimedRunnable.java:33)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.ThreadContext$ContextPreservingAbstractRunnable.doRun(ThreadContext.java:984)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.AbstractRunnable.run(AbstractRunnable.java:26)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1144)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n     2/10 snapshots sharing following 22 elements\n       app/org.apache.lucene.queryparser@9.11.1/org.apache.lucene.queryparser.classic.QueryParser.TopLevelQuery(QueryParser.java:221)\n       app/org.apache.lucene.queryparser@9.11.1/org.apache.lucene.queryparser.classic.QueryParserBase.parse(QueryParserBase.java:137)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.index.search.QueryStringQueryParser.parse(QueryStringQueryParser.java:833)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.index.query.QueryStringQueryBuilder.doToQuery(QueryStringQueryBuilder.java:943)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.index.query.AbstractQueryBuilder.toQuery(AbstractQueryBuilder.java:117)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.index.query.SearchExecutionContext.toQuery(SearchExecutionContext.java:540)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService.parseSource(SearchService.java:1287)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService.createContext(SearchService.java:1081)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService.executeQueryPhase(SearchService.java:684)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService.lambda$executeQueryPhase$2(SearchService.java:558)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService$$Lambda/0x00007f2c44035d40.get(Unknown Source)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.action.ActionRunnable$3.accept(ActionRunnable.java:78)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.action.ActionRunnable$3.accept(ActionRunnable.java:75)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.action.ActionRunnable$4.doRun(ActionRunnable.java:100)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.AbstractRunnable.run(AbstractRunnable.java:26)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.TimedRunnable.doRun(TimedRunnable.java:33)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.ThreadContext$ContextPreservingAbstractRunnable.doRun(ThreadContext.java:984)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.AbstractRunnable.run(AbstractRunnable.java:26)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1144)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n     unique snapshot\n       java.base@22.0.1/jdk.internal.misc.Unsafe.unpark(Native Method)\n       java.base@22.0.1/java.util.concurrent.locks.LockSupport.unpark(LockSupport.java:181)\n       java.base@22.0.1/java.util.concurrent.LinkedTransferQueue.xfer(LinkedTransferQueue.java:596)\n       java.base@22.0.1/java.util.concurrent.LinkedTransferQueue.offer(LinkedTransferQueue.java:1174)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.execute(ThreadPoolExecutor.java:1368)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.EsThreadPoolExecutor.execute(EsThreadPoolExecutor.java:72)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.TaskExecutor$TaskGroup.invokeAll(TaskExecutor.java:152)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.TaskExecutor.invokeAll(TaskExecutor.java:76)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.search(ContextIndexSearcher.java:354)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.search(ContextIndexSearcher.java:318)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.query.QueryPhase.addCollectorsAndSearch(QueryPhase.java:205)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.query.QueryPhase.executeQuery(QueryPhase.java:135)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.query.QueryPhase.execute(QueryPhase.java:62)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService.loadOrExecuteQueryPhase(SearchService.java:531)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService.executeQueryPhase(SearchService.java:689)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService.lambda$executeQueryPhase$2(SearchService.java:558)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService$$Lambda/0x00007f2c44035d40.get(Unknown Source)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.action.ActionRunnable$3.accept(ActionRunnable.java:78)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.action.ActionRunnable$3.accept(ActionRunnable.java:75)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.action.ActionRunnable$4.doRun(ActionRunnable.java:100)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.AbstractRunnable.run(AbstractRunnable.java:26)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.TimedRunnable.doRun(TimedRunnable.java:33)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.ThreadContext$ContextPreservingAbstractRunnable.doRun(ThreadContext.java:984)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.AbstractRunnable.run(AbstractRunnable.java:26)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1144)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n   ";

/** `type=cpu&threads=3&interval=500ms` on an idle node: one sleeping thread at 0.0%. */
export const IDLE_CPU_CAPTURE = "::: {es-node-1}{I7MELLk0RvSiAPhRW6211Q}{PmMqJWbnQNSpiMldpxbnjA}{es-node-1}{127.0.0.1}{127.0.0.1:9300}{cdfhilmrstw}{8.15.3}{7000099-8512000}{transform.config_version=10.0.0, rack=r1, ml.config_version=12.0.0, zone=zone-1, xpack.installed=true}\n   Hot threads at 2026-10-14T21:24:53.994Z, interval=500ms, busiestThreads=3, ignoreIdleThreads=true:\n   \n    0.0% [cpu=0.0%, other=0.0%] (187.9micros out of 500ms) cpu usage by thread 'elasticsearch[es-node-1][inference_utility][T#1]'\n     10/10 snapshots sharing following 16 elements\n       java.base@22.0.1/java.lang.Thread.sleepNanos0(Native Method)\n       java.base@22.0.1/java.lang.Thread.sleepNanos(Thread.java:491)\n       java.base@22.0.1/java.lang.Thread.sleep(Thread.java:559)\n       java.base@22.0.1/java.util.concurrent.TimeUnit.sleep(TimeUnit.java:446)\n       org.elasticsearch.inference@8.15.3/org.elasticsearch.xpack.inference.external.http.sender.RequestExecutorService.lambda$static$0(RequestExecutorService.java:66)\n       org.elasticsearch.inference@8.15.3/org.elasticsearch.xpack.inference.external.http.sender.RequestExecutorService$$Lambda/0x00007f2c43c78b68.sleep(Unknown Source)\n       org.elasticsearch.inference@8.15.3/org.elasticsearch.xpack.inference.external.http.sender.RequestExecutorService.handleTasks(RequestExecutorService.java:240)\n       org.elasticsearch.inference@8.15.3/org.elasticsearch.xpack.inference.external.http.sender.RequestExecutorService.start(RequestExecutorService.java:192)\n       org.elasticsearch.inference@8.15.3/org.elasticsearch.xpack.inference.external.http.sender.AmazonBedrockRequestExecutorService.start(AmazonBedrockRequestExecutorService.java:19)\n       org.elasticsearch.inference@8.15.3/org.elasticsearch.xpack.inference.external.amazonbedrock.AmazonBedrockRequestSender.lambda$start$0(AmazonBedrockRequestSender.java:89)\n       org.elasticsearch.inference@8.15.3/org.elasticsearch.xpack.inference.external.amazonbedrock.AmazonBedrockRequestSender$$Lambda/0x00007f2c43c849c0.run(Unknown Source)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.ThreadContext$ContextPreservingRunnable.run(ThreadContext.java:917)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1144)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n\n";

/** `type=cpu&threads=3` with every thread idle: Elasticsearch lists the nodes without threads. */
export const EMPTY_CPU_CAPTURE = "::: {es-node-3}{dmdk_a7-TrKWtlTZ9-ZHzQ}{gqH15Zf4TKOjKCGHn3zj6A}{es-node-3}{127.0.0.1}{127.0.0.1:9302}{cdfhilmrstw}{8.15.3}{7000099-8512000}{transform.config_version=10.0.0, rack=r3, ml.config_version=12.0.0, zone=zone-1, xpack.installed=true}\n   Hot threads at 2026-10-14T21:32:47.496Z, interval=500ms, busiestThreads=3, ignoreIdleThreads=true:\n\n::: {es-node-1}{I7MELLk0RvSiAPhRW6211Q}{PmMqJWbnQNSpiMldpxbnjA}{es-node-1}{127.0.0.1}{127.0.0.1:9300}{cdfhilmrstw}{8.15.3}{7000099-8512000}{transform.config_version=10.0.0, rack=r1, ml.config_version=12.0.0, zone=zone-1, xpack.installed=true}\n   Hot threads at 2026-10-14T21:32:47.496Z, interval=500ms, busiestThreads=3, ignoreIdleThreads=true:\n\n::: {es-node-2}{wEqTWTA0T2CktRBr56viXg}{LePZvWKVS2e3SN1Nkg6biA}{es-node-2}{127.0.0.1}{127.0.0.1:9301}{cdfhilmrstw}{8.15.3}{7000099-8512000}{rack=r2, transform.config_version=10.0.0, ml.config_version=12.0.0, zone=zone-2, xpack.installed=true}\n   Hot threads at 2026-10-14T21:32:47.496Z, interval=500ms, busiestThreads=3, ignoreIdleThreads=true:\n\n";

/** `type=wait&ignore_idle_threads=false` on es-node-1 (first three threads; no cpu/other split in wait captures). */
export const WAIT_CAPTURE = "::: {es-node-1}{I7MELLk0RvSiAPhRW6211Q}{PmMqJWbnQNSpiMldpxbnjA}{es-node-1}{127.0.0.1}{127.0.0.1:9300}{cdfhilmrstw}{8.15.3}{7000099-8512000}{transform.config_version=10.0.0, rack=r1, ml.config_version=12.0.0, zone=zone-1, xpack.installed=true}\n   Hot threads at 2026-10-14T21:25:02.358Z, interval=500ms, busiestThreads=5, ignoreIdleThreads=false:\n   \n   100.2% (501ms out of 500ms) wait usage by thread 'Connection evictor'\n     10/10 snapshots sharing following 6 elements\n       java.base@22.0.1/java.lang.Thread.sleepNanos0(Native Method)\n       java.base@22.0.1/java.lang.Thread.sleepNanos(Thread.java:491)\n       java.base@22.0.1/java.lang.Thread.sleep(Thread.java:522)\n       org.apache.httpcomponents.httpclient@4.5.14/org.apache.http.impl.client.IdleConnectionEvictor$1.run(IdleConnectionEvictor.java:66)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n   \n   100.2% (501ms out of 500ms) wait usage by thread 'elasticsearch[es-node-1][generic][T#6]'\n     10/10 snapshots sharing following 10 elements\n       java.base@22.0.1/jdk.internal.misc.Unsafe.park(Native Method)\n       java.base@22.0.1/java.util.concurrent.locks.LockSupport.parkNanos(LockSupport.java:410)\n       java.base@22.0.1/java.util.concurrent.LinkedTransferQueue$DualNode.await(LinkedTransferQueue.java:452)\n       java.base@22.0.1/java.util.concurrent.LinkedTransferQueue.xfer(LinkedTransferQueue.java:613)\n       java.base@22.0.1/java.util.concurrent.LinkedTransferQueue.poll(LinkedTransferQueue.java:1268)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.getTask(ThreadPoolExecutor.java:1069)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1130)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n   \n   100.2% (501ms out of 500ms) wait usage by thread 'elasticsearch[es-node-1][generic][T#9]'\n     10/10 snapshots sharing following 10 elements\n       java.base@22.0.1/jdk.internal.misc.Unsafe.park(Native Method)\n       java.base@22.0.1/java.util.concurrent.locks.LockSupport.parkNanos(LockSupport.java:410)\n       java.base@22.0.1/java.util.concurrent.LinkedTransferQueue$DualNode.await(LinkedTransferQueue.java:452)\n       java.base@22.0.1/java.util.concurrent.LinkedTransferQueue.xfer(LinkedTransferQueue.java:613)\n       java.base@22.0.1/java.util.concurrent.LinkedTransferQueue.poll(LinkedTransferQueue.java:1268)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.getTask(ThreadPoolExecutor.java:1069)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1130)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n   ";

/** `type=block` on es-node-2: a thread blocked in a file read, reported at 0.0%. */
export const BLOCK_CAPTURE = "::: {es-node-2}{wEqTWTA0T2CktRBr56viXg}{LePZvWKVS2e3SN1Nkg6biA}{es-node-2}{127.0.0.1}{127.0.0.1:9301}{cdfhilmrstw}{8.15.3}{7000099-8512000}{rack=r2, transform.config_version=10.0.0, ml.config_version=12.0.0, zone=zone-2, xpack.installed=true}\n   Hot threads at 2026-10-14T21:25:02.973Z, interval=500ms, busiestThreads=3, ignoreIdleThreads=true:\n   \n    0.0% (0s out of 500ms) block usage by thread 'elasticsearch-cli-monitor-thread'\n     10/10 snapshots sharing following 9 elements\n       java.base@22.0.1/java.io.FileInputStream.readBytes(Native Method)\n       java.base@22.0.1/java.io.FileInputStream.read(FileInputStream.java:287)\n       java.base@22.0.1/java.io.BufferedInputStream.fill(BufferedInputStream.java:291)\n       java.base@22.0.1/java.io.BufferedInputStream.implRead(BufferedInputStream.java:325)\n       java.base@22.0.1/java.io.BufferedInputStream.read(BufferedInputStream.java:312)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.bootstrap.Elasticsearch.lambda$startCliMonitorThread$1(Elasticsearch.java:367)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.bootstrap.Elasticsearch$$Lambda/0x00007f8f5c249328.run(Unknown Source)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n\n";

/** `type=mem&interval=1s` on es-node-2 under load: bytes allocated per thread. */
export const MEMORY_CAPTURE = "::: {es-node-2}{wEqTWTA0T2CktRBr56viXg}{LePZvWKVS2e3SN1Nkg6biA}{es-node-2}{127.0.0.1}{127.0.0.1:9301}{cdfhilmrstw}{8.15.3}{7000099-8512000}{rack=r2, transform.config_version=10.0.0, ml.config_version=12.0.0, zone=zone-2, xpack.installed=true}\n   Hot threads at 2026-10-14T21:27:14.672Z, interval=1s, busiestThreads=3, ignoreIdleThreads=false:\n   \n   71mb memory allocated by thread 'elasticsearch[es-node-2][search][T#3]'\n     10/10 snapshots sharing following 3 elements\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n   \n   45mb memory allocated by thread 'elasticsearch[es-node-2][search][T#4]'\n     8/10 snapshots sharing following 26 elements\n       java.base@22.0.1/jdk.internal.misc.Unsafe.park(Native Method)\n       java.base@22.0.1/java.util.concurrent.locks.LockSupport.park(LockSupport.java:221)\n       java.base@22.0.1/java.util.concurrent.FutureTask.awaitDone(FutureTask.java:500)\n       java.base@22.0.1/java.util.concurrent.FutureTask.get(FutureTask.java:190)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.TaskExecutor$TaskGroup.invokeAll(TaskExecutor.java:159)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.TaskExecutor.invokeAll(TaskExecutor.java:76)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.search(ContextIndexSearcher.java:354)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.search(ContextIndexSearcher.java:318)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.query.QueryPhase.addCollectorsAndSearch(QueryPhase.java:205)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.query.QueryPhase.executeQuery(QueryPhase.java:135)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.query.QueryPhase.execute(QueryPhase.java:62)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService.loadOrExecuteQueryPhase(SearchService.java:531)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService.executeQueryPhase(SearchService.java:689)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService.lambda$executeQueryPhase$2(SearchService.java:558)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService$$Lambda/0x00007f8f5c483b10.get(Unknown Source)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.action.ActionRunnable$3.accept(ActionRunnable.java:78)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.action.ActionRunnable$3.accept(ActionRunnable.java:75)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.action.ActionRunnable$4.doRun(ActionRunnable.java:100)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.AbstractRunnable.run(AbstractRunnable.java:26)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.TimedRunnable.doRun(TimedRunnable.java:33)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.ThreadContext$ContextPreservingAbstractRunnable.doRun(ThreadContext.java:984)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.AbstractRunnable.run(AbstractRunnable.java:26)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1144)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n     2/10 snapshots sharing following 17 elements\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.addQueryCancellation(ContextIndexSearcher.java:165)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.DefaultSearchContext.preProcess(DefaultSearchContext.java:432)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService.createContext(SearchService.java:1092)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService.executeQueryPhase(SearchService.java:684)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService.lambda$executeQueryPhase$2(SearchService.java:558)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService$$Lambda/0x00007f8f5c483b10.get(Unknown Source)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.action.ActionRunnable$3.accept(ActionRunnable.java:78)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.action.ActionRunnable$3.accept(ActionRunnable.java:75)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.action.ActionRunnable$4.doRun(ActionRunnable.java:100)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.AbstractRunnable.run(AbstractRunnable.java:26)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.TimedRunnable.doRun(TimedRunnable.java:33)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.ThreadContext$ContextPreservingAbstractRunnable.doRun(ThreadContext.java:984)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.AbstractRunnable.run(AbstractRunnable.java:26)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1144)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n   \n   38.3mb memory allocated by thread 'elasticsearch[es-node-2][search][T#5]'\n     10/10 snapshots sharing following 21 elements\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.TaskExecutor.invokeAll(TaskExecutor.java:76)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.search(ContextIndexSearcher.java:354)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.search(ContextIndexSearcher.java:318)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.query.QueryPhase.addCollectorsAndSearch(QueryPhase.java:205)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.query.QueryPhase.executeQuery(QueryPhase.java:135)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.query.QueryPhase.execute(QueryPhase.java:62)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService.loadOrExecuteQueryPhase(SearchService.java:531)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService.executeQueryPhase(SearchService.java:689)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService.lambda$executeQueryPhase$2(SearchService.java:558)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.SearchService$$Lambda/0x00007f8f5c483b10.get(Unknown Source)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.action.ActionRunnable$3.accept(ActionRunnable.java:78)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.action.ActionRunnable$3.accept(ActionRunnable.java:75)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.action.ActionRunnable$4.doRun(ActionRunnable.java:100)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.AbstractRunnable.run(AbstractRunnable.java:26)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.TimedRunnable.doRun(TimedRunnable.java:33)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.ThreadContext$ContextPreservingAbstractRunnable.doRun(ThreadContext.java:984)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.AbstractRunnable.run(AbstractRunnable.java:26)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1144)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n";

/** `performance/thread_pools` rows (strings, `size` null for idle scaling pools, `-1` unbounded queues). */
export const THREAD_POOL_ROWS = [
  {
    "node_name": "es-node-2",
    "name": "analyze",
    "type": "fixed",
    "active": "0",
    "queue": "0",
    "rejected": "0",
    "completed": "2",
    "size": "1",
    "queue_size": "16"
  },
  {
    "node_name": "es-node-2",
    "name": "azure_event_loop",
    "type": "scaling",
    "active": "0",
    "queue": "0",
    "rejected": "0",
    "completed": "0",
    "size": null,
    "queue_size": "-1"
  },
  {
    "node_name": "es-node-2",
    "name": "force_merge",
    "type": "fixed",
    "active": "0",
    "queue": "0",
    "rejected": "0",
    "completed": "0",
    "size": "1",
    "queue_size": "-1"
  },
  {
    "node_name": "es-node-2",
    "name": "generic",
    "type": "scaling",
    "active": "0",
    "queue": "0",
    "rejected": "0",
    "completed": "53391",
    "size": null,
    "queue_size": "-1"
  },
  {
    "node_name": "es-node-2",
    "name": "get",
    "type": "fixed",
    "active": "0",
    "queue": "0",
    "rejected": "0",
    "completed": "0",
    "size": "7",
    "queue_size": "1000"
  },
  {
    "node_name": "es-node-2",
    "name": "management",
    "type": "scaling",
    "active": "1",
    "queue": "0",
    "rejected": "0",
    "completed": "49301",
    "size": null,
    "queue_size": "-1"
  },
  {
    "node_name": "es-node-2",
    "name": "refresh",
    "type": "scaling",
    "active": "0",
    "queue": "0",
    "rejected": "0",
    "completed": "303253",
    "size": null,
    "queue_size": "-1"
  },
  {
    "node_name": "es-node-2",
    "name": "search",
    "type": "fixed",
    "active": "0",
    "queue": "0",
    "rejected": "0",
    "completed": "4539",
    "size": "7",
    "queue_size": "1000"
  },
  {
    "node_name": "es-node-2",
    "name": "search_worker",
    "type": "fixed",
    "active": "0",
    "queue": "0",
    "rejected": "0",
    "completed": "3706",
    "size": "7",
    "queue_size": "-1"
  },
  {
    "node_name": "es-node-2",
    "name": "snapshot",
    "type": "scaling",
    "active": "0",
    "queue": "0",
    "rejected": "0",
    "completed": "330",
    "size": null,
    "queue_size": "-1"
  },
  {
    "node_name": "es-node-2",
    "name": "write",
    "type": "fixed",
    "active": "0",
    "queue": "0",
    "rejected": "0",
    "completed": "1790",
    "size": "4",
    "queue_size": "10000"
  },
  {
    "node_name": "es-node-1",
    "name": "analyze",
    "type": "fixed",
    "active": "0",
    "queue": "0",
    "rejected": "0",
    "completed": "2",
    "size": "1",
    "queue_size": "16"
  },
  {
    "node_name": "es-node-1",
    "name": "azure_event_loop",
    "type": "scaling",
    "active": "0",
    "queue": "0",
    "rejected": "0",
    "completed": "0",
    "size": null,
    "queue_size": "-1"
  },
  {
    "node_name": "es-node-1",
    "name": "force_merge",
    "type": "fixed",
    "active": "0",
    "queue": "0",
    "rejected": "0",
    "completed": "0",
    "size": "1",
    "queue_size": "-1"
  },
  {
    "node_name": "es-node-1",
    "name": "generic",
    "type": "scaling",
    "active": "0",
    "queue": "0",
    "rejected": "0",
    "completed": "55316",
    "size": null,
    "queue_size": "-1"
  },
  {
    "node_name": "es-node-1",
    "name": "get",
    "type": "fixed",
    "active": "0",
    "queue": "0",
    "rejected": "0",
    "completed": "0",
    "size": "7",
    "queue_size": "1000"
  },
  {
    "node_name": "es-node-1",
    "name": "management",
    "type": "scaling",
    "active": "1",
    "queue": "0",
    "rejected": "0",
    "completed": "78334",
    "size": null,
    "queue_size": "-1"
  },
  {
    "node_name": "es-node-1",
    "name": "refresh",
    "type": "scaling",
    "active": "0",
    "queue": "0",
    "rejected": "0",
    "completed": "325460",
    "size": null,
    "queue_size": "-1"
  },
  {
    "node_name": "es-node-1",
    "name": "search",
    "type": "fixed",
    "active": "0",
    "queue": "0",
    "rejected": "0",
    "completed": "7610",
    "size": "7",
    "queue_size": "1000"
  },
  {
    "node_name": "es-node-1",
    "name": "search_worker",
    "type": "fixed",
    "active": "0",
    "queue": "0",
    "rejected": "0",
    "completed": "4782",
    "size": "7",
    "queue_size": "-1"
  },
  {
    "node_name": "es-node-1",
    "name": "snapshot",
    "type": "scaling",
    "active": "0",
    "queue": "0",
    "rejected": "0",
    "completed": "107",
    "size": null,
    "queue_size": "-1"
  },
  {
    "node_name": "es-node-1",
    "name": "write",
    "type": "fixed",
    "active": "0",
    "queue": "0",
    "rejected": "0",
    "completed": "1627",
    "size": "4",
    "queue_size": "10000"
  }
];

/** `performance/pending_tasks` while twelve indices were created at once. */
export const PENDING_TASKS = {
  "tasks": [
    {
      "insert_order": 2573,
      "priority": "URGENT",
      "source": "create-index [tmp-performance-p3], cause [api]",
      "executing": true,
      "time_in_queue_millis": 202,
      "time_in_queue": "202ms"
    },
    {
      "insert_order": 2574,
      "priority": "URGENT",
      "source": "create-index [tmp-performance-p6], cause [api]",
      "executing": false,
      "time_in_queue_millis": 202,
      "time_in_queue": "202ms"
    },
    {
      "insert_order": 2575,
      "priority": "URGENT",
      "source": "create-index [tmp-performance-p5], cause [api]",
      "executing": false,
      "time_in_queue_millis": 202,
      "time_in_queue": "202ms"
    },
    {
      "insert_order": 2576,
      "priority": "URGENT",
      "source": "create-index [tmp-performance-p10], cause [api]",
      "executing": false,
      "time_in_queue_millis": 202,
      "time_in_queue": "202ms"
    },
    {
      "insert_order": 2577,
      "priority": "URGENT",
      "source": "create-index [tmp-performance-p2], cause [api]",
      "executing": false,
      "time_in_queue_millis": 202,
      "time_in_queue": "202ms"
    },
    {
      "insert_order": 2578,
      "priority": "URGENT",
      "source": "create-index [tmp-performance-p1], cause [api]",
      "executing": false,
      "time_in_queue_millis": 202,
      "time_in_queue": "202ms"
    },
    {
      "insert_order": 2579,
      "priority": "URGENT",
      "source": "create-index [tmp-performance-p7], cause [api]",
      "executing": false,
      "time_in_queue_millis": 202,
      "time_in_queue": "202ms"
    },
    {
      "insert_order": 2580,
      "priority": "URGENT",
      "source": "create-index [tmp-performance-p8], cause [api]",
      "executing": false,
      "time_in_queue_millis": 202,
      "time_in_queue": "202ms"
    },
    {
      "insert_order": 2581,
      "priority": "URGENT",
      "source": "reconcile-desired-balance",
      "executing": false,
      "time_in_queue_millis": 202,
      "time_in_queue": "202ms"
    },
    {
      "insert_order": 2585,
      "priority": "URGENT",
      "source": "reconcile-desired-balance",
      "executing": false,
      "time_in_queue_millis": 0,
      "time_in_queue": "0s"
    },
    {
      "insert_order": 2582,
      "priority": "URGENT",
      "source": "create-index [tmp-performance-p12], cause [api]",
      "executing": false,
      "time_in_queue_millis": 202,
      "time_in_queue": "202ms"
    },
    {
      "insert_order": 2583,
      "priority": "URGENT",
      "source": "create-index [tmp-performance-p4], cause [api]",
      "executing": false,
      "time_in_queue_millis": 202,
      "time_in_queue": "202ms"
    },
    {
      "insert_order": 2584,
      "priority": "URGENT",
      "source": "create-index [tmp-performance-p9], cause [api]",
      "executing": false,
      "time_in_queue_millis": 0,
      "time_in_queue": "0s"
    }
  ]
};

/**
 * `performance/slowlog` with tmp-performance-b on the Moderate preset and
 * tmp-performance-a partly configured (fetch levels out of order, indexing
 * warn disabled, source/reformat/include.user set).
 */
export const SLOWLOG_RESPONSE = {
  "tmp-performance-b": {
    "settings": {
      "index.indexing.slowlog.threshold.index.debug": "2s",
      "index.indexing.slowlog.threshold.index.info": "5s",
      "index.indexing.slowlog.threshold.index.trace": "500ms",
      "index.indexing.slowlog.threshold.index.warn": "10s",
      "index.search.slowlog.threshold.fetch.debug": "500ms",
      "index.search.slowlog.threshold.fetch.info": "800ms",
      "index.search.slowlog.threshold.fetch.trace": "200ms",
      "index.search.slowlog.threshold.fetch.warn": "1s",
      "index.search.slowlog.threshold.query.debug": "2s",
      "index.search.slowlog.threshold.query.info": "5s",
      "index.search.slowlog.threshold.query.trace": "500ms",
      "index.search.slowlog.threshold.query.warn": "10s"
    }
  },
  "tmp-performance-a": {
    "settings": {
      "index.indexing.slowlog.reformat": "false",
      "index.indexing.slowlog.source": "1000",
      "index.indexing.slowlog.threshold.index.warn": "-1",
      "index.search.slowlog.include.user": "true",
      "index.search.slowlog.threshold.fetch.trace": "1s",
      "index.search.slowlog.threshold.fetch.warn": "200ms",
      "index.search.slowlog.threshold.query.warn": "10s"
    }
  }
};

/** CPU capture of es-node-1 with ignore_idle_threads=false: 8.x prints network threads as [cpu=x%, idle=y%] (live 8.15.3). */
export const TRANSPORT_IDLE_CAPTURE = "::: {es-node-1}{I7MELLk0RvSiAPhRW6211Q}{PmMqJWbnQNSpiMldpxbnjA}{es-node-1}{127.0.0.1}{127.0.0.1:9300}{cdfhilmrstw}{8.15.3}{7000099-8512000}{transform.config_version=10.0.0, rack=r1, ml.config_version=12.0.0, zone=zone-1, xpack.installed=true}\n   Hot threads at 2026-10-14T22:33:09.186Z, interval=500ms, busiestThreads=6, ignoreIdleThreads=false:\n   \n    0.0% [cpu=0.0%, idle=100.0%] (500ms out of 500ms) cpu usage by thread 'elasticsearch[es-node-1][transport_worker][T#1]'\n     10/10 snapshots sharing following 10 elements\n       java.base@22.0.1/sun.nio.ch.EPoll.wait(Native Method)\n       java.base@22.0.1/sun.nio.ch.EPollSelectorImpl.doSelect(EPollSelectorImpl.java:121)\n       java.base@22.0.1/sun.nio.ch.SelectorImpl.lockAndDoSelect(SelectorImpl.java:130)\n       java.base@22.0.1/sun.nio.ch.SelectorImpl.select(SelectorImpl.java:147)\n       io.netty.transport@4.1.109.Final/io.netty.channel.nio.NioEventLoop.select(NioEventLoop.java:879)\n       io.netty.transport@4.1.109.Final/io.netty.channel.nio.NioEventLoop.run(NioEventLoop.java:526)\n       io.netty.common@4.1.109.Final/io.netty.util.concurrent.SingleThreadEventExecutor$4.run(SingleThreadEventExecutor.java:997)\n       io.netty.common@4.1.109.Final/io.netty.util.internal.ThreadExecutorMap$2.run(ThreadExecutorMap.java:74)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n   \n    0.1% [cpu=0.1%, other=0.0%] (395.1micros out of 500ms) cpu usage by thread 'elasticsearch[es-node-1][scheduler][T#1]'\n     10/10 snapshots sharing following 10 elements\n       java.base@22.0.1/jdk.internal.misc.Unsafe.park(Native Method)\n       java.base@22.0.1/java.util.concurrent.locks.LockSupport.parkNanos(LockSupport.java:269)\n       java.base@22.0.1/java.util.concurrent.locks.AbstractQueuedSynchronizer$ConditionObject.awaitNanos(AbstractQueuedSynchronizer.java:1758)\n       java.base@22.0.1/java.util.concurrent.ScheduledThreadPoolExecutor$DelayedWorkQueue.take(ScheduledThreadPoolExecutor.java:1182)\n       java.base@22.0.1/java.util.concurrent.ScheduledThreadPoolExecutor$DelayedWorkQueue.take(ScheduledThreadPoolExecutor.java:899)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.getTask(ThreadPoolExecutor.java:1070)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1130)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n   \n    0.1% [cpu=0.1%, other=0.0%] (318.8micros out of 500ms) cpu usage by thread 'elasticsearch[es-node-1][inference_utility][T#1]'\n     10/10 snapshots sharing following 16 elements\n       java.base@22.0.1/java.lang.Thread.sleepNanos0(Native Method)\n       java.base@22.0.1/java.lang.Thread.sleepNanos(Thread.java:491)\n       java.base@22.0.1/java.lang.Thread.sleep(Thread.java:559)\n       java.base@22.0.1/java.util.concurrent.TimeUnit.sleep(TimeUnit.java:446)\n       org.elasticsearch.inference@8.15.3/org.elasticsearch.xpack.inference.external.http.sender.RequestExecutorService.lambda$static$0(RequestExecutorService.java:66)\n       org.elasticsearch.inference@8.15.3/org.elasticsearch.xpack.inference.external.http.sender.RequestExecutorService$$Lambda/0x00007f2c43c78b68.sleep(Unknown Source)\n       org.elasticsearch.inference@8.15.3/org.elasticsearch.xpack.inference.external.http.sender.RequestExecutorService.handleTasks(RequestExecutorService.java:240)\n       org.elasticsearch.inference@8.15.3/org.elasticsearch.xpack.inference.external.http.sender.RequestExecutorService.start(RequestExecutorService.java:192)\n       org.elasticsearch.inference@8.15.3/org.elasticsearch.xpack.inference.external.http.sender.AmazonBedrockRequestExecutorService.start(AmazonBedrockRequestExecutorService.java:19)\n       org.elasticsearch.inference@8.15.3/org.elasticsearch.xpack.inference.external.amazonbedrock.AmazonBedrockRequestSender.lambda$start$0(AmazonBedrockRequestSender.java:89)\n       org.elasticsearch.inference@8.15.3/org.elasticsearch.xpack.inference.external.amazonbedrock.AmazonBedrockRequestSender$$Lambda/0x00007f2c43c849c0.run(Unknown Source)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.ThreadContext$ContextPreservingRunnable.run(ThreadContext.java:917)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1144)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n   \n    0.0% [cpu=0.0%, other=0.0%] (169micros out of 500ms) cpu usage by thread 'elasticsearch[es-node-1][refresh][T#2]'\n     10/10 snapshots sharing following 10 elements\n       java.base@22.0.1/jdk.internal.misc.Unsafe.park(Native Method)\n       java.base@22.0.1/java.util.concurrent.locks.LockSupport.parkNanos(LockSupport.java:410)\n       java.base@22.0.1/java.util.concurrent.LinkedTransferQueue$DualNode.await(LinkedTransferQueue.java:452)\n       java.base@22.0.1/java.util.concurrent.LinkedTransferQueue.xfer(LinkedTransferQueue.java:613)\n       java.base@22.0.1/java.util.concurrent.LinkedTransferQueue.poll(LinkedTransferQueue.java:1268)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.getTask(ThreadPoolExecutor.java:1069)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1130)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n   \n    0.0% [cpu=0.0%, other=0.0%] (143.3micros out of 500ms) cpu usage by thread 'elasticsearch[es-node-1][refresh][T#1]'\n     10/10 snapshots sharing following 10 elements\n       java.base@22.0.1/jdk.internal.misc.Unsafe.park(Native Method)\n       java.base@22.0.1/java.util.concurrent.locks.LockSupport.parkNanos(LockSupport.java:410)\n       java.base@22.0.1/java.util.concurrent.LinkedTransferQueue$DualNode.await(LinkedTransferQueue.java:452)\n       java.base@22.0.1/java.util.concurrent.LinkedTransferQueue.xfer(LinkedTransferQueue.java:613)\n       java.base@22.0.1/java.util.concurrent.LinkedTransferQueue.poll(LinkedTransferQueue.java:1268)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.getTask(ThreadPoolExecutor.java:1069)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1130)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n   \n    0.0% [cpu=0.0%, other=0.0%] (52.2micros out of 500ms) cpu usage by thread 'elasticsearch[es-node-1][[timer]]'\n     10/10 snapshots sharing following 4 elements\n       java.base@22.0.1/java.lang.Thread.sleepNanos0(Native Method)\n       java.base@22.0.1/java.lang.Thread.sleepNanos(Thread.java:491)\n       java.base@22.0.1/java.lang.Thread.sleep(Thread.java:522)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.threadpool.ThreadPool$CachedTimeThread.run(ThreadPool.java:871)\n\n";

/** CPU capture under search load (live 8.15.3), trimmed to es-node-3 (threads with only a unique snapshot) and two es-node-2 workers (idle and base-only stacks most frequent). */
export const BUSY_SEARCH_CAPTURE = "::: {es-node-3}{dmdk_a7-TrKWtlTZ9-ZHzQ}{gqH15Zf4TKOjKCGHn3zj6A}{es-node-3}{127.0.0.1}{127.0.0.1:9302}{cdfhilmrstw}{8.15.3}{7000099-8512000}{transform.config_version=10.0.0, rack=r3, ml.config_version=12.0.0, zone=zone-1, xpack.installed=true}\n   Hot threads at 2026-10-14T22:33:33.616Z, interval=1s, busiestThreads=6, ignoreIdleThreads=true:\n   \n   33.1% [cpu=6.6%, other=26.5%] (331ms out of 1s) cpu usage by thread 'elasticsearch[es-node-3][search_worker][T#1]'\n     unique snapshot\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.codecs.lucene90.blocktree.IntersectTermsEnum._next(IntersectTermsEnum.java:519)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.codecs.lucene90.blocktree.IntersectTermsEnum.next(IntersectTermsEnum.java:377)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.index.FilterLeafReader$FilterTermsEnum.next(FilterLeafReader.java:201)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ExitableDirectoryReader$ExitableTermsEnum.next(ExitableDirectoryReader.java:252)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.MultiTermQueryConstantScoreBlendedWrapper$1.rewriteInner(MultiTermQueryConstantScoreBlendedWrapper.java:111)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.AbstractMultiTermQueryConstantScoreWrapper$RewritingWeight.rewrite(AbstractMultiTermQueryConstantScoreWrapper.java:179)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.AbstractMultiTermQueryConstantScoreWrapper$RewritingWeight$1.get(AbstractMultiTermQueryConstantScoreWrapper.java:269)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.DisjunctionMaxQuery$DisjunctionMaxWeight$1.get(DisjunctionMaxQuery.java:154)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.BooleanWeight.optionalBulkScorer(BooleanWeight.java:221)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.BooleanWeight.booleanScorer(BooleanWeight.java:373)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.BooleanWeight.bulkScorer(BooleanWeight.java:443)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.searchLeaf(ContextIndexSearcher.java:430)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.search(ContextIndexSearcher.java:365)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.lambda$search$3(ContextIndexSearcher.java:350)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher$$Lambda/0x00007fa04c3c7940.call(Unknown Source)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.TaskExecutor$TaskGroup.lambda$createTask$0(TaskExecutor.java:117)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.TaskExecutor$TaskGroup$$Lambda/0x00007fa04c316f58.call(Unknown Source)\n       java.base@22.0.1/java.util.concurrent.FutureTask.run(FutureTask.java:317)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.TimedRunnable.doRun(TimedRunnable.java:33)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.ThreadContext$ContextPreservingAbstractRunnable.doRun(ThreadContext.java:984)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.AbstractRunnable.run(AbstractRunnable.java:26)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1144)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n   \n   28.9% [cpu=4.9%, other=24.0%] (289ms out of 1s) cpu usage by thread 'elasticsearch[es-node-3][search_worker][T#2]'\n     unique snapshot\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.codecs.lucene90.blocktree.IntersectTermsEnum._next(IntersectTermsEnum.java:519)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.codecs.lucene90.blocktree.IntersectTermsEnum.next(IntersectTermsEnum.java:377)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.index.FilterLeafReader$FilterTermsEnum.next(FilterLeafReader.java:201)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ExitableDirectoryReader$ExitableTermsEnum.next(ExitableDirectoryReader.java:252)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.MultiTermQueryConstantScoreBlendedWrapper$1.rewriteInner(MultiTermQueryConstantScoreBlendedWrapper.java:111)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.AbstractMultiTermQueryConstantScoreWrapper$RewritingWeight.rewrite(AbstractMultiTermQueryConstantScoreWrapper.java:179)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.AbstractMultiTermQueryConstantScoreWrapper$RewritingWeight$1.get(AbstractMultiTermQueryConstantScoreWrapper.java:269)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.DisjunctionMaxQuery$DisjunctionMaxWeight$1.get(DisjunctionMaxQuery.java:154)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.BooleanWeight.optionalBulkScorer(BooleanWeight.java:221)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.BooleanWeight.booleanScorer(BooleanWeight.java:373)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.BooleanWeight.bulkScorer(BooleanWeight.java:443)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.searchLeaf(ContextIndexSearcher.java:430)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.search(ContextIndexSearcher.java:365)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.lambda$search$3(ContextIndexSearcher.java:350)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher$$Lambda/0x00007fa04c3c7940.call(Unknown Source)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.TaskExecutor$TaskGroup.lambda$createTask$0(TaskExecutor.java:117)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.TaskExecutor$TaskGroup$$Lambda/0x00007fa04c316f58.call(Unknown Source)\n       java.base@22.0.1/java.util.concurrent.FutureTask.run(FutureTask.java:317)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.TimedRunnable.doRun(TimedRunnable.java:33)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.ThreadContext$ContextPreservingAbstractRunnable.doRun(ThreadContext.java:984)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.AbstractRunnable.run(AbstractRunnable.java:26)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1144)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n\n::: {es-node-2}{wEqTWTA0T2CktRBr56viXg}{LePZvWKVS2e3SN1Nkg6biA}{es-node-2}{127.0.0.1}{127.0.0.1:9301}{cdfhilmrstw}{8.15.3}{7000099-8512000}{rack=r2, transform.config_version=10.0.0, ml.config_version=12.0.0, zone=zone-2, xpack.installed=true}\n   Hot threads at 2026-10-14T22:33:33.615Z, interval=1s, busiestThreads=6, ignoreIdleThreads=true:\n   \n   49.4% [cpu=8.5%, other=40.9%] (494ms out of 1s) cpu usage by thread 'elasticsearch[es-node-2][search_worker][T#5]'\n     4/10 snapshots sharing following 7 elements\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.TimedRunnable.doRun(TimedRunnable.java:33)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.ThreadContext$ContextPreservingAbstractRunnable.doRun(ThreadContext.java:984)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.AbstractRunnable.run(AbstractRunnable.java:26)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1144)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n     6/10 snapshots sharing following 10 elements\n       java.base@22.0.1/jdk.internal.misc.Unsafe.park(Native Method)\n       java.base@22.0.1/java.util.concurrent.locks.LockSupport.park(LockSupport.java:371)\n       java.base@22.0.1/java.util.concurrent.LinkedTransferQueue$DualNode.await(LinkedTransferQueue.java:458)\n       java.base@22.0.1/java.util.concurrent.LinkedTransferQueue.xfer(LinkedTransferQueue.java:613)\n       java.base@22.0.1/java.util.concurrent.LinkedTransferQueue.take(LinkedTransferQueue.java:1257)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.getTask(ThreadPoolExecutor.java:1070)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1130)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n   \n   40.9% [cpu=8.9%, other=32.0%] (409ms out of 1s) cpu usage by thread 'elasticsearch[es-node-2][search_worker][T#3]'\n     2/10 snapshots sharing following 19 elements\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.AbstractMultiTermQueryConstantScoreWrapper$RewritingWeight$1.get(AbstractMultiTermQueryConstantScoreWrapper.java:269)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.DisjunctionMaxQuery$DisjunctionMaxWeight$1.get(DisjunctionMaxQuery.java:154)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.BooleanWeight.optionalBulkScorer(BooleanWeight.java:221)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.BooleanWeight.booleanScorer(BooleanWeight.java:373)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.BooleanWeight.bulkScorer(BooleanWeight.java:443)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.searchLeaf(ContextIndexSearcher.java:430)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.search(ContextIndexSearcher.java:365)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher.lambda$search$3(ContextIndexSearcher.java:350)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.internal.ContextIndexSearcher$$Lambda/0x00007f8f5c491138.call(Unknown Source)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.TaskExecutor$TaskGroup.lambda$createTask$0(TaskExecutor.java:117)\n       app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.TaskExecutor$TaskGroup$$Lambda/0x00007f8f5c396238.call(Unknown Source)\n       java.base@22.0.1/java.util.concurrent.FutureTask.run(FutureTask.java:317)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.TimedRunnable.doRun(TimedRunnable.java:33)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.ThreadContext$ContextPreservingAbstractRunnable.doRun(ThreadContext.java:984)\n       app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.AbstractRunnable.run(AbstractRunnable.java:26)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1144)\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n     8/10 snapshots sharing following 3 elements\n       java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)\n       java.base@22.0.1/java.lang.Thread.runWith(Thread.java:1583)\n       java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)\n   \n";
