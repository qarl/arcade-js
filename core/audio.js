// SPDX-License-Identifier: GPL-3.0-only
//
// SamplePlayer — the audio abstraction.
//
// Audio is NOT emulated at the sound-chip level. The emulation core stays
// deterministic and sound-free (the pixel gate never depends on it). Instead, a
// board observes the program's *sound-command writes* and hands each command value
// to a SamplePlayer, which maps it to a pre-recorded sample. Audio is therefore a
// thin, swappable layer sitting ABOVE the emulation.
//
// A game supplies:
//   - `samples`:    { sampleId: <asset> }                     (games/<x>/audio/)
//   - `triggerMap`: { <soundCommandValue>: sampleId }         (games/<x>/audio/)
// and its board calls `player.trigger(commandValue)` on each write to the game's
// sound-command latch.
//
// This is the interface + wiring. The concrete WebAudio-backed playback and the
// per-game trigger maps/samples land in later phases (see games/dkong/audio/).

export class SamplePlayer {
  /** @param {{ samples?: object, triggerMap?: object }} [cfg] */
  constructor({ samples = {}, triggerMap = {} } = {}) {
    this.samples = samples;        // { sampleId: decoded audio / url }
    this.triggerMap = triggerMap;  // { soundCommandValue: sampleId }
    this.enabled = false;
  }

  setEnabled(on) { this.enabled = !!on; }

  /** Called by the board when the game writes a sound command. */
  trigger(commandValue) {
    if (!this.enabled) return;
    const id = this.triggerMap[commandValue];
    if (id != null) this.play(id);
  }

  // --- playback backend: implemented in a later phase (WebAudio, etc.) ---
  play(/* sampleId */) {}
  stop(/* sampleId */) {}
}
