package controllers.auth.ldap

import controllers.auth.AuthConfig
import play.api.Configuration

import java.util.Locale

class LDAPAuthConfig(config: Configuration) extends AuthConfig {

  implicit val conf: Configuration = config

  final val userTemplate = getSetting("user-template")
  // The value becomes JNDI's SECURITY_AUTHENTICATION. See bindMethod.
  final val method = LDAPAuthConfig.bindMethod(getSetting("method")) match {
    case Right(method) => method
    case Left(error)   => throw config.reportError("method", error)
  }
  final val url = getSetting("url")
  final val baseDN = getSetting("base-dn")


  final val groupMembership: Option[LDAPGroupSearchConfig] = {
    config.getOptional[Configuration]("group-search").flatMap { groupAuthConfig =>
      groupAuthConfig.getOptional[String]("group").map { group =>
        LDAPGroupSearchConfig(
          getSetting("bind-dn"),
          getSetting("bind-pw"),
          groupAuthConfig.getOptional[String]("base-dn").getOrElse(baseDN),
          getSetting("user-attr")(groupAuthConfig),
          groupAuthConfig.getOptional[String]("user-attr-template").getOrElse(userTemplate),
          group
        )
      }
    }
  }
}

object LDAPAuthConfig {

  // SASL mechanisms of the JDK that authenticate with the password typed at
  // sign-in. EXTERNAL (the JVM's TLS client certificate) and GSSAPI (the JVM's
  // Kerberos ticket) never send it, so the bind would succeed for any password.
  private val PasswordMechanisms = Set("DIGEST-MD5", "CRAM-MD5", "PLAIN")

  // cerebro 0.9.x read this setting but always made a simple bind with the
  // user's password. JNDI's "none" and "anonymous" skip the bind, so any
  // password would be accepted: they, and an empty value, keep the simple bind.
  // A SASL value is a whitespace-separated list, and JNDI uses the first
  // mechanism the JVM has a client for, so every mechanism in it must check the
  // password; anything else stops the start. Names are upper-cased because the
  // JDK's SASL clients only match upper-case names.
  private[ldap] def bindMethod(configured: String): Either[String, String] = {
    val value = configured.trim
    if (value.isEmpty || Seq("none", "anonymous", "simple").exists(value.equalsIgnoreCase)) Right("simple")
    else {
      val mechanisms = value.split("\\s+").toSeq.map(_.toUpperCase(Locale.ROOT))
      if (mechanisms.forall(PasswordMechanisms.contains)) Right(mechanisms.mkString(" "))
      else
        Left(
          s"auth.settings.method (LDAP_METHOD) is \"$value\". Use simple, or SASL mechanisms that check the " +
            s"user's password: ${PasswordMechanisms.toSeq.sorted.mkString(", ")}. Mechanisms such as EXTERNAL or " +
            "GSSAPI authenticate cerebro's own certificate or Kerberos ticket and would accept any password."
        )
    }
  }

}

case class LDAPGroupSearchConfig(bindDN: String, bindPwd: String, baseDN: String, userAttr: String, userAttrTemplate:String, group: String)
