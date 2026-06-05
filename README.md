# Macro Brief

Shared macro allocation viewer with a single trusted publisher.

The intended model is:

- you run the publisher job with your own market-data access and AI API key
- the job writes published artifacts into `docs/`
- viewers only read the hosted site
- viewers do not need their own Anthropic/OpenAI keys

## Recommended deployment

- Host `docs/` on Cloudflare Pages
- Protect access with Cloudflare Access
- Run `scripts/publish_site.js` on one machine you control

That gives you:

- one private publisher identity
- a shared read-only app for approved users
- no API-key handling in the browser

## Publisher workflow

The publisher script:

1. fetches fresh market data
2. writes `docs/data/live.json`
3. writes `docs/data/daily-flows.json`
4. writes `docs/data/shares-history.json`
5. generates the latest brief into `docs/briefs/`
6. updates `docs/briefs/index.json`
7. updates `docs/data/history.json`

Run it with environment variables:

```bash
export MACRO_BRIEF_PROVIDER=anthropic
export ANTHROPIC_API_KEY=your_key_here
# optional:
# export MACRO_BRIEF_MODEL=claude-sonnet-4-6

npm run publish:site
```

OpenAI works too:

```bash
export MACRO_BRIEF_PROVIDER=openai
export OPENAI_API_KEY=your_key_here
# optional:
# export MACRO_BRIEF_MODEL=gpt-4o

npm run publish:site
```

If you only want to refresh market data without generating a new brief:

```bash
MACRO_BRIEF_SKIP_BRIEF=1 npm run publish:site
```

## Local development

Install dependencies:

```bash
npm install
```

Run the old Electron app locally if you still want the admin desktop shell:

```bash
npm start
```

The hosted viewer itself is just the static `docs/` app.

## Cloudflare Pages

Deploy `docs/` as your static site.

Suggested setup:

1. Push this repo to GitHub
2. In Cloudflare, create a Pages project named something like `macro-brief`
3. Use `docs` as the Pages output directory
4. Protect the site with Cloudflare Access so only approved users can open it

You do not need to expose your API keys to Cloudflare Pages for the viewer.
Only the publisher machine needs them.

### Repo files added for Cloudflare

- `wrangler.jsonc`
- `.github/workflows/deploy-cloudflare-pages.yml`
- `.github/workflows/publish-and-deploy.yml`

### GitHub secrets to add

Add these repository secrets in GitHub:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_PAGES_PROJECT_NAME`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`

The workflow deploys `docs/` to Cloudflare Pages on every push to `main`.
The manual publish workflow can also generate fresh artifacts from secrets stored in GitHub.

### Minimal Cloudflare setup

1. Create an API token in Cloudflare with Pages edit/deploy permissions
2. Copy your Cloudflare account ID
3. Create the Pages project once in the dashboard
4. Set `CLOUDFLARE_PAGES_PROJECT_NAME` to that exact Pages project name
5. Push to `main` or run the GitHub Actions workflow manually

### Manual publisher workflow

You now have a manual GitHub Actions workflow named `Publish Artifacts And Deploy`.

Use it when you want GitHub to:

1. fetch fresh market data
2. optionally generate a new brief
3. commit updated `docs/` artifacts back to `main`
4. deploy the updated `docs/` folder to Cloudflare Pages

Workflow inputs:

- `provider`: `anthropic` or `openai`
- `model`: optional model override
- `skip_brief`: if `true`, only refresh data and skip AI brief generation

If you primarily want GitHub to act as the publisher, this is the easiest operating path.

### Optional local deployment

If you want to deploy without GitHub Actions:

```bash
npm run deploy:pages -- --project-name=your-pages-project-name
```

That command uses Wrangler to upload `docs/` directly to Cloudflare Pages.

### Cloudflare Access

After the site is live:

1. Open Cloudflare Zero Trust
2. Create an Access application for the Pages hostname
3. Add only the email addresses or domains you want to allow

That turns the hosted viewer into an invite-only site without giving viewers API keys.

## What viewers can do

- read the latest brief
- browse prior briefs
- inspect allocation history
- inspect published flow snapshots
- reload the latest published artifacts already on the site

## What viewers cannot do

- enter their own API keys
- generate briefs directly
- trigger privileged market-data fetches from the browser

## Project structure

```text
macro-brief/
├── docs/                  # shared viewer app and published artifacts
├── electron/              # legacy/admin desktop shell and data generators
├── scripts/publish_site.js
└── tests/
```

## Notes

- The browser app should be treated as read-only
- Your API keys must stay on the publisher machine
- If you later want a fully online publisher, move `scripts/publish_site.js` to a scheduled server environment
