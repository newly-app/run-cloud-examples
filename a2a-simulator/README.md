# Simulator A2A adapter

An A2A 1.0 JSON-RPC adapter using the official `@a2a-js/sdk` client and server
and the published run.cloud SDK. It binds to loopback; it is not a hosted
public A2A endpoint. Discovery is public locally; every operation requires the
caller's own run.cloud API key. No server credential fallback is allowed.

With Node.js 20 or newer, from this directory:

```sh
npm ci
npm test
npm start
```

To get the example first:

```sh
git clone --depth 1 https://github.com/newly-app/run-cloud-examples.git
cd run-cloud-examples/a2a-simulator
```

See [verification evidence](VERIFICATION.md) for the production registration
result and the distinction between simulated protocol tests and live checks.

Discover `http://127.0.0.1:3100/.well-known/agent-card.json`. `PORT` selects
the local port and `RUN_CLOUD_API_URL` selects the upstream environment.
`client.mjs` exports `connect(baseUrl, apiKey)`, which returns an operation
function using the official A2A client.

```js
import { connect } from './client.mjs';

const agent = await connect('http://127.0.0.1:3100', process.env.RUN_CLOUD_API_KEY);
const account = await agent({ operation: 'account' });
console.log({ authenticated: account.authenticated });
```

Send one structured data part, for example:

```json
{"operation":"create","platform":"ios","orgId":"your-account","idempotencyKey":"your-stable-request"}
```

Operations: `account`, `usage`, `create`, `get`, `open-url`, `accessibility`,
`tap`, `press-button` (Home), `screenshot`, and `delete`. Device operations use
`platform` (`ios` or `android`); existing devices use `sessionId`. `open-url`
takes an HTTP(S) `url`; `tap` takes normalized `x` and `y`. Creation enforces
60-second inactivity and five-minute hard timeouts. Always release in `finally`.
Screenshots return PNG bytes; other results preserve SDK types. Treat session
viewer URLs as bearer secrets, not log output.

The adapter returns immediate messages and retains no conversation/task state.
It does not advertise streaming or persistent task support. The calling agent
translates prompts into structured operations. Keep the adapter local; exposing
it remotely requires a separately secured HTTPS deployment.

Account authentication does not authorize a wallet or fund the account. Device
sessions use the caller's normal run.cloud billing and are metered until release.
This adapter contains no Link transport and does not initiate payments. See the
[simulator integration guide](https://docs.run.cloud/agents/simulators).

## Autonomous registration check

With an explicitly authorized Purelymail inbox, this command requests a fresh
signup code, retrieves it over TLS IMAP, creates an account and API key, and
checks the CLI, SDK, and official A2A client without manual code entry.

Install this adapter's dependencies, Python 3, and the published `runcloud` CLI
first. The inbox must support tagged aliases and authorize the agent to read
verification messages.

```sh
RUN_CLOUD_REGISTRATION_E2E=1 \
RUN_CLOUD_TEST_MAILBOX=qa@example.com \
RUN_CLOUD_TEST_MAILBOX_PASSWORD_FILE=/secure/path/mail-password \
node registration-proof.mjs
```

It uses a unique tagged email alias and the default public run.cloud API, or
the explicit `RUN_CLOUD_API_URL`. It creates no simulator and makes no payment.
Account credentials and the redacted report stay in a restricted temporary
directory printed at completion. Do not publish `signup.json`; retain it only
in your secret storage or revoke the test key when finished. Mail retrieval is
read-only and restricted to the new alias.

The ordinary tests use simulated device operations and exercise the official
A2A client/server, credential rejection, caller isolation, bounded session
creation, screenshots, release, input validation, and sanitized failures.
