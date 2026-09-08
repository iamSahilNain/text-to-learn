# Deploy a private instance

The production image serves React and the API from Express. Caddy terminates HTTPS. A server-side HTTP Basic login protects all pages, assets and API routes; `/healthz` exposes only readiness. All people using this login share the same courses. This is a private single-instance deployment, with in-memory per-IP request limits, not a multi-user service or a spending cap.

## Configure

Use a Linux host with Docker Engine and Compose, and an external MongoDB replica set (such as Atlas). Point your domain DNS at the host, allow inbound TCP 80/443, and allow the host's outbound IP in MongoDB's network access settings. Use a database user restricted to the application's database. Enable backups with your database provider.

From the repository root:

```sh
cp .env.deploy.example .env.deploy
chmod 600 .env.deploy
openssl rand -hex 32
nvim .env.deploy
```

Paste the generated password into `APP_PASSWORD` (minimum 16 characters). Set `DOMAIN` to a hostname without a scheme or path, `ACME_EMAIL` to your certificate contact email, `MONGO_URI` to the replica-set connection string, and `DEEPSEEK_API_KEY` to your DeepSeek API key. The template selects `AI_PROVIDER=deepseek`. To use Gemini instead, set `AI_PROVIDER=gemini` and supply `GEMINI_API_KEY`; only the selected provider key is required. URL-encode credentials inside MongoDB URIs. Quote environment values containing `$` with single quotes so Compose preserves them literally. `YOUTUBE_API_KEY` is optional. Do not place credentials in any `VITE_` variable or commit `.env.deploy`.

For the generated Desktop file, copy it after filling the blanks:

```sh
cp ~/Desktop/text-to-learn.env .env.deploy
chmod 600 .env.deploy
```

## Start

```sh
docker compose --env-file .env.deploy -f compose.deploy.yaml up -d --build
docker compose --env-file .env.deploy -f compose.deploy.yaml ps
```

Visit `https://YOUR_DOMAIN` and enter `APP_USERNAME` and `APP_PASSWORD` in the browser login dialog. Deep links, streaming generation and PDF exports use this same origin. Do not expose Express directly or bypass Caddy: `TRUST_PROXY=1` assumes the only incoming path is through this proxy. Keep the Compose network private.

A healthy app requires MongoDB connectivity; readiness does not verify provider credentials or quota. Check `/healthz` for HTTP 200, confirm an anonymous `/api/courses` request returns 401, then generate one small course and export a PDF to verify your actual provider credentials. This last check consumes provider quota. TLS certificate issuance requires working public DNS and reachable ports.

## Operations

```sh
docker compose --env-file .env.deploy -f compose.deploy.yaml logs --tail 100 app caddy
docker compose --env-file .env.deploy -f compose.deploy.yaml down
```

Keep the Caddy volumes for certificate state; do not use `down -v`. MongoDB is external and not managed by this Compose file. Tag release images with `APP_IMAGE_TAG`, retain the previous image, and use `up -d --no-build` with its tag to roll back. Restart the app after rotating the password; browser Basic credentials may remain cached until the browser session ends. There is no application logout or account recovery flow. Set provider-side quotas and billing alerts separately. Run only one app replica; rate limits and generation coordination are process-local.

Reference: [Caddy HTTPS prerequisites](https://caddyserver.com/docs/automatic-https) and [Docker environment interpolation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/).


## Model providers

DeepSeek uses `deepseek-v4-flash` by default with thinking disabled, JSON mode,
and an 8192-token output limit. Set `DEEPSEEK_MODEL` to override the model. Its
attempt timeout is 40 seconds; generation plus repair shares 90 seconds. Outline
requests have 100 seconds and lesson operations 110 seconds. Bulk generation
retains its ten-minute total budget; retry to resume completed lessons.
These are initial operating budgets, not measured latency guarantees.

Non-retryable provider errors (including invalid keys and HTTP 402 insufficient
balance) stop immediately. Rate limits and server failures use bounded retries.
Empty, truncated or schema-invalid output gets one repair round, then a clearly
labelled degraded fallback. Live course quality and provider latency still need
testing with your key. [DeepSeek API contract](https://api-docs.deepseek.com/api/create-chat-completion/).
