const ASKING_FOR_IDEAS =
  /^(what (can|could|should|do) (i|we|she)( do)?|how (do|can|could) (i|we|she) get|give me (an )?ideas?|(any )?ideas?|inspire me|suggest|what next|i'?m bored|now what)\b/i;

/** Sandbox asks that want an idea rather than a hint: "what can I do?", "how do I get across?". */
export const isIdeaRequest = (text: string): boolean =>
  ASKING_FOR_IDEAS.test(text.trim().replace(/[?!.]+$/, ""));
