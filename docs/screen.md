# The big screen

A monitor shows the game live while people draw on iPads. The monitor opens the game's own page
with `?screen`; every playing device streams what it renders to the server, and the server passes
the stream of whichever device is in use on to the screens. Nothing is recorded, nothing is
captured as video: the screen runs the same renderer on the same data, so it is sharp at any size.

```
iPad: Game → mirroredRenderer → StageSource ──WS──▶ server/stage Stage ──WS──▶ StageWatcher → renderer
      (src/stage)                 role=source        (relays, never reads)       role=screen   (?screen page)
```

## Using it

| Where | Address |
|---|---|
| The monitor | `http://<box>:8787/?screen` — add `&join=http://<box>:8787` to show that address and its QR code while nobody plays |
| A player | any game address; `?stage=<name>` to play on another stage than `main` |
| Another stage's monitor | `?screen=<name>` (`[a-z0-9-]{1,32}`) |

On the GX10 the monitor plugged into the box is driven by `box/screen.sh` (`start [url]`, `stop`,
`status`, `install`, `uninstall`): Firefox in kiosk mode with its own profile on the box's desktop
session, held awake by an idle inhibitor for as long as it runs. `box/start.sh` starts it after the
game when the box has a desktop session and leaves a headless box alone.

The screen shows the board, every drawing as it is drawn, Alice and her copies, the ink eater, the
boss, Kami's notes and the standing laws. It shows no HUD: no toolbar, no cards, no joystick.

## Who is on the screen

A stage has any number of sources and screens, and at most one source is **live**.

- A source shows nothing until the server tells it `go`. A game nobody watches pays for one idle
  WebSocket and nothing else.
- The first source to join a watched stage goes live. While someone is drawing on a device (a
  stroke under the pen, or ink being read) it says `active`, about once a second, live or not.
- A resting source that says `active` takes the stage once the live one has not been active for
  `HANDOVER_IDLE_MS` (4 s): the screen follows whoever picked up a pen, without flickering between
  two people drawing at once.
- When the live source leaves, the most recently active one goes live; with none left the screens
  are told `offstage` and show the waiting card.
- `go` always means *start over*: the source forgets what it has told and tells the board, the
  laws, every drawing and every note again. That is how a screen that joins late, or reconnects,
  catches up; the server keeps no copy of anything.

## Wire

`WS /api/stage/:stage?role=source|screen`. Every message is text: a kind, and for the kinds with a
body a newline and JSON. The kind comes first and alone so the server can tell a frame (which it
may drop) from a drawing (which it must deliver) without parsing either; it never reads a body.

| Kind | From | Body |
|---|---|---|
| `board` | source | the `BoardDefinition` on the renderer (`src/board/types.ts`) |
| `laws` | source | `LawListing[]`, what the laws panel lists |
| `ink` | source | a `Drawing` — sent once, and again only when the game hands the renderer new strokes for it (a tidy, a retrace) |
| `note` | source | `{ id, script }`, a note's pen script, sent once |
| `frame` | source | the `RenderFrame` without strokes or scripts (`LeanFrame`: inks by `id`, notes without `script`), plus the source canvas's `viewport` in CSS px and the events of any frames skipped since the last one sent |
| `active` | source | — |
| `go`, `rest` | server → source | — |
| `offstage` | server → screen | — |

Frames go out at most every 30 ms and are held back while more than 256 KB waits on the source's
socket; the server drops a frame for a screen with more than 1 MB waiting, and any frame over
512 KB or other message over 4 MB. Drawings, notes, boards and laws are never dropped. The screen
fits the source's camera to its own canvas (`fittedCamera`): same centre, all of what the player
sees, as large as it goes.

The bodies are the client's own render types, not a second schema: what a source says is trusted
the way its `POST`s of drawings are in demo mode, a screen only ever paints it, and a message that
is not a known kind with a JSON object for a body is ignored. Access follows `docs/access.md`:
same-origin in demo mode; any signed-in device when access is shared, re-checked every 15 s.

## Limits

- One live source per stage: two iPads in the same shared sandbox are two views, and the screen
  shows one of them (with the other's Alice as a ghost, as that iPad sees her).
- A source in a background tab stops painting, so it stops showing; the screen holds its last
  frame until another device draws.
- The eraser ring and the pen's hover follow the pointer on the device and are not shown.
