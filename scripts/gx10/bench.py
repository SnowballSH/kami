#!/usr/bin/env python3
"""Runs ON the GX10. Times its local Ollama models on Kami's real rule-compiler prompt.

usage: bench.py <payload.json> [model ...]      (payload: {"system": str, "lines": [str]})
Reports what a player would wait for, from Ollama's own counters: model load, prompt speed,
generation speed, and the wall-clock time of each reply — with reasoning off, and once with it on.
"""
import json
import sys
import time
import urllib.request

OLLAMA = "http://127.0.0.1:11434"
REPLY_BUDGET = 400
REASONING_BUDGET = 1500
NANOSECONDS = 1e9


def call(path, body, timeout=300):
    request = urllib.request.Request(
        OLLAMA + path, data=json.dumps(body).encode(), headers={"content-type": "application/json"}
    )
    started = time.monotonic()
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response), time.monotonic() - started


def installed_models():
    with urllib.request.urlopen(OLLAMA + "/api/tags", timeout=10) as response:
        return [model["name"] for model in json.load(response)["models"]]


def chat(model, system, line, think):
    body = {
        "model": model,
        "stream": False,
        "think": think,
        "options": {"temperature": 0, "num_predict": REASONING_BUDGET if think else REPLY_BUDGET},
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": line}],
    }
    try:
        reply, wall = call("/api/chat", body)
    except Exception as error:  # a model that rejects `think` still deserves a row
        if think is False:
            body.pop("think")
            reply, wall = call("/api/chat", body)
        else:
            return {"error": str(error)}
    generated = reply.get("eval_count", 0)
    seconds = reply.get("eval_duration", 0) / NANOSECONDS
    prompt_seconds = reply.get("prompt_eval_duration", 0) / NANOSECONDS
    return {
        "wall": wall,
        "load": reply.get("load_duration", 0) / NANOSECONDS,
        "prompt_tokens": reply.get("prompt_eval_count", 0),
        "prompt_rate": reply.get("prompt_eval_count", 0) / prompt_seconds if prompt_seconds else 0,
        "tokens": generated,
        "rate": generated / seconds if seconds else 0,
        "content": (reply.get("message", {}).get("content") or "").strip().replace("\n", " "),
        "thought": len(reply.get("message", {}).get("thinking") or ""),
    }


def as_kami_calls_it(model, system, line):
    body = {
        "model": model,
        "temperature": 0,
        "max_tokens": REASONING_BUDGET,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": line}],
    }
    reply, wall = call("/v1/chat/completions", body)
    message = reply["choices"][0]["message"]
    return wall, (message.get("content") or "").strip().replace("\n", " "), reply.get("usage", {})


def main():
    payload = json.load(open(sys.argv[1]))
    system, lines = payload["system"], payload["lines"]
    models = sys.argv[2:] or installed_models()

    for model in models:
        print(f"\n=== {model}")
        first = chat(model, system, lines[0], think=False)
        if "error" in first:
            print(f"  could not run: {first['error']}")
            continue
        print(f"  cold start: {first['wall']:.1f}s, of which loading the model {first['load']:.1f}s")
        print(f"  prompt: {first['prompt_tokens']} tokens at {first['prompt_rate']:.0f} tok/s")

        print("  reasoning OFF (what Kami would use):")
        for line in lines:
            result = chat(model, system, line, think=False)
            print(f"    {result['wall']:5.1f}s  {result['tokens']:4d} tok @ {result['rate']:5.1f} tok/s  {line!r}")
            print(f"           -> {result['content'][:150]}")

        result = chat(model, system, lines[0], think=True)
        if "error" in result:
            print(f"  reasoning ON: not supported ({result['error'][:80]})")
        else:
            print(f"  reasoning ON: {result['wall']:.1f}s, {result['tokens']} tok ({result['thought']} chars of thinking)")

        wall, content, usage = as_kami_calls_it(model, system, lines[0])
        print(f"  exactly as the Kami server calls it (/v1/chat/completions): {wall:.1f}s  usage={usage}")
        print(f"           -> {content[:150]}")


if __name__ == "__main__":
    main()
