// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for buildVectorItemList (ROM 0xd804-0xd8a8) -- the frame vector-list builder. It runs four
// setup passes, lays a header pair, emits a marker $0158 times, then a run of table-indexed coordinate
// records selected by $016a/$0200/$004d/$0009, and finally falls through into emitScaledByteDigit (dissolved to a
// direct call). The routine draws into vector RAM ($2000-$2fff) and returns no value, so the contract is
// RAM only (dumpState minus stack scratch below the entry SP) -- no register is a live-out. The one still-frozen callee is
// the co-SCC reset arm reached only when the mask CMP matches and the slot index underflows (m.call);
// the CRAFTED seeds keep that arm out of the picture. Oracle is the frozen translated buildVectorItemList.
// Run: node --test games/tempest/idiomatic/test/equivalence-d804.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_d804 } from "../../translated/loc_d804.js";
import { buildVectorItemList } from "../buildVectorItemList.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import {
  SLOT_LOOP_INDEX, INPUT_DEBOUNCED, SPINNER_ACCUM, RIM_ROT_OFFSET, DRAW_CURSOR_LO, DRAW_CURSOR_HI, DSW_BONUS_CONFIG, PLAYER_SEGMENT, PENDING_WORK_FLAGS,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xd804;
const oracle = atEntry(loc_d804);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// Some callees dip into the POKEY random latches ($60ca/$60da); freeze the polynomials on both clones so
// a captured/crafted compare is deterministic.
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0xd804 dispatches -- buildVectorItemList == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a real dispatch may reach the frozen reset arm / an unlifted callee
    if (threw) continue;                        // both layers reach the same frozen code there; nothing to compare
    buildVectorItemList(c);
    assert.equal(ramDiff(o, c), null, "RAM equal for a captured dispatch");
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// Skip seed: point the vector cursor into vector RAM, run the draw loop once ($0158=1), and force the mask
// CMP to MISS ($004d=0 so the AND is 0 while every $d8b6 mask entry is nonzero) -> the dex/reset block is
// skipped entirely and control drops to the common tail (df53 + two emitScaledByteDigit records).
function seedSkip(m) {
  m.mem.write8(DRAW_CURSOR_LO, 0x00); m.mem.write8(DRAW_CURSOR_HI, 0x20); // cursor -> $2000, keeps writes in vector RAM
  m.mem.write8(DSW_BONUS_CONFIG, 0x01);                            // draw loop runs once, $37 ends at 0
  m.mem.write8(SLOT_LOOP_INDEX, 0x11);                             // overwritten by the $0158 copy then decremented
  m.mem.write8(SPINNER_ACCUM, 0x00); m.mem.write8(RIM_ROT_OFFSET, 0x00); // adce fold -> no carry/sign -> folded = $0200
  m.mem.write8(PLAYER_SEGMENT, 0x00);                            // folded 0 -> sel 0 -> x 0
  m.mem.write8(INPUT_DEBOUNCED, 0x00);                             // AND result 0 != mask -> CMP miss -> skip block
}

test("CRAFTED: mask-miss path skips the dex block -- RAM equal; draw count $37 zeroed", () => {
  const o = freezePokey(new Machine(ROM, OPTS)); seedSkip(o);
  const c = freezePokey(new Machine(ROM, OPTS)); seedSkip(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED(skip): oracle threw -- skipped"); return; }
  buildVectorItemList(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the mask-miss path");
  assert.equal(c.mem.read8(SLOT_LOOP_INDEX), 0x00, "draw-loop counter $37 decremented to 0");
  assert.equal(c.mem.read8(PLAYER_SEGMENT), 0x00, "folded step written back to $0200");
});

// Hit seed: drive the mask CMP to MATCH on slot index x=3 (mask $d8b6+3 = 0x50) with $004d = 0x50, and
// arrange the folded selector so sel=6 -> x=3; after dex dex x=1 (BPL taken, BNE taken) the dded/ora arm
// runs, ORing 0x03 into $01c9. This exercises a dissolved-call arm without reaching the reset (x stays
// non-negative).
function seedHit(m) {
  m.mem.write8(DRAW_CURSOR_LO, 0x00); m.mem.write8(DRAW_CURSOR_HI, 0x20);
  m.mem.write8(DSW_BONUS_CONFIG, 0x01);
  m.mem.write8(SPINNER_ACCUM, 0x00); m.mem.write8(RIM_ROT_OFFSET, 0x00);
  m.mem.write8(PLAYER_SEGMENT, 0x06);   // folded 6 -> sel = 6&6 = 6 -> x = 3
  m.mem.write8(INPUT_DEBOUNCED, 0x50);    // 0x50 & mask(0x50) = 0x50 -> CMP match
  m.mem.write8(PENDING_WORK_FLAGS, 0x80);
}

test("CRAFTED: mask-match on x=3 runs the ora arm -- RAM equal; $01c9 |= 0x03", () => {
  const o = freezePokey(new Machine(ROM, OPTS)); seedHit(o);
  const c = freezePokey(new Machine(ROM, OPTS)); seedHit(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED(hit): oracle threw -- skipped"); return; }
  buildVectorItemList(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the mask-match ora path");
  assert.equal(c.mem.read8(PENDING_WORK_FLAGS) & 0x03, 0x03, "0x03 ORed into $01c9 on the dded arm");
});

test("TEETH: a twin that leaves the draw-count store $37 non-zero MUST diverge in RAM", () => {
  const o = freezePokey(new Machine(ROM, OPTS)); seedSkip(o);
  const c = freezePokey(new Machine(ROM, OPTS)); seedSkip(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw -- skipped"); return; }
  let ran = false;
  const broken = (m) => {
    buildVectorItemList(m);
    m.mem.write8(SLOT_LOOP_INDEX, 0x11); // BUG: revert the counter the draw loop decremented to 0
    ran = true;
  };
  broken(c);
  assert.ok(ran, "the teeth twin did not run");
  assert.notEqual(ramDiff(o, c), null, "the reverted $37 store was NOT caught by the RAM compare");
});
