// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for loc_c7bd (ROM 0xc7bd-0xc7d9) -- a DSW-gated RTS-trick dispatcher: when (loc_d00 & 0x83)
// == 0x82 it returns immediately; otherwise it runs a pre-pass (loc_a7d2), sets bit7 of loc_4e, and
// rts-dispatches to word($c7da+loc_00)+1. The table has 19 entries (idx0..18); idx6 is an unused slot
// (ROM word 0x0000 -> a jump into RAM, never validly selected). The idiomatic form dissolves the trick
// into TABLE[loc_00>>1](m). Contract: RAM (dumpState minus STACK_SCRATCH). loc_d00 is the read-only DSW1
// port (driven via m.io.dsw1); a handler reaches the clock-coupled POKEY RANDOM so CAPTURE freezes it.
// Run: node --test games/tempest/idiomatic/test/equivalence-c7bd.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c7bd as oracle } from "../../translated/loc_c7bd.js";
import { loc_c7bd } from "../loc_c7bd.js";
import { loc_c90c } from "../loc_c90c.js";
import { loc_c940 } from "../loc_c940.js";
import { loc_970b } from "../loc_970b.js";
import { loc_c9af } from "../loc_c9af.js";
import { loc_c9f1 } from "../loc_c9f1.js";
import { loc_c800 } from "../loc_c800.js";
import { loc_c98c } from "../loc_c98c.js";
import { loc_ac3f } from "../loc_ac3f.js";
import { loc_ad6e } from "../loc_ad6e.js";
import { loc_ca18 } from "../loc_ca18.js";
import { loc_9149, loc_9108 } from "../loc_90c4.js";
import { loc_904b } from "../loc_904b.js";
import { loc_b0e7 } from "../loc_b0e7.js";
import { loc_c97b } from "../loc_c97b.js";
import { loc_9729 } from "../loc_9729.js";
import { loc_d7e1 } from "../loc_d7e1.js";
import { loc_a618 } from "../loc_a618.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, loc_00, loc_4e } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xc7bd;
const GARBAGE_IDX = 6; // the only unused slot (ROM word 0x0000)
const TABLE = [
  loc_c90c, loc_c940, loc_970b, loc_c9af, loc_c9f1, loc_c800, null, loc_c98c, loc_ac3f, loc_ad6e,
  loc_ca18, loc_9149, loc_904b, loc_b0e7, loc_9108, loc_c97b, loc_9729, loc_d7e1, loc_a618,
];
const OFFSETS = TABLE.map((t, idx) => (t ? idx * 2 : -1)).filter((o) => o >= 0);
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0xc7bd dispatches -- loc_c7bd == oracle in RAM (-stack)", () => {
  let checked = 0, skippedGarbage = 0;
  for (const cap of CAPS) {
    // Only the genuine idx6 garbage slot is skipped (there the oracle jumps into RAM); the coinage gate
    // (loc_d00 & 0x83)==0x82 short-circuits before the dispatch and is compared normally.
    if ((cap.io.readDsw1() & 0x83) !== 0x82 && (cap.mem.read8(loc_00) >> 1) === GARBAGE_IDX) { skippedGarbage++; continue; }
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue; // a real dispatch may reach an unimplemented handler arm; POKEY RANDOM frozen
    loc_c7bd(c);
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} compared (${skippedGarbage} idx6-garbage skipped)`);
});

test("GATE: (DSW1 & 0x83)==0x82 -> early return, no dispatch (loc_4e bit7 untouched)", () => {
  const o = new Machine(ROM, OPTS); o.io.dsw1 = 0x82; o.mem.write8(loc_4e, 0x00);
  const c = new Machine(ROM, OPTS); c.io.dsw1 = 0x82; c.mem.write8(loc_4e, 0x00);
  oracle(o); loc_c7bd(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the gated (no-dispatch) path");
  assert.equal(c.mem.read8(loc_4e) & 0x80, 0, "gate closed: the dispatch (and its loc_4e bit7 set) did not run");
});

test("CRAFTED: each live entry offset -> loc_c7bd == oracle in RAM (gate open); skip on oracle throw", () => {
  let checked = 0;
  for (const off of OFFSETS) {
    const o = freezePokey(new Machine(ROM, OPTS)); o.io.dsw1 = 0x00; o.mem.write8(loc_00, off);
    const c = freezePokey(new Machine(ROM, OPTS)); c.io.dsw1 = 0x00; c.mem.write8(loc_00, off);
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue; // a handler the generic seed cannot provision
    loc_c7bd(c);
    assert.equal(ramDiff(o, c), null, `RAM equal after dispatching offset ${off}`);
    checked++;
  }
  console.log(`  CRAFTED: ${checked}/${OFFSETS.length} entries provisioned and checked`);
  assert.ok(checked >= 1, "no entry could be provisioned -- seed is inert");
});

test("TEETH: a twin that dispatches the WRONG entry (off>>1)^1 diverges in RAM", () => {
  let caught = false, tried = 0;
  for (const off of OFFSETS) {
    const o = freezePokey(new Machine(ROM, OPTS)); o.io.dsw1 = 0x00; o.mem.write8(loc_00, off);
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue;
    const idx = off >> 1, flipped = idx ^ 1;
    if (flipped >= TABLE.length || !TABLE[flipped]) continue;
    const c = freezePokey(new Machine(ROM, OPTS)); c.io.dsw1 = 0x00; c.mem.write8(loc_00, off);
    let brokeThrew = false;
    try { c.mem.write8(loc_4e, c.mem.read8(loc_4e) | 0x80); TABLE[flipped](c); } catch { brokeThrew = true; }
    if (brokeThrew) continue;
    tried++;
    if (ramDiff(o, c) !== null) { caught = true; break; }
  }
  assert.ok(tried > 0, "no entry pair could be exercised for the teeth arm");
  assert.ok(caught, "the RAM diff FAILED to catch a wrong-entry dispatch on every exercised pair");
});

test("SP-TOOTH: the omitted-ret dispatcher is seam-placeable", () => {
  const m = freezePokey(new Machine(ROM, OPTS)); m.io.dsw1 = 0x00; m.mem.write8(loc_00, 0x04); // -> loc_970b
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, loc_c7bd, TARGET, m);
  assert.equal(r.placeable, true, `loc_c7bd must be seam-placeable; got: ${r.error}`);
});
