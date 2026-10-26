// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitHalvedCountHeaderAndClearVectorSlots -- emits a header word via emitTaggedVectorWord (Y = $50>>1, A=0x68), then always
// continues into emitVectorHeaderAndClearSlots (the gate byte 0x33 is a constant nonzero). Dissolves both m.calls into direct
// idiomatic calls. The oracle m.calls the frozen df4c/db88; the idiomatic calls the idiomatic ones. Output
// is the vector fill from df4c and db88's df39 word (RAM), so each arm compares the RAM diff (minus the
// dead stack). A/X/Y at RTS incidental. Run: node --test games/tempest/idiomatic/test/equivalence-db6f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_db6f } from "../../translated/loc_db6f.js";
import { emitHalvedCountHeaderAndClearVectorSlots } from "../emitHalvedCountHeaderAndClearVectorSlots.js";
import { emitTaggedVectorWord } from "../emitTaggedVectorWord.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { SPINNER_ACCUM } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xdb6f;
const oracle = atEntry(loc_db6f);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

const seat = (m, s = {}) => { m.mem.write8(SPINNER_ACCUM, s.slots ?? 0x00); };

test("CAPTURE: real 0xdb6f dispatches -- emitHalvedCountHeaderAndClearVectorSlots == oracle in RAM (-stack, poly frozen)", () => {
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    oracle(o); emitHalvedCountHeaderAndClearVectorSlots(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: several $50 counts -> df4c header + db88 fill == oracle (RAM)", () => {
  for (const slots of [0x00, 0x0a, 0x1e, 0xff]) {
    const o = freezePokey(new Machine(ROM, OPTS)); seat(o, { slots });
    const c = freezePokey(new Machine(ROM, OPTS)); seat(c, { slots });
    oracle(o); emitHalvedCountHeaderAndClearVectorSlots(c);
    assert.equal(ramDiff(o, c), null, `slots=${slots}`);
  }
});

test("TEETH: a twin that stops after df4c (skips db88's word/clear) diverges", () => {
  const s = { slots: 0x1e };
  const o = freezePokey(new Machine(ROM, OPTS)); seat(o, s);
  const c = freezePokey(new Machine(ROM, OPTS)); seat(c, s);
  oracle(o);
  // BUG: emits the header but never runs the db88 continuation.
  const broken = (m) => { emitTaggedVectorWord(m, 0x68, m.mem8[SPINNER_ACCUM] >> 1); };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped db88 continuation");
});

test("SP-TOOTH: the omitted-ret tail-caller is seam-placeable", () => {
  const m = freezePokey(new Machine(ROM, OPTS));
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, emitHalvedCountHeaderAndClearVectorSlots, TARGET, m);
  assert.equal(r.placeable, true, `emitHalvedCountHeaderAndClearVectorSlots must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret tail-caller placeable");
});
