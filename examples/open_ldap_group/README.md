# OpenLDAP sign-in with a group check

This example continues the [OpenLDAP example](../open_ldap/README.md). cerebro
checks the user name and password, and also checks that the user is a member
of the group `cn=cerebro,ou=groups,dc=example,dc=org`.

## What it contains

[docker-compose.yml](docker-compose.yml) starts the same two containers as the
OpenLDAP example:

- `cerebro`: the `chosenwar/cerebro:latest` image with LDAP sign-in and the
  group check, on port 9000.
- `open_ldap`: an OpenLDAP server from the `osixia/openldap:1.4.0` image, with
  the container name `ldap`. It holds the directory `dc=example,dc=org` with
  the administrator `cn=admin,dc=example,dc=org` (password `admin`). The
  [ldif](ldif) folder is mounted at `/opt` in this container.

The osixia/openldap image loads the OpenLDAP `memberOf` overlay. When a group
of the class `groupOfUniqueNames` lists a user in its `uniqueMember`
attribute, the overlay adds the group's DN to the `memberOf` attribute of the
user's entry. The group check of this example searches for that attribute.

The example has no Elasticsearch cluster. After you sign in, cerebro shows its
connect page, where you can enter the address of a cluster that the cerebro
container can reach.

## Run it

1. In this folder, start the containers:

   ```sh
   docker compose up -d
   ```

2. Add the directory entries with [add_group.sh](add_group.sh):

   ```sh
   ./add_group.sh
   ```

   The script runs `ldapadd` in the `ldap` container three times. It adds the
   organizational units `ou=people` and `ou=groups`
   ([ldif/ous.ldif](ldif/ous.ldif)), the user `test` with the password `test`
   ([ldif/test-user.ldif](ldif/test-user.ldif)) and the group `cerebro` with
   `test` as its member ([ldif/add_group.ldif](ldif/add_group.ldif)).

   The LDAP server needs a few seconds to start. If the script cannot contact
   it, wait and run the script again.

3. Open <http://localhost:9000> and sign in as `test` with the password
   `test`.

A user who is not a member of the group cannot sign in, even with the right
password. The sign-in page shows the same message as for a wrong password,
"Incorrect username or password", and does not say which check failed.

To stop the example and delete its data:

```sh
docker compose down -v
```

## The directory entries

The user, from [ldif/test-user.ldif](ldif/test-user.ldif):

```ldif
dn: uid=test,ou=people,dc=example,dc=org
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

The group, from [ldif/add_group.ldif](ldif/add_group.ldif):

```ldif
dn: cn=cerebro,ou=groups,dc=example,dc=org
objectClass: groupofuniquenames
cn: cerebro
description: All users
uniquemember: uid=test,ou=people,dc=example,dc=org
```

LDAP attribute and object class names are not case-sensitive, so
`groupofuniquenames` is the class `groupOfUniqueNames` and `uniquemember` is
the attribute `uniqueMember`.

## The cerebro settings

The `cerebro` service in [docker-compose.yml](docker-compose.yml) sets these
environment variables:

```yaml
environment:
  - CEREBRO_SECRET=replace-with-a-long-random-secret
  - AUTH_TYPE=ldap
  - LDAP_URL=ldap://ldap:389
  - LDAP_BASE_DN=ou=people,dc=example,dc=org
  - LDAP_METHOD=simple
  - LDAP_USER_TEMPLATE=uid=%s,%s
  - LDAP_BIND_DN=cn=admin,dc=example,dc=org
  - LDAP_BIND_PWD=admin
  - LDAP_USER_ATTR=uid
  - LDAP_USER_ATTR_TEMPLATE=%s
  - "LDAP_GROUP=memberof=cn=cerebro,ou=groups,dc=example,dc=org"
```

The first six are explained in the [OpenLDAP example](../open_ldap/README.md).
Here the users are in `ou=people`, so `LDAP_BASE_DN` is
`ou=people,dc=example,dc=org`, and a user who signs in as `test` binds as
`uid=test,ou=people,dc=example,dc=org`.

The group check uses the others:

- `LDAP_BIND_DN` and `LDAP_BIND_PWD`: the account that cerebro binds with to
  search the directory. The example uses the administrator. The search only
  reads, so an account that can read the user entries is enough.
- `LDAP_USER_ATTR`: the attribute that identifies the user, here `uid`.
- `LDAP_USER_ATTR_TEMPLATE`: turns the user name typed at sign-in into the
  value of `LDAP_USER_ATTR`. `%s` keeps the user name unchanged, because the
  `uid` of the test user is the plain user name `test`. If your users were
  identified by their `mail` attribute instead, you would set
  `LDAP_USER_ATTR=mail` and `LDAP_USER_ATTR_TEMPLATE=%s@example.org`. When
  `LDAP_USER_ATTR_TEMPLATE` is not set, cerebro uses `LDAP_USER_TEMPLATE`,
  which here would give `uid=test,ou=people,dc=example,dc=org` as the value
  of `uid` and match no entry.
- `LDAP_GROUP`: an LDAP filter that the user's entry must also match. Here it
  is `memberof=cn=cerebro,ou=groups,dc=example,dc=org`, the attribute that the
  `memberOf` overlay maintains.

## If the group check fails

cerebro binds as `LDAP_BIND_DN` and searches the subtree below
`LDAP_GROUP_BASE_DN` with this filter. When `LDAP_GROUP_BASE_DN` is not set,
as in this example, the search starts at `LDAP_BASE_DN`.

```text
(&(<LDAP_USER_ATTR>=<value from LDAP_USER_ATTR_TEMPLATE>)(<LDAP_GROUP>))
```

The value from `LDAP_USER_ATTR_TEMPLATE` is LDAP-escaped: cerebro replaces
`*`, `(`, `)`, `\` and NUL characters in it with escape sequences. The user
can sign in only if the search finds an entry and the password is right.

For the user `test`, the filter is:

```text
(&(uid=test)(memberof=cn=cerebro,ou=groups,dc=example,dc=org))
```

Run the same search with `ldapsearch` in the `ldap` container:

```sh
docker exec ldap ldapsearch -LLL -x -H ldap://localhost \
  -D "cn=admin,dc=example,dc=org" -w admin \
  -b "ou=people,dc=example,dc=org" \
  "(&(uid=test)(memberof=cn=cerebro,ou=groups,dc=example,dc=org))" 1.1
```

The attribute list `1.1` asks for no attributes, so `ldapsearch` prints only
the DN of each entry that matches:

```text
dn: uid=test,ou=people,dc=example,dc=org
```

If it prints nothing, check that the group lists the user, and that
`LDAP_USER_ATTR`, `LDAP_USER_ATTR_TEMPLATE` and `LDAP_GROUP` produce a filter
that matches the user's entry. `memberOf` is an operational attribute, so
`ldapsearch` shows it only when you ask for it: replace `1.1` with `memberOf`
to see the groups of the user.
