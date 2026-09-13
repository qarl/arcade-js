// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for loc_c891 (ROM 0xc891-0xc90b) -- the per-frame dispatcher. It sets speed/mode cells from
// the coin input + phase counters, then a common tail advances loc_3 and fires the sub-steps loc_c81b
// (c8d2), loc_de1b (odd frames) and loc_ccfa (when loc_c is live), threading the slot index X/Y from one to
// the next. Contract: RAM (dumpState minus STACK_SCRATCH) PLUS the decimal (D) flag, which loc_c891 sets
// (sed, when loc_16c != 0 and loc_9f > 0x13) and NEVER clears -- a load-bearing processor-flag live-out the
// frozen sbc downstream reads. c891 is a full JS dispatcher (calls its sub-steps as JS), not an omitted-ret
// leaf, so there is no SP-tooth. The X/Y threading into loc_ccfa is load-bearing: ccfa forwards them to
// loc_ccc7, which stamps loc_31/loc_32 -- a stale (entry) X/Y writes the wrong cells.
// Run: node --test games/tempest/idiomatic/test/equivalence-c891.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c891 as oracle } from "../../translated/loc_c891.js";
import { loc_c891 } from "../loc_c891.js";
import { loc_de1b } from "../loc_de1b.js";
import { loc_ccfa } from "../loc_ccfa.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, loc_3, loc_c, loc_9f, loc_16c } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xc891;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(24, 4000) : [];

test("CAPTURE: real 0xc891 dispatches -- loc_c891 == oracle in RAM (-stack) and in the D flag", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue;
    loc_c891(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.fD, o.regs.fD, "decimal-flag live-out matches");
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} compared`);
});

// Force the tail sub-steps: odd frame (so loc_de1b runs) and loc_c live (so loc_ccfa runs).
const forceTailSubsteps = (m) => { m.mem.write8(loc_3, 0x00); m.mem.write8(loc_c, 0x01); };

test("CRAFTED: loc_ccfa reached (odd frame + loc_c live) -- RAM equal, X/Y threaded correctly", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()); forceTailSubsteps(o);
    const c = freezePokey(cap.clone()); forceTailSubsteps(c);
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue;
    loc_c891(c);
    assert.equal(ramDiff(o, c), null, "RAM equal after the ccfa-reaching tail (loc_31/loc_32 stamped by threaded X/Y)");
    checked++;
  }
  console.log(`  CRAFTED ccfa: ${checked} states`);
  assert.ok(checked >= 1, "no state reached the ccfa tail cleanly");
});

const forceSed = (m) => { m.mem.write8(loc_16c, 0x01); m.mem.write8(loc_9f, 0x20); };

test("CRAFTED: sed condition (loc_16c!=0 && loc_9f>0x13) -> D flag set, matching oracle", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()); o.regs.cld(); forceSed(o);
    const c = freezePokey(cap.clone()); c.regs.cld(); forceSed(c);
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue;
    loc_c891(c);
    assert.equal(ramDiff(o, c), null, "RAM equal on the sed path");
    assert.equal(o.regs.fD, true, "oracle set decimal mode");
    assert.equal(c.regs.fD, true, "idiomatic set decimal mode");
    checked++;
  }
  console.log(`  CRAFTED sed: ${checked} states`);
  assert.ok(checked >= 1, "no state exercised the sed path");
});

// A full copy of loc_c891 identical EXCEPT the ccfa call hands over the stale (entry-register) X/Y
// instead of the threaded locals -- the exact R37 defect this routine's threading prevents.
function brokenStaleBridge(m, x = m.regs.x, y = m.regs.y) {
  const rd = (a) => m.mem8[a], wr = (a, v) => { m.mem8[a] = v & 0xff; };
  let toC81b = false, toTail = false;
  if ((rd(0x0c00) & 0x10) === 0) { wr(0x00, 0x22); toTail = true; }
  else if ((rd(0x05) & 0x40) !== 0) { toTail = true; }
  else if ((rd(0x0a) & 0x01) === 0) { toC81b = true; }
  else {
    y = rd(0x06);
    if (y === 0) wr(0xa2, 0x80);
    if ((rd(0xa2) & 0x80) === 0) toC81b = true;
    else if (y >= 2) { wr(0x00, 0x14); wr(0xa2, 0x00); toC81b = true; }
    else if (y !== 0) { wr(0x01, 0x16); wr(0x00, 0x0a); }
  }
  if (!toTail) {
    if (toC81b && rd(0x06) !== 0) [x, y] = loc_c81b(m, x);
    if ((rd(0x09) & 0x03) === 0) wr(0x06, 0x02);
  }
  wr(0x03, rd(0x03) + 1);
  if ((rd(0x03) & 0x01) !== 0) [x, y] = loc_de1b(m, x, y);
  if (rd(0x0c) !== 0) loc_ccfa(m); // BUG: stale entry X/Y from the bridge, not the threaded de1b/c81b exit
  if (rd(0x16c) !== 0 && rd(0x9f) > 0x13) m.regs.sed();
  if ((rd(0x4e) & 0x80) !== 0) wr(0x4e, 0x00);
}

test("TEETH (X/Y threading): a twin that lets loc_ccfa read the stale bridge diverges from the oracle", () => {
  // On an odd frame loc_de1b changes X/Y, so a ccfa that reads the entry registers stamps the wrong
  // loc_31/loc_32. Scan the forced states for one that diverges (the design measured ~148/200), proving it.
  let caught = false, tried = 0;
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()); forceTailSubsteps(o);
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue;
    const s = freezePokey(cap.clone()); forceTailSubsteps(s);
    brokenStaleBridge(s);
    tried++;
    if (ramDiff(o, s) !== null) { caught = true; break; }
  }
  assert.ok(tried > 0, "no state could be exercised for the threading teeth");
  assert.ok(caught, "the RAM diff FAILED to catch a stale-bridge ccfa on every exercised state");
});

test("TEETH (D flag): a twin that skips the sed leaves the D flag wrong", () => {
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()); o.regs.cld(); forceSed(o);
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue;
    if (o.regs.fD !== true) continue; // want a state where the oracle actually set D
    const c = freezePokey(cap.clone()); c.regs.cld(); forceSed(c);
    // Broken twin: everything real EXCEPT it never sets decimal mode.
    // (Run the real dispatcher, then forcibly clear D to model the omitted sed.)
    loc_c891(c); c.regs.cld();
    assert.notEqual(c.regs.fD, o.regs.fD, "the D-flag arm FAILED to catch the omitted sed");
    return;
  }
  assert.fail("no state exercised the sed path for the D-flag teeth");
});
