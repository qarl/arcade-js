// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawStyledSlotList -- when the guard flag is clear, walks seven slots and for each nonzero
// control byte caches it, splits the paired slot byte, and dispatches a draw handler. The idiomatic side
// dissolves jsr b5d7 into a direct call to the idiomatic dispatcher (seating X as the slot-index bridge the
// handlers read). Live-out is memory only, so each arm compares RAM (dumpState minus stack scratch below the entry SP).
// Run: node --test games/tempest/idiomatic/test/equivalence-b5ad.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b5ad } from "../../translated/loc_b5ad.js";
import { drawStyledSlotList } from "../drawStyledSlotList.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { SPIKE_ACTIVE_FLAG, SLOT_LOOP_INDEX, ENEMY_DEPTH, OBJ_DEPTH, ENEMY_SLOT_FLAGS, DRAW_STYLE } from "../names.js";

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
const oracle = atEntry(loc_b5ad);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0xb5ad dispatches -- drawStyledSlotList == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); drawStyledSlotList(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Guard clear and one slot armed: slot 3 has a nonzero control byte and a paired byte that
// yields style 0 and selector 4, so the walk caches the control byte and dispatches the handler.
function seedWalk(m) {
  m.mem.write8(SPIKE_ACTIVE_FLAG, 0x00); // guard clear (bit7 = 0) -> do not exit
  for (let i = 0; i <= 6; i++) {
    m.mem.write8((ENEMY_DEPTH + i) & 0xffff, 0x00); // all slots idle...
    m.mem.write8((ENEMY_SLOT_FLAGS + i) & 0xffff, 0x00);
  }
  m.mem.write8((ENEMY_DEPTH + 3) & 0xffff, 0x08); // ...except slot 3 armed
  m.mem.write8((ENEMY_SLOT_FLAGS + 3) & 0xffff, 0x02); // style nibble 0, selector 4
}

test("CRAFTED: armed slot -- control byte cached and RAM matches the oracle", () => {
  const o = new Machine(ROM, OPTS); seedWalk(o);
  const c = new Machine(ROM, OPTS); seedWalk(c);
  oracle(o); drawStyledSlotList(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the walk");
  assert.equal(c.mem.read8(OBJ_DEPTH), 0x08, "control byte cached into $57");
  assert.equal(c.mem.read8(DRAW_STYLE), o.mem.read8(DRAW_STYLE), "$55 matches the oracle (a dispatched draw handler leaves the final value)");
  assert.equal(c.mem.read8(SLOT_LOOP_INDEX), 0xff, "loop counter decremented past 0 to 0xff at exit");
});

test("TEETH: a twin that skips caching + dispatch diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedWalk(o);
  const c = new Machine(ROM, OPTS); seedWalk(c);
  oracle(o);
  const brokenB5ad = (m) => { m.mem8[SLOT_LOOP_INDEX] = 0x00; /* BUG: never caches $57 nor dispatches a draw */ };
  brokenB5ad(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped walk");
});

test("TEETH-GUARD: guard flag set -- oracle and idiomatic both early-out identically", () => {
  const seed = (m) => { m.mem.write8(SPIKE_ACTIVE_FLAG, 0x80); };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); drawStyledSlotList(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the guarded early-out");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seedWalk(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, drawStyledSlotList, TARGET, m);
  assert.equal(r.placeable, true, `drawStyledSlotList must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret caller (moved 0) placeable");
});
