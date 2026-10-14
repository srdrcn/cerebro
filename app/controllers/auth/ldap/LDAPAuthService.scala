package controllers.auth.ldap

import com.google.inject.Inject
import controllers.auth.AuthService
import javax.naming._
import javax.naming.directory.SearchControls
import javax.naming.ldap.{InitialLdapContext, LdapContext}
import play.api.{Configuration, Logger}

import java.util.Hashtable

import scala.util.control.NonFatal

class LDAPAuthService @Inject()(globalConfig: Configuration) extends AuthService {

  import LDAPAuthService.escapeFilterValue

  private val log = Logger(this.getClass)

  private final val config = new LDAPAuthConfig(globalConfig.get[Configuration]("auth.settings"))

  private def openContext(principal: String, password: String, followReferrals: Boolean = false): LdapContext = {
    val props = new Hashtable[String, Object]()
    props.put(Context.INITIAL_CONTEXT_FACTORY, "com.sun.jndi.ldap.LdapCtxFactory")
    props.put(Context.PROVIDER_URL, config.url)
    props.put(Context.SECURITY_AUTHENTICATION, config.method)
    props.put(Context.SECURITY_PRINCIPAL, principal)
    props.put(Context.SECURITY_CREDENTIALS, password)
    if (followReferrals) props.put(Context.REFERRAL, "follow")
    new InitialLdapContext(props, null)
  }

  def checkUserAuth(username: String, password: String): Boolean = {
    try {
      val context = openContext(config.userTemplate.format(username, config.baseDN), password)
      try true finally context.close()
    } catch {
      case e: AuthenticationException =>
        log.info(s"login of $username failed with: ${e.getMessage}")
        false
      case NonFatal(e) =>
        log.error(s"login of $username failed", e)
        false
    }
  }

  def checkGroupMembership(username: String, groupConfig: LDAPGroupSearchConfig): Boolean = {
    val user     = escapeFilterValue(groupConfig.userAttrTemplate.format(username, config.baseDN))
    val controls = new SearchControls()
    controls.setSearchScope(SearchControls.SUBTREE_SCOPE)
    try {
      val context = openContext(groupConfig.bindDN, groupConfig.bindPwd, followReferrals = true)
      try {
        val search = context.search(groupConfig.baseDN, s"(& (${groupConfig.userAttr}=$user)(${groupConfig.group}))", controls)
        try search.hasMore finally search.close()
      } finally context.close()
    } catch {
      case e: AuthenticationException =>
        log.info(s"User $username doesn't fulfill condition (${groupConfig.group}) : ${e.getMessage}")
        false
      case NonFatal(e) =>
        log.error(s"Unexpected error while checking group membership of $username", e)
        false
    }
  }

  def auth(username: String, password: String): Option[String] = {
    val isValidUser = config.groupMembership match {
      case Some(groupConfig) => checkGroupMembership(username, groupConfig) && checkUserAuth(username, password)
      case None              => checkUserAuth(username, password)
    }
    if (isValidUser) Some(username) else None
  }

}

object LDAPAuthService {
  private[ldap] def escapeFilterValue(value: String): String =
    value.flatMap {
      case '\u0000' => "\\00"
      case '*'      => "\\2a"
      case '('      => "\\28"
      case ')'      => "\\29"
      case '\\'     => "\\5c"
      case char     => char.toString
    }
}
