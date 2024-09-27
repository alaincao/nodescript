#!/bin/bash

export APP_DIR=$(dirname $(readlink -f "$0"))

set -xe

cd "${APP_DIR}/"

PARM="stop"
if [ "$1" == "down" ]; then
	PARM="down --volumes"
fi

docker compose --profile '*' ${PARM}
