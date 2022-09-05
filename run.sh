#!/bin/bash

export APP_DIR=$(dirname $(readlink -f "$0"))
set -xe
cd "${APP_DIR}/"

docker-compose pull
docker-compose build --pull
docker-compose up -d --remove-orphans
