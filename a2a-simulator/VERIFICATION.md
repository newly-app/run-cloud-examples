# A2A and registration verification

This example uses `@a2a-js/sdk@1.2.0` for both sides of an A2A 1.0 JSON-RPC
connection and `@run-cloud/sdk@0.36.0` for run.cloud operations.

## Live registration and authentication

[Redacted result](evidence/registration.json), recorded September 21, 2026 UTC:

| Check | Result |
| --- | --- |
| Fresh account registration against `https://api.run.cloud` | Passed |
| Real verification email retrieved over TLS IMAP from an authorized inbox | Passed |
| Organization created | Passed |
| CLI and published SDK authenticated with the new API key | Passed |
| Official A2A client discovered the local agent card and authenticated | Passed |
| Missing and invalid keys rejected | Passed |
| Account-scoped usage read through A2A | Passed |
| Manual input during the run | None |

Run ID: `a18229a8-63dd-4047-9a1c-d10f91b571f6`. The report contains no inbox
address, password, verification code, API key, or signed session URL.

## Repeat the checks

Run `npm ci && npm test` for credential-free tests of the official A2A
client/server, caller isolation, session limits, screenshots, release, input
validation, and failure redaction. Simulator operations in these unit tests
are simulated; they do not create a paid device.

For fresh live registration, follow the opt-in command in [the README](README.md).
It requires authorization to read a mailbox and creates a real account/key.
Its private `signup.json` is not a shareable artifact; only `proof.json` is
intended as a redacted report.

## Scope

The adapter runs locally and forwards authenticated operations to run.cloud.
It does not establish a hosted public A2A endpoint, persistent A2A tasks,
streaming, or compatibility with a particular assistant host. The calling
agent maps prompts into the supported structured operations.

Registration and wallet authorization are separate. This registration run
created no simulator and made no payment. This example does not contain a
Link integration, and these results are not proof of autonomous wallet payment.
