# Automatic deploys

The server checks GitHub every three minutes and rebuilds any repository whose
commit changed. Nothing is exposed to the internet and no tokens are needed,
because the server asks GitHub rather than GitHub calling in.

Covers `~/qacops-site` (port 4004) and `~/qacops-scan` (port 4005).

## Install, once

```bash
sudo install -m 755 ~/qacops-scan/deploy/auto-deploy.sh /usr/local/bin/qacops-deploy
sudo cp ~/qacops-scan/deploy/qacops-deploy.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now qacops-deploy.timer
```

The script runs from `/usr/local/bin/qacops-deploy` rather than the repository,
because deploying `qacops-scan` rewrites the repository copy, and bash reads a
script as it goes. If the script itself ever changes, re install it:

```bash
sudo install -m 755 ~/qacops-scan/deploy/auto-deploy.sh /usr/local/bin/qacops-deploy
```

Check it is scheduled:

```bash
systemctl list-timers qacops-deploy --no-pager
```

## Watching it

```bash
tail -f ~/qacops-deploy.log          # what it did, and the health check after
journalctl -u qacops-deploy -n 50    # systemd's own view, including failures
```

A deploy line looks like:

```
2026-09-21T09:03:12+00:00  qacops-site: 61d0124 -> d5d51e4 on main, deploying
2026-09-21T09:03:41+00:00  qacops-site: deployed d5d51e4 (Send relative redirects so a wrong path stays on https)
2026-09-21T09:03:42+00:00  health check 4004 -> 200
```

## Run it now rather than waiting

```bash
sudo systemctl start qacops-deploy
```

## How it behaves when things go wrong

- **A build fails:** the previous container keeps serving and the log says
  `BUILD FAILED`. The site never goes down because of a bad commit.
- **Someone edited files on the server:** the pull is not a fast forward, so the
  deploy stops and says so rather than throwing the edits away.
- **GitHub is unreachable:** it logs the failure and tries again on the next run.
- **Disk fills with old images:** images older than a week are pruned after each
  successful deploy.

## Turning it off

```bash
sudo systemctl disable --now qacops-deploy.timer
```

## Changing the schedule

Edit `OnUnitActiveSec` in `/etc/systemd/system/qacops-deploy.timer`, then
`sudo systemctl daemon-reload && sudo systemctl restart qacops-deploy.timer`.
