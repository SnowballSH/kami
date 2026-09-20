# Physical controllers — the arcade joystick

An Arduino Uno R4 reads a joystick (two axes, **x and y**) and buttons, and walks Alice. The iPad's browser
cannot talk to an Arduino (Safari has no WebSerial, WebHID or Web Bluetooth), so the Arduino talks to the
**Kami server on the GX10**, and the server relays to every open game:

```
joystick x,y ─► Uno R4 ──UDP :8788 (Wi-Fi)──────┐
                     └──USB serial (cable to box)─┼─► controller hub (server) ──SSE──► game in the browser
              anything else ──HTTP POST───────────┘                                    └► one more walk source
```

In the game the stick is one more source for `WalkIntentMerger` (`src/ui/walkIntent.ts`), beside the arrow
keys and the on-screen thumbstick: it reports the set of held directions, nothing else changes. The
Arduino sends the axes; **the server decides what counts as "held"**, so the dead zone is tuned in one
place. The cabinet's microswitch sketch uses a serial adapter described below.

## Cabinet readiness

The checked-in `hardware/cabinet/cabinet.ino` uses the pins in [hardware.md](hardware.md), **not**
the analog joystick wiring below. Its UNO R4 WiFi compile is verified with pinned dependencies via
`scripts/checkHardware.sh`; physical booth validation is outstanding.

Its USB frames are `S,<dir>,<ink>,<cat>,<px>,<py>` at 50 Hz. The serial listener accepts them as
`arcade`: direction mask (left 1, right 2, up 4, down 8) → ±100 axes; opposite directions cancel.
INK becomes unbound button `b`, CAT becomes unbound button `x`; knob values are validated, then
discarded. Firmware debounces all six switches for 20 ms. Invalid fields and lines longer than
256 characters are discarded through their terminator. `kami` frames remain supported unchanged.
`S` frames are not accepted by UDP/HTTP.

This supports the walking path only. Knob drawing, button gestures, cabinet-triggered speech,
game-driven LEDs and a visible connection status/retry UI are deferred. The server reads USB and the browser uses SSE;
no Web Serial adapter or "Connect cabinet" button exists. Automatic device rescans and EventSource
reconnects are already implemented. Use `GET /api/controllers` and server logs during bring-up.
The actual booth host, browser, power and wiring still need the checklist in [hardware.md](hardware.md).

## The one message

The named-controller protocol carries **the whole current state, never a delta** — so a lost message
heals itself on the next one. USB additionally accepts the cabinet format above.

```
kami <controller> <x> <y> [buttons]\n
```

| Part | |
|---|---|
| `kami` | literal; anything else on the port is ignored |
| `<controller>` | a name, `[a-z0-9-]{1,32}`. The demo stick is **`arcade`** |
| `<x>` | integer **-100 … 100**, percent of travel: -100 full left, 0 at rest, 100 full right |
| `<y>` | integer **-100 … 100**: -100 full **down**, 0 at rest, 100 full **up** |
| `[buttons]` | optional: the letters of the buttons held right now, any order: `A` `B` `X` `Y`. Leave it out when none is |

Examples: `kami arcade 100 0` (full right), `kami arcade -70 85` (up-left), `kami arcade 60 0 A`
(right + button A), `kami arcade 0 0` (at rest). Values outside the range are clamped (a decimal is
rounded); unknown button letters are ignored, so a sketch can grow without breaking the server. A line that
is not this — another word first, a bad name, an axis that is not a number — is dropped without a sound. A
stick with four microswitches instead of axes just sends ±100.

**Send it** whenever an axis moves by 3 or more or a button changes, and again at least every **100 ms**
while the stick is off centre or a button is held (a heartbeat). If a controller says nothing for **1 s**,
the hub lets go of everything for it — an unplugged stick can never leave Alice walking. At rest, one
message a second is enough to stay listed as connected; after a **minute** of silence the hub forgets the
controller (its subscribers stay subscribed and hear it again when it comes back).

**What the server makes of it:** a direction becomes held when its axis passes **40**, and is let go when
it falls back under **30** (the gap stops chatter at the threshold). `left`/`right` walk, `up` climbs or
(on the ground) jumps once per press, `down` climbs down. Button `A` is jump as well: **the server puts `up` into `held` while `A` is held**, so
the game only has to read `held`. `B`, `X`, `Y` are delivered to the game but not bound yet. The game walks at one speed, so the analogue
value is passed along (`x`, `y` in the event below) but not used for pace yet.

## Transports

| Transport | For | How |
|---|---|---|
| **UDP** `:8788` on the box | Uno R4 **WiFi** — the default: three lines of Arduino, no connection to keep alive, ~2 ms | one datagram = one message line (several lines in one datagram are all read) |
| **USB serial**, 115200 baud | Uno R4 **Minima**, or when the venue Wi-Fi misbehaves: plug the Arduino into a USB port **of the GX10** | print the same line to `Serial`; the server reads every `/dev/ttyACM*` (on a Mac also `/dev/cu.usbmodem*`), looking again every 3 s, so the stick can be plugged in late or pulled and put back (`KAMI_CONTROLLER_SERIAL` names one device instead, `off` disables). The user running the server must be in the **`dialout`** group — the log says so once if not: `sudo usermod -aG dialout $USER`, then log in again |
| **HTTP** `POST /api/controllers/:id/state` | scripts, tests, an ESP without UDP | body `<x> <y> [buttons]` as plain text (e.g. `100 0 A`; the content type is not looked at, so `curl -d` works); answers `204`, or `400` `{ error }` to a body or a controller name that makes no sense |

Test any of them without hardware:

```bash
echo "kami arcade 100 0" | nc -u -w0 <box> 8788                          # UDP
curl -X POST http://<box>:8787/api/controllers/arcade/state -d "100 0"   # HTTP
curl http://<box>:8787/api/controllers                                   # who is connected, what they hold
```

## What the game listens to

| Route | |
|---|---|
| `GET /api/controllers/:id/events` | Server-Sent Events. One event on connect (the current state) and one per change: `data: {"x":-0.7,"y":0.85,"held":["left","up"],"buttons":["a"]}`. `x`, `y` are the axes as -1 … 1 (y up); directions are `left` `right` `up` `down`; buttons `a` `b` `x` `y`; `held` already holds `up` while `a` is held. The stream opens with `retry: 1000`, so an `EventSource` is back a second after a server restart. A comment line (`: keep-alive`) every **5 s** keeps the connection open — `Bun.serve` drops one that has been silent for 10 s. A controller nobody has heard of is simply at rest. `400` to a name no controller can have. |
| `GET /api/controllers` | `[{ id, x, y, held, buttons, transport: "udp" \| "serial" \| "http", idleMs }]` — for "is my stick connected?" |

The game subscribes to controller **`arcade`** by default; `?controller=<id>` picks another and
`?controller=off` none. `EventSource` reconnects by itself; on any error the client lets go of everything.
Every open game hears the same stick — fine for one table, one stick.

Not protected: anyone on the network can send `kami arcade 100 0`. Acceptable for the demo; a shared token is
the obvious next step.

## The analog joystick on the box (`hardware/joystick`)

A thumb joystick module (x, y, push) on an Uno R4, plugged into a USB port of the GX10. This is the stick
in use: flashed and heard by the server on the box on 20 September 2026.

| Module pin | Uno R4 pin | |
|---|---|---|
| `VRx` | `A0` | up–down on the box, where the module sits a quarter turn round; pushing up reads lower (`Y_SIGN = -1`) |
| `VRy` | `A1` | left–right; pushing right reads lower (`X_SIGN = -1`) |
| `SW` | `D2` | `INPUT_PULLUP`, pressed = `LOW`, debounced 20 ms; sent as button **`A`** = jump |
| `+5V`, `GND` | `5V`, `GND` | |

`joystick.ino` reads the pins and prints `kami arcade <x> <y> [A]` to USB serial; `stick.h` holds what can
be tested without a board. The average of 16 readings while the board starts becomes the centre, and each
side of it scales to its own end of travel, so an off-centre stick still reaches ±100 both ways. A start
reading further than a quarter of the range from the middle means the stick was held: the middle is used
instead. Lines go out by the rule under "The one message". `PIN_X` / `PIN_Y` and `X_SIGN` / `Y_SIGN` at
the top of the sketch say which way round the module is mounted: a module mounted upright reads x from
`A0` and y from `A1` with both signs `1`. Checked on the box by pushing right, then up, then clicking, and
reading `GET /api/controllers`: `right`, `up`, and `a` (which puts `up` into `held`).

```bash
bun run gx10:flash              # from the Mac: compile on the box, upload to the Arduino plugged into it
bun run gx10:flash cabinet      # the cabinet sketch instead
scripts/checkHardware.sh        # native tests (+ pinned compile of both sketches where arduino-cli is installed)
curl http://<box>:8787/api/controllers    # arcade, transport "serial", x/y moving with the stick
```

`scripts/gx10/flash.sh` copies `hardware/` to `~/kami-hardware/sketches` on the box, installs the pinned,
checksum-verified Arduino CLI under `~/kami-hardware` on its first run (no sudo; the toolchain is a
~200 MB download), compiles with the sketch's build profile and uploads to the first `/dev/ttyACM*`
(`KAMI_FLASH_PORT` names another). The Kami server reads that port too, and a second reader would eat the
bootloader's answers, so when the server holds the port the script stops it for the upload and runs
`box/start.sh` after. The box's user must be in `dialout` (needed by both the server and the upload).

## Illustrative Wi-Fi variant (UDP, not checked in)

This Wi-Fi example is not included in the compilation check and has not been hardware-verified.
Use an Uno R4 WiFi. It sends raw buttons without debounce; use `DebouncedButton` from
`hardware/libraries/KamiControls` before relying on it. Prefer growing `hardware/joystick` over copying this.

Axes on `A0`/`A1`; buttons between their pin and **GND** (internal pull-ups, so held = `LOW`). The stick
must be at rest while the board starts: that reading becomes the centre.

```cpp
#include <WiFiS3.h>
#include <WiFiUdp.h>

const char WIFI_NAME[] = "…";
const char WIFI_PASSWORD[] = "…";
const IPAddress KAMI_BOX(192, 168, 1, 50);
const unsigned int KAMI_PORT = 8788;
const char CONTROLLER[] = "arcade";

const uint8_t X_PIN = A0;
const uint8_t Y_PIN = A1;
const int X_SIGN = 1;   // -1 if pushing right reads negative
const int Y_SIGN = 1;   // -1 if pushing up reads negative
struct Button { uint8_t pin; char letter; };
const Button BUTTONS[] = { {2, 'A'}, {3, 'B'} };

const int MOVED = 3;
const unsigned long HEARTBEAT_MS = 100;
const unsigned long IDLE_BEAT_MS = 1000;

WiFiUDP udp;
int restX = 0, restY = 0;
int sentX = 0, sentY = 0;
String sentButtons = "";
unsigned long sentAt = 0;

int travel(uint8_t pin) { return map(analogRead(pin), 0, 1023, -100, 100); }

String heldButtons() {
  String held = "";
  for (const Button &button : BUTTONS) {
    if (digitalRead(button.pin) == LOW) held += button.letter;
  }
  return held;
}

void send(int x, int y, const String &buttons) {
  String line = String("kami ") + CONTROLLER + " " + x + " " + y;
  if (buttons.length() > 0) line += " " + buttons;
  line += "\n";
  Serial.print(line);
  if (WiFi.status() != WL_CONNECTED) return;
  udp.beginPacket(KAMI_BOX, KAMI_PORT);
  udp.print(line);
  udp.endPacket();
}

void setup() {
  Serial.begin(115200);
  for (const Button &button : BUTTONS) pinMode(button.pin, INPUT_PULLUP);
  restX = travel(X_PIN);
  restY = travel(Y_PIN);
  WiFi.begin(WIFI_NAME, WIFI_PASSWORD);
  udp.begin(KAMI_PORT);
}

void loop() {
  const unsigned long now = millis();
  const int x = constrain(X_SIGN * (travel(X_PIN) - restX), -100, 100);
  const int y = constrain(Y_SIGN * (travel(Y_PIN) - restY), -100, 100);
  const String buttons = heldButtons();
  const bool atRest = abs(x) < MOVED && abs(y) < MOVED && buttons.length() == 0;
  const bool changed = abs(x - sentX) >= MOVED || abs(y - sentY) >= MOVED || buttons != sentButtons;
  if (changed || now - sentAt >= (atRest ? IDLE_BEAT_MS : HEARTBEAT_MS)) {
    send(x, y, buttons);
    sentX = x; sentY = y; sentButtons = buttons; sentAt = now;
  }
  delay(2);
}
```

## Where the code lives

| | |
|---|---|
| `server/controllers/` | `types.ts` (the contract), `message.ts` (named-controller parser), `cabinet.ts` (USB cabinet adapter), `hub.ts` (hysteresis, staleness, subscribers), `udpListener.ts`, `serialListener.ts` (+ `tty.ts`, `lines.ts`), `eventStream.ts` (the SSE response), `index.ts` (`startControllers`) |
| `server/http/api.ts` | the three routes above |
| `src/controller/` | the browser side: `EventSource` → the merger's `PressedListener` |
| `server/config.ts` | `KAMI_CONTROLLER_UDP_PORT` (8788, `off` disables), `KAMI_CONTROLLER_SERIAL` (`auto`, a device path, or `off`) |
| `hardware/` | `joystick/` (the analog stick: `joystick.ino`, `stick.h`), `cabinet/` (the microswitch cabinet), `libraries/KamiControls` (`DebouncedButton`, shared through each `sketch.yaml`), `*.test.cpp` (native tests) |
| `scripts/` | `checkHardware.sh` (native tests + pinned compiles), `gx10/flash.sh` (compile on the box and upload) |
