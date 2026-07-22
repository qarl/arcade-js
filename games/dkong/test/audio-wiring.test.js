// SPDX-License-Identifier: GPL-3.0-only
/**
 * Drift gate for the AUDIO WIRING — the seam between three files that are
 * deliberately owned by different layers and must not be edited into
 * disagreement:
 *
 *   games/dkong/manifest.js        declares WHERE the map, the synth and the clips are
 *   games/dkong/audio/sounds.js    says what each sound-command write MEANS
 *   games/dkong/audio/synth.js     re-creates the three discrete circuits
 *   games/dkong/tools/record_samples.py   decides what each clip FILE is called
 *
 * web/player.html reads all of them and never hardcodes a Donkey Kong value.
 * This test re-derives, from the manifest + the map + the synth alone, exactly
 * what that page would decide to play — and pins the answer. It needs no ROM, no
 * audio, and no browser; it cannot prove a sound is right, only that the wiring
 * still says what it said.
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
import { EFFECTS, EFFECT_NAMES } from "../audio/synth.js";

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
  assert.equal(typeof audio.synth, "string");
  assert.equal(typeof audio.samples, "string");
  assert.equal(typeof audio.clipIds?.trigger, "string");
  assert.equal(typeof audio.clipIds?.latch, "string");
  // Relative to the game directory: the player joins them onto ../games/<id>/.
  for (const p of [audio.map, audio.synth, audio.samples]) {
    assert.ok(!p.startsWith("/") && !p.startsWith("."), `${p} must be game-relative`);
  }
});

test("manifest.audio.synth is the module this test loaded", async () => {
  const mod = await import(`../${audio.synth}`);
  assert.equal(mod.EFFECTS, EFFECTS, "manifest.audio.synth points somewhere else");
  assert.equal(typeof mod.renderEffects, "function", "the player calls renderEffects()");
  assert.equal(typeof mod.DEFAULT_SAMPLE_RATE, "number", "the player renders at this rate");
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
  if (playable(SOUNDS.irq)) names.push(SOUNDS.irq.name);
  assert.equal(new Set(names).size, names.length, "a name collision would drop a sound");
});

// --------------------------------------------------------------------------
// The 0x7D80 IRQ line — the death tune. Its own write surface, so its own
// wiring: a map entry, a clip id, and a place in the player's dispatcher. It
// was silent for a long time because all three were missing, not because the
// map named it wrongly.
// --------------------------------------------------------------------------

test("the death tune is on the IRQ line, not on any tune-latch value", () => {
  // Pins the thing a reader will otherwise re-derive wrongly. A write trace of a
  // real death (coin_start idle, --writes) shows 0x7C00 <- 0x00 at the hit and
  // 0x7D80 pulsed 65 frames later, with no latch value written in between. So no
  // 0x7C00 value means "death", and looking for one is a dead end.
  assert.equal(SOUNDS.irq.name, "death");
  assert.equal(SOUNDS.ports.irq, 0x7d80);
  for (let v = 0; v <= 0x0f; v++) {
    assert.notEqual(SOUNDS.latch[v].name, "death", `latch 0x${hex2(v)} claims to be death`);
  }
});

test("the IRQ line is wired end to end: playable, one-shot, and has a clip id", () => {
  const e = SOUNDS.irq;
  assert.ok(playable(e), "the map refuses the IRQ line, so death can never sound");
  assert.equal(e.kind, "oneshot", "a held IRQ line is not a thing the ROM does");
  assert.equal(e.measured.audible, true, "0x7D80 was measured in isolation; it makes sound");
  assert.ok(e.measured.clipSec > 3, "the death tune is seconds long, not a blip");
  assert.equal(typeof audio.clipIds.irq, "string", "no clip id -> the player loads nothing");
  assert.equal(fill(audio.clipIds.irq, {}), "irq", "record_samples.py writes irq.wav");
});

test("a one-shot tune outlasts the ROM's 3-frame pulse by orders of magnitude", () => {
  // The reason a one-shot must NOT be stopped when the line reverts. The ROM
  // holds a priority tune (0x608A/0x608B) and the IRQ counter (0x6088) for 3
  // frames = 0.05 s; every one-shot tune measured runs far longer than that, so
  // stopping on the revert would replace the tune with a click.
  const holdSec = 3 / 60.606060;
  const oneshots = [SOUNDS.irq];
  for (let v = 0; v <= 0x0f; v++) {
    const e = SOUNDS.latch[v];
    if (playable(e) && e.kind === "oneshot") oneshots.push(e);
  }
  assert.ok(oneshots.length >= 10, "expected the nine one-shot tunes plus the IRQ line");
  for (const e of oneshots) {
    const d = e.measured.durationSec ?? e.measured.clipSec;
    assert.ok(typeof d === "number" && d > 10 * holdSec,
      `${e.name} runs ${d}s, not clearly longer than the ${holdSec.toFixed(3)}s hold`);
  }
});

// --------------------------------------------------------------------------
// Looping tunes must carry a WHOLE PHRASE. Recording them at the pulse length
// gave 0.22–0.39 s fragments, and looping a fragment is what "the music is
// missing notes" sounded like.
// --------------------------------------------------------------------------

test("the sweep's GATED set is exactly the map's kind:\"loop\" set", () => {
  // Two independent derivations: `kind` comes from the ROM parking the value in
  // the background slot 0x6089; `measured.gated` comes from stimulating the
  // hardware and seeing the sound stop when the latch is released. They agree,
  // which is the strongest statement in the map about `kind` — and says nothing
  // about any NAME, so no confidence field moves because of it.
  const byKind = [], byMeasurement = [];
  for (let v = 0; v <= 0x0f; v++) {
    const e = SOUNDS.latch[v];
    if (!playable(e)) continue;
    if (e.kind === "loop") byKind.push(v);
    if (e.measured.gated === true) byMeasurement.push(v);
  }
  assert.deepEqual(byKind, [0x03, 0x04, 0x08, 0x09, 0x0b]);
  assert.deepEqual(byMeasurement, byKind);
});

test("every looping tune carries a measured phrase, long enough to be one", () => {
  for (let v = 0; v <= 0x0f; v++) {
    const e = SOUNDS.latch[v];
    if (!playable(e) || e.kind !== "loop") continue;
    const m = e.measured;
    assert.equal(typeof m.phraseSec, "number", `${e.name} has no measured phrase length`);
    assert.equal(m.phraseSec, m.durationSec, `${e.name}: the clip is not the phrase`);
    // The pulse pass is what USED to be shipped, and it never captured even
    // half a phrase — the whole defect, restated as a number.
    assert.ok(m.pulseSec <= 0.5 * m.phraseSec,
      `${e.name}: the ${m.pulseSec}s pulse is not clearly a fragment of the ${m.phraseSec}s phrase`);
    assert.ok(m.phraseSec >= 1.0, `${e.name}: ${m.phraseSec}s is a note, not a phrase`);
    assert.ok(m.phraseCorr >= 0.9,
      `${e.name}: phrase correlation ${m.phraseCorr} is too weak to loop on`);
    // ...and it was measured on a hold long enough to contain several of them.
    assert.ok(m.sustainSec > 4 * m.phraseSec,
      `${e.name}: the phrase was measured from too few repeats`);
  }
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

// --------------------------------------------------------------------------
// The synthesised default: what a visitor hears with NOTHING installed.
// --------------------------------------------------------------------------

test("the synth covers the discrete circuits, by name, and the map permits them", () => {
  // The player keys playback off the MAP (which bit, and may it sound at all)
  // and takes only the audio from the synth, matched BY NAME. So every synth
  // name must be a playable trigger in the map, on the bit the synth claims.
  for (const name of EFFECT_NAMES) {
    const fx = EFFECTS[name];
    const e = SOUNDS.triggers[fx.trigger];
    assert.ok(e, `synth ${name} claims trigger ${fx.trigger}, which the map does not define`);
    assert.equal(e.name, name, `synth ${name} sits on the map's "${e.name}" bit`);
    assert.ok(playable(e), `the map refuses ${name}, so the synth buffer would never play`);
    assert.equal(e.source, "discrete", `${name} is not a discrete circuit — it cannot be synthesised honestly`);
    assert.equal(fx.port, SOUNDS.ports.triggerBase + fx.trigger);
  }
  // And the converse: every discrete bit is synthesised, so no visitor is
  // missing an effect that needs no ROM.
  const discrete = Object.entries(SOUNDS.triggers)
    .filter(([, e]) => e.source === "discrete")
    .map(([n]) => Number(n))
    .sort((a, b) => a - b);
  assert.deepEqual(discrete, EFFECT_NAMES.map((n) => EFFECTS[n].trigger).sort((a, b) => a - b));
});

test("a synthesised effect plays UNGATED and retriggers — walk especially", () => {
  // The decision, and the two numbers behind it. The walk render is one whole
  // footstep: the rising-edge blip at 0 s AND the falling-edge release blip the
  // recorder found at 0.2455 s. In game the ROM holds 0x7D00 for ~3 frames
  // (~50 ms), so gating the render on the falling edge would cut it at 50 ms —
  // chopping the footstep's own 0.12 s tail and losing the release blip
  // altogether. Ungated one-shot it is, whatever `measured.behaviour` says
  // about the HARDWARE, because the render is not the hardware's live output:
  // it is a complete pre-baked event.
  assert.equal(SOUNDS.triggers[0].measured.behaviour, "level"); // the clip rule, still true
  const release = EFFECTS.walk.voices.find((v) => v.atSec > 0);
  assert.ok(release, "the walk render lost its release blip — the gating argument with it");
  assert.ok(Math.abs(release.atSec - 0.2455) < 1e-6);
  assert.ok(release.atSec > 3 / 60, "the release blip must land after the ROM's 3-frame hold");

  // Retrigger: one circuit has one output, and every effect is longer than the
  // interval its own ROM site can repeat at (footsteps ~12 frames, Kong's pound
  // ~32 frames), so overlapping voices of one effect are not a thing the
  // hardware can do — the player stops the previous voice first.
  assert.ok(EFFECTS.walk.durationSec > 12 / 60, "walk shorter than a footstep interval");
  assert.ok(EFFECTS.boom.durationSec > 0.5, "boom shorter than Kong's 32-frame pound interval");
});

test("recordings override the synth by landing on the same sample name", () => {
  // The player loads the synth buffer under the map's name, then loads any
  // recorded clip under the map's name too — so "recorded wins" is not a
  // special case in the code, it is the same key being written twice. That only
  // holds while both sources agree on the name, which is what this pins.
  for (const name of EFFECT_NAMES) {
    const n = EFFECTS[name].trigger;
    assert.equal(SOUNDS.triggers[n].name, name);
    // ...and the recorder does have a clip id for that bit, so the override is
    // reachable rather than theoretical.
    assert.equal(fill(audio.clipIds.trigger, { n }), `trig${n}`);
  }
});

test("boom's clip span and its audible length are recorded as different numbers", () => {
  // The recorder's silence threshold counted a DC settling step as signal, so
  // the 1.825 s span overstates the sound by more than a second. Both files now
  // carry both figures; nothing behavioural reads either (boom is a one-shot),
  // but a future reader must not take 1.825 s for the length of the sound.
  const m = SOUNDS.triggers[2].measured;
  assert.equal(m.clipSec.hold0_25, 1.825);
  assert.equal(m.clipSec.hold3_0, 1.825);
  assert.equal(m.audibleSec, 0.7625);
  assert.equal(EFFECTS.boom.measured.audibleSec, m.audibleSec, "the two files disagree on boom");
  assert.ok(m.audibleSec < m.clipSec.hold0_25);
  assert.ok(EFFECTS.boom.durationSec < m.clipSec.hold0_25);
  // walk and jump have no such discrepancy: their clip IS their sound.
  assert.equal(EFFECTS.walk.measured.audibleSec, EFFECTS.walk.measured.clipSec);
  assert.equal(EFFECTS.jump.measured.audibleSec, EFFECTS.jump.measured.clipSec);
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
