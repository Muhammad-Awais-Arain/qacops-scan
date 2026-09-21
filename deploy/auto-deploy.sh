#!/usr/bin/env bash
# Checks each repository for new commits and rebuilds only the ones that moved.
# Run by qacops-deploy.timer every few minutes. Safe to run by hand.
set -uo pipefail

REPOS=("$HOME/qacops-site" "$HOME/qacops-scan")
# Space separated override, used when testing the script somewhere else.
[ -n "${QACOPS_REPOS:-}" ] && read -ra REPOS <<<"$QACOPS_REPOS"
PORTS=(4004 4005)
LOG="$HOME/qacops-deploy.log"
MAX_LOG_BYTES=$((5 * 1024 * 1024))

log() { printf '%s  %s\n' "$(date -Is)" "$*" >>"$LOG"; }

# Keep the log from growing forever.
if [ -f "$LOG" ] && [ "$(stat -c%s "$LOG")" -gt "$MAX_LOG_BYTES" ]; then
  tail -n 2000 "$LOG" >"$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  log "log trimmed"
fi

deployed_any=0

for dir in "${REPOS[@]}"; do
  name=$(basename "$dir")

  if [ ! -d "$dir/.git" ]; then
    log "$name: skipped, not a git checkout"
    continue
  fi

  cd "$dir" || continue
  branch=$(git rev-parse --abbrev-ref HEAD)

  if ! git fetch --quiet origin "$branch" 2>>"$LOG"; then
    log "$name: fetch failed, will retry next run"
    continue
  fi

  local_sha=$(git rev-parse HEAD)
  remote_sha=$(git rev-parse "origin/$branch")
  [ "$local_sha" = "$remote_sha" ] && continue

  log "$name: ${local_sha:0:7} -> ${remote_sha:0:7} on $branch, deploying"

  # --ff-only refuses to deploy anything that needs a merge, which would mean
  # someone edited files on the server. Better to stop and be told.
  if ! git pull --ff-only --quiet 2>>"$LOG"; then
    log "$name: pull is not a fast forward, deploy skipped. Check for local edits on the server."
    continue
  fi

  if docker compose up -d --build >>"$LOG" 2>&1; then
    log "$name: deployed $(git rev-parse --short HEAD) ($(git log -1 --pretty=%s))"
    deployed_any=1
  else
    # A failed build leaves the previous container running, so the site stays up.
    log "$name: BUILD FAILED, previous container left running"
  fi
done

if [ "$deployed_any" = "1" ]; then
  for port in "${PORTS[@]}"; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$port/" || echo 000)
    log "health check $port -> $code"
  done
  # Reclaim space from images the rebuilds replaced.
  docker image prune -f --filter "until=168h" >/dev/null 2>&1
fi
