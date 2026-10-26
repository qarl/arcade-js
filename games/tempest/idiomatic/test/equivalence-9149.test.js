// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for tickWaveSpawnCadence (ROM 0x9149, second entry of selectWaveStartSlot.js) vs the
// frozen loc_9149, whole path to its rts. Contract: RAM minus STACK_SCRATCH. No register live-out: the only
// return site is c7bd's rts-dispatch back into the frame loop at 0xc7b3, whose next jsr (c891) loads A/Y and
// sets C/V/N/Z before reading them; X is only saved/restored there (ccc7 via $31/$32). D: loc_9149 cld's only
// on its tick path, and D is set only by c891's $016c checksum trap. POKEY RANDOM is frozen on both sides.
// Run: node --test games/tempest/idiomatic/test/equivalence-9149.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9149 as oracle } from "../../translated/loc_90c4.js";
import { tickWaveSpawnCadence } from "../selectWaveStartSlot.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH, GAME_MODE, MODE_DELAY_TIMER, STATUS_FLAGS, loc_3d, INPUT_EDGE_FLAGS, PLAYER_SEGMENT, PASS_COUNTER,
  loc_102, DEPTH_CEILING, SPINNER_ACCUM, RIM_ROT_OFFSET, loc_9f, POKEY1_RANDOM,
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
const TAPE_URL = new URL("../../tapes/coin_start_play.json", import.meta.url);
// The shipped tape is timed for the idiomatic IRQ runner; under the cycle-clocked runFrames its coin (f30-45)
// lands in the ~40-frame boot and play never starts, so it is replayed 40 frames later (play at ~f119).
const TAPE_1P = existsSync(TAPE_URL)
  ? JSON.parse(readFileSync(TAPE_URL, "utf8")).inputs.map((t) => ({ ...t, frame: t.frame + 40 })) : null;
// Three coins then START2 (IN2 0x40): a two-player game, so every turn hand-off re-enters the wave build.
const TAPE_2P = [70, 100, 130].map((frame) => ({ port: 0, bits: 0x04, frame, dur: 15 }))
  .concat([{ port: 2, bits: 0x40, frame: 170, dur: 20 }]);

const TARGET = 0x9149;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

// Hook 0x9149 (reached only through c7bd's table rts-dispatch, GAME_MODE 0x16) and clone real dispatches,
// at most PER_ARM per (sign, tick, low-phase, edge-fires) key so the sample spans the arms. Attract never
// dispatches 0x9149 (sign-clear 90c4 never sets mode 0x16), so the captures come from live play.
const PER_ARM = 3;
const armKey = (mm) => {
  const ph = mm.mem.read8(MODE_DELAY_TIMER), e = mm.mem.read8(INPUT_EDGE_FLAGS);
  return `sign=${mm.mem.read8(STATUS_FLAGS) >> 7} tick=${mm.mem.read8(PASS_COUNTER) === 0 ? 1 : 0}`
    + ` low=${ph < 8 ? 1 : 0} fire=${(e & (ph < 8 ? 0x78 : 0x18)) ? 1 : 0}`;
};
function captureDispatches(maxFrames, tape) {
  const caps = [], seen = new Map();
  const snap = new Map([[TARGET, (mm) => {
    const k = armKey(mm), n = seen.get(k) ?? 0;
    if (n < PER_ARM) { seen.set(k, n + 1); caps.push(mm.clone()); }
    return oracle(mm);
  }]]);
  const m = new Machine(ROM, { overrides: snap, ...OPTS });
  m.inputTape = tape;
  try { m.runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT && TAPE_1P ? [...captureDispatches(600, TAPE_1P), ...captureDispatches(1300, TAPE_2P)] : [];

const base = (cap = CAPS[0]) => freezePokey((cap ?? new Machine(ROM, OPTS)).clone());
function pair(pokes, cap) {
  const o = base(cap), c = base(cap);
  for (const m of [o, c]) for (const [a, v] of pokes) m.mem.write8(a, v);
  return { o, c };
}
const sign = (on) => [STATUS_FLAGS, ((CAPS[0]?.mem.read8(STATUS_FLAGS) ?? 0) & 0x7f) | (on ? 0x80 : 0)];

test("CAPTURE: real 0x9149 dispatches -- tickWaveSpawnCadence == oracle in RAM (-stack)", () => {
  let checked = 0;
  const arms = new Set();
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue;
    tickWaveSpawnCadence(c);
    assert.equal(ramDiff(o, c), null);
    arms.add(armKey(cap));
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} compared; arms seen: ${[...arms].join(", ")}`);
  assert.ok(CAPS.length > 0, "positive control: no real 0x9149 dispatch was captured");
  assert.ok(checked > 0, "no captured dispatch ran to its rts");
});

// The rim nudge (b0ab) re-clamps PLAYER_SEGMENT to [0, DEPTH_CEILING] after folding SPINNER_ACCUM into
// RIM_ROT_OFFSET, before the spawn records it into loc_102+seat: zero the spin and lift the ceiling so a
// poked segment survives to the spawn. These arms therefore do not exercise b0ab; the two rim arms below do.
const KEEP_SEGMENT = [[SPINNER_ACCUM, 0], [RIM_ROT_OFFSET, 0], [DEPTH_CEILING, 0x0f]];
// The off-sign random entry runs on a real capture whose frozen RANDOM has bit 2 set, so the 0..7 mask width shows.
const RND_CAP = CAPS.find((c) => freezePokey(c.clone()).mem.read8(POKEY1_RANDOM) & 4);
const RND = RND_CAP ? freezePokey(RND_CAP.clone()).mem.read8(POKEY1_RANDOM) : 0;
// [label, pokes, oracle-side witness that the arm took its branch, optional capture to poke]
const ARMS = [
  ["no tick, no fire (mask 0x18)", [[PASS_COUNTER, 5], [MODE_DELAY_TIMER, 0x12], [INPUT_EDGE_FLAGS, 0x87]],
    (o) => o.mem.read8(PASS_COUNTER) === 4 && o.mem.read8(INPUT_EDGE_FLAGS) === 0x07],
  ["high phase hides 0x60 bits", [[PASS_COUNTER, 5], [MODE_DELAY_TIMER, 0x12], [INPUT_EDGE_FLAGS, 0x60]],
    (o) => o.mem.read8(INPUT_EDGE_FLAGS) === 0x00 && o.mem.read8(PASS_COUNTER) === 4],
  ["low phase, no fire (mask 0x78)", [[PASS_COUNTER, 2], [MODE_DELAY_TIMER, 0x05], [INPUT_EDGE_FLAGS, 0x85]],
    (o) => o.mem.read8(INPUT_EDGE_FLAGS) === 0x05 && o.mem.read8(PASS_COUNTER) === 1],
  ["tick 0x10->0x09, fire, table entry", [[PASS_COUNTER, 0], [MODE_DELAY_TIMER, 0x10], [INPUT_EDGE_FLAGS, 0x88],
    sign(true), [PLAYER_SEGMENT, 3], [loc_3d, 0], ...KEEP_SEGMENT],
    (o) => o.mem.read8(MODE_DELAY_TIMER) === 0x09 && o.mem.read8(GAME_MODE) === 2 && o.mem.read8(loc_102) === 3],
  ["tick to phase 3 (sound), fire, random seat 1", [[PASS_COUNTER, 0], [MODE_DELAY_TIMER, 0x04],
    [INPUT_EDGE_FLAGS, 0x40], sign(false), [PLAYER_SEGMENT, 5], [loc_3d, 1], ...KEEP_SEGMENT],
    (o) => o.mem.read8(MODE_DELAY_TIMER) === 0x03 && o.mem.read8(GAME_MODE) === 2 && o.mem.read8(loc_102 + 1) === 5
      && o.mem.read8(loc_9f) === (RND & 7), RND_CAP],
  ["phase underflow 0x00->0x99 arms 0x10, fire", [[PASS_COUNTER, 0], [MODE_DELAY_TIMER, 0x00],
    [INPUT_EDGE_FLAGS, 0x80], sign(true), [loc_3d, 0]],
    (o) => o.mem.read8(MODE_DELAY_TIMER) === 0x99 && o.mem.read8(GAME_MODE) === 2],
  ["phase 8 uses mask 0x18 (0x40 does not fire)", [[PASS_COUNTER, 5], [MODE_DELAY_TIMER, 0x08], [INPUT_EDGE_FLAGS, 0x40]],
    (o) => o.mem.read8(GAME_MODE) !== 2 && o.mem.read8(INPUT_EDGE_FLAGS) === 0],
  ["rim fold: spin 2", [[PASS_COUNTER, 5], [MODE_DELAY_TIMER, 0x12], [INPUT_EDGE_FLAGS, 0], [SPINNER_ACCUM, 2],
    [RIM_ROT_OFFSET, 0]], (o) => o.mem.read8(RIM_ROT_OFFSET) === 0x10 && o.mem.read8(SPINNER_ACCUM) === 0],
  ["rim clamp: segment over ceiling", [[PASS_COUNTER, 5], [MODE_DELAY_TIMER, 0x12], [INPUT_EDGE_FLAGS, 0],
    [SPINNER_ACCUM, 0], [PLAYER_SEGMENT, 0x14], [DEPTH_CEILING, 0x0f]], (o) => o.mem.read8(PLAYER_SEGMENT) === 0x0f],
];

test("CRAFTED: a real capture with frozen RANDOM bit 2 set exists (random-entry arm host)", () => {
  assert.ok(RND_CAP, "no capture has frozen POKEY1_RANDOM & 4 set");
});

for (const [label, pokes, witness, cap] of ARMS) {
  test(`CRAFTED (${label}): RAM equal`, () => {
    const { o, c } = pair(pokes, cap);
    oracle(o);
    assert.ok(witness(o), `oracle did not take the ${label} arm`);
    tickWaveSpawnCadence(c);
    assert.equal(ramDiff(o, c), null);
  });
}

// BUG twin: forgets the trailing edge-flag trim for the entry's high bits (c7bd always sets bit7 first).
const broken = (m) => { const hi = m.mem8[INPUT_EDGE_FLAGS] & 0xf8; tickWaveSpawnCadence(m); m.mem8[INPUT_EDGE_FLAGS] |= hi; };

test("TEETH: the untrimmed-edge-flag twin diverges at INPUT_EDGE_FLAGS (crafted + every real dispatch)", () => {
  const { o, c } = pair(ARMS[0][1]);
  oracle(o); broken(c);
  assert.equal(ramDiff(o, c)?.addr, INPUT_EDGE_FLAGS);
  let caught = 0;
  for (const cap of CAPS) {
    if ((cap.mem.read8(INPUT_EDGE_FLAGS) & 0xf8) === 0) continue;
    const oo = freezePokey(cap.clone()), cc = freezePokey(cap.clone());
    try { oracle(oo); } catch { continue; }
    broken(cc);
    assert.notEqual(ramDiff(oo, cc), null, "twin escaped at a real dispatch");
    caught++;
  }
  console.log(`  TEETH: caught at ${caught} real dispatch(es)`);
});

test("SP-TOOTH: tickWaveSpawnCadence omits its ret and is seam-placeable (moved 0)", () => {
  const { c: m } = pair(ARMS[0][1]);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, tickWaveSpawnCadence, TARGET, m);
  assert.equal(r.placeable, true, `tickWaveSpawnCadence must be seam-placeable; got: ${r.error}`);
});
