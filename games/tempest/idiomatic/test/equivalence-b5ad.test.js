// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_b5ad -- when the guard flag is clear, walks seven slots and for each nonzero
// control byte caches it, splits the paired slot byte, and dispatches a draw handler. The idiomatic side
// dissolves jsr b5d7 into a direct call to the idiomatic dispatcher (seating X as the slot-index bridge the
// handlers read). Live-out is memory only, so each arm compares RAM (dumpState minus STACK_SCRATCH).
// Run: node --test games/tempest/idiomatic/test/equivalence-b5ad.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b5ad as oracle } from "../../translated/loc_b5ad.js";
import { loc_b5ad } from "../loc_b5ad.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, loc_106, loc_37, loc_2df, loc_57, loc_283, loc_55 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xb5ad;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0xb5ad dispatches -- loc_b5ad == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); loc_b5ad(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Guard clear and one slot armed: slot 3 has a nonzero control byte and a paired byte that
// yields style 0 and selector 4, so the walk caches the control byte and dispatches the handler.
function seedWalk(m) {
  m.mem.write8(loc_106, 0x00); // guard clear (bit7 = 0) -> do not exit
  for (let i = 0; i <= 6; i++) {
    m.mem.write8((loc_2df + i) & 0xffff, 0x00); // all slots idle...
    m.mem.write8((loc_283 + i) & 0xffff, 0x00);
  }
  m.mem.write8((loc_2df + 3) & 0xffff, 0x08); // ...except slot 3 armed
  m.mem.write8((loc_283 + 3) & 0xffff, 0x02); // style nibble 0, selector 4
}

test("CRAFTED: armed slot -- control byte cached and RAM matches the oracle", () => {
  const o = new Machine(ROM, OPTS); seedWalk(o);
  const c = new Machine(ROM, OPTS); seedWalk(c);
  oracle(o); loc_b5ad(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the walk");
  assert.equal(c.mem.read8(loc_57), 0x08, "control byte cached into $57");
  assert.equal(c.mem.read8(loc_55), o.mem.read8(loc_55), "$55 matches the oracle (a dispatched draw handler leaves the final value)");
  assert.equal(c.mem.read8(loc_37), 0xff, "loop counter decremented past 0 to 0xff at exit");
});

test("TEETH: a twin that skips caching + dispatch diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedWalk(o);
  const c = new Machine(ROM, OPTS); seedWalk(c);
  oracle(o);
  const brokenB5ad = (m) => { m.mem8[loc_37] = 0x00; /* BUG: never caches $57 nor dispatches a draw */ };
  brokenB5ad(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped walk");
});

test("TEETH-GUARD: guard flag set -- oracle and idiomatic both early-out identically", () => {
  const seed = (m) => { m.mem.write8(loc_106, 0x80); };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); loc_b5ad(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the guarded early-out");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seedWalk(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, loc_b5ad, TARGET, m);
  assert.equal(r.placeable, true, `loc_b5ad must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret caller (moved 0) placeable");
});
