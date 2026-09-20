# Kami — Hardware: the Wonderland Cabinet

Companion to `docs/spec.md` §11. The cabinet remains an **optional, incomplete milestone**.
The implemented controller relay is described in [controllers.md](controllers.md).

**Goal:** a self-contained cabinet that plays the whole game. Today only the arcade stick's
walking/jumping/climbing path is connected to the game. Knob drawing, INK gestures, CAT speech,
game-driven LEDs and a visible connection indicator are deferred. Keep mouse, keyboard and touch
available; the game never depends on the cabinet. Software checks and firmware compilation pass;
physical controls, feedback and the actual booth browser/host have **not** been verified.

---

## 1. What we have

Original checkout-list status (19 September); recheck physical availability before bring-up.

| Item | Status | Use |
|---|---|---|
| Arduino UNO R4 WiFi | **In hand** | Reads controls and drives diagnostic LEDs; the API/game run on a host computer. |
| EG STARTS arcade joystick (2-pin microswitches) | **In hand** | Walk Alice |
| Potentiometers ×2 | **In hand** | Etch A Sketch pen: X and Y |
| Thumb joysticks ×2 | **In hand** | Their click switches = INK and CAT buttons. Stick axes = backup pen if the pots are unusable. |
| Jumper wires | **In hand** | Wiring |
| BOJACK 840-pc jumper wire kit | Pending | Tidy breadboard runs. **It is wires only — not a breadboard.** |
| WS2812B strip, 300 px | Pending | Standalone feedback experiment. Firmware addresses only the first 60 px. |
| 5 V 2 A micro-USB supply | Pending | Possible separate strip supply; verify regulation, wiring and load. |
| Teensy 4.1 | Pending | **Not needed.** Keep as a spare or release it. |
| RC522 RFID | Pending | **Not planned.** Stretch only (§8). |
| Monitor | In hand | Cabinet display, mirrored from the laptop |

## 2. What's missing

**Must get — the cabinet doesn't work without these:**

1. **A breadboard** (half-size is enough). Nothing on the list is one.
2. **USB-C data cable** for the UNO R4 WiFi (it's USB-C, and charge-only cables won't enumerate).
3. **A way onto the arcade stick's switch tabs.** They're 4.8 mm (0.187") spade tabs; Dupont jumpers don't grip them. In order of preference: the harness that shipped with the stick (check the bag) → female 4.8 mm quick-disconnect crimps + the crimp tool → alligator-clip leads → one trip to the supervised soldering bench for 5 leads.
4. **Check the pots' legs.** Breadboard pins: fine. Solder lugs: alligator clips or the soldering bench.

**Want:**

5. **Two momentary pushbuttons** (arcade 30 mm ideal, tactile switches fine). Thumb-joystick clicks work but feel mushy and aren't obviously "buttons" to a judge.
6. **Knob caps** for the pots — 3D print, or anything grippable. Bare pot shafts are miserable to draw with.
7. **A panel/enclosure.** A cardboard box with holes and hand-lettered labels fits the aesthetic better than a print and takes 30 minutes. Print only the knob caps.
8. **Headset or USB mic** — optional for the browser voice path; the physical CAT button is not bound to it.
9. For the strip: 330 Ω resistor (data line), 1000 µF capacitor (across 5 V/GND); check the strip's wiring guidance.
10. Zip ties, tape, a multimeter from the desk.

Items 1–3 enable physical stick bring-up. Knob/button readings alone do not make the full cabinet playable.

---

## 3. The proposed panel and current bindings

```
┌──────────────────────────────────────────────────────────┐
│                        MONITOR                           │  ← LED strip runs around the bezel
└──────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────┐
│   (◉)            [ INK ]   [ CAT ]          (○)    (○)   │
│  WALK            pen ↓↑    hold to          ←→      ↑↓   │
│  arcade stick              talk             Etch A Sketch│
└──────────────────────────────────────────────────────────┘
```

| Control | Implemented behavior |
|---|---|
| **WALK** stick | ←/→ walk; ↑ jumps on the ground or climbs; ↓ climbs down. Opposing switches cancel. |
| **Knobs** | Smoothed 12-bit values appear in serial diagnostics. The server validates them but does not relay them or move the pen. |
| **INK** | Relayed as unbound button `b`. Toggle/long-press erase are deferred. |
| **CAT** | Relayed as unbound button `x`. Binding this physical button to speech is deferred. |

The Etch A Sketch drawing proposal in the spec needs a separate client pen contract. The current
whiteboard has **unlimited ink**, no ink meter and no out-of-ink state. Naming uses writing/typing
or the optional [browser voice path](voice.md): the on-screen CAT button/Space requests the microphone,
and the server relays to Deepgram when configured. This needs HTTPS on the LAN and microphone
permission. The cabinet's physical CAT button does not invoke it. Speech was not tested in this
cabinet verification.

**Firmware-only feedback, not connected to game events:**

| Output | Shows |
|---|---|
| LED strip (60 px) | Manual blue level, pink/purple chase, white pulse, green/red flash |
| UNO R4 12×8 LED matrix | Grin controlled by manual `C,1` / `C,0` |

---

## 4. Wiring (UNO R4 WiFi)

| Pin | To | Notes |
|---|---|---|
| D2, D3, D4, D5 | Arcade stick ←, →, ↑, ↓ (one tab each) | `INPUT_PULLUP`. Daisy-chain the other tab of all four switches to **GND**. Pressed = LOW. |
| D6 | INK button | `INPUT_PULLUP`, other leg to GND. (Thumb joystick A: `SW` pin, its `GND` to GND.) |
| D7 | CAT button | Same. (Thumb joystick B `SW`.) |
| A0 | Pot X wiper (middle leg) | Outer legs to **5V** and **GND**. If a knob runs backwards, swap its outer legs. |
| A1 | Pot Y wiper | Same. |
| A2, A3 | *(backup)* thumb joystick A `VRx`, `VRy` | Only if the pots don't work out. `+5V` and `GND` to the rails. |
| D8 | WS2812B `DIN` | Through 330 Ω if you have one. Strip `5V` → board **5V**, strip `GND` → **GND**. Feed the end marked with the arrow pointing *away* from the connector. |

**LED power budget.** 300 px at full white is 18 A — never do that. We address only the first 60 px at
`setBrightness(40)`: estimated worst case ≈ 60 × 60 mA × 40/255 ≈ 0.56 A all-white, before the board's
own load. USB supply/cable capacity has not been measured; start with 8 px and verify power before
using 60. For a separately powered strip, use a suitable regulated 5 V supply and **join the grounds**.

The R4's I/O pins source only ~8 mA each — never power anything from a data pin.

---

## 5. Protocol

USB serial to the **server host**, 115200 baud, newline-terminated ASCII. No browser Web Serial
adapter is used. The cabinet sketch sends USB only; the separate Wi-Fi sketch in
[controllers.md](controllers.md) uses the hub's `kami` protocol.

**Board → server, 50 Hz:**

```
S,<dir>,<ink>,<cat>,<px>,<py>
```
`dir` is an integer bitmask 0–15: 1 = left, 2 = right, 4 = up, 8 = down.
`ink`, `cat` are 0 or 1 while held. All six switches require **20 ms of stable input**, on both
press and release, in the firmware. `px`, `py` are integers 0–4095, smoothed.

`server/controllers/cabinet.ts` adapts this serial-only format to controller **`arcade`**:
`x = 100 × (right - left)`, `y = 100 × (up - down)`, INK → `b`, CAT → `x`.
It validates all fields and drops malformed/out-of-range frames. Knobs never become walking axes;
neither cabinet button becomes jump. Existing `kami <id> <x> <y> [buttons]` serial/UDP/HTTP remains
supported. Use only one device with the `arcade` identity at a time.

Partial serial lines wait for CR or LF. A line over 256 characters is discarded **through its next
terminator**, including valid-looking suffixes, then reading resumes. A disconnected controller
releases its held state after 1 s; the server rescans devices every 3 s. Browser SSE errors release
the remote source immediately, and EventSource reconnects automatically. Keyboard/touch remain
independent sources of movement.

**Manual serial monitor → board (diagnostic only):**

| Msg | Firmware effect |
|---|---|
| `I,<0-100>` | Blue strip level; a legacy command, not the game's ink balance |
| `C,<0\|1>` | Toggle chase and grin |
| `P` | Start a white pulse |
| `F,g` / `F,r` | Start a green/red flash |

Firmware feedback lines are limited to 23 characters, discard overlong frames through CR/LF, and
reject malformed commands. `I`/`C` set state; `P`/`F` restart effects and are **not idempotent**.
The server opens serial read-only: it does not send any feedback commands.

---

## 6. Server and browser connection

```text
cabinet USB → server serial listener → controller hub → SSE → RemoteStick → WalkIntentMerger
```

Plug the USB data cable into the machine **running the Kami API**. The serial listener finds
`/dev/ttyACM*` automatically on Linux (`/dev/cu.usbmodem*` on macOS).
`KAMI_CONTROLLER_SERIAL=/dev/ttyACM0` selects a specific device; `off` disables it.
Device permissions, server logs and `GET /api/controllers` provide setup diagnostics.
Do not run a serial monitor and the server reader on the same device simultaneously.

The game subscribes to `arcade` by default; `?controller=off` disables the remote stick.
There is **no "Connect cabinet" or reconnect button**. Device reconnect is automatic on the server,
and stream reconnect is automatic in the browser. A visible connection indicator/retry UI is deferred.

The browser needs ordinary [EventSource support](https://developer.mozilla.org/en-US/docs/Web/API/EventSource),
not a Web Serial device permission or Web Serial secure context. Serve the game and `/api` together;
an HTTPS game must also reach its SSE endpoint through HTTPS. The actual booth URL, reverse proxy's
streaming behavior, Safari/Chrome versions and device permissions still require on-site verification.
No browser or physical device verification is claimed by the shell tests below.

---

## 7. Firmware

`hardware/cabinet/cabinet.ino`, board **Arduino UNO R4 WiFi**. Compile verified on 20 September 2026:

| Component | Verified version |
|---|---|
| Arduino CLI | 1.3.1 |
| `arduino:renesas_uno` | 1.5.3 |
| `Adafruit NeoPixel` | 1.15.1 |
| `Arduino_LED_Matrix` | Bundled with the pinned Renesas core |

The [build profile](https://docs.arduino.cc/arduino-cli/sketch-project-file/) in
`hardware/cabinet/sketch.yaml` pins board and libraries. Install
[Arduino CLI](https://docs.arduino.cc/arduino-cli/installation/) and a C++11 compiler, then:

```bash
scripts/checkHardware.sh             # native tests + pinned UNO R4 WiFi compile of cabinet and joystick; no upload
scripts/checkHardware.sh --native    # pure debounce/framing/feedback/stick tests, no Arduino download
bun run gx10:flash cabinet           # compile on the GX10 and upload to the Arduino plugged into it
bun run test -- server/controllers src/controller
```

`DebouncedButton` lives in `hardware/libraries/KamiControls`, shared with the analog joystick sketch
(`hardware/joystick`, [controllers.md](controllers.md)) through a `dir:` library in each `sketch.yaml`.

`ARDUINO_CLI` and `CXX` can name installed executables. The first full run downloads the toolchain
and libraries; profile builds do not depend on globally installed Arduino library versions.
Verified build (on the GX10, 20 September): **56,228 bytes flash, 7,196 bytes RAM**. The native tests cover switch bounce,
release and timer wraparound, split/overlong feedback frames and strict command validation.
The TypeScript tests cover cabinet mapping, malformed frames, hub staleness, simulated SSE
disconnect/reconnect and keyboard fallback. The JS gate does not compile firmware.

**Outstanding physical acceptance checklist (none completed by the automated checks):**

1. Confirm parts, wiring, cable, power and port permissions; upload to a real UNO R4 WiFi.
2. In a serial monitor at 115200, verify every switch, stable held/released states and both pot endpoints.
3. Test strip/matrix commands separately, initially with 8 pixels; measure power before using 60.
4. Close the monitor, connect to the API host, start its normal server, and inspect `GET /api/controllers`.
5. On the actual booth browser/URL, verify walk/jump/climb, diagonals and keyboard/mouse/touch fallback.
6. Unplug while walking: verify release within 1 s; replug: verify automatic recovery after rescan/boot.
   Restart the SSE connection and check recovery on the actual proxy. Record board, host, browser and result.

Do not describe the cabinet as independently playable until deferred drawing/naming/feedback
integration and these physical checks are complete. No GX10 service change is required by compilation.

---

## 8. If there's time (and only then)

**The Queen's cards (RFID).** Tag three playing cards. Tapping one on the reader spends an enchantment token — a physical spell budget the player holds in their hand. Thematically perfect, mechanically just another way to press a button.

Cautions: the RC522 is a **3.3 V part** — power it from the R4's 3.3 V pin, and its SPI lines are not 5 V-tolerant (the R4 is a 5 V board), so use level shifting or accept the risk on borrowed hardware. The kit may not include tags; ask the desk. This is the first thing to skip.

---

## 9. Failure plan

| Fails | Do |
|---|---|
| Pots too jittery or wrong taper (log pots feel lumpy) | More smoothing in firmware (`ALPHA` 0.1). Still bad → thumb joystick as a rate-controlled pen (A2/A3). |
| Arcade stick can't be wired without solder and the bench is busy | Thumb joystick for walking: `hardware/joystick` ([controllers.md](controllers.md)), in use on the box. |
| Strip won't light | Check direction arrow, shared ground and power with 8 px. Leave feedback disconnected; the game has no ink meter. |
| Serial drops mid-demo | Use mouse/keyboard/touch. Inspect server logs/device permissions; replug and wait for automatic rescan. No reconnect button exists. |
| Anything flaky at hour 20 | Cut it (spec §12). A cabinet that half-works is worse than a laptop that fully works. |
