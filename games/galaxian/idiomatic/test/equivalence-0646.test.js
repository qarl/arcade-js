// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0646 — crafted-entry equivalence vs the frozen bitmask unpacker.
 * Two live-outs: the 128-cell flag block written at the unpack destination (RAM, in the state dump) and
 * register DE, advanced past the 16 source bytes (the caller reads it back via `ex de,hl` to copy the data
 * following the mask). A post-attract seed is cloned; DE points at a 16-byte mask laid in work RAM, the
 * destination pre-dirtied with a sentinel, and a return address pushed for the oracle's ret. EQUAL asserts
 * ramDiff==null AND register DE; non-vacuous positive control. Teeth: no-op, inverted, and MSB-first twins
 * (RAM) plus a wrong-DE-advance twin (register).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { romsPresent, craft, ramDiff, STUBS } from "./_bootSetup.js";
import { loc_0646 as cand } from "../loc_0646.js";
import { loc_0646 as oracle } from "../../translated/loc_0646.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const SRC = 0x4280; // 16-byte packed mask source (work RAM, clear of the destination and stack)
const DEST = 0x4100; // 128-cell one-byte-per-bit flag block
const SENTINEL = 0xaa; // pre-dirties the destination so the oracle demonstrably rewrites it
const MASK = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x03, 0xc0, 0x55, 0xaa, 0xff, 0x00, 0x81, 0x18];

const entry = () => craft((mem, m) => {
  m.push16(0x9999);
  m.regs.de = SRC;
  for (let i = 0; i < 16; i++) mem[SRC + i] = MASK[i];
  for (let i = 0; i < 128; i++) mem[DEST + i] = SENTINEL;
});

// Live-out = the flag block (RAM) AND the advanced source pointer in DE.
function deDiff(twin, e) {
  const a = e.clone(); a.routines = STUBS; oracle(a);
  const b = e.clone(); b.routines = STUBS; twin(b);
  if (a.regs.de !== b.regs.de) return `DE: 0x${a.regs.de.toString(16)} vs 0x${b.regs.de.toString(16)}`;
  return null;
}

test("EQUAL (crafted): loc_0646 == oracle unpacks the mask and advances DE", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, entry()), null, "the flag block diverged");
  assert.equal(deDiff(cand, entry()), null, "the advanced source pointer diverged");

  // Non-vacuous: the oracle rewrites the destination and advances DE past the 16 mask bytes.
  const a = entry(); oracle(a);
  assert.equal(a.mem8[DEST], 1, "control: bit 0 of mask byte 0 (0x01) unpacked to 1");
  assert.equal(a.mem8[DEST + 1], 0, "control: bit 1 of mask byte 0 unpacked to 0");
  assert.equal(a.regs.de, SRC + 16, "control: DE advanced past the 16 mask bytes");
  console.log("  EQUAL: loc_0646 == oracle (128-cell flag block + DE = src+16)");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const inverted = (m) => {
    let out = DEST, src = SRC;
    for (let r = 0; r < 16; r++) { const p = m.mem8[src++]; for (let b = 0; b < 8; b++) m.mem8[out++] = (p >> b) & 1 ? 0 : 1; }
  };
  const msbFirst = (m) => {
    let out = DEST, src = SRC;
    for (let r = 0; r < 16; r++) { const p = m.mem8[src++]; for (let b = 7; b >= 0; b--) m.mem8[out++] = (p >> b) & 1; }
  };
  const wrongDe = (m) => { cand(m); m.regs.de = (m.regs.de + 1) & 0xffff; };
  assert.ok(ramDiff(oracle, noOp, entry()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, inverted, entry()), "the inverted twin escaped");
  assert.ok(ramDiff(oracle, msbFirst, entry()), "the MSB-first twin escaped");
  assert.ok(deDiff(wrongDe, entry()), "the wrong-DE-advance twin escaped (register)");
  console.log("  TEETH: no-op, inverted, MSB-first (RAM) and wrong-DE (register) all caught");
});
