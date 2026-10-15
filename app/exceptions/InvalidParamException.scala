package exceptions

/** A request parameter is present but has a value the endpoint does not accept (answered with 400). */
case class InvalidParamException(name: String, allowed: Seq[String])
  extends Exception(s"Invalid value for parameter $name, expected one of ${allowed.mkString(", ")}")
