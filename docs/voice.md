# Voice — talking to Kami, and Kami talking back

Deepgram both ways (`spec.md` §10.2). Hold the CAT button (or Space), say something, let go: what
you said is written on the board in your hand and goes into the same funnel a written note does, so
speech buys nothing extra — it is just another way to write. Every line Kami writes back is spoken
in his voice while the handwriting reveals.

Or hold nothing: tap the ear beside the CAT and say his name. "Kami, make gravity the moon's" is
the same utterance the button would have caught.

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

 ear tapped ─► game.onWakeToggled ─► the same socket with ?wake=1, standing open: one `heard`
               per utterance, and only the ones naming him are taken as said to him
```

The Deepgram key never reaches the browser: the Bun server holds it and proxies both directions.
Microphone capture requires a secure browser context: HTTPS on the iPad/LAN, or localhost for local
development. Plain HTTP on a LAN address cannot capture the microphone.

## Ears (speech → the funnel)

- **A press is one utterance**, one socket, one transcript: the microphone is acquired on press and
  closed by whatever ends the press — lifting, leaving the page, cancelling.
- **Waking is the other way, and the player asks for it.** The ear is off until tapped; a tap holds
  the microphone open until it is tapped off, or until the microphone is refused, which turns it
  back off by itself. Deepgram cuts the stream into utterances (`speech_final`) and the browser
  throws away every one that does not name him, so nothing else is written, spoken or acted on.
- Anything that sounds like his name wakes him — Nova-3 spells him a dozen ways — and the rest of
  that breath is the utterance; his name said alone takes the next breath instead. He never signs
  his name aloud (`aloud()` drops the `kami:` he writes), so he cannot wake himself.
- The name is matched by how it sounds, not by a list of spellings: `wakeWord.ts` flattens a word
  (`c`, `q`, `ck` → `k`, silent `h`, `y` → `i`, doubles collapsed) and takes anything shaped like
  _kah-mee_, including it split in two (`Cam me`). Plain English that sounds the same — "come",
  "came", "comma" — leaves him asleep.
- Speech carries what writing does not, so `spoken()` takes the hesitation ("uh", "erm"), the
  run-up ("okay so", "can you") and the politeness ("please") off a transcript before it reaches
  the funnel — both for a press and for a wake. Only filler goes; the command is untouched.
- A press wins: holding the button takes the microphone from the standing stream, which resumes
  once the press is done.
- The browser sends mono signed 16-bit little-endian PCM at whatever rate the `AudioContext` gave
  it, and tells the server that rate in `?rate=`; the server passes it to Deepgram.
- Audio captured before the socket opens is queued, not dropped, so the first word survives.
- The server relays `hearing` (interim) and one `heard` (the finalised utterance) as JSON; the
  browser only acts on `heard`. An empty transcript is silence, and nothing is written.
- A spoken note lands beside Alice, as if the player had written it there, and is stored like any
  other note.
- Opening or clearing a board cancels the current utterance and switches wake listening off.
  Voice input is available again after the board finishes loading.

## Mouth (Kami → speech)

- `game.kamiWrites` hands each line to `Mouth`, which is fire-and-forget: notes are never made to
  wait on audio, and a failed request or a blocked autoplay is simply silence.
- Lines play one at a time, in order, at most three queued; opening another board hushes what is
  left. Kami's own wordmark and tagline are written silently.
- Repeated lines (he has favourites) are cached in memory on the server, keyed by the line, under a
  byte budget — a hint costs one Deepgram call, not one per telling.

## Configuration

A standing wake stream costs Deepgram's streaming rate for as long as it is on, and it is an open
microphone — which is why it is a toggle the player turns on, and never the default.

On the GX10 the key travels from the Mac's gitignored `.deepgram.env` (`DEEPGRAM_API_KEY=...`): `scripts/gx10/deploy.sh` sends that file to `~/kami/secrets.env` on the box (mode 600, outside every release), and `box/start.sh` reads it as `NAME=value` lines — it is never run as a script, only `DEEPGRAM_API_KEY` is taken from it, and it is never printed. The iPad's microphone needs the https address (`https://<box>:8443`, accept the certificate once); Kami's speaking voice works on either.

`DEEPGRAM_API_KEY` on the server turns voice on; without it the socket refuses and
`POST /api/voice/speak` answers `501`, which the client treats as silence. `KAMI_VOICE_LISTEN_MODEL`
(default `nova-3`) and `KAMI_VOICE_SPEAK_MODEL` (default `aura-2-draco-en`) override the models.

Microphones need HTTPS when the game is opened over the LAN. The GX10 box serves
`https://<box>:8443` with a self-signed certificate; accept it once on the iPad/Chrome. Set
`KAMI_TLS_CERT` and `KAMI_TLS_KEY` to enable the listener, and optionally set `KAMI_TLS_PORT`
(default `8443`). See `server/README.md`.

## Why not Deepgram's Voice Agent API

It brings its own LLM and its own turn-taking. Kami's replies are not chat: they are the offline
grammar, the Cat's ladder of hints and the GX10 compiling laws, all of which write on the board and
change the world. Voice Agent would have replaced the part of Kami that *is* Kami. Nova-3 and
Aura-2 give him ears and a voice and leave his mind alone.
