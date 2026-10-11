// SPDX-License-Identifier: GPL-3.0-only
/** launchBankEnemyWhenAimedNearPlayer — one gated attempt to launch an enemy into the object bank. Four gates guard it: a
 * phase key that only lets one bank phase through, a launch cooldown that must have run out, a non-zero scan bound, and a
 * free record in the bank being found by a strided upward scan. When all pass, three window tests
 * follow: the craft must NOT sit near the player's fixed screen position on both axes, its heading
 * must lie near the player's heading, and the heading toward the aim point must lie near its own;
 * only then
 * does it request the launch sound, copy the launching craft's (caller's) two coordinates into the found record's
 * paired entry, look a velocity pair up from the heading (one of two tables, chosen by a select
 * cell), stock the record with that velocity, stamp two entry constants, reload the cooldown from its
 * source, and count the record head down one. The scan cursors, the margin scratch and the found
 * pointers are JS locals; the craft's record and sprite-entry pointers ride in on ix/iy and are never disturbed, so both
 * stay seated as the only register live-outs (the sprite/steer callees downstream read them). The
 * heading passes into the velocity shims as an argument. LIVE-OUT: the found
 * record and its entry, the pointer cells, the cooldown; and ix/iy held. Nothing is returned. */
//
// ROM 0x3ED6-0x3F92, plus the detached block 0x3F9E-0x3FAE (lift: translated/loc_3ed6.js). Grounding
// tag in names.js ROUTINES: [seen].
//
// ROLE IN THE MACHINE. This is how an ordinary enemy craft FIRES at the player. Each era's per-slot
// craft handler (serviceEra0EnemyCraftSlot ... serviceEra4EnemyCraftSlot) calls it with IX/IY on that
// craft's record and sprite entry. The shot goes into one of the four enemy-shot slots
// (ACTOR_RECORD_SLOT0..3, 0xA810-0xA840, [seen]). Per mechanisms.md ("Enemy weapons and special
// craft, era by era") it fires only when: the craft is on its one-in-eight turn, BANK_LAUNCH_COOLDOWN
// has run out, one of the first BANK_LAUNCH_SLOT_COUNT shot slots is free, the craft is NOT within
// the near band of the player's fixed screen position on both axes, the craft's heading is within
// BANK_LAUNCH_HEADING_HALF_WIDTH of the player's heading, and the heading toward the aim point is within 16
// of the craft's own. The shot then starts at the craft and flies along that aim heading.
//
// PARAMETERS. `ixEntry` is the launching craft's record (the ROM's IX), `iyEntry` its sprite entry
// (IY). Every cell named below is tagged [seen] in names.js.
//
// THE WINDOW TEST used throughout below: for a half-width h, `(target - value) + h` taken as a byte is
// below 2h exactly when value lies within h of target (the wrap turns "too far either side" into one
// unsigned compare).

import { u8, u16 } from "../../../core/int.js";
import { headingToward } from "./headingToward.js";
import { requestEraKeyedLaunchSound } from "./requestEraKeyedLaunchSound.js";
import { loc_59cb } from "./loc_59cb.js";
import { loc_59d1 } from "./loc_59d1.js";
import { ACTOR_ENTRY_SLOT0, ACTOR_RECORD_SLOT0, BANK_LAUNCH_COOLDOWN, BANK_LAUNCH_COOLDOWN_PERIOD, BANK_LAUNCH_HEADING_HALF_WIDTH, BANK_LAUNCH_NEAR_HALF_WIDTH, BANK_LAUNCH_SLOT_COUNT, ENEMY_STANDOFF_AIM_MAIN, ERA_INDEX, FRAME_TICK, PLAYER_HEADING, SCRATCH_PTR_A, SCRATCH_PTR_B } from "./names.js";

// Offsets. Sprite entry: +0x00 and +0x31 are the two coordinate bytes, +0x01 the shape, +0x30 the
// attribute. Record: +0x02 is the heading field every actor family shares (see PLAYER_HEADING in
// names.js), +0x0F the craft's phase key, +0x0A..+0x0D the two
// 16-bit velocity components. Records are 0x10 apart; sprite entries 2 apart.
const SPRITE_ATTRIBUTE = 0x30;

const PHASE_KEY = 0x0f;
const HEADING = 0x02;
const COORD_Y = 0x31;
const VELOCITY = 0x0a;
const RECORD_STRIDE = 0x10;

export function launchBankEnemyWhenAimedNearPlayer(m, ixEntry = m.regs.ix, iyEntry = m.regs.iy) {
  const { mem8, mem16 } = m;

  // GATE 1 -- THIS CRAFT'S TURN (0x3ED6-0x3EE0). FRAME_TICK's low three bits count 0-7, plus 5; only
  // the craft whose +0x0F phase key matches may try this frame, so each craft gets one frame in eight.
  if (((mem8[FRAME_TICK] & 0x07) + 0x05) !== mem8[u16(ixEntry + PHASE_KEY)]) return; // wrong bank phase this frame
  // GATE 2 -- COOLDOWN (0xA817). Non-zero means a recent launch is still cooling down (a vblank timer
  // winds it to zero); it is re-armed at the end of a successful launch.
  if (mem8[BANK_LAUNCH_COOLDOWN] !== 0) return; // still cooling down

  // GATE 3 -- A FREE SHOT SLOT (0x3EE9-0x3EFE). BANK_LAUNCH_SLOT_COUNT (0xA844) bounds how many of the
  // shot slots may be used; zero disables firing altogether. Walk records from 0xA810 (stride 0x10) and
  // entries from 0xAA12 (stride 2), stepping only the low byte as the ROM does (`add a,0x10` into L,
  // `inc e` twice), until a record whose head byte is zero -- a free slot.
  if (mem8[BANK_LAUNCH_SLOT_COUNT] === 0) return;
  let record = ACTOR_RECORD_SLOT0;
  let entry = ACTOR_ENTRY_SLOT0;
  let count = mem8[BANK_LAUNCH_SLOT_COUNT];

  let freeSlot = false;
  do {
    if (mem8[record] === 0) { freeSlot = true; break; }
    record = (record & (0xff << 8)) | u8((record & 0xff) + RECORD_STRIDE);
    entry = (entry & (0xff << 8)) | u8((entry & 0xff) + 2);
    count = u8(count - 1);
  } while (count !== 0);
  if (!freeSlot) return; // bank full

  // Park the free slot's pointers in the two scratch cells (0xA991/0xA993); they are read back below
  // once all the aiming gates have passed.
  mem16[SCRATCH_PTR_A] = record;
  mem16[SCRATCH_PTR_B] = entry;

  // margin window against the player entry: vertical, and horizontal only if the vertical is close
  // GATE 4 -- NOT ON TOP OF THE PLAYER (0x3F09-0x3F1C). The player's ship is pinned at a fixed screen
  // position, 0x78 on the +0x31 axis and 0x84 on the +0x00 axis. If the craft is within
  // BANK_LAUNCH_NEAR_HALF_WIDTH (0xA827) of it on the first axis AND on the second, give up.
  const halfNear = mem8[BANK_LAUNCH_NEAR_HALF_WIDTH];
  const fullNear = u8(halfNear + halfNear);
  let near = u8(u8(0x78 - mem8[u16(iyEntry + COORD_Y)]) + halfNear);
  if (near < fullNear) {
    near = u8(u8(0x84 - mem8[iyEntry]) + halfNear);
    if (near < fullNear) return;
  }

  // GATE 5 -- FLYING THE PLAYER'S WAY (0x3F1D-0x3F2B). The craft's heading must be within
  // BANK_LAUNCH_HEADING_HALF_WIDTH (0xA837) of PLAYER_HEADING (0xA802).
  const halfHeading = mem8[BANK_LAUNCH_HEADING_HALF_WIDTH];
  const fullHeading = u8(halfHeading + halfHeading);
  const headingGap = u8(u8(mem8[PLAYER_HEADING] - mem8[u16(ixEntry + HEADING)]) + halfHeading);
  if (headingGap >= fullHeading) return;

  // (ROM 0x3F2D diverts to an extra window at 0x3F9E when the entry cursor's high byte is 0x02; the
  // cursor stays on the sprite-entry page, so that divert is never taken.)

  // GATE 6 -- AIMED (0x3F32-0x3F40). headingToward (0x33B8) gives the heading from the craft to
  // ENEMY_STANDOFF_AIM_MAIN (0xAC7F), a point standing off the player's ship. The craft fires only if
  // that heading is within 16 steps (out of 256) of its own: the window test with h = 0x10.
  const heading = headingToward(m, ENEMY_STANDOFF_AIM_MAIN, iyEntry);
  const aim = u8(u8(heading - mem8[u16(ixEntry + HEADING)]) + 0x10);
  if (aim >= 0x20) return; // aim not aligned to the object's own heading

  // LAUNCH. Request the launch sound (call 0x3F93; play-gated, so the attract demo stays silent).
  requestEraKeyedLaunchSound(m);

  // Start the shot at the craft: copy the craft's two sprite coordinates into the free slot's entry,
  // found again through the scratch cells (`ld ix,(0xa991)` / `ld iy,(0xa993)`).
  const coordY = mem8[u16(iyEntry + COORD_Y)];
  const coordX = mem8[iyEntry];
  const recIx = mem16[SCRATCH_PTR_A];
  const entIy = mem16[SCRATCH_PTR_B];
  mem8[u16(entIy + COORD_Y)] = coordY;
  mem8[entIy] = coordX;

  // Velocity along the aim heading: the doubled component pair from one of two sample tables, the
  // third table (loc_59d1) from era 1 on and the second (loc_59cb) in era 0, keyed on ERA_INDEX (0xAD04).
  const [alongFirstAxis, alongSecondAxis] = mem8[ERA_INDEX] !== 0 ? loc_59d1(m, heading) : loc_59cb(m, heading);

  // the shim's doubled pair: de then bc, stored low, high, low, high
  mem8[u16(recIx + VELOCITY + 0)] = alongFirstAxis;
  mem8[u16(recIx + VELOCITY + 1)] = alongFirstAxis >> 8;
  mem8[u16(recIx + VELOCITY + 2)] = alongSecondAxis;
  mem8[u16(recIx + VELOCITY + 3)] = alongSecondAxis >> 8;
  // Stamp the shot's sprite: shape 0x4D and attribute 0x62 (0x3F7D-0x3F85). Then re-arm the cooldown
  // from its fixed period BANK_LAUNCH_COOLDOWN_PERIOD (0xA814), and count the new record's head byte
  // down one (`dec (ix+0x00)`), which marks the slot as taken.
  mem8[u16(entIy + 0x01)] = 0x4d;
  mem8[u16(entIy + SPRITE_ATTRIBUTE)] = 0x62;
  mem8[BANK_LAUNCH_COOLDOWN] = mem8[BANK_LAUNCH_COOLDOWN_PERIOD];
  mem8[recIx] = u8(mem8[recIx] - 1);
}
