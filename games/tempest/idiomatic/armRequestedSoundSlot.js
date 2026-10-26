// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import { GAME_MODE, loc_3d, INPUT_EDGE_FLAGS, SPINNER_ACCUM, SLOT_METRIC, ACTIVE_SLOT, REQUEST_BITS, REARM_COUNTER, PASS_COUNTER } from "./names.js";
import { selectProjectionScale } from "./selectProjectionScale.js";
import { resetPerSlotStateTable } from "./resetPerSlotStateTable.js";

/**
 * armRequestedSoundSlot — pick the next live sound slot out of the packed request word and arm it.
 * ROM 0xad22.
 *
 * Role in the machine: Tempest's sound engine queues effect requests as a packed word ($603 =
 * REQUEST_BITS), two bits per slot. This routine is the request walker: it scans that word for the first
 * slot that carries a live metric (1..8), computes the slot's control value, seeds the per-slot timing
 * cells, and transitions the sound state machine to "armed" so the per-frame tick (tickActiveSoundSlot)
 * will play it. If the word is empty it drops the engine to idle.
 *
 * Behavior: loop over the packed word. On an empty word ($603 == 0) write idle status $0 = 0x14
 * (GAME_MODE) and return. Otherwise take the low two bits as the slot index $3d (loc_3d, minus 1) and
 * consume them with two logical right shifts. Read the slot's metric $600+index (SLOT_METRIC); skip slots
 * whose byte is 0 or >= 9 (empty / out-of-range) and keep walking. For a live slot, form the control value
 * $602 (ACTIVE_SLOT) = ((3*byte) ^ 0xff) - 0xe5 — scale by three, invert, and offset — then call
 * selectProjectionScale. Seed the paired cells: $605 = 0x60 (PASS_COUNTER), $4e = 0 (INPUT_EDGE_FLAGS),
 * $50 = 0 (SPINNER_ACCUM), $604 = 2 (REARM_COUNTER); run resetPerSlotStateTable; write armed status
 * $0 = 0x24 and return.
 *
 * Live-out: $3d (chosen slot index), $602 (control value), $605/$4e/$50/$604 (per-slot timing seeds), and
 * $0 = 0x24 armed (or 0x14 idle when exhausted).
 *
 * x is the X the ROM enters with. Returns the exit [X, Y] the ROM leaves: Y is the status it stores through
 * Y (0x14 or 0x24). When exhausted, X is the last skipped slot index the walk loaded, or the incoming x when
 * none was skipped; when armed, X = 0xff (resetPerSlotStateTable's walk runs it past 0). Grounding: [seen].
 */
export function armRequestedSoundSlot(m, x = m.regs.x) {
  const { mem8 } = m;
  while (true) {
    if (mem8[REQUEST_BITS] === 0) {
      mem8[GAME_MODE] = 0x14; // exhausted
      return [x, 0x14];
    }
    // Low two bits pick the slot index; consume them from the word.
    mem8[loc_3d] = u8((mem8[REQUEST_BITS] & 0x03) - 1);
    mem8[REQUEST_BITS] = mem8[REQUEST_BITS] >> 1;
    mem8[REQUEST_BITS] = mem8[REQUEST_BITS] >> 1;
    x = mem8[loc_3d];
    const n = mem8[u16(SLOT_METRIC + x)];
    if (n === 0 || n >= 0x09) continue; // skip empty / out-of-range slots
    // Scale, invert, and offset the slot byte into the paired value.
    let a = u8(n << 1);
    a = u8(a + n);
    a = a ^ 0xff;
    a = u8(a - 0xe5);
    mem8[ACTIVE_SLOT] = a;
    selectProjectionScale(m);
    mem8[PASS_COUNTER] = 0x60;
    mem8[INPUT_EDGE_FLAGS] = 0x00;
    mem8[SPINNER_ACCUM] = 0x00;
    mem8[REARM_COUNTER] = 0x02;
    resetPerSlotStateTable(m);
    mem8[GAME_MODE] = 0x24; // armed
    return [0xff, 0x24];
  }
}
