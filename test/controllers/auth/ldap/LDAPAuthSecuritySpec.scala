package controllers.auth.ldap

import com.typesafe.config.ConfigFactory
import org.specs2.Specification
import play.api.Configuration

object LDAPAuthSecuritySpec extends Specification {

  def is = s2"""
    LDAP authentication should
      escape user-controlled LDAP filter values $escapeFilterCharacters
      allow configuration without group search  $groupSearchIsOptional
  """

  def escapeFilterCharacters =
    LDAPAuthService.escapeFilterValue("user*()\\\u0000name") mustEqual "user\\2a\\28\\29\\5c\\00name"

  def groupSearchIsOptional = {
    val config = Configuration(ConfigFactory.parseString(
      """
        |url = "ldap://localhost:389"
        |base-dn = "ou=People,dc=example,dc=com"
        |method = "simple"
        |user-template = "uid=%s,%s"
        |""".stripMargin
    ))

    new LDAPAuthConfig(config).groupMembership must beNone
  }
}
