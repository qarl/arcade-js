# games/dkong/audio/ — sound-command → sample map

Audio for Donkey Kong is a thin layer over the emulation, not a sound-chip emulation
(see `core/audio.js`). Donkey Kong drives its sound hardware by writing command bytes to
latch addresses; the board surfaces those writes, and this directory maps each command to a
sample the `SamplePlayer` plays.

When built out, this directory holds:

- `triggers.js` — `{ <soundCommandValue>: <sampleId> }`: which write means "jump", "walk",
  "hammer", "how-high", the BGM cues, etc. Derived from the DK sound-command set (the writes
  the ROM makes to its sound latches).
- `samples/` — the audio assets keyed by `sampleId`.

Nothing here yet — this is the seam. The emulation runs and is pixel-validated with audio
absent; wiring the trigger map + samples is a later phase and cannot affect the pixel gate.
