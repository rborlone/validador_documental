#!/bin/sh
# Aplica las migraciones pendientes antes de arrancar (Prisma usa un advisory lock, así que es
# seguro con varias réplicas). En AKS puede moverse a un Job/initContainer con RUN_MIGRATIONS=false.
set -e
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo '{"level":"info","service":"documents-service","message":"Aplicando migraciones de base de datos"}'
  ./node_modules/.bin/prisma migrate deploy
fi
exec "$@"
