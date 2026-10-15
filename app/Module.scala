import com.google.inject.AbstractModule
import play.api.{Configuration, Environment}

// Play loads the class Module from the root package at startup. It binds
// nothing; it only checks the configuration before the application starts.
class Module(environment: Environment, configuration: Configuration) extends AbstractModule {

  override def configure(): Unit = Module.rejectPublishedSecret(configuration)

}

object Module {

  // The secret that lmenezes/cerebro shipped in conf/application.conf. It is
  // public, so anyone could sign a session cookie with it and get past the
  // basic or LDAP sign-in.
  private[this] val PublishedSecret = "ki:s:[[@=Ag?QI`W2jMwkY:eqvrJ]JqoJyi2axj3ZvOv^/KavOT4ViJSv?6YY4[N"

  def rejectPublishedSecret(configuration: Configuration): Unit =
    if (configuration.getOptional[String]("play.http.secret.key").contains(PublishedSecret))
      throw configuration.reportError(
        "play.http.secret.key",
        "The application secret is the public default of lmenezes/cerebro's application.conf. " +
          "Set CEREBRO_SECRET (or secret / play.http.secret.key) to your own random value of at least 32 characters, " +
          "for example the output of: openssl rand -base64 48"
      )

}
