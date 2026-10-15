name := "cerebro"

maintainer := "Leonardo Menezes <leonardo.menezes@xing.com>"

packageSummary := "Elasticsearch web admin tool"

packageDescription := """cerebro is an open source(MIT License) elasticsearch web admin tool built
  using Scala, Play Framework and Angular."""

version := "0.9.4"

scalaVersion := "2.13.18"

val playVersion = "3.0.11"
val playSlickVersion = "6.2.0"
val jacksonVersion = "2.18.11"
val logbackVersion = "1.5.38"

javacOptions ++= Seq("--release", "17")
scalacOptions += "-release:17"

rpmVendor := "lmenezes"

rpmLicense := Some("MIT")

rpmUrl := Some("http://github.com/lmenezes/cerebro")

libraryDependencies ++= Seq(
  "org.playframework" %% "play"                    % playVersion,
  "org.playframework" %% "play-json"               % "3.0.6",
  "org.playframework" %% "play-slick"              % playSlickVersion,
  "org.playframework" %% "play-slick-evolutions"   % playSlickVersion,
  "org.xerial"         % "sqlite-jdbc"              % "3.53.2.1",
  "org.specs2"        %% "specs2-junit"             % "4.23.0" % Test,
  "org.specs2"        %% "specs2-core"              % "4.23.0" % Test,
  "org.specs2"        %% "specs2-mock"              % "4.23.0" % Test
)

// Keep every Jackson module on the same patched line. Play 3.0.x otherwise
// brings an older Jackson family transitively through Play and Pekko.
dependencyOverrides ++= Seq(
  "at.yawk.lz4"                       % "lz4-java"                     % "1.11.4",
  "com.fasterxml.jackson.core"       % "jackson-annotations"           % jacksonVersion,
  "com.fasterxml.jackson.core"       % "jackson-core"                  % jacksonVersion,
  "com.fasterxml.jackson.core"       % "jackson-databind"              % jacksonVersion,
  "com.fasterxml.jackson.dataformat" % "jackson-dataformat-cbor"       % jacksonVersion,
  "com.fasterxml.jackson.datatype"   % "jackson-datatype-jdk8"         % jacksonVersion,
  "com.fasterxml.jackson.datatype"   % "jackson-datatype-jsr310"       % jacksonVersion,
  "com.fasterxml.jackson.module"     % "jackson-module-parameter-names" % jacksonVersion,
  "com.fasterxml.jackson.module"    %% "jackson-module-scala"          % jacksonVersion,
  "ch.qos.logback"                   % "logback-classic"                % logbackVersion,
  "ch.qos.logback"                   % "logback-core"                   % logbackVersion
)

libraryDependencies += filters
libraryDependencies += ws
libraryDependencies += guice

lazy val root = (project in file(".")).
  enablePlugins(PlayScala, BuildInfoPlugin, LauncherJarPlugin, JDebPackaging, RpmPlugin).
  settings(
    buildInfoKeys := Seq[BuildInfoKey](name, version, scalaVersion, sbtVersion),
    buildInfoPackage := "models"
  )

Compile / doc / sources := Seq.empty

enablePlugins(JavaServerAppPackaging)
enablePlugins(SystemdPlugin)

Debian / systemdSuccessExitStatus += "143"
Rpm / systemdSuccessExitStatus += "143"
linuxPackageMappings += packageTemplateMapping(s"/var/lib/${packageName.value}")() withUser((Linux / daemonUser).value) withGroup((Linux / daemonGroup).value)
