# Bartleby — Restore Runbook

How to get Bartleby back up after losing the VPS (or after a botched
deploy that corrupted the SQLite file). The S3-compatible bucket
configured in `ops/litestream.yml` is the source of truth — it has the
most recent CRDT state and 30 days of point-in-time history.

## What you need

- A fresh VPS with Docker + Docker Compose + git.
- SSH access to that VPS.
- The Bartleby git repo cloned (or ready to clone) on the VPS.
- The same S3 bucket/endpoint/credentials as the original deployment.
  These live in `ops/.env`; have your credentials manager ready.

## Recovery

### 1. Spin up the new VPS, clone the repo

```sh
ssh youruser@new-vps
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin git
git clone https://github.com/EvanWAppel/bartleby.git
cd bartleby
```

### 2. Recreate `ops/.env`

Same values as the old deployment. Order they go in matters most for:

- `LITESTREAM_BUCKET` / `LITESTREAM_ENDPOINT` / `LITESTREAM_REGION` /
  `LITESTREAM_ACCESS_KEY_ID` / `LITESTREAM_SECRET_ACCESS_KEY` — must
  point at the same bucket the original deployment was replicating to.
- `BARTLEBY_DOMAIN` — same DNS name; update the A/AAAA record to the
  new VPS IP before continuing so Caddy can renew TLS.

```sh
cp ops/.env.example ops/.env
$EDITOR ops/.env
```

### 3. Restore the SQLite file

Run a one-shot Litestream restore. This pulls the latest snapshot +
WAL frames from S3 into the `bartleby_data` named volume.

```sh
# Create the volume + a temporary container that owns the mount.
docker volume create bartleby_bartleby_data
docker run --rm \
  -v bartleby_bartleby_data:/data \
  --env-file ops/.env \
  litestream/litestream:0.3 \
  restore -o /data/bartleby.db \
  s3://${LITESTREAM_BUCKET}/data/bartleby.db
```

Replace `${LITESTREAM_BUCKET}` with the literal bucket name if your
shell doesn't expand env-file values.

### 4. Verify the restore landed

```sh
docker run --rm -v bartleby_bartleby_data:/data alpine \
  sh -c 'apk add --no-cache sqlite >/dev/null && sqlite3 /data/bartleby.db "SELECT count(*) FROM documents;"'
```

You should see a row count that matches what you remember being in the
system. If it's `0`, the restore probably missed the right replica —
check the bucket browser for `data/bartleby.db/generations/...`.

### 5. Bring the stack up

```sh
docker compose -f ops/docker-compose.yml up -d --build
docker compose -f ops/docker-compose.yml logs --tail 50 bartleby
```

Within ~30s the bartleby healthcheck should go green
(`docker compose ps` shows "healthy"). Caddy will request a new TLS
cert; that usually completes in 10–30s.

Visit `https://${BARTLEBY_DOMAIN}` and confirm you can sign in + see
your notes. Have a friend connect too and confirm live sync still works.

## Point-in-time restore (older snapshot)

If you want a snapshot from before a corruption event instead of the
latest:

```sh
docker run --rm \
  -v bartleby_bartleby_data:/data \
  --env-file ops/.env \
  litestream/litestream:0.3 \
  snapshots s3://${LITESTREAM_BUCKET}/data/bartleby.db
```

Note the generation+index of the snapshot you want, then:

```sh
docker run --rm \
  -v bartleby_bartleby_data:/data \
  --env-file ops/.env \
  litestream/litestream:0.3 \
  restore -o /data/bartleby.db \
  -generation <GENERATION> -index <INDEX> \
  s3://${LITESTREAM_BUCKET}/data/bartleby.db
```

## Dry-run / test restore

Periodically (quarterly is reasonable for our scale) test the restore
without touching production:

```sh
docker run --rm \
  --env-file ops/.env \
  -v $(pwd)/test-restore:/restore \
  litestream/litestream:0.3 \
  restore -o /restore/bartleby.db \
  s3://${LITESTREAM_BUCKET}/data/bartleby.db
sqlite3 test-restore/bartleby.db 'SELECT count(*) FROM documents;'
rm -rf test-restore
```

A non-zero row count proves the bucket is healthy and the credentials
work.

## Common failures

- **`access denied` from Litestream**: check `LITESTREAM_ACCESS_KEY_ID`
  / `LITESTREAM_SECRET_ACCESS_KEY` in `ops/.env` and that the IAM/B2
  bucket policy grants `s3:GetObject` + `s3:ListBucket`.
- **Restore writes 0 bytes**: the bucket path probably differs — check
  `litestream snapshots` to find the actual key prefix.
- **Caddy can't get a cert**: DNS still points at the old IP, or port
  80/443 isn't open on the new VPS. `dig +short ${BARTLEBY_DOMAIN}`.
