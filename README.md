# Caffeine Zombie Reddit integration: source review snapshot

This folder contains selected, unchanged source files from Caffeine Zombie Marketing Studio for Reddit API review. It is a partial source snapshot, not a standalone bot or a complete runnable application. It contains no Git history or runtime state.

Source commit: 75278ffaa16c5d788cd4d06c47cb3dae45ae9a61

## Purpose and current status

The owner intends to manage the official Reddit account u/caffeineZgames for commercial promotion of MOST ARE MINE. Initial provider access is for OAuth account verification. Real Reddit authentication, permissions, and publishing have not been verified. Publishing remains disabled during connection testing. Commercial and API access approval are requested before provider use.

## Source map

- src/oauth.js: authorization-code OAuth, callback state checks, and explicit token refresh. The Reddit provider requests identity and submit with duration=permanent. This does not collect a Reddit account password. The local callback is http://127.0.0.1:4317/oauth/callback/reddit.
- src/adapters.js: GET /api/v1/me checks the expected account; POST /api/submit is the text self-post path. Publication requires an explicit live-publishing setting, the exact draft ID, a valid human approval, a due schedule, and the expected account. An uncertain result requires manual inspection and is not automatically retried. tick only creates dry-run plans.
- src/drafts.js: per-platform Steam UTM links, draft validation, scheduling, and approval fingerprints. Content or schedule edits invalidate approval.
- src/store.js: local SQLite persistence and AES-256-GCM encryption for OAuth-issued tokens.
- src/config.js and config/: account identity, campaign data, and external artifact-directory configuration. Configured account handles and campaign links are public business identifiers.
- package.json and package-lock.json: exact dependency definitions.
- .env.example: empty configuration placeholders only.

The original modules also contain branches for other social platforms. They are included unchanged so the review accurately reflects the implementation. This folder includes their local module imports and configuration reads. The CLI, web server, UI, and tests are outside this snapshot. package.json is unchanged and therefore retains commands for excluded files. Do not use those commands to run this snapshot.

The script selection in Reddit app registration describes the owner's local, account-specific use. It does not mean this repository contains a single independent script, and it does not remove API approval requirements. Whether Reddit accepts the supplied app type and grant combination remains subject to approval and an actual connection test.

## Review scope

This snapshot is provided for inspection of the actual integration code, not as a public multi-user service. Subreddit targets are not selected. Before production publishing, the owner must choose permitted communities, review their rules, and approve each final draft. The approval checks validate configured fields; they do not automatically determine subreddit policy compliance.

The author inspected 48 currently tracked files and 64 reachable blobs across 3 commits. Ten configured local secret values produced no exact matches. Four limited credential patterns produced no candidates. .env.example assignments are empty. This was a bounded check, not a comprehensive credential scan. The snapshot excludes .env, tokens, databases, logs, machine paths, agent settings, and .git.

## Submission

Share a reviewer-accessible repository URL containing this folder after reviewing it. Describe it in the application as the Reddit integration source snapshot of the private local marketing studio. A localhost address cannot be opened by Reddit reviewers. Source disclosure by itself does not establish API approval.

SOURCE_MANIFEST.json records the original relative paths and SHA-256 hashes. The original studio source remains canonical. No provider request, approval action, advertisement, post, or Git push was performed to prepare this snapshot.
