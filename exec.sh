#!/bin/bash

export APP_DIR=$(dirname $(readlink -f "$0"))
set -xe
cd "${APP_DIR}/"

exec docker compose exec node bash -i -c "$@"
