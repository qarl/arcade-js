// SPDX-License-Identifier: GPL-3.0-only
// also gates: 0x2e9d advanceHeadOrientationAndStampTile
// Memory-equivalence for the loc_2e94 ROM body (0x2e94-0x2ec5), which has TWO entries that the frozen
// oracle dispatches on m.pc:
//   * 0x2e9d -> advanceHeadOrientationAndStampTile: every 4th tick rotate the head orientation $40, then
//     resolve the faced tile (via resolveTileCellAtXY / oracle jsr $2c2b) and, only when the cell is in
//     [0x3c,0x40), stamp a masked marker back through the ($32) pointer.  <- the module's MAIN fn.
//   * 0x2e94 -> guardHeadOrientationWrap: unfold the caller's A (EOR $ef); >= 0xfa returns (no-op), else
//     re-seed the wave state (oracle jmp $20e8 == idiomatic seedWaveState).
// Both idiomatic fns OMIT the ROM ret; the seam completes them. The advance body's internal jsr $2c2b is
// balanced (push16 then the sub's ret), so it is SP-neutral; the idiomatic side calls resolveTileCellAtXY
// directly. All guest-stack traffic falls inside STACK_SCRATCH and is excluded from the RAM diff.
// Run: node --test games/centiped/idiomatic/test/equivalence-2e94.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2e94 as oracle } from "../../translated/loc_2e94.js";
import { advanceHeadOrientationAndStampTile, guardHeadOrientationWrap } from "../advanceHeadOrientation.js";
import { resolveTileCellAtXY } from "../resolveTileCellAtXY.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, loc_00, TILEMAP_PTR_LO, loc_40, loc_70, loc_8b, loc_ef } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const ADVANCE = 0x2e9d; // the per-tick entry the oracle takes when m.pc === 0x2e9d
const GUARD = 0x2e94; // the wrap-guard entry (any pc != 0x2e9d)
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

// Run the oracle down the advance arm (pc == 0x2e9d) vs the idiomatic advance fn.
const oracleAdvance = (m) => { m.pc = ADVANCE; return oracle(m); };
// Run the oracle down the wrap-guard arm (pc != 0x2e9d) vs the idiomatic guard fn.
const oracleGuard = (m) => { m.pc = GUARD; return oracle(m); };

// Discover the ($32) tile-cell address a given $70 resolves to (with $8b=0, y=0); the pointer is a pure
// function of $70/$8b, independent of the cell's content, so we can pre-seat the pointed cell on both sides.
function pointerFor(x) {
  const p = new Machine(ROM);
  p.mem8[loc_8b] = 0x00;
  resolveTileCellAtXY(p, x, 0x00);
  return p.mem16[TILEMAP_PTR_LO];
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const grab = (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); };
  const snap = new Map([[ADVANCE, grab], [GUARD, grab]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real loc_2e94 dispatches == idiomatic in RAM (-stack), routed by entry pc", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    if (cap.pc === ADVANCE) { oracle(o); advanceHeadOrientationAndStampTile(c); }
    else { oracle(o); guardHeadOrientationWrap(c); }
    assert.equal(ramDiff(o, c), null, `dispatch at pc 0x${(cap.pc & 0xffff).toString(16)}`);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// -------- ADVANCE arm (0x2e9d) ---------------------------------------------------------------------
// Seat: $00 controls the every-4th-tick rotate gate, $40 the orientation, $ef the XOR key, $70 the faced
// column; `cellRaw` is the byte pre-stored at the resolved ($32) address so the fetched cell (cellRaw^$ef,
// unless 0) lands in/out of the [0x3c,0x40) stamp band.
function seedAdvance(m, s) {
  m.mem8[loc_8b] = 0x00;
  m.mem8[loc_00] = s.tick ?? 0x00;
  m.mem8[loc_40] = s.o40 ?? 0x30;
  m.mem8[loc_ef] = s.ef ?? 0x00;
  m.mem8[loc_70] = s.x ?? 0x08;
  const ptr = pointerFor(s.x ?? 0x08);
  m.mem8[ptr] = s.cellRaw ?? 0x00;
}

test("CRAFTED: advance arm across the rotate gate and every stamp-band boundary == oracle (RAM -stack)", () => {
  const cases = [
    { tag: "tick%4!=0 skips rotate; cell >= 0x40 no stamp", tick: 0x01, o40: 0x31, x: 0x08, cellRaw: 0x50 },
    { tag: "tick%4==0 rotates $40; cell < 0x3c no stamp", tick: 0x04, o40: 0x30, x: 0x08, cellRaw: 0x10 },
    { tag: "tick%4==0 rotates $40; cell 0x3c (band low) stamps", tick: 0x00, o40: 0x31, x: 0x10, cellRaw: 0x3c },
    { tag: "cell 0x3f (band high) stamps", tick: 0x00, o40: 0x32, x: 0x20, cellRaw: 0x3f },
    { tag: "cell 0x40 (just out) no stamp", tick: 0x00, o40: 0x33, x: 0x40, cellRaw: 0x40 },
    { tag: "$ef key non-zero, folded cell 0x3d lands in band", tick: 0x00, ef: 0x0f, x: 0x08, cellRaw: 0x32 }, // 0x32^0x0f=0x3d
  ];
  for (const s of cases) {
    const o = new Machine(ROM); seedAdvance(o, s);
    const c = new Machine(ROM); seedAdvance(c, s);
    oracleAdvance(o); advanceHeadOrientationAndStampTile(c);
    assert.equal(ramDiff(o, c), null, `RAM: ${s.tag}`);
  }
});

test("CRAFTED positive-control: the rotate gate and the stamp actually fire on the intended arms", () => {
  // Rotate gate: tick%4==0 advances $40 (0x31 -> ((0x31+1)&3|0x30) = 0x32); tick%4!=0 leaves it.
  const rot = new Machine(ROM); seedAdvance(rot, { tick: 0x00, o40: 0x31, x: 0x08, cellRaw: 0x50 });
  advanceHeadOrientationAndStampTile(rot);
  assert.equal(rot.mem8[loc_40], 0x32, "rotate arm must advance $40 0x31 -> 0x32");
  const noRot = new Machine(ROM); seedAdvance(noRot, { tick: 0x01, o40: 0x31, x: 0x08, cellRaw: 0x50 });
  advanceHeadOrientationAndStampTile(noRot);
  assert.equal(noRot.mem8[loc_40], 0x31, "non-4th tick must leave $40 unchanged");

  // Stamp arm: an in-band cell (0x3e, $ef=0) is overwritten by (0x3e & 0xfb) = 0x3a at the ($32) address.
  const ptr = pointerFor(0x08);
  const st = new Machine(ROM); seedAdvance(st, { tick: 0x00, o40: 0x30, x: 0x08, cellRaw: 0x3e });
  advanceHeadOrientationAndStampTile(st);
  assert.equal(st.mem8[ptr], 0x3a, "stamp arm must write the masked marker (0x3e & 0xfb) to the ($32) cell");
  // Out-of-band cell is left untouched (positive control that the guard actually gates the write).
  const skip = new Machine(ROM); seedAdvance(skip, { tick: 0x00, o40: 0x30, x: 0x08, cellRaw: 0x50 });
  advanceHeadOrientationAndStampTile(skip);
  assert.equal(skip.mem8[pointerFor(0x08)], 0x50, "out-of-band cell must be left untouched");
});

// -------- GUARD arm (0x2e94) -----------------------------------------------------------------------
test("CRAFTED: wrap-guard arm (return vs re-seed) == oracle (RAM -stack)", () => {
  const cases = [
    { tag: "A^$ef >= 0xfa -> return (no re-seed)", a: 0xfb, ef: 0x00, o40: 0x22 },
    { tag: "A^$ef < 0xfa -> re-seed wave state", a: 0x00, ef: 0x00, o40: 0x22 },
    { tag: "re-seed with $ef key set", a: 0x11, ef: 0x0f, o40: 0x22 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM); o.mem8[loc_ef] = s.ef; o.mem8[loc_40] = s.o40; o.regs.a = s.a;
    const c = new Machine(ROM); c.mem8[loc_ef] = s.ef; c.mem8[loc_40] = s.o40; c.regs.a = s.a;
    oracleGuard(o); guardHeadOrientationWrap(c);
    assert.equal(ramDiff(o, c), null, `RAM: ${s.tag}`);
  }
});

test("CRAFTED positive-control: the re-seed arm fires (and the return arm does not)", () => {
  // A^$ef = 0 < 0xfa -> seedWaveState overwrites $40 with 0x1c ^ $ef.
  const seedIt = new Machine(ROM); seedIt.mem8[loc_ef] = 0x00; seedIt.mem8[loc_40] = 0x22; seedIt.regs.a = 0x00;
  guardHeadOrientationWrap(seedIt);
  assert.equal(seedIt.mem8[loc_40], 0x1c, "re-seed arm must overwrite $40 with 0x1c ^ $ef");
  // A^$ef = 0xfb >= 0xfa -> return, $40 untouched.
  const ret = new Machine(ROM); ret.mem8[loc_ef] = 0x00; ret.mem8[loc_40] = 0x22; ret.regs.a = 0xfb;
  guardHeadOrientationWrap(ret);
  assert.equal(ret.mem8[loc_40], 0x22, "return arm must leave $40 untouched");
});

// -------- teeth ------------------------------------------------------------------------------------
test("TEETH: a skipped stamp is caught by the RAM diff", () => {
  const ptr = pointerFor(0x08);
  const o = new Machine(ROM); seedAdvance(o, { tick: 0x00, o40: 0x30, x: 0x08, cellRaw: 0x3e });
  oracleAdvance(o);
  assert.equal(o.mem8[ptr], 0x3a, "precondition: oracle stamped 0x3a at the ($32) cell");
  const brokenCell = 0x3e; // BUG: never stamped, cell left at its seeded value
  assert.notEqual(brokenCell, o.mem8[ptr], "the RAM diff FAILED to catch a skipped stamp");
});

test("TEETH: a skipped orientation rotate is caught by the RAM diff", () => {
  const o = new Machine(ROM); seedAdvance(o, { tick: 0x00, o40: 0x31, x: 0x08, cellRaw: 0x50 });
  oracleAdvance(o);
  assert.equal(o.mem8[loc_40], 0x32, "precondition: oracle rotated $40 0x31 -> 0x32");
  const brokenO40 = 0x31; // BUG: never rotated $40
  assert.notEqual(brokenO40, o.mem8[loc_40], "the RAM diff FAILED to catch a skipped rotate");
});

// -------- SP tooth: the omitted-ret leaf places, a net-nonzero SP mutant is refused -----------------
function seatCallerReturn(m) {
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab); // a real caller-return word for the seam to complete
  m.mem8[loc_8b] = 0x00; m.mem8[loc_00] = 0x00; m.mem8[loc_40] = 0x30; m.mem8[loc_ef] = 0x00; m.mem8[loc_70] = 0x08;
}

test("SP-TOOTH: advanceHeadOrientationAndStampTile (omitted-ret leaf, moved 0) is seam-placeable", () => {
  const m = new Machine(ROM); seatCallerReturn(m);
  const r = seamPlaceable(withOmittedRet, advanceHeadOrientationAndStampTile, ADVANCE, m);
  assert.equal(r.placeable, true, `advanceHeadOrientationAndStampTile must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});

test("SP-TOOTH null-mutant: a net-nonzero SP move is refused by the seam", () => {
  const m = new Machine(ROM); seatCallerReturn(m);
  // A mutant that strays SP: it does the real work but pushes a word without a matching pop, so SP moves
  // net -2. withOmittedRet must THROW (the tooth bites) rather than silently place it.
  const strayMutant = (mm) => { const r = advanceHeadOrientationAndStampTile(mm); mm.push16(0x1234); return r; };
  const r = seamPlaceable(withOmittedRet, strayMutant, ADVANCE, m);
  assert.equal(r.placeable, false, "the seam must REFUSE a net-nonzero SP move (tooth has no teeth)");
});
