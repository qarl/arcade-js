// SPDX-License-Identifier: GPL-3.0-only
import { u16 } from "../../../core/int.js";
import { DSW2_SNAPSHOT, loc_100, DSW_DIFFICULTY, PENDING_WORK_FLAGS, SLOT_VALUE, GLYPH_PARAM_X, loc_71b, loc_71c, loc_71d, INPUT_SNAPSHOT_HI, INPUT_SNAPSHOT_LO, TEXT_BUFFER_TEMPLATE } from "./names.js";
import { requestRebuildIfSwitchesChanged } from "./requestRebuildIfSwitchesChanged.js";
import { raiseRebuildRequestBits } from "./raiseRebuildRequestBits.js";

/**
 * rebuildControlBlocksFromTemplate — reshape the per-lane control/glyph blocks from a template. ROM 0xabac.
 *
 * Role in the machine: Tempest lays out its playfield and attract/menu glyphs from per-slot control
 * blocks that depend on the operator's option/difficulty switches. When those switches change, the blocks
 * must be rebuilt. This is the rebuild body: it refreshes the switch snapshot, may raise the request bits
 * itself, then keyed on those bits copies the template block into the live block and fills the glyph
 * parameter run with ones, snapshots the current switch values, and clears the request bits it consumed.
 *
 * Behaviour:
 *   1. requestRebuildIfSwitchesChanged refreshes the live snapshot and raises a request bit on any change.
 *   2. Stamp loc_100 = 0x08 (mode/state marker for the block system).
 *   3. If all three activity sources loc_71b|loc_71c|loc_71d are idle, force both request bits on so a
 *      fully-idle machine still rebuilds both halves.
 *   4. Read the request flags 0x1c9. Bit0 => copy the wider run (top 0x17 else 0x0e) of the template
 *      block into the live slot-value block; bit1 => fill the wider run of the glyph-param block with 0x01.
 *   5. If either request bit was set, latch the switch snapshot: high = DSW2 & 0xf8, low = difficulty & 0x03.
 *   6. Clear the two request bits (flags & 0xfc), leaving any higher bits untouched.
 *
 * Live-out: mode marker loc_100; the slot-value block (loc_606..) and glyph-param block (loc_706..); the
 * snapshot cells loc_71e/loc_71f; pending-work flags 0x1c9 with the low two bits cleared. Returns the exit
 * [X, Y] the ROM leaves: X = 0xff (the fill runs X past 0) and requestRebuildIfSwitchesChanged's exit Y.
 * Grounding: [seen].
 */
export function rebuildControlBlocksFromTemplate(m) {
  const { mem8 } = m;
  const [, y] = requestRebuildIfSwitchesChanged(m); // refresh snapshot; raise a request bit on a switch change
  mem8[loc_100] = 0x08; // mode/state marker for the block system
  // Fully-idle machine (all three activity sources clear) => force both rebuild requests on.
  if ((mem8[loc_71b] | mem8[loc_71c] | mem8[loc_71d]) === 0) raiseRebuildRequestBits(m);

  const flags = mem8[PENDING_WORK_FLAGS];
  // Bit0: copy template block into the live slot-value block; wider run (0x17) when armed, else 0x0e.
  const copyTop = flags & 0x01 ? 0x17 : 0x0e;
  for (let x = copyTop; x >= 0; x--) mem8[u16(SLOT_VALUE + x)] = mem8[u16(TEXT_BUFFER_TEMPLATE + x)];
  // Bit1: fill the glyph-param block with 0x01; wider run (0x17) when armed, else 0x0e.
  const fillTop = flags & 0x02 ? 0x17 : 0x0e;
  for (let x = fillTop; x >= 0; x--) mem8[u16(GLYPH_PARAM_X + x)] = 0x01;
  if (flags & 0x03) {
    // A rebuild happened: latch the switch values so the next change is detected against these.
    mem8[INPUT_SNAPSHOT_HI] = mem8[DSW2_SNAPSHOT] & 0xf8;
    mem8[INPUT_SNAPSHOT_LO] = mem8[DSW_DIFFICULTY] & 0x03;
  }
  mem8[PENDING_WORK_FLAGS] = flags & 0xfc; // consume the two request bits, keep the rest
  return [0xff, y];
}
