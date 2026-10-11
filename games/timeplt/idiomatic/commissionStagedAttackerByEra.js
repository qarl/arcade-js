// SPDX-License-Identifier: GPL-3.0-only
/** commissionStagedAttackerByEra — commission the object the slot-finder staged, whose record and paired-entry pointers
 * wait in two fixed cells. Copies the spawner's two coordinate pairs and the caller's facing byte
 * across into the new slot, then fits it out one of four ways chosen by the current era: era zero
 * an unaimed throw with a fixed shape, flip bits from a mirror flag and a seeded velocity word; eras one and two a heading toward a
 * fixed screen point skewed a quarter turn to one side or the other, picked by a stored bit; era three a velocity vector for a heading
 * offset a fixed step either side of the facing; era four a straight aim at that same point, with
 * one extra byte seeded. Every way counts the new slot's head byte down from free (0x00) to live (0xFF), re-arms the spawn
 * cooldown, and hands off to a sound request (eras one and two share era three's). The staged record/entry pointers ride
 * in JS locals and are handed to each callee as arguments, so the spawner's own index registers are
 * never moved and stand at the spawner throughout. LIVE-OUT: memory; the two index registers, left
 * at the spawner; and whatever the sound request leaves. */
//
// ROM 0x42B7-0x43B6 (lift: translated/loc_42b7.js). Grounding tag in names.js ROUTINES: [seen].
//
// ROLE IN THE MACHINE. The era weapon bank (ERA_OBJECT_RECORD_SLOT0-2, 0xA8C0-0xA8E0) holds a
// different kind of enemy weapon in each era (mechanisms.md, "Enemy weapons and special craft, era by
// era"). An enemy that is allowed to launch one first has a free slot found for it:
// launchAttackerIntoFreeSlot (0x4243) walks the bank and parks the free slot's record pointer in
// SCRATCH_PTR_A (0xA991) and its sprite-entry pointer in SCRATCH_PTR_B (0xA993), then either comes here
// directly or goes through setTheLaunchFacingInsideOneAimWindow (0x429C), which transfers here in turn.
// This routine turns that empty slot into a live weapon: it starts it at the launcher's position and
// gives it the heading, velocity, look and timers its era calls for.
//
// PARAMETERS. `spawnerRecord` / `spawnerEntry` are the LAUNCHING object's record and sprite entry (the
// ROM's IX / IY on entry); `facing` (the ROM's C) is the heading the caller chose for the launch.
// The ROM pushes IX/IY, loads them with the new slot, and pops them back before its tail; here the
// new slot's pointers are simply locals.
//
// LIVE-OUT: memory -- the new slot's record and sprite entry, ATTACKER_SPAWN_COOLDOWN, and the sound
// request. Every cell named below is tagged [seen] in names.js.

import { loc_598e } from "./loc_598e.js";
import { dressSpriteShapeAndAttributeForHeadingSector } from "./dressSpriteShapeAndAttributeForHeadingSector.js";
import { headingToward } from "./headingToward.js";
import { requestAttackerSpawnSoundEra0 } from "./requestAttackerSpawnSoundEra0.js";
import { requestAttackerSpawnSoundLateEra } from "./requestAttackerSpawnSoundLateEra.js";
import { requestTwoSoundsWhilePlaying } from "./requestTwoSoundsWhilePlaying.js";
import { u8 } from "../../../core/int.js";
import { ATTACKER_SPAWN_AIM_WINDOW_HALF, ATTACKER_SPAWN_COOLDOWN, ATTACKER_SPAWN_COOLDOWN_PERIOD, ENEMY_STANDOFF_AIM_MAIN, ERA_INDEX, SCRATCH_PTR_A, SCRATCH_PTR_B } from "./names.js";

// Era 3's launch heading is set off the facing by this many steps (out of 256 round the circle),
// `add a,0x1a` / `sub 0x1a` at 0x4378-0x4381.
const OFFSET_STEP = 0x1a;

export function commissionStagedAttackerByEra(m, spawnerRecord = m.regs.ix, spawnerEntry = m.regs.iy, facing = m.regs.c) {
  const { mem8 } = m;

  // STEP 1 -- READ THE LAUNCHER'S POSITION (0x42B7-0x42C3). Each axis is split across the record and
  // the sprite entry: the vertical whole part in the entry's +0x31 byte with its fraction at record
  // +0x03, the horizontal whole part in the entry's +0x00 byte with its fraction at record +0x05.
  const verticalWhole = mem8[spawnerEntry + 0x31];
  const verticalFraction = mem8[spawnerRecord + 0x03];
  const horizontalWhole = mem8[spawnerEntry + 0x00];
  const horizontalFraction = mem8[spawnerRecord + 0x05];

  // STEP 2 -- FIND THE NEW SLOT. The slot finder left the free slot's record pointer in SCRATCH_PTR_A
  // (0xA991) and its sprite-entry pointer in SCRATCH_PTR_B (0xA993) (`ld ix,(0xa991)` / `ld iy,(0xa993)`).
  const record = m.mem16[SCRATCH_PTR_A];
  const entry = m.mem16[SCRATCH_PTR_B];

  // STEP 3 -- START IT WHERE THE LAUNCHER IS (0x42D1-0x42E0): copy both coordinate pairs across, and
  // store the caller's facing in the new record's +0x01.
  mem8[record + 0x03] = verticalFraction;
  mem8[entry + 0x31] = verticalWhole;
  mem8[record + 0x05] = horizontalFraction;
  mem8[entry + 0x00] = horizontalWhole;
  mem8[record + 0x01] = facing;

  // STEP 4 -- FIT IT OUT BY ERA. ERA_INDEX (0xAD04) is 0-4; the ROM tests 4, then 0, then 3, and
  // eras 1-2 take what is left.
  const era = mem8[ERA_INDEX];

  // The shared ending of every arm: count the new record's head byte down one (`dec (ix+0x00)`), re-arm
  // the shared spawn cooldown from its fixed period (ATTACKER_SPAWN_COOLDOWN 0xA8F4 <-
  // ATTACKER_SPAWN_COOLDOWN_PERIOD 0xA8F6), so the bank cannot launch again at once, and tail into the
  // era's sound request.
  const tailOff = (tail) => {
    mem8[record + 0x00] = u8(mem8[record + 0x00] - 1);
    mem8[ATTACKER_SPAWN_COOLDOWN] = mem8[ATTACKER_SPAWN_COOLDOWN_PERIOD];
    return tail(m);
  };

  // ERA 0 (0x42EC-0x4310): a thrown object, flown later along a ballistic arc (mechanisms.md). No heading
  // is aimed: the sprite entry's +0x01 gets the fixed shape code 0x4F, its +0x30 attribute is 0x0B
  // plus its flip bits 7-6 both copied from bit 0 of C (`rrca` / `sra a` / `and 0xc0`), and record bytes
  // +0x07/+0x08 are seeded 0x00 and 0xFF (names.js: the velocity word, 0xFF00). Sound: requestAttackerSpawnSoundEra0 (0x5664).
  if (era === 0) {
    mem8[entry + 0x01] = 0x4f;
    let mirror = ((facing >> 1) | (facing << 7)) & 0xff; // rrca
    mirror = (mirror >> 1) | (mirror & 0x80); // sra a: keep only the facing's bit 0, in bits 7 and 6
    mem8[entry + 0x30] = ((mirror & 0xc0) + 0x0b);
    mem8[record + 0x07] = 0x00;
    mem8[record + 0x08] = 0xff;
    return tailOff(requestAttackerSpawnSoundEra0);
  }

  // ERA 4 extra (0x43AE-0x43B4): seed the new record's +0x04 from ATTACKER_SPAWN_AIM_WINDOW_HALF
  // (0xA8E6) -- that cell's documented second use -- then carry on into the aimed path below.
  if (era === 4) mem8[record + 0x04] = mem8[ATTACKER_SPAWN_AIM_WINDOW_HALF];

  // ERA 3 (0x436F-0x43AB): a weapon launched a fixed step off the facing, toward the side the facing
  // lies in, with its velocity fixed at launch.
  if (era === 3) {
    const backHalf = (facing + 0x40) & 0x80; // which half of the circle the facing lies in
    mem8[record + 0x02] = backHalf ? u8(facing - OFFSET_STEP) : u8(facing + OFFSET_STEP);
    // Look up the doubled velocity component pair for that offset heading (call 0x598E) and store the
    // two 16-bit components in the record's +0x0A..+0x0D.
    const [alongFirstAxis, alongSecondAxis] = loc_598e(m, mem8[record + 0x02]);
    mem8[record + 0x0a] = alongFirstAxis;
    mem8[record + 0x0b] = alongFirstAxis >> 8;
    mem8[record + 0x0c] = alongSecondAxis;
    mem8[record + 0x0d] = alongSecondAxis >> 8;
    // Then put the un-offset facing back in +0x02 (the ROM's `pop bc`), point the sprite for it (call
    // 0x3FAF), and set the record's +0x0E to 0x20. Sound: requestTwoSoundsWhilePlaying (0x566E).
    mem8[record + 0x02] = facing;
    dressSpriteShapeAndAttributeForHeadingSector(m, record, entry);
    mem8[record + 0x0e] = 0x20;
    return tailOff(requestTwoSoundsWhilePlaying);
  }

  // ERAS 1, 2 AND 4: AIM AT THE STAND-OFF POINT (0x431B-0x4349, 0x434C-0x436C). headingToward (0x33B8)
  // gives the heading from the new object to ENEMY_STANDOFF_AIM_MAIN (0xAC7F), a point that stands off
  // the player's ship; it is stored as the record's +0x01.
  const aim = headingToward(m, ENEMY_STANDOFF_AIM_MAIN, entry);
  mem8[record + 0x01] = aim;
  // Era 4 flies straight at it. Eras 1-2 fly skewed off it: 0x40 or 0xC0 is added (a quarter turn
  // either side -- the two choices half a turn apart), chosen by bit 0 of the record's +0x0F byte.
  if (era >= 3) {
    mem8[record + 0x02] = aim;
  } else {
    let skew = ((mem8[record + 0x0f] >> 1) | (mem8[record + 0x0f] << 7)) & 0xff; // rrca
    skew = (skew & 0x80) + 0x40; // 0x40 or 0xC0: a quarter turn either side, picked by bit 0 of the stored byte
    mem8[record + 0x02] = (skew + mem8[record + 0x01]);
  }
  // Point the sprite along the flight heading (call 0x3FAF), clear +0x0E, and finish. Sound: era 4
  // requestAttackerSpawnSoundLateEra (0x5674), eras 1-2 requestTwoSoundsWhilePlaying (0x566E).
  dressSpriteShapeAndAttributeForHeadingSector(m, record, entry);
  mem8[record + 0x0e] = 0x00;
  return tailOff(era >= 3 ? requestAttackerSpawnSoundLateEra : requestTwoSoundsWhilePlaying);
}
