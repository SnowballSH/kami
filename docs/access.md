# Access and deployment

## Choose the trust model

`KAMI_ACCESS_MODE=demo` is the default for the iPad/GX10 demo. The HTTP server and Vite listen on
all IPv4 interfaces, so **every reachable peer can read, overwrite and delete every board, report
controller state, and spend model capacity**. Use an isolated, trusted LAN with no public port
forwarding. The iPad opens the existing Vite network URL in development or the built game on
GX10 port 8787. For microphone access on the LAN, use the server's built-in TLS listener at
`https://<box>:8443` and accept its self-signed certificate once. Ordinary same-origin requests need no token. A browser origin other than the
request's own origin must appear in `KAMI_ALLOWED_ORIGINS`; there is no wildcard CORS response.
Origin checks protect browser requests but do not authenticate non-browser peers.

For one-machine development, set both `KAMI_BIND_HOST=127.0.0.1` and
`KAMI_WEB_HOST=127.0.0.1`. This intentionally prevents direct iPad access.

`KAMI_ACCESS_MODE=shared` is for an explicitly configured shared deployment:

- The API defaults to loopback. Serve the built game and `/api` through the **same HTTPS origin**
  using a TLS reverse proxy. Keep port 8787 private; an explicit bind override does not add TLS.
- Set `KAMI_ALLOWED_ORIGINS` to exact public HTTPS origins, including a non-default port if used.
  No paths, wildcard, trailing slash, `null` origin, or automatic trust of forwarded headers.
- Configure separate high-entropy credentials for participants/controllers. Each grants exact
  board IDs, exact controller IDs, and an explicit `models` permission. Empty lists grant nothing.
  Possession permits reading and changing the listed resources; this is not per-action RBAC.
- UDP controller input is disabled: it cannot carry authentication. Setting a UDP port explicitly
  in shared mode fails startup. Use local USB serial (trusted host) or authenticated HTTP reports.
- Invalid/missing shared settings stop startup. CORS allowlisting never replaces authentication.

This mode does not provide user registration, identity-provider login, distributed rate limits,
or a public multi-tenant hosting service. A token with model permission can consume the common
model budget. A trusted operator controls credentials, upstream URLs, host access and deployment.
Do not expose the Vite development server as the shared service.

## Provision credentials

Generate a unique random secret, for example with `openssl rand -hex 32`. Deliver it privately to
the intended participant and install it through the deployment's secret environment configuration.
Never commit, log, or put the value in a URL or command checked into the repository.

Configuration shape (the token below is a placeholder, not a usable credential):

```text
KAMI_ACCESS_MODE=shared
KAMI_ALLOWED_ORIGINS=https://kami.example.org
KAMI_CREDENTIALS=[{"id":"player-one","token":"<replace with generated secret>","boards":["demo"],"controllers":["arcade"],"models":true}]
KAMI_CONTROLLER_UDP_PORT=off
```

Tokens must be 32–256 URL-safe characters; IDs are 1–32 lowercase letters, digits or hyphens.
Credential IDs and tokens must be unique. Board IDs follow the API's board schema. Changing a
credential requires an operator-controlled restart; sessions are held only in memory and all
expire on restart. Run one API process or use sticky routing; credentials and quotas are not
coordinated across replicas. Do not enable proxy/header logging of Authorization or cookies.

The iPad's startup form exchanges its token for an opaque `__Host-kami` cookie: `HttpOnly`,
`Secure`, `SameSite=Strict`, `Path=/`, eight-hour lifetime. The token field is cleared, and tokens
are not saved in local storage or appended to SSE URLs. Same-origin fetch clients—including
recognition, completion, compilation, handwriting and speech—and native EventSource/WebSocket use this cookie
without changing their payload contracts. The initial board/controller comes from the grant
unless the URL already selects one. An explicit URL selection never expands its grant.
Sign out revokes the cookie session; existing controller streams recheck before each state or
five-second heartbeat and close when authorization expires. Previously delivered board data
cannot be recalled.

Shared pages (sandbox mode, [modes.md](modes.md)) use the same board grant: a board's event
stream (`GET /api/boards/:board/events`) and presence reports (`POST /api/boards/:board/presence`)
are board routes, so in shared mode they need a credential that lists that board id, and the
stream rechecks the grant before each message and keep-alive and closes when it expires. In demo
mode any reachable peer can watch and join any page — which is the point of a shared LAN
whiteboard — and the `?board=<id>&mode=sandbox` link the share panel shows carries no secret. The
`peer` query is a name for a tab, minted by the browser and forgotten when it closes; it is not an
identity and grants nothing.

Voice listening (`/api/voice/listen`) checks the same origin, session and `models` grant before
the WebSocket upgrade or any upstream connection. It rechecks before forwarding audio or
transcripts and every 15 seconds while idle; expired or signed-out sessions close both ends.
Voice speaking (`POST /api/voice/speak`) also requires `models`. The proxy must support WebSocket
upgrades in addition to SSE. Browser microphone capture requires a secure context.

Exemplar reads (`GET /api/exemplar?word=…`) require `models` too. They sample stored Quick, Draw!
sketches without inference, but still use database work and return vector data; they share the
model request, concurrency and response-body limits in both modes.

Non-browser clients send `Authorization: Bearer <token>` on each request, including HTTP
controller reports. Query-string tokens are ignored. Browser cookies are designed for same-origin
hosting; allowlisting another origin alone does not make cross-site cookie authentication work.
Rotate a bearer token to revoke it; browser sign-out does not revoke the underlying credential.

When the API is unreachable, the startup screen offers retry or **Play without server**.
Choosing local play grants no API access; shared requests still require a valid credential.
If an existing session expires during play, reload to sign in again; unsaved changes may remain
only in the open tab.

## Limits and expected responses

Model routes (`recognize`, `beautify`, `compile`, `transcribe`, `voice/speak`, `exemplar`) and voice-listening
upgrades share a per-process fixed-window budget of 6,000 requests per minute and 32 concurrent
operations by default, in both
modes. Tune `KAMI_MODEL_REQUESTS_PER_MINUTE` and `KAMI_MODEL_CONCURRENCY` for the GX10 and expected
pen traffic. A slot stays occupied while the model response is read; response bodies have an
8 MiB ceiling and 30-second read deadline. Upstream inference/request deadlines remain those of
the individual adapters. A listening socket, including continuous wake-word listening, occupies
one concurrent slot for its entire lifetime; closing it releases the slot. Opening it counts
once against the rate limit, rather than once per audio frame. Restart resets the counters. Board/controller traffic is not charged
against the model budget. The login endpoint allows 30 attempts per minute and at most 128 active
sessions per process. These limits bound work; they do not replace proxy connection/body limits
or a firewall.

| Request | Shared-mode result |
|---|---|
| No valid bearer or cookie, even from an allowed origin | `401` |
| Valid credential, other board/controller, or models not granted | `403` before any mutation/inference |
| Valid credential and scope | Existing API success/validation response |
| Disallowed browser origin, including `null` | `403`, no CORS grant |
| Allowed preflight, supported method and headers | `204`, exact origin and credentials headers |
| Model/login budget exhausted | `429` with `Retry-After: 60` |
| Board/controller list | Only resources in the credential's grant |

Automated coverage in `server/http/access.test.ts` checks these cases with a temporary local
database and mocked models, cookie expiry/logout, controller SSE, bounded model work, and demo
requests. `server/voice/socket.test.ts` uses mocked upstream sockets to verify handshake denial,
cookie/bearer access, shared work limits and revocation. `src/ui/accessGate.test.ts` covers startup, token clearing and scope defaults without
driving a browser or running inference.

## GX10 network verification before shared use

These are deployment requirements, **not claims about the live GX10**. No service, firewall or
model was changed to validate this PR, and the session could not resolve the `gx10` SSH alias.
An authorized operator must verify the real network before enabling shared use:

1. Inspect listening addresses with `ss -lntup` and the active firewall with `sudo ufw status
   verbose` or the host's equivalent. Only the intended HTTPS proxy should be reachable from
   shared clients. Keep API port 8787, MongoDB, Ollama, sketch and completion sidecars on loopback
   or explicitly isolated networks; disable external UDP 8788 in shared mode.
2. From the intended iPad network, open the HTTPS site and verify sign-in, own-board save/load,
   controller updates and SSE. Configure the proxy to preserve the public Host/Origin and permit
   SSE without buffering and WebSocket upgrades. Verify the TLS certificate is trusted on the iPad.
3. From another peer, check unauthenticated denial and a credential scoped to a different board.
   Confirm direct internal ports are unreachable. Test model requests only on the GX10 under
   operator authorization and check that excess requests receive `429`.
4. For demo mode, verify the intended iPad and controller network is isolated, that both dev/API
   ports are restricted to trusted peers, and that there is no router port-forwarding exposure.
   Cold-start the iPad, draw repeatedly at the expected pen-lift rate while voice listening is
   active, and verify live guesses and controller SSE. Tune the finite model budgets from that
   GX10 run; mocked tests do not establish suitable limits for a live demo.

The repository's GX10 start script exports its own variables. Ensure the actual service process
receives the access settings from protected deployment configuration; a developer shell export
on another machine does not configure the GX10.
