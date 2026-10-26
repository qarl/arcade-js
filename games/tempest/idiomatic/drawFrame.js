// SPDX-License-Identifier: GPL-3.0-only
import { u16 } from "../../../core/int.js";
import { STATUS_FLAGS, DRAW_RECORD_PTR_LO, DRAW_RECORD_PTR_HI, REDRAW_COUNTER, PLAYER_SHAPE_SUM, VECHEAD0_FRAME, VECHEAD1_FRAME, VEC_LIST_HEADER_LO, VEC_LIST_HEADER_HI } from "./names.js";
import { seatDrawCursor } from "./seatDrawCursor.js";
import { closeLayerPointer } from "./closeLayerPointer.js";
import { drawScoreStatusList } from "./drawScoreStatusList.js";
import { drawSlotShapeList } from "./drawSlotShapeList.js";
import { drawStyledSlotList } from "./drawStyledSlotList.js";
import { drawEnemyShapeList } from "./drawEnemyShapeList.js";
import { buildObjectDisplayList } from "./buildObjectDisplayList.js";
import { buildTextOverlayList } from "./buildTextOverlayList.js";
import { paintRimLanes } from "./paintRimLanes.js";
import { buildEnemyDisplayList } from "./buildEnemyDisplayList.js";
import { drawTimedObjectList } from "./drawTimedObjectList.js";

/**
 * drawFrame — build one full frame of the vector display list. ROM 0xb230.
 *
 * Role in the machine: this is Tempest's top-level per-frame draw router. Every video frame
 * the game rebuilds the vector generator's display list from scratch, one drawing subsystem at
 * a time, in a fixed layer order. Each subsystem paints a different part of the tube — the
 * score/status text, the player's Blaster and its shots, the styled slot art, the enemies, the
 * timed objects, the rim lanes of the tube — and drawFrame is the spine that runs them all in
 * the right order so the finished list composites correctly on the vector monitor.
 *
 * Behavior: the eight subsystems run in the fixed layer order 0x07, 0x04, 0x03, 0x06, 0x05,
 * 0x00, 0x01, 0x08. Each is bracketed by a seatDrawCursor(id) setup (ROM loc_b2be, which seats
 * the draw cursor for that layer's list) and a closeLayerPointer(id) teardown (loc_b2fe, which
 * closes the list back). Inside the player layer (id 0x00, buildTextOverlayList), when the
 * STATUS_FLAGS sign bit (0x5 bit7) is clear, it folds a 40-byte (0x28) source block reached via
 * the DRAW_RECORD_PTR_LO/HI pointer (0xb6/0xb7) into an 8-bit carry-chained checksum seeded with
 * 0xf2, walking Y from 0x27 down to 0, and stores the running sum into PLAYER_SHAPE_SUM (0x11b) —
 * the player-shape signature the game watches for change. After the player layer, paintRimLanes
 * draws the tube rim. Finally it zeros the REDRAW_COUNTER change-counter (0x114) and latches the
 * two per-frame vector-list header constants (VECHEAD0/1_FRAME, ROM 0xcec2/0xcec3) into the head
 * words VEC_LIST_HEADER_LO/HI (0x2000/0x2001) that begin the completed display list.
 *
 * Live-out: the whole per-frame vector display list (built by the eight subsystems into the VG
 * record area), PLAYER_SHAPE_SUM (0x11b) when the player layer ran the checksum, the cleared
 * REDRAW_COUNTER (0x114), and the two list-header words (0x2000/0x2001).
 *
 * Returns the exit [X, Y] the ROM leaves: the last layer close's (the closing stores write no register).
 * Grounding: [seen].
 */
export function drawFrame(m) {
  const { mem8 } = m;
  // Layer 0x07 — score / status text at the top of the tube.
  seatDrawCursor(m, 0x07);
  drawScoreStatusList(m);
  closeLayerPointer(m, 0x07);

  // Layer 0x04 — styled slot shapes.
  seatDrawCursor(m, 0x04);
  drawSlotShapeList(m);
  closeLayerPointer(m, 0x04);

  // Layer 0x03 — the styled slot list (secondary style pass).
  seatDrawCursor(m, 0x03);
  drawStyledSlotList(m);
  closeLayerPointer(m, 0x03);

  // Layer 0x06 — enemy shapes on the tube.
  seatDrawCursor(m, 0x06);
  drawEnemyShapeList(m);
  closeLayerPointer(m, 0x06);

  // Layer 0x05 — general object display list.
  seatDrawCursor(m, 0x05);
  buildObjectDisplayList(m);
  closeLayerPointer(m, 0x05);

  // Layer 0x00 — the player layer (text overlay + player shape checksum).
  seatDrawCursor(m, 0x00);
  buildTextOverlayList(m);
  if (!(mem8[STATUS_FLAGS] & 0x80)) {
    // Sign bit clear: fold the 40-byte player-shape block into an 8-bit carry-chained sum.
    const ptr = mem8[DRAW_RECORD_PTR_LO] | (mem8[DRAW_RECORD_PTR_HI] << 8);
    let a = 0xf2; // seed
    let carry = 0;
    for (let y = 0x27; y >= 0; y--) {
      const s = a + mem8[u16(ptr + y)] + carry;
      a = s & 0xff;
      carry = s > 0xff ? 1 : 0; // carry chains into the next byte, ADC-style
    }
    mem8[PLAYER_SHAPE_SUM] = a; // player-shape signature the game watches for change
  }
  closeLayerPointer(m, 0x00);
  paintRimLanes(m); // draw the rim lanes of the tube

  // Layer 0x01 — enemy display list.
  seatDrawCursor(m, 0x01);
  buildEnemyDisplayList(m);
  closeLayerPointer(m, 0x01);

  // Layer 0x08 — timed objects (spikes, flippers timers, etc.).
  seatDrawCursor(m, 0x08);
  drawTimedObjectList(m);
  const exit = closeLayerPointer(m, 0x08);

  // Close out the frame: clear the change-counter and latch the two list-header words.
  mem8[REDRAW_COUNTER] = 0x00;
  mem8[VEC_LIST_HEADER_LO] = mem8[VECHEAD0_FRAME];
  mem8[VEC_LIST_HEADER_HI] = mem8[VECHEAD1_FRAME];
  return exit;
}
