# Gemini through Antigravity CLI

LearnHarness now bundles the official **Antigravity CLI 1.5.0** for Linux x64,
using ACP SDK 0.16.1. The saved provider key remains `gemini-cli`, so existing
chat and background-role settings continue to refer to the same provider.
The visible provider and model labels identify Antigravity CLI.

Google stopped serving personal Google AI Pro, Ultra and free individual accounts
through Gemini CLI on 2026-06-18. See the [official announcement](https://github.com/google-gemini/gemini-cli/discussions/28017).
The retired Gemini CLI runtime is no longer bundled. An existing terminal `agy`
installation is neither changed nor required.

## Connect

1. Open Settings → Providers → External CLI → Gemini (Antigravity CLI).
2. Choose **Connect Google account**, then finish Google's browser sign-in with
   the account associated with your subscription.
3. Select a Gemini (Antigravity CLI) model in Models and the desired chat or
   background roles. Those roles remain independently configurable.

A new sign-in is required: old Gemini CLI credentials are incompatible and are
not imported. The old credential directory is left intact. Successful ACP
`oauth-personal` authentication establishes the saved connection; token-file
presence alone does not establish usable account access.

The `auto` alias uses Antigravity's default model. Saved `pro`, `flash` and
`flash-lite` aliases select only an appropriate Gemini model advertised by the
account's session response. An unavailable alias produces an explicit error,
without an API-key fallback. Account access and quota are controlled by Google.
Prices and global context limits remain unknown in the UI. Extra AI-credit
spending is disabled (`useG1Credits: false`).

## Runtime and account storage

The versioned native package is downloaded from Google's official manifest and
verified against pinned SHA-512 archive and binary hashes by
`scripts/prepare-antigravity.mjs` before builds. This local desktop target has
verified runtime metadata for Linux x64; other targets require their own verified
platform manifest before packaging. `build-server.mjs` materializes the runtime
package inside standalone node_modules, avoiding development symlinks.

Antigravity owns OAuth, its browser callback, opaque credential cache and refresh.
The application-owned `antigravity-cli-credentials/` profile sits beside
`auth.json` (or the file selected by `LH_AUTH_FILE`). It is owner-only. The CLI
receives an absolute managed `--gemini-dir` and relative
`--app-data-dir antigravity-cli`, scoped XDG paths and an empty D-Bus address so
native file fallback stays in this profile instead of the user's terminal
keyring. The ordinary HOME is preserved for the user's system browser. The
application never parses or copies native credential files between workers.

Account/API/gateway/ADC override variables are removed from the CLI environment.
Browser authentication is invoked only by the explicit connection action.
Teaching turns call `session/new`, which reuses cached credentials and fails if
they are missing or expired; turns never call `authenticate` implicitly.

Disconnect first stops the provider's live work and login process, then removes
the complete managed profile. This clears local credentials and does not revoke
Google's account grants. Native ACP workers run in an isolated process group,
which cancellation and disposal terminate together. Their disposable workspaces,
including ACP logs, are removed during cleanup. Logs and OAuth URLs are not
forwarded to the UI. JSON-RPC error messages retain useful text while URLs,
bearer credentials and token fields are redacted.

## Teaching protocol and tools

Launch uses `acp --process-per-session --disable-telemetry
--include-default-customizations=false`. Each session sends native
`_meta.disableBuiltInTools: true`. Managed permissions additionally deny native
command, file and browser actions and allow only `mcp(learnharness/*)`. Unexpected
ACP permission requests are cancelled.

The current LearnHarness teaching instructions are passed through the advertised
`_meta.antigravity.systemPrompt.append` extension. This appends instructions to
Antigravity's system prompt; it is not a replacement of the native prompt.
LearnHarness supplies the conversation content and images with full history
replay. ACP notifications are presentation only and cannot execute harness tools.
Actual tool execution requires a request to the bearer-protected local HTTP MCP
bridge. Eager MCP metadata loads the supplied teaching tools.

A waiting teaching question can retain its worker and pending MCP requests for
ten minutes. Only matching run identity, history, model, instructions, tool
configuration and pending tool results can reuse it. Other turns replay saved
history in a fresh session. Cancellation, disconnect, disposal and request/idle
deadlines stop the owned process group and release the bridge.

## Focused verification

Only Antigravity/Gemini-provider tests are used for this migration. They cover
native initialize and unauthenticated session startup, explicit OAuth initiation,
profile and environment isolation, teaching metadata, native-tool disabling,
images, authenticated MCP requests/results, model selection, cancellation,
process-group cleanup, catalog compatibility and safe error display. Native
checks use disposable empty profiles and make no paid model requests. Successful
Google sign-in and subscription access still require completing browser login.

Primary references:

- [ACP integration and authentication](https://antigravity.google/docs/ide/extensions/acp/)
- [CLI release notes and session extensions](https://antigravity.google/docs/changelog/)
- [CLI settings](https://antigravity.google/docs/settings/?tab=cli)
- [Permission rules](https://antigravity.google/docs/permissions/?tab=cli)
