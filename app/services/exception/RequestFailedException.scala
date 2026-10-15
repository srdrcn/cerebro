package services.exception

case class RequestFailedException(url: String, status: Int) extends RuntimeException {

  override def getMessage: String = s"Failure for [$url]"

}
