#include <assert.h>
#include <stdint.h>
#include <string>

#include "cabinet/input.h"

void debounce() {
  DebouncedButton button;
  assert(!button.sample(false, 0));
  assert(!button.sample(true, 1));
  assert(!button.sample(false, 5));
  assert(!button.sample(true, 10));
  assert(!button.sample(true, 29));
  assert(button.sample(true, 30));
  assert(button.sample(false, 31));
  assert(button.sample(true, 34));
  assert(button.sample(false, 40));
  assert(button.sample(false, 59));
  assert(!button.sample(false, 60));

  DebouncedButton wrap;
  assert(!wrap.sample(true, UINT32_MAX - 9));
  assert(!wrap.sample(true, 9));
  assert(wrap.sample(true, 10));
}

void frames() {
  FeedbackLine line;
  assert(!line.push('C'));
  assert(!line.push(','));
  assert(!line.push('1'));
  assert(line.push('\r'));
  assert(std::string(line.text()) == "C,1");
  assert(!line.push('\n'));

  for (int i = 0; i < 1000; ++i) assert(!line.push('x'));
  assert(!line.push('P'));
  assert(!line.push('\n'));
  assert(!line.push('P'));
  assert(line.push('\n'));
  assert(std::string(line.text()) == "P");

  for (int i = 0; i < 23; ++i) assert(!line.push('x'));
  assert(line.push('\n'));
  for (int i = 0; i < 24; ++i) assert(!line.push('x'));
  assert(!line.push('\n'));

  assert(!line.push('P'));
  assert(!line.push('\0'));
  assert(!line.push('\n'));
}

void feedback() {
  Feedback parsed;
  assert(parseFeedback("I,0", parsed));
  assert(parsed.kind == FeedbackKind::Ink && parsed.value == 0);
  assert(parseFeedback("I,100", parsed));
  assert(parsed.kind == FeedbackKind::Ink && parsed.value == 100);
  assert(parseFeedback("C,1", parsed));
  assert(parsed.kind == FeedbackKind::Cat && parsed.value == 1);
  assert(parseFeedback("C,0", parsed));
  assert(parsed.kind == FeedbackKind::Cat && parsed.value == 0);
  assert(parseFeedback("P", parsed));
  assert(parsed.kind == FeedbackKind::Pulse);
  assert(parseFeedback("F,g", parsed));
  assert(parsed.kind == FeedbackKind::Flash && parsed.value == 1);
  assert(parseFeedback("F,r", parsed));
  assert(parsed.kind == FeedbackKind::Flash && parsed.value == 0);
  for (const char* invalid : {"", "I,", "I,-1", "I,101", "I,1000", "I,1x", "I, 1",
                              "C,2", "C,10", "Pnoise", "F,b", "F,green"}) {
    assert(!parseFeedback(invalid, parsed));
  }
}

int main() {
  debounce();
  frames();
  feedback();
}
