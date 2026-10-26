// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for buildSortedSoundRequest (ROM 0xac3f-0xad21) -- a CALLER that dissolves three m.calls into direct
// idiomatic calls: clearChannelStagingBlock (conditional block-clear), queueEaromRegionSave (arm the merge with mask 4), and the
// fall-through armRequestedSoundSlot (walk the request word). It bubble-sorts each channel's record rows counting passes,
// records per-channel pass counts, nudges a running total, and derives a packed request byte. Live-out is RAM
// plus the exit [X, Y] it returns (the request walker's), so each side runs on a clone and the contract is RAM
// (dumpState, minus stack scratch below the entry SP), with the CAPTURE and REQUEST-ZERO arms also comparing the returned pair.
// Run: node --test games/tempest/idiomatic/test/equivalence-ac3f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_ac3f } from "../../translated/loc_ac3f.js";
import { buildSortedSoundRequest } from "../buildSortedSoundRequest.js";
import { clearChannelStagingBlock } from "../clearChannelStagingBlock.js";
import { queueEaromRegionSave } from "../queueEaromRegionSave.js";
import { armRequestedSoundSlot } from "../armRequestedSoundSlot.js";
import { Machine } from "../../machine.js";
import { u8, u16 } from "../../../../core/int.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import {
  STATUS_FLAGS, DSW1_SNAPSHOT, loc_29, loc_2a, loc_2b, COORD_LIST_PTR_LO, COORD_LIST_PTR_HI, loc_2e, SAVED_INDEX2, loc_3d, ACTIVE_SLOT_COUNT,
  loc_40, loc_41, loc_42, SORT_PAYLOAD_LO, SORT_PAYLOAD_MID, SORT_PAYLOAD_HI, SLOT_METRIC, loc_601, REQUEST_BITS, PASS_COUNTER, SORT_KEY_LO, SORT_KEY_MID, SORT_KEY_HI,
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

const TARGET = 0xac3f;
const oracle = atEntry(loc_ac3f);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0xac3f dispatches -- buildSortedSoundRequest == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); { c.regs.x ^= 0xff; c.regs.y ^= 0xff; // m.regs poisoned: this routine takes no entry X/Y, so its exit must not depend on them
      assert.deepEqual(buildSortedSoundRequest(c), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's"); }
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Fill the sort's working RAM window deterministically, then seat the control + key cells.
function fillWindow(m) {
  let s = 0x12345 >>> 0;
  for (let a = 0x0500; a <= 0x07ff; a++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    m.mem.write8(a, (s >>> 16) & 0xff);
  }
  // Key triple cells (indexed by channel) live outside the window -- seat them explicitly.
  m.mem.write8(loc_40, 0x40); m.mem.write8(loc_41, 0x60); m.mem.write8(loc_42, 0x80);
  m.mem.write8(0x0043, 0x30); m.mem.write8(0x0044, 0x50); m.mem.write8(0x0045, 0x70);
  m.mem.write8(ACTIVE_SLOT_COUNT, 0x01); // nonzero -> channel starts at 3, two channels processed
  m.mem.write8(loc_3d, 0x45); // request-byte flag (bit6 set -> carry-in is live)
}

test("CRAFTED (no ca62): full bubble sort + request derivation match the oracle in RAM", () => {
  const o = new Machine(ROM, OPTS); fillWindow(o); o.mem.write8(STATUS_FLAGS, 0xff); o.mem.write8(DSW1_SNAPSHOT, 0x00);
  const c = new Machine(ROM, OPTS); fillWindow(c); c.mem.write8(STATUS_FLAGS, 0xff); c.mem.write8(DSW1_SNAPSHOT, 0x00);
  oracle(o); buildSortedSoundRequest(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after ac3f (no ca62 path)");
  assert.equal(c.mem.read8(STATUS_FLAGS) & 0x40, 0x00, "$05 bit6 cleared");
});

test("CRAFTED (ca62 path): the conditional block-clear fires and still matches the oracle", () => {
  const o = new Machine(ROM, OPTS); fillWindow(o); o.mem.write8(STATUS_FLAGS, 0xff); o.mem.write8(DSW1_SNAPSHOT, 0x40);
  const c = new Machine(ROM, OPTS); fillWindow(c); c.mem.write8(STATUS_FLAGS, 0xff); c.mem.write8(DSW1_SNAPSHOT, 0x40);
  oracle(o); buildSortedSoundRequest(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after ac3f (ca62 path)");
});

// Step the row cursor down by two (or three when still high).
function advanceCursor(y) {
  if (y >= 0x55) y = u8(y - 1);
  y = u8(y - 1);
  y = u8(y - 1);
  return y;
}

// loc_3d = 0x33 derives a request byte of 0, so the walker exits at once with the X it was handed (the channel
// loop's 0xff), making that hand-off observable.
test("CRAFTED REQUEST-ZERO: the walker's exit X is the channel index handed to it (m.regs poisoned)", () => {
  const seed = (m) => { m.mem.write8(loc_3d, 0x33); m.regs.x = 0x21; m.regs.y = 0x5a; };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c); c.regs.x = 0xa5; c.regs.y = 0xa5;
  oracle(o);
  assert.equal(o.mem.read8(REQUEST_BITS), 0x00, "positive control: the request byte is 0");
  assert.deepEqual([o.regs.x, o.regs.y], [0xff, 0x14], "positive control: the oracle's walker exits with X = 0xff");
  assert.deepEqual(buildSortedSoundRequest(c), [o.regs.x, o.regs.y], "returned exit [X, Y]");
  assert.equal(ramDiff(o, c), null, "RAM equal");
});

test("TEETH: a faithful twin that drops the request byte's ADC carry-in diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); fillWindow(o); o.mem.write8(STATUS_FLAGS, 0xff); o.mem.write8(DSW1_SNAPSHOT, 0x00);
  const c = new Machine(ROM, OPTS); fillWindow(c); c.mem.write8(STATUS_FLAGS, 0xff); c.mem.write8(DSW1_SNAPSHOT, 0x00);
  oracle(o);
  // Byte-for-byte buildSortedSoundRequest, with exactly one omission: the (flag>>6)&1 carry-in on the request byte.
  const broken = (m) => {
    const { mem8 } = m;
    mem8[STATUS_FLAGS] = mem8[STATUS_FLAGS] & 0xbf;
    if ((mem8[DSW1_SNAPSHOT] & 0x43) === 0x40) clearChannelStagingBlock(m);
    queueEaromRegionSave(m);
    mem8[loc_601] = 0x00;
    let channel = mem8[ACTIVE_SLOT_COUNT] === 0 ? 0 : 3;
    while (true) {
      mem8[COORD_LIST_PTR_LO] = mem8[u8(loc_42 + channel)];
      mem8[COORD_LIST_PTR_HI] = mem8[u8(loc_41 + channel)];
      mem8[loc_2e] = mem8[u8(loc_40 + channel)];
      mem8[SAVED_INDEX2] = channel & 0x01;
      mem8[loc_2b] = 0x00; mem8[loc_2a] = 0x1a; mem8[loc_29] = 0x1a; mem8[PASS_COUNTER] = 0x00;
      let y = 0xfd;
      while (true) {
        let ordered;
        const hi = mem8[u16(SORT_KEY_HI + y)];
        if (hi !== mem8[COORD_LIST_PTR_LO]) ordered = hi >= mem8[COORD_LIST_PTR_LO];
        else {
          const mid = mem8[u16(SORT_KEY_MID + y)];
          if (mid !== mem8[COORD_LIST_PTR_HI]) ordered = mid >= mem8[COORD_LIST_PTR_HI];
          else if (y < 0x52) ordered = true;
          else ordered = mem8[u16(SORT_KEY_LO + y)] >= mem8[loc_2e];
        }
        if (!ordered) {
          while (true) {
            if (y >= 0xe8) {
              let t = mem8[u16(SORT_PAYLOAD_LO + y)];
              mem8[u16(SORT_PAYLOAD_LO + y)] = mem8[loc_29]; mem8[loc_29] = t;
              t = mem8[u16(SORT_PAYLOAD_MID + y)];
              mem8[u16(SORT_PAYLOAD_MID + y)] = mem8[loc_2a]; mem8[loc_2a] = t;
              t = mem8[u16(SORT_PAYLOAD_HI + y)];
              mem8[u16(SORT_PAYLOAD_HI + y)] = mem8[loc_2b]; mem8[loc_2b] = t;
            }
            let t = mem8[u16(SORT_KEY_MID + y)];
            mem8[u16(SORT_KEY_MID + y)] = mem8[COORD_LIST_PTR_HI]; mem8[COORD_LIST_PTR_HI] = t;
            t = mem8[u16(SORT_KEY_HI + y)];
            mem8[u16(SORT_KEY_HI + y)] = mem8[COORD_LIST_PTR_LO]; mem8[COORD_LIST_PTR_LO] = t;
            if (y >= 0x52) {
              t = mem8[u16(SORT_KEY_LO + y)];
              mem8[u16(SORT_KEY_LO + y)] = mem8[loc_2e]; mem8[loc_2e] = t;
            }
            y = advanceCursor(y);
            if (y === 0) break;
          }
          y = 0x02;
        }
        mem8[PASS_COUNTER] = u8(mem8[PASS_COUNTER] + 1);
        y = advanceCursor(y);
        if (y === 0) break;
      }
      channel = mem8[SAVED_INDEX2];
      mem8[u16(SLOT_METRIC + channel)] = mem8[PASS_COUNTER];
      channel = u8(channel - 1);
      if ((channel & 0x80) !== 0) break;
    }
    const total = mem8[loc_601];
    if (total >= mem8[SLOT_METRIC] && total < 0x63) mem8[loc_601] = u8(mem8[loc_601] + 1);
    const flag = mem8[loc_3d];
    let request = (((flag ^ 0x01) << 2) & 0xff) | flag;
    request = u8(request + 0x05); // BUG: dropped + ((flag >> 6) & 0x01)
    mem8[REQUEST_BITS] = request;
    return armRequestedSoundSlot(m);
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the dropped carry-in");
});
