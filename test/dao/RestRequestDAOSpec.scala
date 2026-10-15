package dao

import java.nio.file.Files
import java.sql.Date

import org.specs2.Specification
import org.specs2.concurrent.ExecutionEnv
import play.api.Play._
import play.api.inject.guice.GuiceApplicationBuilder

import scala.concurrent.Future
import scala.concurrent.duration.FiniteDuration

class RestRequestDAOSpec(implicit ee: ExecutionEnv) extends Specification {

  // A database of its own, so every run starts from an empty history.
  private val database = Files.createTempFile("cerebro-rest-history", ".db")
  database.toFile.deleteOnExit()

  val app = new GuiceApplicationBuilder()
    .configure(
      Map(
        "rest.history.size" -> 3,
        "slick.dbs.default.db.url" -> s"jdbc:sqlite:$database"
      )
    )
    .build()

  override def is =
    sequential ^ s2"""
    RestRequestDAO should                   ${step(start(app))}
        create a new entry                  $save
        update an existing entry            $update
        ensures history has max size        $maxSize
                                            ${step(stop(app))}
      """

  def save = {
    val dao: RestHistoryDAO = app.injector.instanceOf(classOf[RestHistoryDAO])
    val entry =
      RestRequest("somePath", "someMethod", "theBody", "admin", new Date(123))
    dao.save(entry) must beEqualTo(Some("f909cacf3de2c117ca3c08e472bd1d88")).await
  }

  def update = {
    val dao: RestHistoryDAO = app.injector.instanceOf(classOf[RestHistoryDAO])
    val currentTime = System.currentTimeMillis
    val entry = RestRequest("otherPath",
                            "otherMethod",
                            "otherBody",
                            "admin",
                            new Date(currentTime))
    val existing = dao.save(entry)
    val updated = existing.flatMap(_ => dao.save(entry.copy(createdAt = new Date(currentTime + 1))))
    (existing must beEqualTo(Some("fad24b7447043f5412c89b12e2b7697c")).await and
      (updated must beEqualTo(Some("fad24b7447043f5412c89b12e2b7697c")).await))
  }

  def maxSize = {
    val time = System.currentTimeMillis
    val dao: RestHistoryDAO = app.injector.instanceOf(classOf[RestHistoryDAO])
    val all = Future
      .sequence(
        Seq(
          dao.save(
            RestRequest("request1", "GET", "{}", "admin", new Date(time))),
          dao.save(
            RestRequest("request2", "GET", "{}", "admin", new Date(time + 1))),
          dao.save(
            RestRequest("request3", "GET", "{}", "admin", new Date(time + 2)))
        )
      )
      .flatMap { _ =>
        dao.all("admin")
      }
    val expected = Seq(
      RestRequest("request3", "GET", "{}", "admin", new Date(time + 2)),
      RestRequest("request2", "GET", "{}", "admin", new Date(time + 1)),
      RestRequest("request1", "GET", "{}", "admin", new Date(time))
    )
    all must beEqualTo(expected).awaitFor(FiniteDuration(3, "s"))
  }

}
