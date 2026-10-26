// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for animateActorGroupGrowShrink (ROM 0x6566, Pooyan) — the fountain-record
 * animation step. While the flip countdown (0x892f) is nonzero it decrements it and
 * returns; on zero it advances the toggle (0x892c) and, by its new bit0, runs the shrink
 * (odd) half — step three mirrored records then render via the tile-copy helper — or the
 * grow (even) half — step the records then fall into an integrity sweep over the 0x82bc
 * mirror bank (throwing a tamper trap on a slot mismatch / bad checksum, never with
 * intact data).
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The
 * routine WRITES work RAM (and, on the shrink half, hands off to the tile-copy helper
 * which writes actor records), so every case runs the oracle on one fresh clone and the
 * module on another and compares on the go-forward contract:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * There is NO register live-out: the only caller tail-dispatches this handler and reloads
 * its own pointers afterward, so no register survives as an input to a successor. pc / sp
 * / cycles are deliberately not compared (the oracle drives them through the modelled
 * m.step/m.ret stack the direct-call layer replaces with a JS return).
 *
 * The oracle reaches the tile-copy helper through m.call(0x2514) (registry-dispatched to
 * the frozen copyDisplayTilesIntoActorRecords); the module calls the idiomatic copyDisplayTilesIntoActorRecords directly. Their memory
 * effects are identical by copyDisplayTilesIntoActorRecords's own gate, so the shrink half's RAM matches. sp is
 * seated inside STACK_SCRATCH so the oracle's push/ret land in dead RAM (excluded).
 *
 * Jobs:
 *   1. EQUAL (down-count) — (0x892f)!=0: module == oracle in RAM; only (0x892f) ticks down.
 *   2. EQUAL (even/ret-nc) — grow half with the record's +6 field at the cap so the sweep
 *      returns before touching the mirror bank; the record + toggle writes match.
 *   3. EQUAL (odd/render) — shrink half with divert cleared so the tile-copy helper just
 *      copies and returns; module == oracle across the whole render.
 *   4. WRITE-SET — the down-count path writes ONLY (0x892f); the even/ret-nc path writes
 *      exactly the toggle, the seed, and the mirrored +3/+4 fields.
 *   5. CRAFTED (even/full sweep) — on a fresh clone the mirror bank is inconsistent, so
 *      both sides take the SAME completion path (both throw the tamper trap).
 *   6. TEETH — a wrong seeded byte and a wrong-decrement twin are both CAUGHT by the RAM
 *      diff (a gate never seen failing proves nothing).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6566.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6566 as oracle } from "../../translated/loc_6566.js";
import { animateActorGroupGrowShrink } from "../animateActorGroupGrowShrink.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

// Cell/record addresses the routine touches (local to the test, mirroring the oracle listing).
const FLIP_COUNTDOWN = 0x892f; // decremented on the shallow path; reseeded 0x06/0x0c
const PHASE_TOGGLE = 0x892c;   // incremented on the deep path; bit0 selects the half
const SHARED_GATE = 0x8930;    // seeded 0x02 by the sweep prologue
const SHARED_COUNTDOWN = 0x892e;
const HUNTER_REC = 0x8c78;     // sweep record base (ix := here in the even half)
const HUNTER_CAP_FIELD = HUNTER_REC + 0x06; // +6 field; >=0x0c makes the sweep ret nc
const IX_REC = 0x8b00;         // input record base in observable work RAM
const DIVERT_A = 0x8df9;       // TAMPER_STRIKES_TERMINATOR — must be 0 for a shallow render
const DIVERT_B = 0x89e5;       // BOARD_CLEAR_FLAG — must be 0 for a shallow render

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** First RAM difference minus the stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with IX seated and a bag of cell pokes applied; sp parked in dead stack. */
function craft(pokes = {}) {
  const m = BASE.clone();
  m.regs.ix = IX_REC;
  m.regs.sp = 0x8fe0; // inside STACK_SCRATCH: the oracle's push16/ret read+write dead RAM
  for (const [addr, val] of Object.entries(pokes)) m.mem.write8(Number(addr), val);
  return m;
}

// -- 1. EQUAL (down-count) ----------------------------------------------------

test("EQUAL: (0x892f)!=0 shallow path — module == oracle in RAM (−stack)", () => {
  const o = craft({ [FLIP_COUNTDOWN]: 0x05 });
  const c = craft({ [FLIP_COUNTDOWN]: 0x05 });
  oracle(o);
  animateActorGroupGrowShrink(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  assert.equal(o.mem.read8(FLIP_COUNTDOWN), 0x04, "oracle decremented 5 -> 4");
  assert.equal(c.mem.read8(FLIP_COUNTDOWN), 0x04, "module decremented 5 -> 4");
  console.log("  EQUAL(down-count): (0x892f) 5 -> 4, RAM identical");
});

// -- 2. EQUAL (even / ret-nc) -------------------------------------------------

test("EQUAL: grow half with the sweep ret-nc taken — module == oracle in RAM (−stack)", () => {
  // 0x892c=1 -> inc -> 2 -> bit0 clear -> even; (ix+3)=0xff + (ix+8)=2 -> carry -> +4 inc block;
  // (0x8c7e)=0x0c so the sweep returns before writing the mirror bank.
  const pokes = { [FLIP_COUNTDOWN]: 0x00, [PHASE_TOGGLE]: 0x01, [IX_REC + 3]: 0xff, [IX_REC + 8]: 0x02, [HUNTER_CAP_FIELD]: 0x0c };
  const o = craft(pokes);
  const c = craft(pokes);
  oracle(o);
  animateActorGroupGrowShrink(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  assert.equal(o.mem.read8(FLIP_COUNTDOWN), 0x06, "even half seeds 0x06");
  assert.equal(o.mem.read8(IX_REC + 3), 0x01, "(ix+3) = 0xff + 2 = 0x01");
  assert.equal(o.mem.read8(IX_REC + 4), 0x01, "(ix+4) incremented on carry");
  assert.equal(o.mem.read8(HUNTER_REC + 0x10), c.mem.read8(HUNTER_REC + 0x10), "sweep body skipped (ret nc)");
  console.log("  EQUAL(even/ret-nc): record + toggle writes identical, sweep skipped");
});

// -- 3. EQUAL (odd / render) --------------------------------------------------

test("EQUAL: shrink half render — module == oracle in RAM (−stack)", () => {
  // 0x892c=0 -> inc -> 1 -> bit0 set -> odd; (ix+3)=0 - (ix+8)=1 -> borrow (dec +4 fields);
  // (ix+5)=5 - (ix+9)=3 -> no borrow. Divert cleared so the tile-copy helper just copies.
  const pokes = {
    [FLIP_COUNTDOWN]: 0x00, [PHASE_TOGGLE]: 0x00,
    [IX_REC + 3]: 0x00, [IX_REC + 8]: 0x01, [IX_REC + 5]: 0x05, [IX_REC + 9]: 0x03,
    [IX_REC + 4]: 0x10, [IX_REC + 4 - 0x18]: 0x10, [IX_REC + 4 - 0x30]: 0x10,
    [DIVERT_A]: 0x00, [DIVERT_B]: 0x00,
  };
  const o = craft(pokes);
  const c = craft(pokes);
  oracle(o);
  animateActorGroupGrowShrink(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  assert.equal(o.mem.read8(FLIP_COUNTDOWN), 0x0c, "odd half seeds 0x0c");
  assert.equal(o.mem.read8(IX_REC + 3), 0xff, "(ix+3) = 0 - 1 = 0xff");
  assert.equal(o.mem.read8(IX_REC + 4), 0x0f, "(ix+4) decremented 0x10 -> 0x0f on borrow");
  // The render copied source bytes into (ix+0x0f) and its two shadow records.
  assert.equal(o.mem.read8(IX_REC + 0x0f), c.mem.read8(IX_REC + 0x0f), "render wrote the base record tile identically");
  console.log("  EQUAL(odd/render): shrink + render RAM identical");
});

// -- 4. WRITE-SET -------------------------------------------------------------

function changedSet(before, after) {
  const b = before.dumpState();
  const a = after.dumpState();
  const set = new Map();
  for (let off = 0; off < b.length; off++) {
    if (b[off] !== a[off]) {
      const addr = after.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) set.set(addr, a[off]);
    }
  }
  return set;
}

test("WRITE-SET: down-count writes ONLY (0x892f); even/ret-nc writes toggle+seed+mirrored fields", () => {
  const bd = craft({ [FLIP_COUNTDOWN]: 0x05 });
  const ad = craft({ [FLIP_COUNTDOWN]: 0x05 });
  oracle(ad);
  const setD = changedSet(bd, ad);
  assert.deepEqual([...setD.keys()].sort(), [FLIP_COUNTDOWN], "down-count touches only (0x892f)");
  assert.equal(setD.get(FLIP_COUNTDOWN), 0x04, "(0x892f) 5 -> 4");

  const pokes = { [FLIP_COUNTDOWN]: 0x00, [PHASE_TOGGLE]: 0x01, [IX_REC + 3]: 0xff, [IX_REC + 8]: 0x02, [HUNTER_CAP_FIELD]: 0x0c };
  const be = craft(pokes);
  const ae = craft(pokes);
  oracle(ae);
  const setE = changedSet(be, ae);
  const expected = [
    PHASE_TOGGLE, FLIP_COUNTDOWN,
    IX_REC + 3, IX_REC + 3 - 0x18, IX_REC + 3 - 0x30,
    IX_REC + 4, IX_REC + 4 - 0x18, IX_REC + 4 - 0x30,
  ].sort((x, y) => x - y);
  assert.deepEqual([...setE.keys()].sort((x, y) => x - y), expected, "even/ret-nc write footprint");
  console.log(`  WRITE-SET: down-count={${hx(FLIP_COUNTDOWN)}}; even/ret-nc=${expected.length} cells`);
});

// -- 5. CRAFTED (even / full sweep) -------------------------------------------

test("CRAFTED: even full sweep — oracle and module take the same completion path (both throw)", () => {
  // 0x892c=1 -> even; (0x8c7e)=0 so the sweep runs; a fresh clone's mirror bank is
  // inconsistent, so the integrity guard throws on both sides.
  const pokes = { [FLIP_COUNTDOWN]: 0x00, [PHASE_TOGGLE]: 0x01, [HUNTER_CAP_FIELD]: 0x00 };
  const o = craft(pokes);
  const c = craft(pokes);
  let oThrew = false;
  let cThrew = false;
  try { oracle(o); } catch { oThrew = true; }
  try { animateActorGroupGrowShrink(c); } catch { cThrew = true; }
  assert.equal(oThrew, cThrew, "oracle and module must take the same completion path");
  // Compare RAM even when both throw: the grow-half reseed writes happen BEFORE the integrity throw,
  // so this is where the reseed footprint gets real teeth (a fresh clone throws on both sides).
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log(`  CRAFTED(full-sweep): same path (threw=${oThrew})`);
});

// -- 6. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded (0x892f) byte is CAUGHT by the RAM diff", () => {
  const pokes = { [FLIP_COUNTDOWN]: 0x00, [PHASE_TOGGLE]: 0x01, [IX_REC + 3]: 0xff, [IX_REC + 8]: 0x02, [HUNTER_CAP_FIELD]: 0x0c };
  const o = craft(pokes);
  const c = craft(pokes);
  oracle(o);
  animateActorGroupGrowShrink(c);
  c.mem.write8(FLIP_COUNTDOWN, 0x05); // BUG: grow half must seed 0x06, not 0x05
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong seed — it is worthless");
  assert.equal(d.addr, FLIP_COUNTDOWN, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(seed): wrong (0x892f) caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

/** Broken twin: decrements the flip countdown by 2 instead of 1 on the shallow path. */
function brokenDecrement(m) {
  const { mem8 } = m;
  mem8[FLIP_COUNTDOWN] = mem8[FLIP_COUNTDOWN] - 2; // BUG: must tick down by exactly 1
}

test("TEETH: a wrong-decrement twin on the shallow path is CAUGHT", () => {
  const o = craft({ [FLIP_COUNTDOWN]: 0x05 });
  const c = craft({ [FLIP_COUNTDOWN]: 0x05 });
  oracle(o);
  brokenDecrement(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong decrement — it is worthless");
  assert.equal(d.addr, FLIP_COUNTDOWN, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(decrement): 5->3 twin caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
