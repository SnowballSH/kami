# Access and deployment

## Choose the trust model

`KAMI_ACCESS_MODE=demo` is the default, for an iPad on a trusted LAN. The HTTP server and Vite listen on
all IPv4 interfaces, so **every reachable peer can read, overwrite and delete every board, report
controller state, and spend model capacity**. Use an isolated, trusted LAN with no public port
forwarding. The iPad opens the existing Vite network URL in development or the built game on
the server's port 8787. The server's built-in TLS listener serves the same game at `https://<host>:8443`;
accept its self-signed certificate once. Ordinary same-origin requests need no token. A browser origin other than the
request's own origin must appear in `KAMI_ALLOWED_ORIGINS`; there is no wildcard CORS response.
Origin checks protect browser requests but do not authenticate non-browser peers.

For one-machine development, set both `KAMI_BIND_HOST=127.0.0.1` and
`KAMI_WEB_HOST=127.0.0.1`. This intentionally prevents direct iPad access.

`KAMI_ACCESS_MODE=shared` is for an explicitly configured shared deployment:

- The API defaults to loopback. Serve the built game and `/api` through the **same HTTPS origin**
  using a TLS reverse proxy. Keep port 8787 private; an explicit bind override does not add TLS.
- Set `KAMI_ALLOWED_ORIGINS` to exact public HTTPS origins, including a non-default port if used.
  No paths, wildcard, trailing slash, `null` origin, or automatic trust of forwarded headers.
  Loopback origins (`http://localhost:5173`, `http://127.0.0.1:8787`) are accepted too, because
  browsers treat them as secure: that is for trying shared mode on one machine, not for serving it.
- Set one password for everyone (`KAMI_PASSWORD`), or configure separate high-entropy credentials
  for participants/controllers (`KAMI_CREDENTIALS`), or both. Each credential grants exact
  board IDs, exact controller IDs, and an explicit `models` permission. Empty lists grant nothing.
  Possession permits reading and changing the listed resources; this is not per-action RBAC.
- UDP controller input is disabled: it cannot carry authentication. Setting a UDP port explicitly
  in shared mode fails startup. Use local USB serial (trusted host) or authenticated HTTP reports.
- Invalid/missing shared settings stop startup. CORS allowlisting never replaces authentication.

A shared server is signed into with either **one password** (`KAMI_PASSWORD`, below) or scoped
**tokens** (`KAMI_CREDENTIALS`, "Provision credentials"), or both.

This mode does not provide user registration, identity-provider login, distributed rate limits,
or a public multi-tenant hosting service. A token with model permission can consume the common
model budget. A trusted operator controls credentials, upstream URLs, host access and deployment.
Do not expose the Vite development server as the shared service.

## One password

The simplest way to put Kami on the internet for friends, a class or a jam: one secret password.

```text
KAMI_PASSWORD_FILE=/run/secrets/kami-password
KAMI_ALLOWED_ORIGINS=https://kami.example.org
```

- Setting `KAMI_PASSWORD` (or `KAMI_PASSWORD_FILE`, a file holding it) switches the server to
  `shared` mode; `KAMI_ACCESS_MODE` may be left unset or set to `shared`. Setting it with
  `KAMI_ACCESS_MODE=demo` stops start-up rather than silently ignoring the password. Every other
  shared-mode rule applies: HTTPS allowed origins, loopback bind by default, UDP controllers off.
- The password is equivalent to one credential that grants **every board, every controller and the
  models**. Anyone holding it can read, change and delete every board, so share it like a house key
  and pick a long passphrase (`openssl rand -base64 18` makes a good one). Surrounding whitespace is
  ignored; it may be up to 1024 characters of anything.
- The browser's access gate asks for a **password** (the server says so in `GET /api/session`,
  `secret: "password"`): a real password field that password managers fill and offer to save, Enter
  to submit, and a plain "Wrong password" when it is wrong. It is posted once, as a JSON body, to
  `POST /api/session` and exchanged for the same eight-hour session cookie tokens get. It is never a
  bearer credential on other requests, so it cannot be guessed there.
- It can sit beside `KAMI_CREDENTIALS`: people type the password at the gate, while devices and
  scripts (an HTTP controller, a big screen on a kiosk) keep their own scoped tokens. The password
  must differ from every token, and no credential may use the id `password`.
- Change it by changing the secret and restarting; sessions live in memory, so everyone signs in
  again.

**Guessing.** The password is compared in constant time (as a SHA-256 digest). Sign-in attempts are
limited to 30 a minute for the whole server, and each client may fail 10 times in 15 minutes before
it is told to wait (`429` with `Retry-After`) — other clients are unaffected, and a correct password
clears the count. A client is the connecting address; behind a reverse proxy it is the last
`X-Forwarded-For` entry, which is believed only from `KAMI_TRUSTED_PROXIES` (default the loopback
addresses, where a proxy on the same host connects from). When Kami runs in a container behind the
host's proxy, the proxy reaches it from the container network's gateway: add that address (e.g.
`KAMI_TRUSTED_PROXIES=10.88.0.1` for podman's default network), or every visitor shares one
count. Forwarded addresses are used for this count only, never to decide access.

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

The iPad's startup form exchanges its token (or the password) for an opaque `__Host-kami` cookie:
`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, eight-hour lifetime. The field is cleared once
the attempt is answered, and secrets are not saved in local storage or appended to SSE URLs.
The game's page and assets load without a session, so the gate can render; only `/api` asks. Same-origin fetch clients—including
recognition, completion, compilation and handwriting—and native EventSource/WebSocket use this cookie
without changing their payload contracts. The initial board/controller comes from the grant
unless the URL already selects one. An explicit URL selection never expands its grant.
Sign out (the door button beside home, shown only on a shared server) revokes the cookie session
and reloads to the access gate; existing controller streams recheck before each state or
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

The big screen's stage socket (`/api/stage/:stage`) checks the same origin and session before the
WebSocket upgrade and every 15 seconds while open; expired or signed-out sessions close it. The
proxy must support WebSocket upgrades in addition to SSE.

Exemplar reads (`GET /api/exemplar?word=…`) require `models` too. They sample stored Quick, Draw!
sketches without inference, but still use database work and return vector data; they share the
model request, concurrency and response-body limits in both modes.

Non-browser clients send `Authorization: Bearer <token>` on each request, including HTTP
controller reports. Query-string tokens are ignored. Browser cookies are designed for same-origin
hosting; allowlisting another origin alone does not make cross-site cookie authentication work.
Rotate a bearer token to revoke it; browser sign-out does not revoke the underlying credential.

When the API is unreachable, the startup screen offers retry or **Play without server**.
Choosing local play grants no API access; shared requests still require a valid credential. The
game then runs on a `ForgetfulBoardStore` with no board link: the save status reads *Not saved*
and the share button (QR and link) stays hidden, since no other device could join.
If an existing session expires during play, reload to sign in again; unsaved changes may remain
only in the open tab.

## Limits and expected responses

Model routes (`recognize`, `beautify`, `compile`, `transcribe`, `exemplar`) share a per-process
fixed-window budget of 6,000 requests per minute and 32 concurrent
operations by default, in both
modes. Those defaults are sized for a LAN demo with a local model. Tune
`KAMI_MODEL_REQUESTS_PER_MINUTE` and `KAMI_MODEL_CONCURRENCY` for the host and the expected pen
traffic: one iPad posts a few live guesses a second while drawing plus a compile or handwriting read
per pen lift, so a shared 2-vCPU box serving a handful of players behind a paid model gateway does
well with about `600` requests a minute and `4` concurrent — enough for play, small enough that a
scripted client cannot run up the gateway bill or starve the host's other services. The budget counts
`recognize` too, which the built-in k-NN answers from a worker thread with a bounded queue of its own
(`server/README.md`, "Self-hosting"). A slot stays occupied while the model response is read; response bodies have an
8 MiB ceiling and 30-second read deadline. Upstream inference/request deadlines remain those of
the individual adapters. Restart resets the counters. Board/controller traffic is not charged
against the model budget. The login endpoint allows 30 attempts per minute, 10 failures per client in 15
minutes ("One password" above), and at most 128 active sessions per process. These limits bound work; they do not replace proxy connection/body limits
or a firewall.

| Request | Shared-mode result |
|---|---|
| No valid bearer or cookie, even from an allowed origin | `401` |
| Valid credential, other board/controller, or models not granted | `403` before any mutation/inference |
| Valid credential and scope | Existing API success/validation response |
| Disallowed browser origin, including `null` | `403`, no CORS grant |
| Allowed preflight, supported method and headers | `204`, exact origin and credentials headers |
| Model/login budget exhausted | `429` with `Retry-After: 60` |
| Too many failed sign-ins from one client | `429` with `Retry-After` until its 15-minute window ends |
| Signed in with the password | Every board, controller and model route |
| Board/controller list | Only resources in the credential's grant |

Automated coverage in `server/http/access.test.ts` checks these cases with a temporary local
database and mocked models, cookie expiry/logout, controller SSE, bounded model work, and demo
requests, the password gate's configuration, grant and per-client throttling.
`src/ui/accessGate.test.ts` covers startup, the password and token wording, wrong-password and
throttled messages, clearing and scope defaults without
driving a browser or running inference.

## Network verification before shared use

These are deployment requirements, **not claims about any live host**: they have not been validated
against a deployment. An authorized operator must verify the real network before enabling shared use:

1. Inspect listening addresses with `ss -lntup` and the active firewall with `sudo ufw status
   verbose` or the host's equivalent. Only the intended HTTPS proxy should be reachable from
   shared clients. Keep API port 8787, MongoDB, Ollama, sketch and completion sidecars on loopback
   or explicitly isolated networks; disable external UDP 8788 in shared mode.
2. From the intended iPad network, open the HTTPS site and verify sign-in, own-board save/load,
   controller updates and SSE. Configure the proxy to preserve the public Host/Origin and permit
   SSE without buffering and WebSocket upgrades. Verify the TLS certificate is trusted on the iPad.
3. From another peer, check unauthenticated denial and a credential scoped to a different board.
   Confirm direct internal ports are unreachable. Test model requests only against the real deployment under
   operator authorization and check that excess requests receive `429`.
4. For demo mode, verify the intended iPad and controller network is isolated, that both dev/API
   ports are restricted to trusted peers, and that there is no router port-forwarding exposure.
   Cold-start the iPad, draw repeatedly at the expected pen-lift rate, and verify live guesses and
   controller SSE. Tune the finite model budgets from that
   run; mocked tests do not establish suitable limits for a live demo.

Ensure the actual service process (the container, [hosting.md](hosting.md)) receives the access
settings from protected deployment configuration; a developer shell export on another machine does
not configure it.
