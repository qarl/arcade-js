// SPDX-License-Identifier: GPL-3.0-only
//
// Consistency gate for the Donkey Kong sound-command map.
//
// This test CANNOT verify that the map is CORRECT -- correctness lives in the
// MAME citations and write traces documented in ../audio/README.md, and the
// honest parts of the map are explicitly marked `inferred`. What it CAN do is
// stop the map from becoming incoherent: a duplicate name silently shadowing a
// sample, a trigger index outside the ls259.6h's eight bits, a typo'd
// confidence level that quietly reads as "known" to a downstream player.
//
// The allowed vocabularies are RESTATED here rather than imported from the map,
// on purpose. Importing them would make the check circular -- the module would
// be validated against its own opinion. They are also compared against the
// module's exported lists, so a deliberate widening has to be made in both
// places.
//
// Needs no ROM and no audio device, so it runs on any clone.

import test from "node:test";
import assert from "node:assert/strict";
import { SOUNDS, PORTS, KINDS, SOURCES, CONFIDENCE, BEHAVIOURS } from "../audio/sounds.js";

// Independent restatement of the vocabularies (see header).
const ALLOWED_KIND = ["oneshot", "loop", "none"];
const ALLOWED_SOURCE = ["discrete", "i8035", "none"];
const ALLOWED_CONFIDENCE = ["confirmed", "inferred", "unknown"];
const ALLOWED_BEHAVIOUR = ["level", "level+decay", "oneshot", "silent", null];

/** Every entry in the map, as [where, entry] pairs. */
function allEntries() {
  const out = [];
  for (const [k, v] of Object.entries(SOUNDS.triggers)) out.push([`triggers[${k}]`, v]);
  for (const [k, v] of Object.entries(SOUNDS.latch)) {
    out.push([`latch[0x${Number(k).toString(16).padStart(2, "0")}]`, v]);
  }
  out.push(["irq", SOUNDS.irq]);
  return out;
}

test("the exported vocabularies match this test's independent restatement", () => {
  assert.deepEqual([...KINDS].sort(), [...ALLOWED_KIND].sort());
  assert.deepEqual([...SOURCES].sort(), [...ALLOWED_SOURCE].sort());
  assert.deepEqual([...CONFIDENCE].sort(), [...ALLOWED_CONFIDENCE].sort());
  assert.deepEqual(new Set(BEHAVIOURS), new Set(ALLOWED_BEHAVIOUR));
});

test("ports name the three sound-side write surfaces", () => {
  assert.equal(PORTS.latch, 0x7c00); // ls175.3d
  assert.equal(PORTS.triggerBase, 0x7d00); // ls259.6h
  assert.equal(PORTS.triggerCount, 8);
  assert.equal(PORTS.irq, 0x7d80);
  assert.equal(SOUNDS.ports, PORTS);
});

test("every entry has a non-empty name and the three classification fields", () => {
  const entries = allEntries();
  assert.ok(entries.length > 0, "the map is empty");
  for (const [where, e] of entries) {
    assert.equal(typeof e, "object", `${where} is not an object`);
    assert.equal(typeof e.name, "string", `${where} has no name`);
    assert.ok(e.name.length > 0, `${where} has an empty name`);
    assert.ok(ALLOWED_KIND.includes(e.kind), `${where} kind=${e.kind}`);
    assert.ok(ALLOWED_SOURCE.includes(e.source), `${where} source=${e.source}`);
    assert.ok(
      ALLOWED_CONFIDENCE.includes(e.confidence),
      `${where} confidence=${e.confidence}`,
    );
  }
});

test("names are unique across triggers, latch values and the IRQ", () => {
  const seen = new Map();
  for (const [where, e] of allEntries()) {
    assert.ok(!seen.has(e.name), `duplicate name '${e.name}': ${seen.get(e.name)} and ${where}`);
    seen.set(e.name, where);
  }
});

test("trigger indices are exactly the ls259.6h's eight bits, 0-7", () => {
  const keys = Object.keys(SOUNDS.triggers).map(Number);
  assert.deepEqual([...keys].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
  for (const k of keys) {
    assert.ok(Number.isInteger(k), `trigger key ${k} is not an integer`);
    assert.ok(k >= 0 && k < PORTS.triggerCount, `trigger index ${k} out of range`);
  }
});

test("latch keys cover the ls175.3d's whole 4-bit range, 0x00-0x0F", () => {
  const keys = Object.keys(SOUNDS.latch).map(Number);
  assert.deepEqual(
    [...keys].sort((a, b) => a - b),
    Array.from({ length: 16 }, (_, i) => i),
  );
});

test("only bits 0-2 are discrete; every other sound comes from the I8035", () => {
  // The whole point of the map: dkong_a.cpp:1322-1350 routes ls259.6h bits 0/1/2
  // to the discrete netlist and bits 3/4/5 to sound-CPU input pins. Getting this
  // backwards is the mistake that decides whether a sample can be extracted.
  for (const [k, e] of Object.entries(SOUNDS.triggers)) {
    const bit = Number(k);
    if (bit <= 2) assert.equal(e.source, "discrete", `trigger ${bit} should be discrete`);
    else if (bit <= 5) assert.equal(e.source, "i8035", `trigger ${bit} should be i8035`);
    else assert.equal(e.source, "none", `trigger ${bit} is unused on this board`);
  }
  for (const [k, e] of Object.entries(SOUNDS.latch)) {
    assert.equal(e.source, "i8035", `latch 0x${Number(k).toString(16)} should be i8035`);
  }
  assert.equal(SOUNDS.irq.source, "i8035");
});

test("a 'none' kind is only used for lines that make no sound, and vice versa", () => {
  for (const [where, e] of allEntries()) {
    if (e.kind === "none") {
      assert.ok(
        e.source === "none" || e.name === "silence",
        `${where} has kind 'none' but claims to produce a sound`,
      );
    }
    if (e.source === "none") {
      assert.equal(e.kind, "none", `${where} has no source but a real kind`);
    }
  }
});

test("every entry carries provenance: a note or fires description, and evidence", () => {
  for (const [where, e] of allEntries()) {
    assert.ok(
      typeof e.fires === "string" && e.fires.length > 0,
      `${where} does not say when it fires`,
    );
    assert.ok(Array.isArray(e.evidence), `${where} has no evidence array`);
    assert.ok(e.evidence.length > 0, `${where} has an empty evidence array`);
    for (const cite of e.evidence) {
      assert.equal(typeof cite, "string", `${where} has a non-string citation`);
      assert.ok(cite.length > 0, `${where} has an empty citation`);
    }
  }
});

test("nothing is marked 'confirmed' without at least two citations", () => {
  // 'confirmed' in this map means MAME source AND an observed write trace (or an
  // unambiguous ROM site plus a trace). One citation is not that.
  for (const [where, e] of allEntries()) {
    if (e.confidence !== "confirmed") continue;
    assert.ok(
      e.evidence.length >= 2,
      `${where} is 'confirmed' on ${e.evidence.length} citation(s)`,
    );
  }
});

test("every entry carries a measured block, distinct from the ROM-usage `kind`", () => {
  // `kind` says how the ROM USES a command; `measured` says what the hardware
  // DOES when it is driven. Conflating them is what produces a wrong player --
  // e.g. walk is a 3-frame ROM pulse (kind oneshot) but LEVEL-driven hardware.
  for (const [where, e] of allEntries()) {
    assert.equal(typeof e.measured, "object", `${where} has no measured block`);
    assert.notEqual(e.measured, null, `${where} measured is null, not a block`);
    assert.ok(
      e.measured.audible === true || e.measured.audible === false || e.measured.audible === null,
      `${where} measured.audible=${e.measured.audible} (true|false|null)`,
    );
    assert.ok(
      ALLOWED_BEHAVIOUR.includes(e.measured.behaviour),
      `${where} measured.behaviour=${e.measured.behaviour}`,
    );
    // A line measured silent must not also be measured with a behaviour that
    // implies audio, and vice versa.
    if (e.measured.audible === false) {
      assert.equal(e.measured.behaviour, "silent", `${where} is silent but has a behaviour`);
    }
    if (e.measured.behaviour === "silent") {
      assert.equal(e.measured.audible, false, `${where} behaves silent but claims audio`);
    }
  }
});

test("a measured-silent entry never claims a sound without flagging the conflict", () => {
  // Measurement alone cannot name a sound, so it cannot lower a name's
  // confidence -- but an entry that is BOTH named as a sound AND measured
  // silent is a contradiction, and must carry an explicit `conflict` string
  // rather than quietly picking a side. (0x0A / bgm_75m is the live case.)
  for (const [where, e] of allEntries()) {
    if (e.measured.audible !== false) continue;
    if (e.source === "none" || e.name === "silence") continue; // legitimately soundless
    assert.equal(
      typeof e.conflict,
      "string",
      `${where} is named as a sound but measured silent, with no conflict noted`,
    );
    assert.ok(e.conflict.length > 0, `${where} has an empty conflict note`);
  }
});

test("the discrete lines are the ones measured audible without the sound CPU", () => {
  // Sanity: the three discrete bits and the six audible trigger bits agree with
  // the sweep's headline result -- 6 of 8 make sound, bits 6 and 7 do not.
  const audible = Object.values(SOUNDS.triggers).filter((e) => e.measured.audible === true);
  assert.equal(audible.length, 6);
  assert.equal(SOUNDS.triggers[6].measured.audible, false);
  assert.equal(SOUNDS.triggers[7].measured.audible, false);
});

test("at least one entry is still marked inferred -- the map is honest about its gaps", () => {
  // A guard against a future edit that upgrades everything to 'confirmed' without
  // new captures. Seven tune values have never been observed in a trace; see
  // games/dkong/audio/README.md. If a tape ever reaches them, delete this test
  // deliberately rather than letting it rot.
  const inferred = allEntries().filter(([, e]) => e.confidence === "inferred");
  assert.ok(inferred.length > 0, "no inferred entries -- was every gap actually closed?");
});
