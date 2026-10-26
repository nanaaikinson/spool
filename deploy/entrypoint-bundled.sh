#!/bin/sh
# Entrypoint for the bundled image: runs a private Prometheus beside Spool.
# Setting PROMETHEUS_URL to your own server skips the bundled one.
set -eu

if [ -z "${PROMETHEUS_URL:-}" ]; then
  port="${SPOOL_ADDR:-0.0.0.0:8003}"
  port="${port##*:}"
  data="${SPOOL_PROMETHEUS_DIR:-/data/prometheus}"
  config=/tmp/prometheus.yml
  mkdir -p "$data"
  {
    printf 'global:\n  scrape_interval: 15s\nscrape_configs:\n'
    printf '  - job_name: %s\n' "${SPOOL_METRICS_JOB:-spool}"
    if [ -n "${SPOOL_METRICS_TOKEN:-}" ]; then
      printf '    authorization:\n      credentials: %s\n' "$SPOOL_METRICS_TOKEN"
    fi
    printf '    static_configs:\n      - targets: ["127.0.0.1:%s"]\n' "$port"
  } > "$config"
  /app/prometheus \
    --config.file="$config" \
    --storage.tsdb.path="$data" \
    --storage.tsdb.retention.time="${SPOOL_PROMETHEUS_RETENTION:-15d}" \
    --web.listen-address=127.0.0.1:9090 &
  prom=$!
  export PROMETHEUS_URL=http://127.0.0.1:9090
else
  prom=
fi

/app/spool &
spool=$!
stopping=
trap 'stopping=1; kill -TERM "$spool" ${prom:+"$prom"} 2>/dev/null || true' TERM INT

# Spool is the container's lifecycle; Prometheus is best-effort.
code=0
wait "$spool" || code=$?
# A trapped signal ends the first wait early. Spool shuts down cleanly on it,
# so a requested stop is a success rather than 143.
if [ -n "$stopping" ]; then
  wait "$spool" 2>/dev/null || true
  code=0
fi
if [ -n "$prom" ]; then
  kill -TERM "$prom" 2>/dev/null || true
  wait "$prom" 2>/dev/null || true
fi
exit "$code"
