# Voice — talking to Kami, and Kami talking back

Deepgram both ways (`spec.md` §10.2). Hold the CAT button (or Space), say something, let go: what
you said is written on the board in your hand and goes into the same funnel a written note does, so
speech buys nothing extra — it is just another way to write. Every line Kami writes back is spoken
in his voice while the handwriting reveals.

The board is still the truth. If Deepgram is unreachable, misconfigured or slow, nothing is said
aloud and nothing is heard, and the game plays exactly as it did before.

## Shape

```
 CAT button / Space held ─► ui/TalkButton ─► game.onTalkStarted ─► voice/Ears
      mic ─ AudioWorklet ─ linear16 frames ─► ws /api/voice/listen ─► server/voice/VoiceRelay
                                                                          │ wss deepgram nova-3
      let go ─► {"type":"done"} ─────────────────────────────────────────►│
                                     ◄── {hearing|heard} ── final transcript
      heard ─► game.interpret(text, beside Alice) ─► law / name / help / the model, as ever
      kamiWrites(line) ─► voice/Mouth ─► POST /api/voice/speak ─► aura-2 mp3 ─► played in order
```

The Deepgram key never reaches the browser: the Bun server holds it and proxies both directions,
which also keeps voice working on the iPad's plain-HTTP LAN origin.

## Ears (speech → the funnel)

- **Never an open mic.** The microphone is acquired on press and closed on release — a press is one
  utterance, one socket, one transcript.
- The browser sends mono signed 16-bit little-endian PCM at whatever rate the `AudioContext` gave
  it, and tells the server that rate in `?rate=`; the server passes it to Deepgram.
- Audio captured before the socket opens is queued, not dropped, so the first word survives.
- The server relays `hearing` (interim) and one `heard` (the finalised utterance) as JSON; the
  browser only acts on `heard`. An empty transcript is silence, and nothing is written.
- A spoken note lands beside Alice, as if the player had written it there, and is stored like any
  other note.

## Mouth (Kami → speech)

- `game.kamiWrites` hands each line to `Mouth`, which is fire-and-forget: notes are never made to
  wait on audio, and a failed request or a blocked autoplay is simply silence.
- Lines play one at a time, in order, at most three queued; opening another board hushes what is
  left. Kami's own wordmark and tagline are written silently.
- Repeated lines (he has favourites) are cached in memory on the server, keyed by the line, under a
  byte budget — a hint costs one Deepgram call, not one per telling.

## Configuration

`DEEPGRAM_API_KEY` on the server turns voice on; without it the socket refuses and
`POST /api/voice/speak` answers `501`, which the client treats as silence. `KAMI_VOICE_LISTEN_MODEL`
(default `nova-3`) and `KAMI_VOICE_SPEAK_MODEL` (default `aura-2-draco-en`) override the models.
See `server/README.md`.

## Why not Deepgram's Voice Agent API

It brings its own LLM and its own turn-taking. Kami's replies are not chat: they are the offline
grammar, the Cat's ladder of hints and the GX10 compiling laws, all of which write on the board and
change the world. Voice Agent would have replaced the part of Kami that *is* Kami. Nova-3 and
Aura-2 give him ears and a voice and leave his mind alone.
