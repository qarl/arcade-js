// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence + skip-dissolution gate for scanTargetSlotsAndSpawnOnProximityHit (Pooyan) — the per-slot proximity scan.
 *
 * scanTargetSlotsAndSpawnOnProximityHit is a CALLER-SKIP in the frozen layer: on a hit it spawns and then `pop af; ret`, a skip
 * that aborts its caller's caller; with no hit the loop runs out and it plain-`ret`s. The idiomatic
 * module DISSOLVES that: it returns a JS boolean — true = the plain-ret / exhausted path, false =
 * the pop-af skip / hit path — and the caller early-returns on false instead of unwinding the stack.
 *
 * This gate checks both halves:
 *   1. RAM-equivalence (dumpState minus stack scratch below the entry SP): a fresh clone per side, oracle on one and
 *      scanTargetSlotsAndSpawnOnProximityHit on the other, identical over empty / hit-I0 / hit-I1(negate) / dx-reject / dy-reject
 *      / two-slot-then-hit cases. pc/SP/cycles are NOT compared — the oracle drives SP through the
 *      modelled pushes/pops the dissolution drops, so those land in STACK_SCRATCH and are excluded.
 *   2. BOOLEAN-vs-oracle-path: the oracle's SP movement tells which path it took (a plain ret pops
 *      one word, sp 0x8ffe -> 0x9000; the pop-af skip pops two, sp -> 0x9002). The module's returned
 *      boolean must be true exactly when the oracle took the plain-ret path.
 *
 * INPUTS: IX (coordinate slots, stride 4, X at +0 / Y at +2), B (slot count), HL (record list,
 * stride 0x18, presence byte at +0), IY (actor box, X at +0 / Y at +2), I (interrupt register — its
 * parity picks OBJ_HIT_FLAG_I0 vs _I1), and FLIP_SCREEN_FLAG (picks the +5 / -2 X bias). All bases
 * are isolated work-RAM; the spawn tile + display command land on the command rings (callee domain).
 *
 * Jobs: EQUAL, BOOLEAN (tied to the oracle SP path), WRITE-SET (the hit footprint), TEETH (a wrong
 * written byte caught by the RAM diff; a wrong boolean caught by the path check).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-638a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_638a as oracle } from "../../translated/loc_638a.js";
import { scanTargetSlotsAndSpawnOnProximityHit } from "../scanTargetSlotsAndSpawnOnProximityHit.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, FLIP_SCREEN_FLAG, OBJ_HIT_FLAG_I0, OBJ_HIT_FLAG_I1 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const IX_REC = 0x8b00; //  coordinate slots (X at +0, Y at +2), stride 4
const HL_REC = 0x8c00; //  record list (presence at +0), stride 0x18
const IY_BOX = 0x8e00; //  actor box (X at +0, Y at +2)
const SP_ENTRY = 0x8ffe; // stack in STACK_SCRATCH; the oracle's pushes/pops stay inside it
const REC_STRIDE = 0x18;
const COORD_STRIDE = 0x04;
const ANIM_LO = 0xfb; //   the spawn animation pointer 0x63fb, low / high
const ANIM_HI = 0x63;
const HUNTER_CMD_HI = 0x03; // the queued spawn display command 0x0315, high byte

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP_ENTRY);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the scan's register inputs, flip flag, coord slots and record presence seated. */
function craft(spec) {
  const m = BASE.clone();
  m.regs.sp = SP_ENTRY;
  m.regs.ix = IX_REC;
  m.regs.hl = HL_REC;
  m.regs.iy = IY_BOX;
  m.regs.b = spec.count & 0xff;
  m.regs.i = (spec.ireg ?? 0x00) & 0xff;
  m.mem8[FLIP_SCREEN_FLAG] = (spec.flip ?? 0x01) & 0xff;
  for (let i = 0; i < (spec.slots ?? []).length; i++) {
    const s = spec.slots[i];
    m.mem8[HL_REC + i * REC_STRIDE] = (s.present ?? 0x00) & 0xff; // presence byte
    m.mem8[IX_REC + i * COORD_STRIDE + 0] = (s.x ?? 0x00) & 0xff;
    m.mem8[IX_REC + i * COORD_STRIDE + 2] = (s.y ?? 0x00) & 0xff;
  }
  m.mem8[IY_BOX + 0] = (spec.boxX ?? 0x00) & 0xff;
  m.mem8[IY_BOX + 2] = (spec.boxY ?? 0x00) & 0xff;
  return m;
}

// flip=1 -> slot X biased +5, so slotX = x+5; slotY = y+8. A hit needs |boxX - slotX| < 6 and
// |(boxY+8) - slotY| = |boxY - y| < 6. flip=0 biases X by -2 (0xfe).
const CASES = [
  { name: "empty slot -> exhaust -> normal(true)", expectHit: false, count: 1,
    slots: [{ present: 0x00 }], flip: 1, boxX: 0x15, boxY: 0x22 },
  { name: "HIT I==0 -> skip(false), flag I0", expectHit: true, count: 1, ireg: 0x00, flip: 1,
    slots: [{ present: 0x01, x: 0x10, y: 0x20 }], boxX: 0x15, boxY: 0x22 },
  { name: "HIT I!=0 (negate path) -> skip(false), flag I1", expectHit: true, count: 1, ireg: 0x01, flip: 0,
    slots: [{ present: 0x01, x: 0x30, y: 0x10 }], boxX: 0x2e, boxY: 0x0e },
  { name: "dx reject -> exhaust -> normal(true)", expectHit: false, count: 1, flip: 1,
    slots: [{ present: 0x01, x: 0x10, y: 0x20 }], boxX: 0x40, boxY: 0x22 },
  { name: "dy reject -> exhaust -> normal(true)", expectHit: false, count: 1, flip: 1,
    slots: [{ present: 0x01, x: 0x10, y: 0x20 }], boxX: 0x15, boxY: 0x40 },
  { name: "two-slot: 1st dx-reject, 2nd HIT -> skip(false)", expectHit: true, count: 2, ireg: 0x00, flip: 1,
    slots: [{ present: 0x01, x: 0x50, y: 0x20 }, { present: 0x01, x: 0x10, y: 0x20 }], boxX: 0x15, boxY: 0x22 },
];

/** true if the oracle exited via the plain-ret path (one pop); false if it took the pop-af skip. */
function oracleNormalPath(o) {
  return ((o.regs.sp - SP_ENTRY) & 0xffff) === 2;
}

// -- 1. EQUAL + 2. BOOLEAN-vs-oracle-path -------------------------------------

test("EQUAL + BOOLEAN: scanTargetSlotsAndSpawnOnProximityHit == oracle in RAM (−stack), and its boolean matches the oracle path", () => {
  for (const spec of CASES) {
    const o = craft(spec);
    oracle(o);
    const c = craft(spec);
    const ret = scanTargetSlotsAndSpawnOnProximityHit(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${spec.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);

    const normal = oracleNormalPath(o);
    assert.equal(normal, !spec.expectHit, `[${spec.name}] oracle SP path disagrees with the crafted intent`);
    assert.equal(ret, normal, `[${spec.name}] module boolean ${ret} must equal the oracle's normal-path ${normal}`);
  }
  console.log(`  EQUAL+BOOLEAN: ${CASES.length} cases identical (RAM −stack) with boolean == oracle path`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a hit stamps the record, its parity flag, the anim pointer and frame reset", () => {
  const i0 = craft(CASES[1]); // I==0
  oracle(i0);
  assert.equal(i0.mem8[HL_REC + 0x00], 0x00, "state byte 0");
  assert.equal(i0.mem8[HL_REC + 0x01], 0x01, "state byte 1");
  assert.equal(i0.mem8[HL_REC + 0x02], 0x02, "state byte 2");
  assert.equal(i0.mem8[HL_REC + 0x11], 0x28, "teardown countdown");
  assert.equal(i0.mem8[HL_REC + 0x0c], ANIM_LO, "anim pointer low");
  assert.equal(i0.mem8[HL_REC + 0x0d], ANIM_HI, "anim pointer high");
  assert.equal(i0.mem8[HL_REC + 0x0e], 0x00, "anim frame index reset");
  assert.equal(i0.mem8[OBJ_HIT_FLAG_I0], 0x01, "I==0: flag I0 set");
  assert.equal(i0.mem8[OBJ_HIT_FLAG_I1], 0x00, "I==0: partner flag I1 clear");

  const i1 = craft(CASES[2]); // I!=0
  oracle(i1);
  assert.equal(i1.mem8[OBJ_HIT_FLAG_I1], 0x01, "I!=0: flag I1 set");
  assert.equal(i1.mem8[OBJ_HIT_FLAG_I0], 0x00, "I!=0: partner flag I0 clear");
  console.log(`  WRITE-SET: record 0/1/2/0x11 + anim 0x0c..0x0e + parity hit flag; cmd hi=${hx(HUNTER_CMD_HI)}`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH/RAM: a wrong stamped byte is CAUGHT by the RAM diff", () => {
  const spec = CASES[1];
  const o = craft(spec);
  const c = craft(spec);
  oracle(o);
  scanTargetSlotsAndSpawnOnProximityHit(c);
  c.mem8[HL_REC + 0x11] = 0x00; // BUG: the teardown countdown must be 0x28

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong stamped byte — it is worthless");
  assert.equal(d.addr, HL_REC + 0x11, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong countdown caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH/BOOL: a boolean that disagrees with the oracle skip path is CAUGHT", () => {
  const spec = CASES[1]; // a hit -> oracle takes the pop-af skip -> module must return false
  const o = craft(spec);
  oracle(o);
  const normal = oracleNormalPath(o);
  assert.equal(normal, false, "sanity: a hit is the pop-af skip path (not the plain ret)");
  const brokenTwinReturn = true; // BUG: a twin that returns the normal path on a hit
  assert.notEqual(brokenTwinReturn, normal, "the boolean check must reject a twin that returns true on a hit");
  console.log(`  TEETH/BOOL: a true-on-hit twin is rejected (oracle normal-path=${normal})`);
});
