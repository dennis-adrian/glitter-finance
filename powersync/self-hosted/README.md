# Self-hosted PowerSync

Runs the [PowerSync Service](https://github.com/powersync-ja/powersync-service)
(Open Edition, the same engine as PowerSync Cloud) on one small server, for an
environment that needs more than the 50 simultaneous connections of the Cloud
free plan. The app does not change: it only needs `NEXT_PUBLIC_POWERSYNC_URL`
to point here.

| File                  | What it is                                                   |
| --------------------- | ------------------------------------------------------------ |
| `docker-compose.yaml` | The containers: storage, migrations, replication, API, proxy |
| `service.yaml`        | PowerSync Service configuration                              |
| `Caddyfile`           | HTTPS and load balancing across the API containers           |
| `.env.example`        | The values to fill in on the server (copy to `.env`)         |
| `../sync-rules.yaml`  | The sync rules, shared with every other environment          |

## How it fits together

```text
devices ──HTTPS──▶ proxy (Caddy) ──▶ api × 3 ──▶ storage (Postgres, on this server)
                                                   ▲
Supabase Postgres ──logical replication──▶ replication
```

- **replication** reads every change from Supabase through the `powersync`
  publication, as `powersync_role`, and writes it into **storage**.
- **api** containers serve devices from storage. Each takes up to 150
  connections (`service.yaml`); a device that finds one full is refused
  (`PSYNC_S2304`) and retries every few seconds. Its own writes still upload
  meanwhile: only receiving other devices' changes waits.
- **storage** holds only a copy. Losing it loses no data: the service
  replicates everything again from Supabase, and devices sync again.
- Devices still upload straight to Supabase. Nothing here handles writes.

## Capacity

Measured on a development machine with this exact stack, three API containers
and a small data set (200 rows per connection): 450 connections held, the
451st onward refused with 429, about 200 MB of memory per API container and
under 1 GB for the whole stack. That is a smoke test, not a guarantee: real
puestos hold more rows and the server is smaller. **Run the load test below on
the real server before a festival.**

A server with 2 vCPU and 4 GB of memory fits the default three API containers
(450 connections). For more, raise `PS_API_REPLICAS`; plan about 600 MB each.

## Server

1. **Create the server.** Any Linux VPS with 2 vCPU, 4 GB of memory, 40 GB of
   disk and a **public IPv6 address** as well as IPv4. IPv6 is required: on
   the Supabase free plan the direct database host
   (`db.<project-ref>.supabase.co`) resolves to IPv6 only.
2. **Install Docker Engine** 27 or later with the Compose plugin
   (<https://docs.docker.com/engine/install/>).
3. **Open the firewall** for TCP 80 and 443 (and UDP 443), nothing else
   besides SSH.
4. **Point DNS at it:** an `A` record (and `AAAA`) for the sync hostname, for
   example `sync.example.com`. Caddy needs it to get the certificate.
5. **Check IPv6 reaches Supabase** before going further:

   ```bash
   docker run --rm --network host postgres:17-alpine \
     pg_isready -h db.<project-ref>.supabase.co -p 5432
   ```

   It must print `accepting connections`. If it cannot resolve or reach the
   host, the server has no working IPv6.

## Supabase

The project needs what the main README's **PowerSync setup** already
describes: `powersync_role` (with its password) and the `powersync`
publication with every synced table. A project that PowerSync Cloud already
syncs has both; nothing to add.

Then check how the project signs its tokens. Open
`https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`:

- It lists one or more keys: nothing to do, `client_auth.supabase: true`
  finds them.
- It shows `{"keys":[]}`: the project still uses the legacy shared JWT
  secret. Either migrate it to signing keys (Supabase dashboard,
  **Authentication → Signing keys**), or add the secret to the server: put
  `PS_SUPABASE_JWT_SECRET=<the JWT secret>` in `.env`, pass it through in
  `docker-compose.yaml` under `x-powersync` → `environment`, and add
  `supabase_jwt_secret: !env PS_SUPABASE_JWT_SECRET` under `client_auth` in
  `service.yaml`.

## First start

On the server:

```bash
git clone https://github.com/dennis-adrian/glitter-finance.git
cd glitter-finance/powersync/self-hosted
cp .env.example .env
nano .env            # fill in every value
docker compose up -d
docker compose ps
```

After a minute `storage` and the three `api` containers are `healthy`,
`migrate` has `Exited (0)`, and `replication` and `proxy` are `Up`. Then:

```bash
# The first copy of the database. Wait for "Activated new replication stream".
docker compose logs -f replication

# From anywhere: the instance answers over HTTPS.
curl https://<PS_DOMAIN>/probes/liveness
```

In Supabase, `SELECT slot_name, active FROM pg_replication_slots;` shows a
slot that starts with the `PS_SLOT_NAME_PREFIX`, active.

## Load test

From a checkout of this repository, against **staging** (a QA account that
`pnpm db:seed:qa` created, and a sync server connected to the staging
project):

```bash
POWERSYNC_URL=https://<PS_DOMAIN> \
QA_EMAIL=... QA_PASSWORD=... \
NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... \
pnpm powersync:load-test -- --connections 300 --ramp 60 --hold 300
```

The connections are WebSockets, as the app's are (`--transport http` opens
HTTP streams, which the service counts separately). It passes when every
connection reaches sync and none fails. While it holds,
watch `docker stats` on the server: no container should sit near its memory
limit. If the hosted project has captcha on, password sign-in from a script is
refused; pass a `POWERSYNC_TOKEN` (an access token copied from a signed-in
browser session) in place of the four sign-in variables.

## Switching an environment over

Staging first, then production, each once its load test passes.

1. Start the stack against that environment's Supabase project and wait for
   the first copy to finish.
2. In Vercel, set `NEXT_PUBLIC_POWERSYNC_URL` to `https://<PS_DOMAIN>` for
   that environment and redeploy. The variable is built into the app, so only
   a new deployment picks it up.
3. Devices move over as they load the new build: an installed app has to be
   closed and reopened online once. A device on the old build keeps using
   PowerSync Cloud until then, which is fine: both read the same database.
   Each device downloads its data again from the new instance; unsent sales
   stay queued on the device and upload to Supabase as before.
4. Check on two devices of one puesto that a sale made on one shows on the
   other, and that Diagnósticos shows a recent sync.
5. **When no device uses the Cloud instance any more, delete it** in the
   PowerSync dashboard, then confirm in Supabase that its replication slot is
   gone (`SELECT slot_name, active FROM pg_replication_slots;`; drop an
   inactive leftover with `SELECT pg_drop_replication_slot('<name>');`). A
   slot nobody reads makes Postgres keep every change since, and on the free
   plan that fills the 500 MB database.

To go back, set `NEXT_PUBLIC_POWERSYNC_URL` to the Cloud URL again and
redeploy. Keep the Cloud instance until you are sure you will not.

## Operations

- **Sync rules changed** (`powersync/sync-rules.yaml`): `git pull`, then
  `docker compose up -d --force-recreate replication api`. The service
  replicates again under the new rules and switches when that is done.
- **Logs:** `docker compose logs -f api` (or `replication`, `proxy`).
- **Restart everything:** `docker compose restart`. Devices reconnect by
  themselves.
- **More connections:** raise `PS_API_REPLICAS` in `.env`, then
  `docker compose up -d`.
- **Disk:** `df -h` and `docker system df`. Storage grows with the synced
  history; the service compacts it as part of replication.
- **Stopping for more than a few hours:** the replication slot stays on
  Supabase and holds changes back while nothing reads it. Before leaving the
  stack off for long, drop the slot (see step 5 above); the next start makes
  a new one and copies the database again.
- **Start over:** `docker compose down -v` deletes the storage copy (and the
  certificate). Drop the slot in Supabase too, then `docker compose up -d`.
- **Monitoring:** point an uptime monitor at
  `https://<PS_DOMAIN>/probes/liveness`, next to the one for `/api/health`
  (`docs/production-observability.md`).

## On Railway instead of a server

Railway runs the same images without a server to look after. It cannot mount
files or run a compose file, so the pieces map like this:

| Here                       | On Railway                                                                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `proxy` (Caddy)            | Not needed: Railway terminates HTTPS and balances the API replicas. Give the `api` service a public domain with target port `8080`.                                                                                                        |
| `storage`                  | A service from `postgres:17-alpine` with a volume at `/var/lib/postgresql/data`, `PGDATA=/var/lib/postgresql/data/pgdata`, and `POSTGRES_USER`, `POSTGRES_DB` (`powersync`) and `POSTGRES_PASSWORD`. No public domain.                     |
| `replication`, `api`       | Two services from `journeyapps/powersync-service:<version>`, told apart by `PS_RUNNER_TYPE` (`sync` and `api`); `api` with 3 replicas and health check path `/probes/liveness`. Turn on **outbound IPv6** on both (Settings → Networking). |
| `service.yaml`, sync rules | `POWERSYNC_CONFIG_B64` and `POWERSYNC_SYNC_CONFIG_B64`: `base64 -w0 service.yaml` and `base64 -w0 ../sync-rules.yaml`. Update the variable and redeploy when either file changes.                                                          |
| `PS_STORAGE_URI`           | `postgresql://powersync:${{storage.POSTGRES_PASSWORD}}@${{storage.RAILWAY_PRIVATE_DOMAIN}}:5432/powersync`                                                                                                                                 |
| `PS_SOURCE_URI`            | A project **shared variable**, entered by hand in the dashboard (it holds the `powersync_role` password); both services read it as `${{shared.PS_SOURCE_URI}}`.                                                                            |
| `migrate`                  | Not a separate service: each container migrates on start. With restart policy **On failure**, a container that loses the race on the very first start restarts and finds the tables there.                                                 |
| Memory limits              | 0.75 GB per replica on every service, and `NODE_OPTIONS=--max-old-space-size=512` on the PowerSync ones, so the bill has a ceiling.                                                                                                        |

`NEXT_PUBLIC_POWERSYNC_URL` is `https://<the api service's domain>`. Railway
bills memory by use (about $10 per GB a month): expect roughly $9 to $10 a
month for this stack. Keep it in its own project, apart from other services
on the account, and mind that an account-wide spending limit stops those too.

## Upgrading

The image is pinned in `docker-compose.yaml`. To upgrade, read the
[release notes](https://github.com/powersync-ja/powersync-service/releases),
change the tag in a pull request, then on the server `git pull` and
`docker compose up -d`. `migrate` runs the storage migrations first.

## Licence

The PowerSync Service is published under the Functional Source License: free
to run and modify for your own application, not to offer as a competing
hosted sync service.
