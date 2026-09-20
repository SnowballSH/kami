#pragma once

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

/** One axis of an analog stick: a raw reading becomes -100 … 100 percent of travel around its rest. */
class StickAxis {
 public:
  StickAxis(int fullScale, int sign) : fullScale_(fullScale), sign_(sign), rest_(fullScale / 2) {}

  /** A reading far from the middle means the stick was held while the board started: keep the middle. */
  void restAt(int raw) {
    const int middle = fullScale_ / 2;
    rest_ = abs(raw - middle) <= fullScale_ / 4 ? raw : middle;
  }

  int travel(int raw) const {
    const long offset = static_cast<long>(raw) - rest_;
    const long span = offset < 0 ? rest_ : fullScale_ - rest_;
    if (span <= 0) return 0;
    const long percent = offset * 100 / span;
    return sign_ * static_cast<int>(percent < -100 ? -100 : percent > 100 ? 100 : percent);
  }

 private:
  int fullScale_;
  int sign_;
  int rest_;
};

struct StickState {
  int x;
  int y;
  bool pushed;
};

const int STICK_MOVED = 3;
const uint32_t STICK_HEARTBEAT_MS = 100;
const uint32_t STICK_IDLE_BEAT_MS = 1000;

/** docs/controllers.md: send on a change, every 100 ms while anything is held, once a second at rest. */
class StickReporter {
 public:
  bool due(const StickState& state, uint32_t now) {
    const bool atRest = abs(state.x) < STICK_MOVED && abs(state.y) < STICK_MOVED && !state.pushed;
    const bool changed = abs(state.x - sent_.x) >= STICK_MOVED ||
                         abs(state.y - sent_.y) >= STICK_MOVED ||
                         state.pushed != sent_.pushed;
    const uint32_t beat = atRest ? STICK_IDLE_BEAT_MS : STICK_HEARTBEAT_MS;
    if (reported_ && !changed && now - sentAt_ < beat) return false;
    reported_ = true;
    sent_ = state;
    sentAt_ = now;
    return true;
  }

 private:
  StickState sent_ = {0, 0, false};
  uint32_t sentAt_ = 0;
  bool reported_ = false;
};

const size_t STICK_LINE_CAPACITY = 48;

/** `kami <controller> <x> <y> [A]` — the push is button A, which the server reads as jump. */
inline int formatStickLine(char* line, size_t capacity, const char* controller,
                           const StickState& state) {
  return snprintf(line, capacity, "kami %s %d %d%s", controller, state.x, state.y,
                  state.pushed ? " A" : "");
}
