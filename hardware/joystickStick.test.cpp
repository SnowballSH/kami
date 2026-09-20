#include <assert.h>
#include <stdint.h>
#include <string>

#include "joystick/stick.h"

const int ADC_MAX = 4095;

void travel() {
  StickAxis axis(ADC_MAX, 1);
  axis.restAt(2100);
  assert(axis.travel(2100) == 0);
  assert(axis.travel(ADC_MAX) == 100);
  assert(axis.travel(0) == -100);
  assert(axis.travel(2100 + (ADC_MAX - 2100) / 2) == 49);
  assert(axis.travel(1050) == -50);
  assert(axis.travel(ADC_MAX + 500) == 100);
  assert(axis.travel(-500) == -100);

  StickAxis flipped(ADC_MAX, -1);
  flipped.restAt(2000);
  assert(flipped.travel(ADC_MAX) == -100);
  assert(flipped.travel(0) == 100);

  StickAxis heldAtBoot(ADC_MAX, 1);
  heldAtBoot.restAt(ADC_MAX);
  assert(heldAtBoot.travel(ADC_MAX / 2) == 0);
  assert(heldAtBoot.travel(ADC_MAX) == 100);
}

void reporting() {
  StickReporter reporter;
  assert(reporter.due({0, 0, false}, 0));
  assert(!reporter.due({2, -2, false}, 500));
  assert(!reporter.due({0, 0, false}, 999));
  assert(reporter.due({0, 0, false}, 1000));

  assert(reporter.due({50, 0, false}, 1001));
  assert(!reporter.due({51, 1, false}, 1050));
  assert(reporter.due({53, 0, false}, 1060));
  assert(!reporter.due({53, 0, false}, 1159));
  assert(reporter.due({53, 0, false}, 1160));

  assert(reporter.due({0, 0, true}, 1161));
  assert(!reporter.due({0, 0, true}, 1260));
  assert(reporter.due({0, 0, true}, 1261));
  assert(reporter.due({0, 0, false}, 1262));

  StickReporter wrap;
  assert(wrap.due({80, 0, false}, UINT32_MAX - 49));
  assert(!wrap.due({80, 0, false}, 49));
  assert(wrap.due({80, 0, false}, 50));
}

void lines() {
  char line[STICK_LINE_CAPACITY];
  formatStickLine(line, sizeof(line), "arcade", {-70, 85, false});
  assert(std::string(line) == "kami arcade -70 85");
  formatStickLine(line, sizeof(line), "arcade", {100, 0, true});
  assert(std::string(line) == "kami arcade 100 0 A");
}

int main() {
  travel();
  reporting();
  lines();
}
