#!/bin/sh
set -eu
snapshot=$(mktemp -d)
trap 'rm -rf "$snapshot"' EXIT
cp api/openapi.json "$snapshot/openapi.json"
cp -R apps/web/src/api/generated "$snapshot/generated"
make api-client
cmp api/openapi.json "$snapshot/openapi.json"
diff -ru "$snapshot/generated" apps/web/src/api/generated
