# PocketKu

PocketKu is a personal-finance dashboard built with React, TypeScript, Cloudflare Workers and Cloudflare D1.

**Public source only:** This repository should contain application code and database schema, not anyone's bank balances, personal financial schedule, credentials, database dumps, or Git history from a private installation.

## Prerequisites

- Node.js and npm (use compatible versions for the listed dependencies)
- A Cloudflare account and Wrangler access for D1
- An isolated D1 database **of your own**

## Local setup

1. Run `npm ci`.
2. Create your own D1 database, for example `npx wrangler d1 create pocketku-db`, then copy its ID into `wrangler.jsonc` in place of `REPLACE_WITH_YOUR_D1_DATABASE_ID`. The ID in the template is deliberately not a working database ID. **Before committing to a public GitHub repository, restore the placeholder if you inserted your personal D1 identifier while testing.**
3. Run `npx wrangler d1 migrations apply pocketku-db --local`.
4. In **PowerShell on Windows**, run `powershell -ExecutionPolicy Bypass -File .\tools\setup-local-login.ps1`. Choose an email-shaped login ID (it need not be a real mailbox) and a password. The script writes local secrets to `.dev.vars`, which is ignored by Git.
5. Run `npm run dev` and open the displayed localhost URL.

This public copy starts without personal D1 records. Do not import financial seed files from any private installation.

## Security and privacy

- **Never commit** `.dev.vars`, `.env`, credentials, personal `.sql` seeds, D1 exports, or `.wrangler/` database files.
- `src/pocketku/seed.ts` returns an empty browser-demo state; user financial records belong in a private D1 database.
- Single-user login protects Worker `/api/*` routes, but this has **not** passed a production penetration test. Do not deploy with actual financial data until you have verified authentication, rate limiting, session handling, recovery, backup restoration and unauthorised API access.
- The current password setup allows a 6-character minimum because of the owner's local preference. **Do not rely on a short password for an internet-exposed finance application.** Use a long, random, unique password and additional edge protection for any production deployment.
- `wrangler.jsonc` includes a placeholder D1 ID; configure each deployment's own database and keep its contents private.
- The D1 schema includes historical income category identifiers for compatibility. These identifiers alone do not include private payment records.

## Public-repository publishing

See [`PUBLIC_RELEASE_CHECKLIST.md`](PUBLIC_RELEASE_CHECKLIST.md) before publishing. This package has deliberately **no `.git` history**.

## License

No license has been chosen. Add one explicitly if you intend to grant others reuse rights; making a repository public does not itself grant a software license.
