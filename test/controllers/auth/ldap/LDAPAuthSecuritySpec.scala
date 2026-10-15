package controllers.auth.ldap

import com.typesafe.config.ConfigFactory
import org.specs2.Specification
import play.api.{Configuration, PlayException}

object LDAPAuthSecuritySpec extends Specification {

  def is = s2"""
    LDAP authentication should
      escape user-controlled LDAP filter values $escapeFilterCharacters
      allow configuration without group search  $groupSearchIsOptional
      bind with the password for method none, anonymous or empty $anonymousMethodsBindSimple
      pass simple and password SASL mechanisms to JNDI         $passwordMethodsArePassedOn
      refuse SASL mechanisms that do not check the password    $nonPasswordMechanismsAreRefused
      refuse such a method at configuration time               $configurationRefusesExternal
  """

  private def config(method: String) = new LDAPAuthConfig(Configuration(ConfigFactory.parseString(
    s"""
      |url = "ldap://localhost:389"
      |base-dn = "ou=People,dc=example,dc=com"
      |method = "$method"
      |user-template = "uid=%s,%s"
      |""".stripMargin
  )))

  def escapeFilterCharacters =
    LDAPAuthService.escapeFilterValue("user*()\\\u0000name") mustEqual "user\\2a\\28\\29\\5c\\00name"

  def groupSearchIsOptional =
    config("simple").groupMembership must beNone

  def anonymousMethodsBindSimple = {
    val methods = Seq("none", "anonymous", "NONE", " Anonymous ", "", "  ")
    methods.map(m => m -> config(m).method) mustEqual methods.map(_ -> "simple")
  }

  def passwordMethodsArePassedOn =
    (config("simple").method mustEqual "simple") and
      (config(" SIMPLE ").method mustEqual "simple") and
      (config("DIGEST-MD5").method mustEqual "DIGEST-MD5") and
      (config("cram-md5").method mustEqual "CRAM-MD5") and
      (LDAPAuthConfig.bindMethod(" DIGEST-MD5\tplain ") must beRight("DIGEST-MD5 PLAIN"))

  def nonPasswordMechanismsAreRefused = {
    val methods = Seq("EXTERNAL", "gssapi", "DIGEST-MD5 EXTERNAL", "PLAIN\tGSSAPI", "simple DIGEST-MD5", "SCRAM-SHA-256")
    methods.map(m => m -> LDAPAuthConfig.bindMethod(m).isLeft) mustEqual methods.map(_ -> true)
  }

  def configurationRefusesExternal =
    config("DIGEST-MD5 EXTERNAL") must throwA[PlayException].like {
      case e => e.getMessage must contain("auth.settings.method") and (e.getMessage must contain("DIGEST-MD5 EXTERNAL"))
    }
}
