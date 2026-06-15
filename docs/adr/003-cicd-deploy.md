# ADR 003: Gated Continuous Deployment via GitHub Actions (Cloudflare Workers)

- **Status:** Proposed (candidate — pending implementation Quick Dev)
- **Date:** 2026-06-15
- **Research:** `_bmad-output/planning-artifacts/research/technical-ops-cloudflare-deploy-ci-research-2026-06-15.md`

## Context

Two operational gaps exist:

1. **CI runs only on pull requests.** `.github/workflows/ci.yml` triggers on `pull_request: [main]`, so direct pushes to `main` (e.g. the deploy commit `582d36b`) skip the entire suite — including the `@lhci/cli autorun` Lighthouse gate. The Tier-3 "Lighthouse never ran for this release" is a symptom of this.
2. **Deploys are manual.** There is no deploy job; shipping is a hand-run `wrangler deploy`, so "what was tested" and "what shipped" are only coincidentally the same artifact.

Constraints:

- The app deploys as **Workers Static Assets** (`wrangler.toml` `[assets]` + `not_found_handling = "single-page-application"`) — already Cloudflare's recommended platform for SPAs (Pages parity since March 2026). No platform migration needed.
- **SvelteKit generates a per-build hash-mode CSP** (`svelte.config.js`, `csp.mode: 'hash'`). The deployed HTML must be the exact HTML whose inline-script hashes were computed at build time, or the CSP breaks in production (previously hit as NFR19).
- **Privacy contract:** zero runtime telemetry; "zero production error visibility" is a conscious, accepted tradeoff — not to be changed here.

Two delivery models were evaluated: Cloudflare **Workers Builds** (Git integration) vs a **GitHub Actions** deploy job (`cloudflare/wrangler-action`). See the research report for the full matrix and citations.

## Decision

**Let GitHub Actions own build _and_ deploy, with deployment gated behind the existing CI.**

- **Add `push: [main]`** to the workflow triggers so direct pushes run the full gate (incl. Lighthouse) — structurally fixing gap (1).
- **Add a `deploy` job** that:
  - `needs: ci` (cannot run unless audit/check/lint/test/build/artifacts/a11y/Lighthouse pass), and
  - `if: github.event_name == 'push' && github.ref == 'refs/heads/main'` (deploy only on push to main, never on PRs).
- **Artifact handoff:** `ci` uploads the tested `./build`; `deploy` downloads that exact artifact and runs `cloudflare/wrangler-action@v3` with `command: deploy` (no rebuild) — so the **tested artifact is the shipped artifact** and the hash-mode CSP is preserved byte-for-byte.
- **Auth:** GitHub secrets `CLOUDFLARE_API_TOKEN` (scoped to Account → Workers Scripts → Edit) and `CLOUDFLARE_ACCOUNT_ID`; optional `production` GitHub Environment for an extra protection gate.
- **Do not** enable Workers Builds for production deploys (it deploys on push _independently_ of the Actions gate, which would re-open gap (1)). Workers Builds may be used later **only** for non-production preview branches.

## Rationale

- **Gating is the whole point, and only a CI-downstream deploy delivers it.** Workers Builds builds + deploys on push but does not run the vitest/Playwright/Lighthouse suite — it is decoupled from, not downstream of, the quality gate. A GitHub Actions `deploy` job with `needs: ci` makes deployment impossible unless the checks the brief cares about are green.
- **`push: [main]` fixes the Lighthouse gap** at the source: `@lhci/cli autorun` now runs on every push, not just PRs.
- **Artifact handoff guarantees CSP correctness** — no second build environment, no chance of hash divergence between tested and shipped HTML.
- **Single source of truth in version control.** Workers Builds setup is Dashboard-only today (no IaC; workers-sdk#12058), whereas the Actions pipeline lives in the repo.
- **No telemetry added** — the privacy contract and the deliberate no-error-visibility tradeoff are untouched.
- **Preserves solo-dev velocity** — the push-trigger + gated deploy closes the gap without forcing a PR-only workflow (branch protection is an optional later hardening).

## Consequences

- **Positive:** Direct pushes are gated; red builds can't deploy; Lighthouse is actually enforced on what ships. Tested artifact == shipped artifact (CSP-safe). Deploy is automatic, reproducible, and version-controlled. No telemetry/privacy change.
- **Positive:** Subsumes the Tier-3 "Lighthouse never ran" item.
- **Negative / cost:** Two GitHub secrets to manage and a Cloudflare API token to scope/rotate. Slightly more workflow YAML (deploy job + artifact handoff).
- **Negative:** PR preview URLs are not included by default (Workers Builds gives those natively) — added later via `wrangler versions upload` or non-production Workers Builds branches if wanted.
- **Watch-outs:** scope the API token minimally; ensure the deploy job's `if` restricts to push-to-main; don't run Workers Builds production deploys in parallel.

## Follow-up

Implement via `bmad-quick-dev` using the plan + `ci.yml` YAML in §10 of the research report. Promote this ADR from **Proposed** to **Accepted** when it lands and a gated deploy has been observed (green push → deploy; red push → blocked).
