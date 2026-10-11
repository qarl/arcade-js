// SPDX-License-Identifier: GPL-3.0-only
/** velocityForHeading — turn an object's heading into the pair of numbers that will move it. The heading
 * counts a whole turn in 256 steps and the caller's table is read as that many signed 16-bit
 * samples, so the sample a quarter turn back is the perpendicular partner of the one at the
 * heading; their shared length is the speed, chosen by choosing the table. Which of the pair is
 * the screen's across and which its down is not settled here.
 *
 * ROM 0x596E-0x598D (frozen lift translated/loc_596e.js). Grounding: [seen].
 *
 * Role in the machine: turns a heading into a velocity for the movers. Its callers include
 * flyAlongHeading, flyAlongHeadingAtDoubleVelocity and doubledVelocityForHeading, each passing the
 * table that sets its speed; scrollWorldAtTheEraPace passes an era-chosen table, and
 * negateVelocityIntoWorldScrollThenDressSprite negates the pair this returns into the scroll cells
 * that driftWithWorldScroll adds to every world-static object — negated player velocity applied to
 * everything else is the camera. The selectable tables hold a near-constant magnitude around the
 * heading circle, not an exact one.
 *
 * `table` is the base of the caller's 256-word table (HL on the Z80); `heading` defaults to byte +2
 * of the object record in IX, as the ROM reads it (`ld a,(ix+0x02)`).
 *
 * LIVE-OUT: the pair (DE, BC). */

// 256 samples per turn, so a quarter turn is 64 samples (the ROM's 0x40).
const SAMPLES_PER_TURN = 256;
const QUARTER_TURN = SAMPLES_PER_TURN / 4;
// Record byte +2: the heading the object flies on.
const HEADING_OFFSET = 2;

export function velocityForHeading(m, table = m.regs.hl, heading = m.mem8[m.regs.ix + HEADING_OFFSET]) {
  // First component: the sample at the heading itself (the ROM doubles the heading into a byte
  // offset and reads the word into DE).
  const alongFirstAxis = sampleAt(m, table, heading);
  // Second component: the sample a quarter turn back, wrapping round the table — the ROM reaches it
  // by stepping back 0x40 entries, or forward 0xC0 when the heading is under 0x40, which is the
  // same index modulo 256. Being a quarter turn from the first, it is the perpendicular component.
  const alongSecondAxis = sampleAt(m, table, heading - QUARTER_TURN);
  return [m.regs.de = alongFirstAxis, m.regs.bc = alongSecondAxis];
}

// Read sample `sample` (taken modulo 256) of a table of little-endian 16-bit words.
function sampleAt(m, table, sample) {
  const index = sample & (SAMPLES_PER_TURN - 1);
  return m.mem16[table + 2 * index];
}
