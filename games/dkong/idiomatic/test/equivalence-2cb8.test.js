// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for releaseBarrelIntoFreeSlot (ROM 0x2CB8) — the 25m barrel-release slot claim.
 *
 * The scan above it (ROM 0x2C8F) walks the ten OBJ_ARRAY_67 barrel records counting down and
 * jumps here on the first record whose low two flag bits are clear. This routine turns that free
 * slot into a released barrel: it publishes the record as RENDER_OBJ_PTR, stamps its OBJ_ACTIVE
 * field with 2 ("occupied"), stores the matching ACTOR_SPRITES slot into RENDER_DST_PTR (the
 * scan's countdown runs 10..1 across records 0..9, so ten-minus-the-count is the record index),
 * latches the cluster's event gate (0x6393), posts the deferred "step the bonus readout down one
 * notch" task, decrements BONUS — on 25m the barrel release IS the bonus tick — and raises
 * BONUS_EXPIRED_STEP if that reaches zero. It then continues into loc_2ce6 with the counter's
 * address in the pointer register.
 *
 * CONTEXT, GROUNDED (live MAME 0.288 on the real dkong ROM, understanding pass 12,
 * scratchpad/pass12-grounding.md §2): this cluster is ORDINARY 25m BARREL PLAY, not a cutscene —
 * the older "0x2C-cluster cutscene renderer" framing is REFUTED. All 46 observed dispatches of
 * the downstream stampReleasedBarrelKind fell at gameplay substates (17 credited in-board 25m,
 * 29 attract 25m demo) and ZERO at substate 7, the opening Kong-climb cutscene; board 1 only;
 * each was preceded in the SAME frame by a slot claim here (46/46, none unmatched either way)
 * with the scan's countdown walking 10, 9, 8, 7…; and the claimed record was an OBJ_ARRAY_67
 * barrel record every time. A freshly claimed record was watched sitting at OBJ_ACTIVE == 2 for
 * ~28 frames before flipping to 1 when it started moving. Grounding deliberately did NOT
 * establish which NAMED Donkey Kong object either barrel kind is, so no lore name is used here.
 *
 * releaseBarrelIntoFreeSlot WRITES MEMORY (its own claim, the task ring, the bonus, and — through the
 * continuation — everything the loc_2ce6 / stampReleasedBarrelKind / advanceBarrelRelease chain touches), so
 * it is gated on memory-equivalence, not a returned scalar, and every case runs on FRESH clones.
 * The contract is RAM (minus the stack scratch below the entry SP) + pc + SP.
 *
 * LIVE-OUT: memory-only, plus the control-flow boundary. releaseBarrelIntoFreeSlot pushes nothing of its own that
 * survives (its `call 0x309F` bracket balances; its exit is a jump into loc_2ce6), and the chain
 * nets exactly ONE caller-return pop, performed downstream on its behalf. The idiomatic routine
 * models that as a plain JS return, so the harness performs one m.ret() on the candidate AFTER
 * the call to line pc + SP up with the oracle; the crafted cases additionally assert,
 * non-vacuously, that both sides land on the return address that was actually on the stack at
 * entry with SP popped by exactly 2. No register is asserted: every register the oracle leaves
 * (the scaled index, the computed pointers, the accumulator) is overwritten downstream before it
 * is read, and the scan's callers read none of them. The dead STACK_SCRATCH region — churned by
 * the oracle's dissolved `call 0x309F` bracket and by the downstream chain's `call 0x004E` — is
 * excluded by the contract.
 *
 *   0. REACHABILITY — hook 0x2CB8 in a plain attract run and measure: how many natural
 *      dispatches, which slot indices the scan's countdown reaches, the BONUS range, and whether
 *      the bonus-expiry arm is ever taken. Also asserts the claimed record really is
 *      OBJ_ARRAY_67 + index*0x20 at every dispatch, which is what makes "ten-minus-the-count is
 *      the record index" an observation rather than a reading of the caller.
 *
 *   1. EQUAL (real captured dispatches) — clone the machine at each true dispatch, run the
 *      ORACLE on one clone and releaseBarrelIntoFreeSlot on another, confirm identical RAM (minus the stack scratch below the entry SP)
 *      + pc + SP. These cover 8 of the 10 slot indices and none of the expiry arm.
 *
 *   2. EQUAL (crafted) — from a real captured dispatch, poke ONE byte identically on both sides:
 *      (a) every slot index 0..9, including the two attract never reaches, plus an exhaustive
 *          256-value sweep of the countdown that pins the slot arithmetic over its whole byte
 *          range;
 *      (b) an exhaustive 256-value sweep of BONUS, which reaches the bonus-expiry arm attract
 *          never does (the counter never fell below 37 in 14000 frames);
 *      (c) one case that drives the continuation through the renderer's acting frame instead of
 *          its frame-gate return, so the RENDER_DST_PTR this routine computes is actually
 *          dereferenced by stepBarrelAlongReleasePath.
 *      Non-vacuity: the claim, the two pointers, the gate latch, the posted task message, the
 *      new counter and the expiry latch are each asserted on BOTH sides.
 *
 *   3. TEETH — five broken twins, each MUST be caught:
 *      (a) wrong slot index — uses the countdown itself instead of ten-minus-the-countdown, so
 *          RENDER_DST_PTR names the wrong sprite slot.
 *      (b) wrong claim value — marks the record active (1) instead of occupied (2), so the next
 *          scan would treat it as a live barrel rather than a claimed slot.
 *      (c) dropped expiry latch — never raises BONUS_EXPIRED_STEP when the counter hits zero.
 *      (d) dropped task post — decrements the counter but never posts the readout task.
 *      (e) dropped continuation — does the whole claim but returns without continuing into
 *          loc_2ce6, so the downstream preset and renderer tick are missing.
 *
 * OBSERVED FAILING against the real candidate, not only against the twins. Injecting an
 * off-by-one into releaseBarrelIntoFreeSlot's slot index fails three separate cases here —
 * the captured-dispatch job (`RAM@0x62ac oracle=128 cand=124`), the exhaustive countdown
 * sweep (`countdown 1: RAM@0x62ac oracle=164 cand=160`) and the BONUS sweep (`bonus 0:
 * RAM@0x62ac oracle=128 cand=124`) — and the teeth job independently reports each of the five
 * twins' first divergence, including the dropped expiry latch at `RAM@0x6386 oracle=1 cand=0`,
 * which only the crafted BONUS sweep reaches because attract never drives the counter to zero.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2cb8.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2cb8 as oracle } from "../../translated/loc_2cb8.js";
import { releaseBarrelIntoFreeSlot } from "../releaseBarrelIntoFreeSlot.js";
import { enqueueTask } from "../enqueueTask.js";
import { loc_2ce6 } from "../loc_2ce6.js";
import { Machine } from "../../machine.js";
import { u8 } from "../../../../core/int.js";
import {
  STACK_SCRATCH, RENDER_OBJ_PTR, RENDER_DST_PTR, ACTOR_SPRITES, OBJ_ACTIVE, OBJ_ARRAY_67,
  BONUS, BONUS_EXPIRED_STEP, TASK_TAIL, TASK_RING,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2cb8;
const FRAMES = 14000; // the attract window the reachability numbers in the routine header quote

// Constants the routine is built on, restated here rather than imported from it, so the test
// asserts against an independent statement of the contract.
const EVENT_GATE = 0x6393; // the cluster's one-shot "a barrel went out" latch (unnamed in names.js)
const SLOT_CLAIMED = 2; // OBJ_ACTIVE bit 1 = occupied
const BARREL_SLOTS = 10;
const OBJ_RECORD_STRIDE = 0x20; // stride of an OBJ_ARRAY_67 record
const SPRITE_RECORD_BYTES = 4; // stride of an ACTOR_SPRITES record
const TASK_OPCODE = 5;
const TASK_ARG = 1;

// Downstream renderer control bytes, poked so each crafted case picks a deterministic path.
const FRAME_GATE = 0x62af; // advanceBarrelRelease's per-tick down-counter (unnamed)
const ANIM_COUNTER = 0x638f; // advanceBarrelRelease's animation sub-counter (unnamed)

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const slotAddr = (count) => ACTOR_SPRITES + u8((BARREL_SLOTS - count) * SPRITE_RECORD_BYTES);

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs, skipping the stack scratch below the entry SP. */
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Run the ORACLE on a fresh clone. Its chain performs its own terminal `ret`. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/** Run a candidate on a fresh clone, then model its single terminal `ret` with one m.ret() so pc + SP match the
 *  oracle's (the idiomatic chain replaces the Z80 stack with the JS call stack). */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Full contract diff: RAM − the stack scratch below the entry SP, pc, SP. Live-out is memory + the return boundary. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}

// -- capture ------------------------------------------------------------------

/**
 * ONE attract run serves every test below: it hooks 0x2CB8, records the reachability census, and
 * clones the machine at each true dispatch. Memoised because a Machine run is the expensive part
 * and the clones are read-only here — every case clones again before touching anything.
 */
let ATTRACT = null;
function attractRun() {
  if (ATTRACT) return ATTRACT;
  const caps = [];
  const census = { count: 0, expiryArm: 0, recordMatchesIndex: 0, indices: new Set(), records: new Set(), bonuses: [] };
  const snapshot = new Map([[TARGET, (mm) => {
    census.count++;
    census.indices.add(BARREL_SLOTS - mm.regs.b);
    census.records.add(mm.regs.ix);
    const b = mm.mem.read8(BONUS);
    census.bonuses.push(b);
    if (u8(b - 1) === 0) census.expiryArm++;
    if (mm.regs.ix === OBJ_ARRAY_67 + (BARREL_SLOTS - mm.regs.b) * OBJ_RECORD_STRIDE) census.recordMatchesIndex++;
    caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(FRAMES);
  ATTRACT = { caps, census };
  return ATTRACT;
}

/**
 * A crafted dispatch: a REAL captured entry with a surgical nudge — the scan's countdown, the
 * bonus counter, and the downstream renderer's control bytes. The expiry latch is pre-cleared so
 * its write is observable. Applied to a clone, so the capture itself is untouched.
 */
function craft(cap, { count, bonus, gate = 0x05, counter = 0x00 } = {}) {
  const m = cap.clone();
  if (count !== undefined) m.regs.b = count;
  if (bonus !== undefined) m.mem.write8(BONUS, bonus);
  m.mem.write8(BONUS_EXPIRED_STEP, 0);
  m.mem.write8(FRAME_GATE, gate);
  m.mem.write8(ANIM_COUNTER, counter);
  return m;
}

/** Assert every observable effect of the claim on one finished machine. */
function assertClaim(label, entry, out) {
  const count = entry.regs.b;
  const record = entry.regs.ix;
  const bonusIn = entry.mem.read8(BONUS);
  const remaining = u8(bonusIn - 1);

  assert.equal(out.mem.read16(RENDER_OBJ_PTR), record, `${label}: RENDER_OBJ_PTR`);
  assert.equal(out.mem.read8(record + OBJ_ACTIVE), SLOT_CLAIMED, `${label}: record claim flag`);
  assert.equal(out.mem.read16(RENDER_DST_PTR), slotAddr(count), `${label}: RENDER_DST_PTR`);
  assert.equal(out.mem.read8(EVENT_GATE), 1, `${label}: event gate latched`);
  assert.equal(out.mem.read8(BONUS), remaining, `${label}: bonus decremented`);
  assert.equal(
    out.mem.read8(BONUS_EXPIRED_STEP), remaining === 0 ? 1 : 0,
    `${label}: expiry latch (bonus ${bonusIn} -> ${remaining})`,
  );

  // The task message really landed in the ring, when the ring had room at the tail.
  const tail = entry.mem.read8(TASK_TAIL);
  const slot = (TASK_RING & 0xff00) | tail;
  if ((entry.mem.read8(slot) & 0x80) !== 0) {
    assert.equal(out.mem.read8(slot), TASK_OPCODE, `${label}: posted task opcode`);
    assert.equal(out.mem.read8((TASK_RING & 0xff00) | u8(tail + 1)), TASK_ARG, `${label}: posted task argument`);
  }
}

// -- broken twins -------------------------------------------------------------

/** The correct body, parameterised so each twin differs in exactly one place. */
function twin(m, bug) {
  const { regs, mem } = m;
  const record = regs.ix;
  mem.write16(RENDER_OBJ_PTR, record);
  mem.write8(record + OBJ_ACTIVE, bug === "claim" ? 1 : SLOT_CLAIMED);
  const offset = bug === "index"
    ? u8(regs.b * SPRITE_RECORD_BYTES) // BUG: the countdown itself, not ten-minus-it
    : u8((BARREL_SLOTS - regs.b) * SPRITE_RECORD_BYTES);
  mem.write16(RENDER_DST_PTR, ACTOR_SPRITES + offset);
  mem.write8(EVENT_GATE, 1);
  if (bug !== "task") {
    regs.d = TASK_OPCODE;
    regs.e = TASK_ARG;
    enqueueTask(m);
  }
  const remaining = u8(mem.read8(BONUS) - 1);
  mem.write8(BONUS, remaining);
  if (remaining === 0 && bug !== "expiry") mem.write8(BONUS_EXPIRED_STEP, 1);
  regs.hl = BONUS;
  if (bug === "continuation") return; // BUG: never continues into loc_2ce6
  return loc_2ce6(m);
}

const brokenSlotIndex = (m) => twin(m, "index");
const brokenClaimValue = (m) => twin(m, "claim");
const brokenExpiryLatch = (m) => twin(m, "expiry");
const brokenTaskPost = (m) => twin(m, "task");
const brokenContinuation = (m) => twin(m, "continuation");

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x2CB8 is dispatched during attract, always on an OBJ_ARRAY_67 record", () => {
  const { count, expiryArm, indices, records, bonuses, recordMatchesIndex } = attractRun().census;

  assert.ok(count > 0, "0x2CB8 should be dispatched — the 25m barrel-release slot claim");
  // The claimed record IS the record the countdown names: this is what makes the slot index
  // an observation rather than a reading of the caller's loop.
  assert.equal(recordMatchesIndex, count, "every claimed record should be OBJ_ARRAY_67 + index*0x20");
  for (const r of records) {
    assert.ok(r >= OBJ_ARRAY_67 && r < OBJ_ARRAY_67 + BARREL_SLOTS * OBJ_RECORD_STRIDE, `record ${hx(r)} in OBJ_ARRAY_67`);
  }
  // Attract never charges the bonus down to zero, which is why the expiry arm is crafted.
  assert.equal(expiryArm, 0, "attract is not expected to reach the bonus-expiry arm");
  console.log(
    `  REACHABILITY: ${count} natural 0x2CB8 dispatches in ${FRAMES} frames; ` +
    `slot indices ${[...indices].sort((a, b) => a - b).join(",")} of 0..${BARREL_SLOTS - 1}; ` +
    `records ${[...records].sort((a, b) => a - b).map(hx).join(",")}; ` +
    `BONUS ${Math.max(...bonuses)}..${Math.min(...bonuses)}; expiry arm ${expiryArm}`,
  );
});

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): releaseBarrelIntoFreeSlot == oracle on every captured 0x2CB8 entry", () => {
  const { caps } = attractRun();
  assert.ok(caps.length >= 1, "expected at least one real 0x2CB8 dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, releaseBarrelIntoFreeSlot); // FRESH clones inside — cap is untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
    assertClaim("real", cap, runCandidate(cap, releaseBarrelIntoFreeSlot));
    assertClaim("real/oracle", cap, runOracle(cap));
  }
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical to the oracle`);
});

// -- 2. EQUAL (crafted) -------------------------------------------------------

test("EQUAL (crafted): every slot index, the whole countdown byte range, and an acting renderer frame", () => {
  const cap = attractRun().caps[0];
  assert.ok(cap, "expected a real 0x2CB8 dispatch to craft from");

  // (a) every slot index the scan can produce — attract only reaches 0..7.
  for (let count = 1; count <= BARREL_SLOTS; count++) {
    const entry = craft(cap, { count });
    const diffs = contractDiffs(entry, releaseBarrelIntoFreeSlot);
    assert.equal(diffs.length, 0, `countdown ${count}: ${diffs.join("; ")}`);
    const c = runCandidate(entry, releaseBarrelIntoFreeSlot);
    assertClaim(`countdown ${count}`, entry, c);
    assertClaim(`countdown ${count}/oracle`, entry, runOracle(entry));
    assert.equal(
      c.mem.read16(RENDER_DST_PTR), ACTOR_SPRITES + (BARREL_SLOTS - count) * SPRITE_RECORD_BYTES,
      `countdown ${count}: slot index should be ten-minus-the-countdown`,
    );
  }

  // (a') exhaustive over the countdown's whole byte range — pins the scaled index, wrap included.
  for (let count = 0; count < 256; count++) {
    const diffs = contractDiffs(craft(cap, { count }), releaseBarrelIntoFreeSlot);
    assert.equal(diffs.length, 0, `countdown sweep ${count}: ${diffs.join("; ")}`);
  }

  // (c) the continuation actually runs the renderer's acting frame, so the destination pointer
  //     this routine computes is dereferenced rather than merely stored.
  const acting = craft(cap, { count: 6, gate: 0x01, counter: 0x00 });
  const actingDiffs = contractDiffs(acting, releaseBarrelIntoFreeSlot);
  assert.equal(actingDiffs.length, 0, `acting renderer frame: ${actingDiffs.join("; ")}`);
  const actingOut = runCandidate(acting, releaseBarrelIntoFreeSlot);
  assertClaim("acting renderer frame", acting, actingOut);
  // Non-vacuity: the renderer really took its acting frame (it reloads the gate) rather than
  // returning at the gate as every other crafted case does.
  assert.equal(actingOut.mem.read8(FRAME_GATE), 0x18, "the acting renderer frame should have reloaded the gate");
  assert.equal(runOracle(acting).mem.read8(FRAME_GATE), 0x18, "oracle: the acting renderer frame should have run");

  // Live-out: both sides return to the address that was on the stack at entry, SP popped by 2.
  const retAddr = acting.mem.read16(acting.regs.sp);
  assert.equal(runOracle(acting).pc, retAddr, `oracle should return to ${hx(retAddr)}`);
  assert.equal(actingOut.pc, retAddr, `releaseBarrelIntoFreeSlot should return to ${hx(retAddr)}`);
  assert.equal(actingOut.regs.sp, (acting.regs.sp + 2) & 0xffff, "SP should pop exactly one return address");

  console.log(
    `  EQUAL/crafted: slot indices 0..${BARREL_SLOTS - 1} + a 256-value countdown sweep + an ` +
    "acting renderer frame, all identical to the oracle",
  );
});

test("EQUAL (crafted): exhaustive BONUS sweep reaches the bonus-expiry arm attract never does", () => {
  const cap = attractRun().caps[0];
  let expiryCases = 0;
  for (let bonus = 0; bonus < 256; bonus++) {
    const entry = craft(cap, { bonus });
    const diffs = contractDiffs(entry, releaseBarrelIntoFreeSlot);
    assert.equal(diffs.length, 0, `bonus ${bonus}: ${diffs.join("; ")}`);
    const c = runCandidate(entry, releaseBarrelIntoFreeSlot);
    assertClaim(`bonus ${bonus}`, entry, c);
    assertClaim(`bonus ${bonus}/oracle`, entry, runOracle(entry));
    if (u8(bonus - 1) === 0) expiryCases++;
  }
  assert.equal(expiryCases, 1, "exactly one swept value (1) should reach the expiry arm");
  console.log("  EQUAL/crafted: 256 BONUS values identical to the oracle, including the expiry arm at 1");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: all five broken twins are CAUGHT", () => {
  const cap = attractRun().caps[0];

  // (a) wrong slot index: countdown 3 addresses slot 7; using the countdown itself gives slot 3.
  const indexDiffs = contractDiffs(craft(cap, { count: 3 }), brokenSlotIndex);
  assert.ok(indexDiffs.length > 0, "the wrong-slot-index twin escaped — the render destination is unproven");
  assert.ok(
    indexDiffs[0].startsWith(`RAM@${hx(RENDER_DST_PTR)}`),
    `expected the diff at RENDER_DST_PTR ${hx(RENDER_DST_PTR)}, got ${indexDiffs[0]}`,
  );

  // (b) wrong claim value: marking the record active (1) instead of occupied (2).
  const claimEntry = craft(cap, { count: 6 });
  const claimDiffs = contractDiffs(claimEntry, brokenClaimValue);
  assert.ok(claimDiffs.length > 0, "the wrong-claim-value twin escaped — the claim flag is unproven");
  assert.ok(
    claimDiffs[0].startsWith(`RAM@${hx(claimEntry.regs.ix + OBJ_ACTIVE)}`),
    `expected the diff at the claimed record ${hx(claimEntry.regs.ix + OBJ_ACTIVE)}, got ${claimDiffs[0]}`,
  );

  // (c) dropped expiry latch — only visible on the crafted arm where the counter reaches zero.
  const expiryDiffs = contractDiffs(craft(cap, { bonus: 1 }), brokenExpiryLatch);
  assert.ok(expiryDiffs.length > 0, "the dropped-expiry-latch twin escaped — the expiry arm is unproven");
  assert.ok(
    expiryDiffs[0].startsWith(`RAM@${hx(BONUS_EXPIRED_STEP)}`),
    `expected the diff at BONUS_EXPIRED_STEP ${hx(BONUS_EXPIRED_STEP)}, got ${expiryDiffs[0]}`,
  );

  // (d) dropped task post — the ring tail never advances and the message never lands.
  const taskDiffs = contractDiffs(craft(cap, {}), brokenTaskPost);
  assert.ok(taskDiffs.length > 0, "the dropped-task-post twin escaped — the deferred post is unproven");
  assert.ok(
    taskDiffs[0].startsWith(`RAM@${hx(TASK_TAIL)}`),
    `expected the diff at TASK_TAIL ${hx(TASK_TAIL)}, got ${taskDiffs[0]}`,
  );

  // (e) dropped continuation — the downstream renderer's frame gate is never decremented.
  const contDiffs = contractDiffs(craft(cap, {}), brokenContinuation);
  assert.ok(contDiffs.length > 0, "the dropped-continuation twin escaped — the continuation is unproven");
  assert.ok(
    contDiffs[0].startsWith(`RAM@${hx(FRAME_GATE)}`),
    `expected the diff at the renderer frame gate ${hx(FRAME_GATE)}, got ${contDiffs[0]}`,
  );

  console.log(
    `  TEETH: slot index (${indexDiffs[0]}); claim value (${claimDiffs[0]}); ` +
    `expiry latch (${expiryDiffs[0]}); task post (${taskDiffs[0]}); continuation (${contDiffs[0]})`,
  );
});
