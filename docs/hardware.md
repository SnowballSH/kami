# Kami — Hardware: the Wonderland Cabinet

Companion to `docs/spec.md` §11. Owner: lane D.

**Goal:** a self-contained cabinet — monitor, one control panel, no mouse, no keyboard — that plays the whole game. The mouse stays plugged in as the fallback; the game never depends on the cabinet.

---

## 1. What we have

Status as read from the checkout list (items with a table/pickup number = in hand).

| Item | Status | Use |
|---|---|---|
| Arduino UNO R4 WiFi | **In hand** | **The brain.** Everything runs on this. |
| EG STARTS arcade joystick (2-pin microswitches) | **In hand** | Walk Alice |
| Potentiometers ×2 | **In hand** | Etch A Sketch pen: X and Y |
| Thumb joysticks ×2 | **In hand** | Their click switches = INK and CAT buttons. Stick axes = backup pen if the pots are unusable. |
| Jumper wires | **In hand** | Wiring |
| BOJACK 840-pc jumper wire kit | Pending | Tidy breadboard runs. **It is wires only — not a breadboard.** |
| WS2812B strip, 300 px | Pending | Ink meter + Cat stripes + fall pulse. We light only the first 60 px. |
| 5 V 2 A micro-USB supply | Pending | Only needed if lighting more than ~60 px. Probably unused. |
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
8. **Headset or USB mic** — the hall is loud and the Cat has to hear.
9. For the strip, if available: 330 Ω resistor (data line), 1000 µF capacitor (across 5 V/GND). Not required at 60 px / low brightness.
10. Zip ties, tape, a multimeter from the desk.

**Verdict:** the core (stick + knobs + buttons) is buildable today with items 1–3. LEDs wait on the pending strip. Start now on the R4 — don't wait for the Teensy.

---

## 3. The panel

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

| Control | Behavior |
|---|---|
| **WALK** stick | ←/→ walk. ↑/↓ only matter on `climbable` ink. |
| **Knobs** | Absolute pen position: left knob = X across the screen, right knob = Y. A crosshair always shows where the pen is. |
| **INK** | **Toggle**, not hold — both hands are on the knobs. Tap: pen down (bullet-time starts). Tap: pen up. Drawing commits 1 s after pen-up, as with the mouse. |
| **CAT** | Hold to talk. Release to send. |
| Long-press INK (1 s) | Erase last drawing (refunds ink). |

**Why an Etch A Sketch:** nobody draws well on one, and everyone knows it. "I'm bad at drawing" stops being an apology and becomes the joke — then you say "it's a mushroom" and it *is*. That's the whole pitch in one interaction. Bullet-time while the pen is down keeps it playable.

**Feedback out:**

| Output | Shows |
|---|---|
| LED strip (60 px around the monitor) | **Ink meter** — blue, drains live as you draw, refills on erase · **Cheshire stripes** — pink/purple chase while the Cat speaks · **Fall pulse** — white blob runs down the strip when Alice drops a room · green flash on room clear, red blink when out of ink |
| UNO R4 12×8 LED matrix | The Cat's grin, lit only while he's present. Mount the board visibly behind a cutout. |

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

**LED power budget.** 300 px at full white is 18 A — never do that. We address only the first 60 px at `setBrightness(40)`: worst case ≈ 60 × 60 mA × 40/255 ≈ 0.56 A all-white, typical (one color, partly lit) < 0.2 A. That's fine from the R4's 5 V pin on USB. If you want more pixels or brightness, power the strip from the 2 A supply instead and **join the grounds**.

The R4's I/O pins source only ~8 mA each — never power anything from a data pin.

---

## 5. Protocol

Web Serial, 115200 baud, newline-terminated ASCII. Malformed lines are dropped on both sides; every message is idempotent, so a lost line costs nothing.

**Board → browser, 50 Hz:**

```
S,<dir>,<ink>,<cat>,<px>,<py>
```
`dir` bitmask: 1 = left, 2 = right, 4 = up, 8 = down · `ink`, `cat`: 1 while pressed (raw — the browser does toggle and long-press logic) · `px`, `py`: 0–4095, smoothed.

**Browser → board, on change + every 500 ms:**

| Msg | Meaning |
|---|---|
| `I,<0-100>` | Ink remaining, percent |
| `C,<0\|1>` | Cat present/speaking |
| `P` | Fall pulse (room transition) |
| `F,g` / `F,r` | Flash green (room clear) / red (out of ink, refusal) |

Why not USB-HID keyboard: the knobs need serial anyway, HID types into whatever has focus, and serial works identically on any board. One path.

---

## 6. Browser side (`src/io/serial.ts`)

```ts
export type Cabinet = { left: boolean; right: boolean; up: boolean; down: boolean;
                        ink: boolean; cat: boolean; px: number; py: number };   // px, py in 0..1

export async function connectCabinet(onState: (s: Cabinet) => void) {
  const port = await (navigator as any).serial.requestPort();   // must be called from a click
  await port.open({ baudRate: 115200 });
  const reader = port.readable.pipeThrough(new TextDecoderStream()).getReader();
  const writer = port.writable.getWriter();
  const enc = new TextEncoder();
  let buf = '';
  (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      for (let i; (i = buf.indexOf('\n')) >= 0; ) {
        const f = buf.slice(0, i).trim().split(','); buf = buf.slice(i + 1);
        if (f[0] !== 'S' || f.length !== 6) continue;
        const d = +f[1];
        onState({ left: !!(d & 1), right: !!(d & 2), up: !!(d & 4), down: !!(d & 8),
                  ink: f[2] === '1', cat: f[3] === '1', px: +f[4] / 4095, py: +f[5] / 4095 });
      }
    }
  })();
  return { send: (msg: string) => writer.write(enc.encode(msg + '\n')) };
}
```

Mapping, in the game's input layer (the sim never sees any of this):

- `left/right/up/down` → the same `walk(dir)` / `climb(dir)` actions as the arrow keys.
- `px, py` → pen position = `5% + 90% × value` of the viewport, so the knob ends don't pin the pen in a corner. Feed it through the same `ink/session.ts` entry points as pointer events: `penMove`, `penDown`, `penUp`.
- `ink` rising edge → toggle pen. Held ≥ 1 s → erase last drawing instead.
- `cat` → identical to holding Space.
- A **"Connect cabinet"** button in a corner calls `connectCabinet`. Click it during setup. If the port drops, the button reappears; mouse and keyboard keep working throughout.

---

## 7. Firmware

`hardware/cabinet/cabinet.ino`. Libraries: **Adafruit NeoPixel** (Library Manager) and `Arduino_LED_Matrix` (ships with the UNO R4 board package). Board: *Arduino UNO R4 WiFi*.

**Not yet compiled** — the environment it was written in couldn't reach the Arduino toolchain. Expect to fix a typo or two on first build.

Bring-up order — each step is five minutes and isolates one failure:

1. Blink the built-in LED. Proves cable, board package, upload.
2. NeoPixel `strandtest` on D8 with 8 px. Proves the library works on the R4 and the strip's direction. If NeoPixel misbehaves on the R4, swap to FastLED (≥ 3.7) — same wiring.
3. Flash `cabinet.ino`, open Serial Monitor at 115200: `S,…` lines should stream; wiggle everything and watch each field change.
4. Type `I,50` then `C,1` into the Serial Monitor: half the strip blue, then stripes + the matrix grin.
5. Open the game, click **Connect cabinet**.

---

## 8. If there's time (and only then)

**The Queen's cards (RFID).** Tag three playing cards. Tapping one on the reader spends an enchantment token — a physical spell budget the player holds in their hand. Thematically perfect, mechanically just another way to press a button.

Cautions: the RC522 is a **3.3 V part** — power it from the R4's 3.3 V pin, and its SPI lines are not 5 V-tolerant (the R4 is a 5 V board), so use level shifting or accept the risk on borrowed hardware. The kit may not include tags; ask the desk. This is the first thing to skip.

---

## 9. Failure plan

| Fails | Do |
|---|---|
| Pots too jittery or wrong taper (log pots feel lumpy) | More smoothing in firmware (`ALPHA` 0.1). Still bad → thumb joystick as a rate-controlled pen (A2/A3). |
| Arcade stick can't be wired without solder and the bench is busy | Thumb joystick B for walking. |
| Strip won't light | Check direction arrow, shared ground, `N_PX`, then try FastLED. Still dead → the on-screen ink meter already exists. |
| Serial drops mid-demo | Reconnect button. Mouse + keyboard never stopped working. |
| Anything flaky at hour 20 | Cut it (spec §12). A cabinet that half-works is worse than a laptop that fully works. |
