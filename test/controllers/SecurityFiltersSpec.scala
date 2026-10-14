package controllers

import org.specs2.Specification
import play.api.{Environment, Mode}
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers._

import scala.util.Try

object SecurityFiltersSpec extends Specification {

  private def withApp[T](test: play.api.Application => T): T = {
    val app = new GuiceApplicationBuilder().build()
    running(app)(test(app))
  }

  private def withBasicAuthApp[T](test: play.api.Application => T): T = {
    val app = new GuiceApplicationBuilder()
      .configure(
        "auth.type" -> "basic",
        "auth.settings.username" -> "test-user",
        "auth.settings.password" -> "test-password"
      )
      .build()
    running(app)(test(app))
  }

  def is = sequential ^ s2"""
    Play security filters should
      add standard security headers       $securityHeaders
      reject an untrusted Host header     $rejectUntrustedHost
      reject cookie-authenticated POSTs without a CSRF token $rejectMissingCsrf
      reject the development signing secret in production $productionSecretIsRequired
      configure HttpOnly and SameSite session cookies $safeSessionCookieDefaults
      expose a signed token in the login form and page metadata $loginCsrfToken
  """

  def securityHeaders = withApp { app =>
    val response = route(app, FakeRequest(GET, "/connect/hosts")).get
    (status(response) mustEqual OK) and
      (header("X-Frame-Options", response) must beSome("DENY")) and
      (header("X-Content-Type-Options", response) must beSome("nosniff"))
  }

  def rejectUntrustedHost = withApp { app =>
    val request = FakeRequest(GET, "/connect/hosts").withHeaders(HOST -> "attacker.example")
    status(route(app, request).get) mustEqual BAD_REQUEST
  }

  def rejectMissingCsrf = withApp { app =>
    val request = FakeRequest(POST, "/auth/logout").withHeaders(COOKIE -> "browser-session=present")
    status(route(app, request).get) mustEqual FORBIDDEN
  }

  def productionSecretIsRequired = {
    val application = Try {
      new GuiceApplicationBuilder(environment = Environment.simple(mode = Mode.Prod)).build()
    }
    application.foreach(_.stop())
    application must beFailedTry
  }

  def safeSessionCookieDefaults = withApp { app =>
    (app.configuration.get[Boolean]("play.http.session.httpOnly") must beTrue) and
      (app.configuration.get[String]("play.http.session.sameSite") mustEqual "lax")
  }

  def loginCsrfToken = withBasicAuthApp { app =>
    val response = route(app, FakeRequest(GET, "/login")).get
    val html = contentAsString(response)
    val metaToken = """name="csrf-token" content="([^"]+)""".r
      .findFirstMatchIn(html)
      .map(_.group(1))

    (status(response) mustEqual OK) and
      (metaToken must beSome.which(_.nonEmpty)) and
      (html must contain("name=\"csrfToken\""))
  }
}
