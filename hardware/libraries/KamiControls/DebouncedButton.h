#pragma once

#include <stdint.h>

/** A switch counts as held or released once its reading has been stable for 20 ms. */
class DebouncedButton {
 public:
  bool sample(bool pressed, uint32_t now) {
    if (pressed != candidate_) {
      candidate_ = pressed;
      changedAt_ = now;
    }
    if (now - changedAt_ >= 20) held_ = candidate_;
    return held_;
  }

 private:
  bool held_ = false;
  bool candidate_ = false;
  uint32_t changedAt_ = 0;
};
