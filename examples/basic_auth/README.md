# How to configure basic auth

## Dockerized environment

When running cerebro's docker image the following environment variables must be set.

- `CEREBRO_SECRET`: the application secret, a random value of at least 32 characters
- `AUTH_TYPE`: must be set to `basic`
- `BASIC_AUTH_USER`
- `BASIC_AUTH_PWD`

This [docker-compose](./docker-compose.yml) shows how to configure cerebro with basic auth and the user `admin`/`admin`.

Other settings are described in [Other settings](../../README.md#other-settings).
