import java.nio.file.Files

import org.specs2.Specification
import org.specs2.execute.Result
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.{Configuration, Environment, Mode, PlayException}

import scala.util.Try

object ModuleSpec extends Specification {

  // conf/application.conf of lmenezes/cerebro 0.9.x
  private val PublishedSecret = "ki:s:[[@=Ag?QI`W2jMwkY:eqvrJ]JqoJyi2axj3ZvOv^/KavOT4ViJSv?6YY4[N"
  private val OwnSecret       = "a-private-application-secret-for-this-test-only"

  def is = sequential ^ s2"""
    The application secret
      is read from the key "secret" of lmenezes/cerebro's configuration files $secretKeyIsRead
      is taken from CEREBRO_SECRET before the key "secret"                    $cerebroSecretWins
      is refused when it is lmenezes/cerebro's published default             $publishedSecretIsRefused
      is accepted when it is another value or not set                        $otherSecretsAreAccepted
      stops a production start when it is the published default              $productionRefusesPublishedSecret
      lets a production start with another value                             $productionAcceptsOwnSecret
  """

  // The configuration as Play loads it, with these settings on top of
  // conf/application.conf and conf/reference.conf.
  private def resolvedSecret(settings: (String, String)*): String =
    Configuration.load(Environment.simple(), settings.toMap).get[String]("play.http.secret.key")

  private def startInProduction(secret: String) = {
    val database = Files.createTempFile("cerebro-module-spec", ".db")
    database.toFile.deleteOnExit()
    val application = Try {
      new GuiceApplicationBuilder(environment = Environment.simple(mode = Mode.Prod))
        .configure(
          "play.http.secret.key"     -> secret,
          "slick.dbs.default.db.url" -> s"jdbc:sqlite:$database"
        )
        .build()
    }
    application.foreach(_.stop())
    application
  }

  def secretKeyIsRead: Result =
    if (sys.env.contains("CEREBRO_SECRET")) skipped("CEREBRO_SECRET is set in the environment and takes precedence")
    else (resolvedSecret("secret" -> OwnSecret) mustEqual OwnSecret).toResult

  def cerebroSecretWins =
    resolvedSecret("secret" -> PublishedSecret, "CEREBRO_SECRET" -> OwnSecret) mustEqual OwnSecret

  def publishedSecretIsRefused =
    Module.rejectPublishedSecret(Configuration("play.http.secret.key" -> PublishedSecret)) must
      throwA[PlayException](message = "public default of lmenezes/cerebro")

  def otherSecretsAreAccepted =
    (Module.rejectPublishedSecret(Configuration("play.http.secret.key" -> OwnSecret)) must not(throwA[Throwable])) and
      (Module.rejectPublishedSecret(Configuration.empty) must not(throwA[Throwable]))

  def productionRefusesPublishedSecret =
    startInProduction(PublishedSecret).failed.map(_.getMessage).getOrElse("") must
      contain("public default of lmenezes/cerebro")

  def productionAcceptsOwnSecret =
    startInProduction(OwnSecret) must beSuccessfulTry
}
