# OpenLDAP sign-in

This example runs cerebro with LDAP sign-in against a test OpenLDAP server.
cerebro checks the user name and password only. To also check that the user
belongs to a group, see the [OpenLDAP group example](../open_ldap_group/README.md).

## What it contains

[docker-compose.yml](docker-compose.yml) starts two containers:

- `cerebro`: the `chosenwar/cerebro:latest` image with LDAP sign-in, on port
  9000.
- `open_ldap`: an OpenLDAP server from the `osixia/openldap:1.4.0` image, with
  the container name `ldap`. It holds the directory `dc=example,dc=org` with
  the administrator `cn=admin,dc=example,dc=org` (password `admin`). The
  [users](users) folder is mounted at `/opt` in this container.

The example has no Elasticsearch cluster. After you sign in, cerebro shows its
connect page, where you can enter the address of a cluster that the cerebro
container can reach.

## Run it

1. In this folder, start the containers:

   ```sh
   docker compose up -d
   ```

2. Add the test user `test`, with the password `test`, from
   [users/test-user.ldif](users/test-user.ldif):

   ```sh
   docker exec ldap ldapadd -x -D "cn=admin,dc=example,dc=org" -w admin -f /opt/test-user.ldif -H ldap://localhost -ZZ
   ```

   The LDAP server needs a few seconds to start. If `ldapadd` cannot contact
   it, wait and run the command again.

3. Open <http://localhost:9000> and sign in as `test` with the password
   `test`.

A wrong user name or password shows "Incorrect username or password".

To stop the example and delete its data:

```sh
docker compose down -v
```

## The test user

The entry in [users/test-user.ldif](users/test-user.ldif):

```ldif
dn: uid=test,dc=example,dc=org
uid: test
cn: test
sn: 3
objectClass: top
objectClass: posixAccount
objectClass: inetOrgPerson
loginShell: /bin/bash
homeDirectory: /home/test
uidNumber: 14583102
gidNumber: 14564100
userPassword: {SSHA}1UJpCaMBlyy29xn2Yj+EadadHVBPxL5X
mail: test@example.org
gecos: test User
```

## The cerebro settings

The `cerebro` service in [docker-compose.yml](docker-compose.yml) sets these
environment variables:

```yaml
environment:
  - CEREBRO_SECRET=replace-with-a-long-random-secret
  - AUTH_TYPE=ldap
  - LDAP_URL=ldap://ldap:389
  - LDAP_BASE_DN=DC=example,DC=org
  - LDAP_METHOD=simple
  - LDAP_USER_TEMPLATE=uid=%s,%s
```

- `CEREBRO_SECRET`: the application secret. The image does not start without
  it. The file uses a placeholder. Before you use the file for anything else,
  replace it with a random value of at least 32 characters, for example the
  output of `openssl rand -base64 48`.
- `AUTH_TYPE`: `ldap` turns on LDAP sign-in.
- `LDAP_URL`: the LDAP server. The host name is `ldap`, the container name of
  the OpenLDAP server.
- `LDAP_BASE_DN`: the part of the directory that holds the users. The test
  user is directly below `dc=example,dc=org`.
- `LDAP_METHOD`: `simple` binds with a DN and a password.
- `LDAP_USER_TEMPLATE`: builds the DN that cerebro binds with, so that users
  type only their user name. The first `%s` is the user name typed at sign-in,
  the second is `LDAP_BASE_DN`. A user who signs in as `test` binds as
  `uid=test,DC=example,DC=org`, the DN of the test user.

The main README describes every setting in
[Environment variables](../../README.md#environment-variables) and how
cerebro signs users in under [LDAP](../../README.md#ldap).
