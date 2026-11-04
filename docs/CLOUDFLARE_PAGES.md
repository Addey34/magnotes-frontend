# Cloudflare Pages publication

This workflow targets the existing **magnotes** Direct Upload project and its
existing domains. It never creates a project, changes a production branch, or
modifies DNS. The read-only preflight refuses a missing project, a Git-connected
project, or a production branch other than `main`.

## Initial state and activation

Merging this workflow does **not** enable publication. PRs only build and validate
the static payload, without Cloudflare secrets. No `pull_request_target` is used.
The existing Frontend CI remains the quality gate.

On every PR, `deployment-tools` separately reproduces the deploy job's setup in
an empty workspace: explicit pnpm **10.33.2**, `standalone: true`, Node **22**, no
checkout, no environment and no token permissions. It actually starts Wrangler
**4.45.0** using `pnpm --package=wrangler@4.45.0 dlx wrangler --version`, then
checks `pages deploy --help` for the flags used by publication. Help does not
authenticate or publish. The same job tests the Cloudflare preflight predicate
against positive/negative JSON fixtures, without calling Cloudflare.

The preflight's GET endpoint and `production_branch`/`source` fields are defined
by the [Cloudflare project API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/get/).
Actual account permission, project state and post-publication HTTP responses can
only be verified during a separately authorized publication. Offline fixtures
and CLI help do not validate credentials, propagation or production headers.

After supervisor approval:

1. Merge the dedicated PR and wait for **Frontend CI on a push of main** to pass.
2. Create the GitHub environment `cloudflare-production`, restrict deployment
   branches to `main`, and configure required reviewers/prevent self-review where
   supported. These protections must be configured separately, not assumed from
   the YAML. Protect `main` and review changes to this workflow and build tooling.
3. In that environment, configure **only** `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID`. Do not place the token in repository-level secrets:
   environment scoping keeps it out of ordinary PR jobs. Enter values directly in
   GitHub settings; never in a PR, log, command argument or committed file.
4. Scope the API token to the intended account with **Account / Cloudflare Pages /
   Edit**, not a global API key. This permission may cover other Pages projects in
   the same account; the workflow's project-name guard is not a token-level ACL.
5. Set repository variable `CLOUDFLARE_DEPLOY_MODE=manual` and, only when ready,
   `CLOUDFLARE_DEPLOY_ENABLED=true`. Unset/other values disable publication.
6. Run **Cloudflare Pages** manually from `main`, supplying its full current
   approved SHA as `production_sha`. The SHA must match the dispatch commit,
   current `main`, and a successful latest push run of `.github/workflows/ci.yml`.
   Approve the environment gate if configured. This step publishes production:
   it is outside preparation and requires deployment authorization.

No secret values are needed to review this PR. Do not dispatch this workflow
while merely preparing it. Secrets are supplied only to the publication step;
dependencies and the app build run beforehand without them.

## Payload and public configuration

Node 22, pnpm 10.33.2 and `pnpm install --frozen-lockfile` build with
`pnpm run build:firebase`. The historical name remains intentional: the script
assembles `firebase-dist/index.html` (landing), `firebase-dist/app/index.html`
(React, Vite base `/app/`), plus `_headers` and `_redirects` derived from the
existing configuration. Only `/app/b/*` is rewritten to the app so real JS assets
are not shadowed. The build rejects missing files, invalid rewrites, symlinks,
hidden files and server-side Workers/Functions content.

The workflow explicitly preserves the existing public configuration:

| Build variable          | Value                                                     |
| ----------------------- | --------------------------------------------------------- |
| `VITE_API_URL`          | `https://api-magnotes.adrianguichard.dev`                 |
| `VITE_UMAMI_SRC`        | `https://analytics-magnotes.adrianguichard.dev/script.js` |
| `VITE_UMAMI_WEBSITE_ID` | `a9929205-23b7-4c23-acce-bce9bd8b8322`                    |

These are public browser configuration, not credentials. The API and analytics
origins must agree with the existing CSP. Update both through review if needed.
Direct Upload uses the bundle built in GitHub, not Cloudflare dashboard build
variables. No backend or production database is involved in build validation.

Actions are pinned by commit; Wrangler is pinned to **4.45.0**. App dependencies
use the lockfile; Wrangler's transitive CLI dependencies are resolved by pnpm
dlx (an exact CLI version is not a transitive lockfile). Review updates explicitly.

## Automatic mode, only after manual acceptance

After an authorized manual publication, confirm the published SHA, both HTML
routes, JS assets, CSP, analytics and existing domains. Inspect desktop and mobile
journeys separately before accepting automatic publication. Then, on supervisor
approval, change `CLOUDFLARE_DEPLOY_MODE` to `automatic`.

Only a completed **Frontend CI** run for a **push** in
`Addey34/magnotes-frontend`, branch **main**, with conclusion **success** can
trigger automatic publication. The workflow also verifies the source repository,
workflow path, head SHA, latest CI run and current main through the API. A PR CI
completion cannot deploy. Manual publication remains available with the same
checks. No upstream CI artifacts or caches are consumed as deployment payloads;
the verified commit is rebuilt and downloaded from this deployment run only.

Production workflows serialize without cancelling an in-flight upload. Current
main and CI are checked again after the build/environment approval, immediately
before the upload. Old queued SHAs fail closed. A push can still occur during
Cloudflare's upload: GitHub's branch update and Cloudflare publication are not
atomic. The new successful main run will publish next in automatic mode; the
HTTP SHA check detects a different publication. Avoid parallel manual uploads
outside this workflow. Turning the enable variable off prevents new eligible
runs; it does not recall a step already uploading. Cancel/inspect that run too.

## Evidence, failures and rollback

The build artifact is retained for seven days, including public `deployment.json`
with source SHA/run ID. Wrangler receives `--commit-hash`, and its log reports the
deployment URL. The job summary records SHA, CI run, publication run and status.
HTTP checks poll the production SHA, check `/`, `/app/`, an actual JS asset and
security headers. They do not perform browser interaction or change user data.

An HTTP failure marks the workflow failed but does not undo an upload. There is
no automatic rollback: it could overwrite a newer valid deployment. With explicit
authorization, disable automatic publication, stop pending uploads, then select
a previously successful production deployment in Cloudflare Pages Deployments
and use **Rollback**. Verify its recorded SHA and HTTP/browser checks. Do not
delete/recreate the project or touch custom domains. A reproducible code rollback
can instead revert the change through a reviewed PR, pass Frontend CI on the new
main SHA, and publish that SHA; arbitrary historical SHA dispatch is intentionally
refused. Resume automatic mode only after the incident is understood.

## Reuse checklist (Galaxy, Ludora, future projects)

Copy and review this pattern in the target repository; this PR changes MagNotes
only. Parameterize the repository allowlist (including job conditions), workflow
name/path, production branch (including event filters/ref guards), Pages project,
build command/output directory, artifact paths, production URL, public build
variables, CSP expectations and route/asset/analytics checks. Use each project's
own account-scoped environment secrets and production environment restrictions.
Keep the initial enable switch off and require a successful manual acceptance
before automatic mode. Confirm the target is an existing Direct Upload project.
The pattern uses ordinary GitHub-hosted Actions and Cloudflare Pages without a
paid deployment service; account quotas and free-plan limits still apply.

References: [Wrangler Pages commands](https://developers.cloudflare.com/workers/wrangler/commands/pages/),
[GitHub workflow_run security](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run),
[Cloudflare rollback](https://developers.cloudflare.com/pages/configuration/rollbacks/).
