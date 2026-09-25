// Kami analog joystick — Arduino UNO R4, USB serial to the Kami server
// Wiring + protocol: docs/controllers.md
// Build profile: sketch.yaml; native checks: scripts/checkHardware.sh; upload: docs/controllers.md

#include <DebouncedButton.h>
#include "stick.h"

// The module is mounted a quarter turn round: its VRy (A1) runs left–right, its VRx (A0) up–down.
const uint8_t PIN_X = A1, PIN_Y = A0, PIN_PUSH = 2;  // push: LOW = pressed
const int X_SIGN = -1;                               // -1 when pushing right reads lower
const int Y_SIGN = -1;                               // -1 when pushing up reads lower
const char CONTROLLER[] = "arcade";
const uint8_t ADC_BITS = 12;
const int ADC_MAX = (1 << ADC_BITS) - 1;
const uint8_t REST_SAMPLES = 16;

StickAxis xAxis(ADC_MAX, X_SIGN), yAxis(ADC_MAX, Y_SIGN);
DebouncedButton push;
StickReporter reporter;

int settled(uint8_t pin) {
  long sum = 0;
  for (uint8_t i = 0; i < REST_SAMPLES; i++) sum += analogRead(pin);
  return sum / REST_SAMPLES;
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_PUSH, INPUT_PULLUP);
  analogReadResolution(ADC_BITS);
  xAxis.restAt(settled(PIN_X));
  yAxis.restAt(settled(PIN_Y));
}

void loop() {
  const uint32_t now = millis();
  const StickState state = {xAxis.travel(analogRead(PIN_X)), yAxis.travel(analogRead(PIN_Y)),
                            push.sample(digitalRead(PIN_PUSH) == LOW, now)};
  if (reporter.due(state, now)) {
    char line[STICK_LINE_CAPACITY];
    formatStickLine(line, sizeof(line), CONTROLLER, state);
    Serial.println(line);
  }
  delay(2);
}
