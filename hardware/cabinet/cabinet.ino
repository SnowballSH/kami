// Kami cabinet — Arduino UNO R4 WiFi
// Wiring + protocol: docs/hardware.md
// Build profile: sketch.yaml; compile and native checks: scripts/checkHardware.sh.

#include <Adafruit_NeoPixel.h>
#include "Arduino_LED_Matrix.h"
#include "input.h"

#define N_PX 60                         // only the first 60 px of the 300 px strip
const uint8_t PIN_DIR[4] = {2, 3, 4, 5};  // left, right, up, down  (LOW = pressed)
const uint8_t PIN_INK = 6, PIN_CAT = 7, PIN_STRIP = 8;
const float   ALPHA = 0.2f;             // knob smoothing: lower = smoother, laggier

Adafruit_NeoPixel strip(N_PX, PIN_STRIP, NEO_GRB + NEO_KHZ800);
ArduinoLEDMatrix matrix;

uint8_t GRIN[8][12] = {
  {0,0,0,0,0,0,0,0,0,0,0,0},
  {0,0,1,1,0,0,0,0,1,1,0,0},
  {0,0,1,1,0,0,0,0,1,1,0,0},
  {0,0,0,0,0,0,0,0,0,0,0,0},
  {1,0,0,0,0,0,0,0,0,0,0,1},
  {1,1,0,0,0,0,0,0,0,0,1,1},
  {0,1,1,1,1,1,1,1,1,1,1,0},
  {0,0,0,1,1,1,1,1,1,0,0,0}
};
uint8_t BLANK[8][12] = {{0}};

float px = 0, py = 0;
int   inkPct = 100;
bool  catOn = false, catShown = false;
uint32_t pulseStart = 0, flashUntil = 0, flashColor = 0;
uint32_t lastSend = 0, lastShow = 0;
DebouncedButton directions[4], inkButton, catButton;
FeedbackLine feedbackLine;

void setup() {
  Serial.begin(115200);
  for (uint8_t i = 0; i < 4; i++) pinMode(PIN_DIR[i], INPUT_PULLUP);
  pinMode(PIN_INK, INPUT_PULLUP);
  pinMode(PIN_CAT, INPUT_PULLUP);
  analogReadResolution(12);
  px = analogRead(A0);
  py = analogRead(A1);
  strip.begin();
  strip.setBrightness(40);              // power budget — see docs/hardware.md §4
  strip.show();
  matrix.begin();
  matrix.renderBitmap(BLANK, 8, 12);
}

void handleLine(const char* line) {
  Feedback feedback;
  if (!parseFeedback(line, feedback)) return;
  switch (feedback.kind) {
    case FeedbackKind::Ink:
      inkPct = feedback.value;
      break;
    case FeedbackKind::Cat:
      catOn = feedback.value != 0;
      break;
    case FeedbackKind::Pulse:
      pulseStart = millis();
      break;
    case FeedbackKind::Flash:
      flashColor = feedback.value ? strip.Color(0, 255, 60) : strip.Color(255, 0, 0);
      flashUntil = millis() + 350;
      break;
  }
}

void readSerial() {
  while (Serial.available()) {
    if (feedbackLine.push(Serial.read())) handleLine(feedbackLine.text());
  }
}

void render(uint32_t now) {
  if (now < flashUntil) {
    strip.fill(flashColor);
  } else if (catOn) {                   // Cheshire stripes, crawling
    uint8_t phase = (now / 120) % 6;
    for (uint16_t i = 0; i < N_PX; i++)
      strip.setPixelColor(i, ((i + phase) % 6 < 3) ? strip.Color(255, 40, 160) : strip.Color(110, 0, 200));
  } else {                              // ink meter
    uint16_t lit = (uint32_t)N_PX * inkPct / 100;
    for (uint16_t i = 0; i < N_PX; i++)
      strip.setPixelColor(i, i < lit ? strip.Color(20, 60, 255) : 0);
  }
  if (pulseStart && now - pulseStart < 800) {           // fall pulse: white blob runs the strip
    int head = (int)((now - pulseStart) * N_PX / 800);
    for (int k = 0; k < 6; k++) if (head - k >= 0 && head - k < N_PX) strip.setPixelColor(head - k, strip.Color(255, 255, 255));
  } else pulseStart = 0;
  strip.show();

  if (catOn != catShown) {              // only touch the matrix on change
    if (catOn) matrix.renderBitmap(GRIN, 8, 12); else matrix.renderBitmap(BLANK, 8, 12);
    catShown = catOn;
  }
}

void loop() {
  readSerial();
  uint32_t now = millis();

  px += ALPHA * (analogRead(A0) - px);
  py += ALPHA * (analogRead(A1) - py);

  uint8_t dir = 0;
  for (uint8_t i = 0; i < 4; i++)
    if (directions[i].sample(digitalRead(PIN_DIR[i]) == LOW, now)) dir |= (1 << i);
  const bool inkHeld = inkButton.sample(digitalRead(PIN_INK) == LOW, now);
  const bool catHeld = catButton.sample(digitalRead(PIN_CAT) == LOW, now);

  if (now - lastSend >= 20) {           // 50 Hz
    lastSend = now;
    Serial.print("S,");  Serial.print(dir);
    Serial.print(',');   Serial.print(inkHeld ? 1 : 0);
    Serial.print(',');   Serial.print(catHeld ? 1 : 0);
    Serial.print(',');   Serial.print((int)px);
    Serial.print(',');   Serial.println((int)py);
  }

  if (now - lastShow >= 33) {           // 30 Hz; show() right after draining serial to minimise dropped bytes
    lastShow = now;
    readSerial();
    render(now);
  }
  delay(1);
}
