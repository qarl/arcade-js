// SPDX-License-Identifier: GPL-3.0-only
/**
 * Drift gate for the AUDIO WIRING — the seam between three files that are
 * deliberately owned by different layers and must not be edited into
 * disagreement:
 *
 *   games/dkong/manifest.js        declares WHERE the map and the clips are
 *   games/dkong/audio/sounds.js    says what each sound-command write MEANS
 *   games/dkong/tools/record_samples.py   decides what each clip FILE is called
 *
 * web/player.html reads all three and never hardcodes a Donkey Kong value. This
 * test re-derives, from the manifest + the map alone, exactly what that page
 * would decide to play — and pins the answer. It needs no ROM, no audio, and no
 * browser; it cannot prove a sound is right, only that the wiring still says
 * what it said.
 *
 * The one rule worth stating out loud, because getting it wrong ships a lie:
 * an entry the map measures SILENT, marks `kind: "none"`, or flags with a
 * `conflict` MUST NOT be given a sample. The tune latch's 0x0A ("75m
 * background") is the live example — the driver and the ROM say music, the
 * hardware measured silence, and until someone records a real 75m playthrough
 * the honest output is nothing at all.
 *
 * Run: node --test
 */

import test from "node:test";
import assert from "node:assert/strict";

import manifest from "../manifest.js";
import SOUNDS from "../audio/sounds.js";

const audio = manifest.audio;

// The same predicate web/player.html applies, restated here so a change to it
// has to be made in two places on purpose rather than in one by accident.
const playable = (entry) =>
  !!entry && entry.kind !== "none" && !entry.conflict &&
  entry.measured?.audible !== false;

const fill = (tpl, subs) => tpl.replace(/\{(\w+)\}/g, (_, k) => subs[k]);
const hex2 = (v) => v.toString(16).padStart(2, "0");

test("manifest.audio declares everything the web player needs", () => {
  assert.ok(audio, "games/dkong/manifest.js lost its audio block");
  assert.equal(typeof audio.map, "string");
  assert.equal(typeof audio.samples, "string");
  assert.equal(typeof audio.clipIds?.trigger, "string");
  assert.equal(typeof audio.clipIds?.latch, "string");
  // Relative to the game directory: the player joins them onto ../games/<id>/.
  for (const p of [audio.map, audio.samples]) {
    assert.ok(!p.startsWith("/") && !p.startsWith("."), `${p} must be game-relative`);
  }
});

test("manifest.audio.map is the module this test loaded", async () => {
  const mod = await import(`../${audio.map}`);
  assert.equal(mod.default, SOUNDS, "manifest.audio.map points somewhere else");
});

test("clipId templates reproduce record_samples.py's filenames", () => {
  // record_samples.py writes `<slot id>.wav`, with slot ids "trig<n>" for the
  // ls259 sweep and "latch_<vv>" (lowercase, 2 hex digits) for the latch sweep.
  assert.equal(fill(audio.clipIds.trigger, { n: 0 }), "trig0");
  assert.equal(fill(audio.clipIds.trigger, { n: 7 }), "trig7");
  assert.equal(fill(audio.clipIds.latch, { vv: hex2(0x00) }), "latch_00");
  assert.equal(fill(audio.clipIds.latch, { vv: hex2(0x0a) }), "latch_0a");
  assert.equal(fill(audio.clipIds.latch, { vv: hex2(0x0f) }), "latch_0f");
});

test("the player would ask for exactly the sounds the map calls audible", () => {
  const trig = [];
  for (let n = 0; n < SOUNDS.ports.triggerCount; n++) {
    if (playable(SOUNDS.triggers[n])) trig.push(n);
  }
  // 6 and 7 are wired to discrete nodes dkong2b_discrete does not define, and
  // are measured silent and inert.
  assert.deepEqual(trig, [0, 1, 2, 3, 4, 5]);

  const tunes = [];
  for (let v = 0; v <= 0x0f; v++) if (playable(SOUNDS.latch[v])) tunes.push(v);
  // 0x00 is "no tune" and 0x0A is the unresolved conflict — neither gets a sample.
  assert.deepEqual(tunes, [1, 2, 3, 4, 5, 6, 7, 8, 9, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f]);
});

test("0x7C00 = 0x0A is refused, and refused for a stated reason", () => {
  const e = SOUNDS.latch[0x0a];
  assert.equal(playable(e), false, "the 75m tune conflict must not be given a sound");
  assert.ok(e.conflict, "0x0A lost its conflict note — the refusal would silently reverse");
  assert.equal(e.measured.audible, false);
});

test("every playable sound has a unique name to load its clip under", () => {
  const names = [];
  for (let n = 0; n < SOUNDS.ports.triggerCount; n++) {
    if (playable(SOUNDS.triggers[n])) names.push(SOUNDS.triggers[n].name);
  }
  for (let v = 0; v <= 0x0f; v++) {
    if (playable(SOUNDS.latch[v])) names.push(SOUNDS.latch[v].name);
  }
  assert.equal(new Set(names).size, names.length, "a name collision would drop a sound");
});

test("every playable entry classifies as gate / one-shot / loop, with no gaps", () => {
  // Triggers go by `measured.behaviour` (what the HARDWARE does); tune-latch
  // values go by `kind` (how the ROM USES the command). Conflating the two is
  // the documented way to build a wrong player.
  for (let n = 0; n < SOUNDS.ports.triggerCount; n++) {
    const e = SOUNDS.triggers[n];
    if (!playable(e)) continue;
    assert.ok(
      ["level", "level+decay", "oneshot"].includes(e.measured?.behaviour),
      `trigger ${n} (${e.name}) has no usable measured.behaviour`,
    );
  }
  for (let v = 0; v <= 0x0f; v++) {
    const e = SOUNDS.latch[v];
    if (!playable(e)) continue;
    assert.ok(["loop", "oneshot"].includes(e.kind), `latch 0x${hex2(v)} has kind ${e.kind}`);
  }
});

test("the tune latch is looked up on the low nibble only", () => {
  // ls175.3d is maskout 0xF0, so 0x10-0x1F mirror 0x00-0x0F on real hardware and
  // the map is only defined over 0x00-0x0F. The player masks; this pins that the
  // map has no key it would then be unable to reach.
  for (const k of Object.keys(SOUNDS.latch)) {
    const v = Number(k);
    assert.ok(Number.isInteger(v) && v >= 0 && v <= 0x0f, `latch key ${k} is outside 0x00-0x0F`);
  }
});
