#pragma once

#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <DebouncedButton.h>

class FeedbackLine {
 public:
  bool push(char character) {
    if (character == '\r' || character == '\n') {
      const bool ready = !discarding_ && length_ > 0;
      text_[length_] = '\0';
      length_ = 0;
      discarding_ = false;
      return ready;
    }
    if (!discarding_) {
      if (character == '\0' || length_ == sizeof(text_) - 1) {
        discarding_ = true;
        length_ = 0;
      } else {
        text_[length_++] = character;
      }
    }
    return false;
  }

  const char* text() const { return text_; }

 private:
  char text_[24] = {};
  size_t length_ = 0;
  bool discarding_ = false;
};

enum class FeedbackKind { Ink, Cat, Pulse, Flash };

struct Feedback {
  FeedbackKind kind;
  uint8_t value;
};

inline bool parseFeedback(const char* text, Feedback& result) {
  if (strcmp(text, "P") == 0) {
    result = {FeedbackKind::Pulse, 0};
  } else if (strcmp(text, "C,0") == 0 || strcmp(text, "C,1") == 0) {
    result = {FeedbackKind::Cat, static_cast<uint8_t>(text[2] - '0')};
  } else if (strcmp(text, "F,g") == 0 || strcmp(text, "F,r") == 0) {
    result = {FeedbackKind::Flash, static_cast<uint8_t>(text[2] == 'g')};
  } else if (strncmp(text, "I,", 2) == 0) {
    const size_t length = strlen(text);
    if (length < 3 || length > 5) return false;
    unsigned int value = 0;
    for (size_t i = 2; i < length; ++i) {
      if (text[i] < '0' || text[i] > '9') return false;
      value = value * 10 + (text[i] - '0');
    }
    if (value > 100) return false;
    result = {FeedbackKind::Ink, static_cast<uint8_t>(value)};
  } else {
    return false;
  }
  return true;
}
