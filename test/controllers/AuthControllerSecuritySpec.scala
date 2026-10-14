package controllers

import org.specs2.Specification

object AuthControllerSecuritySpec extends Specification {

  def is = s2"""
    AuthController redirect validation should
      keep local application paths        $keepLocalPath
      reject external or malformed paths  $rejectUnsafePaths
  """

  def keepLocalPath =
    AuthController.safeRedirectTarget("/overview?tab=nodes#active") mustEqual "/overview?tab=nodes#active"

  def rejectUnsafePaths = {
    val unsafe = Seq(
      "https://attacker.example/",
      "//attacker.example/",
      "/\\attacker.example/",
      "javascript:alert(1)",
      "relative/path",
      "/safe\r\nLocation: https://attacker.example/"
    )

    unsafe.map(AuthController.safeRedirectTarget).distinct mustEqual Seq("/")
  }
}
