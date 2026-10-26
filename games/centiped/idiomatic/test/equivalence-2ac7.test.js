// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for advanceSegmentLoopIndex (ROM 0x2ac7). Steps the segment cursor (X) to the
// previous slot; once it runs past the first slot the strip is done and the routine returns (the seam
// supplies the ret), otherwise it re-enters the mover carrying the stepped cursor -- a DIRECT idiomatic
// tail call, so the re-entry is exercised by running the whole slot walk (a wrong step lands on the wrong
// slot and diverges), not a routine-map stub. Equivalence is the RAM diff (minus stack scratch below the entry SP).
// Run: node --test games/centiped/idiomatic/test/equivalence-2ac7.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2ac7 as oracleRom } from "../../translated/loc_2ac7.js";
import { advanceSegmentLoopIndex } from "../advanceSegmentLoopIndex.js";
import { moveCentipedeSegment } from "../moveCentipedeSegment.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2ac7;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

test("CRAFTED: past the first slot -> return (RTS), no RAM change vs oracle", () => {
  // X == 0 -> DEX underflows to 0xff -> the routine returns; the oracle takes the bare RTS.
  const o = new Machine(ROM); o.regs.x = 0;
  const c = new Machine(ROM); c.regs.x = 0;
  oracle(o); advanceSegmentLoopIndex(c);
  assert.equal(ramDiff(o, c), null);
});

test("CRAFTED: re-entry carries the stepped cursor, matching oracle", () => {
  // The re-entry into the mover ($2962) is a direct idiomatic tail call, so it can't be stubbed through the
  // routine map. Instead run the WHOLE segment-slot walk on both sides from an identical crafted state: a
  // wrong cursor step operates on the wrong slot and diverges in RAM. The oracle re-enters via its cyclic
  // m.call, the rewrite via the direct call; both walk the same slots down to the strip-done exit.
  for (const x of [1, 3, 0x0d]) {
    const o = new Machine(ROM); const c = new Machine(ROM);
    o.regs.x = x; c.regs.x = x;
    oracle(o); advanceSegmentLoopIndex(c);
    assert.equal(ramDiff(o, c), null, `x=${x}: RAM matches through the whole slot walk`);
  }
});

test("TEETH: an un-stepped cursor at re-entry diverges from the oracle", () => {
  // An adrift twin that re-enters the mover with the cursor UNSTEPPED (x, not x-1): it walks one extra slot,
  // writing state the oracle never touches, so the whole-chain RAM diff must catch it.
  const adriftTwin = (m, x = m.regs.x) => {
    if (((x - 1) & 0xff) & 0x80) return; // strip-done, same as the real routine
    return (m.regs.x = x), moveCentipedeSegment(m); // BUG: forwards x instead of the stepped x-1
  };
  for (const x of [3, 0x0d]) {
    const o = new Machine(ROM); const c = new Machine(ROM);
    o.regs.x = x; c.regs.x = x;
    oracle(o); adriftTwin(c);
    assert.notEqual(ramDiff(o, c), null, `x=${x}: the whole-chain RAM diff FAILED to catch an un-stepped cursor`);
  }
});

test("SP-TOOTH: the omitted-ret (strip-done) exit is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab); // caller-return word for the seam
  m.regs.x = 0; // -> DEX underflow -> omitted-ret return
  const r = seamPlaceable(withOmittedRet, advanceSegmentLoopIndex, TARGET, m);
  assert.equal(r.placeable, true, `advanceSegmentLoopIndex must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: strip-done omitted-ret placeable");
});
