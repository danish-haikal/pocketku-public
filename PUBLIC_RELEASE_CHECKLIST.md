# PocketKu public release checklist

This is a **sanitised publishing candidate, not an automated security certification**. It was generated from a source archive supplied for review. The original source archive and your working D1 database were not modified.

## What was intentionally excluded

- `seed-expected-income.sql`: contains a real expected income schedule and amount assumptions
- `balance-check.sql`: personal/local D1 testing query
- `dist/`: compiled output (can be regenerated; may contain stale or personal content)
- `.git/`: never transfer private commit history to the public repo
- `.wrangler/`, `.dev.vars`, `.env`, `node_modules/`, database dumps and backups (if present)
- `.vscode/`: local editor settings (not necessary for source distribution)

## Sanitised

- `wrangler.jsonc` live `database_id` replaced with `REPLACE_WITH_YOUR_D1_DATABASE_ID`.
- Public `.gitignore` explicitly excludes the two private SQL helper filenames and private archive files.
- Generic README replaces the starter Vite template.

## Publication steps (Windows / PowerShell)

1. Keep the original PocketKu repository **private**; do not change its visibility.
2. Unzip this public candidate to an entirely new directory, not over your working PocketKu project.
3. Review each file, including SVG and other assets, for personal information and any unrecognised secrets.
4. Verify no personal SQL data files, `.dev.vars`, Git history, database files, backups or old `dist/` files appear.
5. In that new directory, run `npm ci`, `npm run build` and `npm run lint`. Fix errors before publishing. These were not run against the full dependencies during archive sanitation.
6. Restore the `wrangler.jsonc` `database_id` placeholder if you replaced it during testing. In the new directory, run `git init -b main`, then `git add .`, and inspect `git diff --cached --name-only`. Do **not** commit if personal files or secrets appear.
7. Commit once, then create a **different, initially private** GitHub repo. Push there and check GitHub's file listing and history before flipping that new repo to public.
8. Use GitHub secret scanning and a local scanner (e.g. gitleaks) for a final pass. A keyword scan alone is not sufficient.
9. Only after independent review, publish the clean repo. Never force-push these files into the old history and assume it has been erased.

## Production-blocking security checks

- The login route should resist credential stuffing across many source IPs. Existing lockout is per IP and is not by itself a complete internet-facing safeguard.
- Use a strong unique password even though local setup accepts six characters.
- Confirm every API is inaccessible without a valid authenticated session, including alternate Worker/preview URLs.
- Check cookie flags, CSRF/origin enforcement, logging of sensitive data and session termination.
- Test backup restore to an isolated D1 database. Do not publish your database backups.
- Add appropriate production Cloudflare configuration and secrets, with separate local and production D1 bindings.
- Validate workflows end-to-end and confirm that the app does not expose personal records in source maps or client bundles.

## Source code still deliberately includes generic terms

Historic enum names such as `mara` and `refund` are present in TypeScript and SQL because the existing D1 schema uses them. They are categories, **not populated personal income rows**. Changing their identifiers requires coordinated database and API migration and should not be done merely as a publication scrub.

## Original codebase sync

To continue using one application codebase, make future changes in your private working source, scan/copy only approved changes into the new public release project, and never sync `.git` history, `.dev.vars`, personal seed files, D1 exports or generated assets automatically.
