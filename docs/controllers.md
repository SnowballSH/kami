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
Arduino sends the raw axes; **the server decides what counts as "held"**, so the dead zone is tuned in one
place and the sketch stays trivial.

## The one message

Every transport carries the same thing: **the whole current state, never a delta** — so a lost message
heals itself on the next one.

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
(right + button A), `kami arcade 0 0` (at rest). Values outside the range are clamped; unknown button
letters are ignored, so a sketch can grow without breaking the server. A stick with four microswitches
instead of axes just sends ±100.

**Send it** whenever an axis moves by 3 or more or a button changes, and again at least every **100 ms**
while the stick is off centre or a button is held (a heartbeat). If a controller says nothing for **1 s**,
the hub lets go of everything for it — an unplugged stick can never leave Alice walking. At rest, one
message a second is enough to stay listed as connected.

**What the server makes of it:** a direction becomes held when its axis passes **40**, and is let go when
it falls back under **30** (the gap stops chatter at the threshold). `left`/`right` walk, `up` climbs or
(on the ground) jumps once per press, `down` climbs down. Button `A` is jump as well (it counts as `up`).
`B`, `X`, `Y` are delivered to the game but not bound yet. The game walks at one speed, so the analogue
value is passed along (`x`, `y` in the event below) but not used for pace yet.

## Transports

| Transport | For | How |
|---|---|---|
| **UDP** `:8788` on the box | Uno R4 **WiFi** — the default: three lines of Arduino, no connection to keep alive, ~2 ms | one datagram = one message line |
| **USB serial**, 115200 baud | Uno R4 **Minima**, or when the venue Wi-Fi misbehaves: plug the Arduino into a USB port **of the GX10** | print the same line to `Serial`; the server reads `/dev/ttyACM*` (`KAMI_CONTROLLER_SERIAL` names another device, `off` disables) |
| **HTTP** `POST /api/controllers/:id/state` | scripts, tests, an ESP without UDP | body `text/plain`: `<x> <y> [buttons]` (e.g. `100 0 A`); answers `204` |

Test any of them without hardware:

```bash
echo "kami arcade 100 0" | nc -u -w0 10.189.121.118 8788                          # UDP
curl -X POST http://10.189.121.118:8787/api/controllers/arcade/state -d "100 0"   # HTTP
curl http://10.189.121.118:8787/api/controllers                                   # who is connected, what they hold
```

## What the game listens to

| Route | |
|---|---|
| `GET /api/controllers/:id/events` | Server-Sent Events. One event on connect (the current state) and one per change: `data: {"x":-0.7,"y":0.85,"held":["left","up"],"buttons":["a"]}`. `x`, `y` are the axes as -1 … 1 (y up); directions are `left` `right` `up` `down`; buttons `a` `b` `x` `y`. A comment line every 15 s keeps proxies from closing it. |
| `GET /api/controllers` | `[{ id, x, y, held, buttons, transport: "udp" \| "serial" \| "http", idleMs }]` — for "is my stick connected?" |

The game subscribes to controller **`arcade`** by default; `?controller=<id>` picks another and
`?controller=off` none. `EventSource` reconnects by itself; on any error the client lets go of everything.
Every open game hears the same stick — fine for one table, one stick.

Not protected: anyone on the network can send `kami arcade 100 0`. Acceptable for the demo; a shared token is
the obvious next step.

## The Arduino sketch (Uno R4 WiFi; on a Minima delete the Wi-Fi lines and keep `Serial`)

Axes on `A0`/`A1`; buttons between their pin and **GND** (internal pull-ups, so held = `LOW`). The stick
must be at rest while the board starts: that reading becomes the centre.

```cpp
#include <WiFiS3.h>
#include <WiFiUdp.h>

const char WIFI_NAME[] = "…";
const char WIFI_PASSWORD[] = "…";
const IPAddress KAMI_BOX(10, 189, 121, 118);
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
| `server/controllers/` | the message parser, the hub (state, staleness, subscribers), the UDP and serial listeners |
| `server/http/api.ts` | the three routes above |
| `src/controller/` | the browser side: `EventSource` → the merger's `PressedListener` |
| `server/config.ts` | `KAMI_CONTROLLER_UDP_PORT` (8788, `off` disables), `KAMI_CONTROLLER_SERIAL` |
