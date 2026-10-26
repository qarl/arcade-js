// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import {
  STATUS_FLAGS, DSW1_SNAPSHOT, loc_29, loc_2a, loc_2b, COORD_LIST_PTR_LO, COORD_LIST_PTR_HI, loc_2e, SAVED_INDEX2, loc_3d, ACTIVE_SLOT_COUNT,
  loc_40, loc_41, loc_42, SORT_PAYLOAD_LO, SORT_PAYLOAD_MID, SORT_PAYLOAD_HI, SLOT_METRIC, loc_601, REQUEST_BITS, PASS_COUNTER,
  SORT_KEY_LO, SORT_KEY_MID, SORT_KEY_HI,
} from "./names.js";
import { clearChannelStagingBlock } from "./clearChannelStagingBlock.js";
import { queueEaromRegionSave } from "./queueEaromRegionSave.js";
import { armRequestedSoundSlot } from "./armRequestedSoundSlot.js";

/**
 * buildSortedSoundRequest -- order the sound row table and issue a sound draw request. ROM 0xac3f.
 *
 * Role in the machine: Tempest voices several sounds at once (enemy fire, player fire, explosions,
 * the pulsar hum) but the POKEY has limited channels, so the requests are kept as rows and must be
 * played in priority order. This routine bubble-sorts the pending sound rows into lexicographic key
 * order for each of two channels, records how much work the sort took, then packs a single request
 * byte and hands the ordered list to the request walker (armRequestedSoundSlot) that actually arms a
 * POKEY slot.
 *
 * Behavior: it clears bit6 of STATUS_FLAGS (a request-in-progress flag), and when DSW1_SNAPSHOT bit6
 * is set with bits1/0 clear it wipes the staging block (clearChannelStagingBlock); it queues the EAROM
 * high-score save (queueEaromRegionSave) and zeros the running total loc_601. Channel select starts at
 * 0 or 3 depending on ACTIVE_SLOT_COUNT. For each channel it seats the sort key triple -- pointer
 * COORD_LIST_PTR_LO/HI and loc_2e from the per-channel bases loc_42/loc_41/loc_40 -- saves the channel
 * parity in SAVED_INDEX2, seeds the swap-temp triple loc_2b/loc_2a/loc_29, and clears the pass counter
 * PASS_COUNTER. The inner loop walks the row cursor y from 0xfd downward (advanceCursor steps by 2, or
 * 3 while still high), comparing each row's key triple SORT_KEY_HI/MID/LO against the running key
 * lexicographically. When a pair is out of order it swaps the key triple (and, above index 0xe8, the
 * parallel payload triple SORT_PAYLOAD_LO/MID/HI) all the way down, then resumes; every settle pass
 * bumps PASS_COUNTER. The pass count is stored per channel to SLOT_METRIC[channel]. After both channels
 * it nudges the total loc_601 up by one when it is within [SLOT_METRIC, 0x63). Finally it derives the
 * packed request byte from the mode flag loc_3d -- ((flag^1)<<2)|flag, plus 5, plus flag bit6 -- stores
 * it to REQUEST_BITS, and tail-calls armRequestedSoundSlot.
 *
 * Live-out: the SORT_KEY and SORT_PAYLOAD rows reordered in place, SLOT_METRIC[0..1] (per-channel pass
 * counts), loc_601 (running total), REQUEST_BITS (packed request), STATUS_FLAGS bit6 cleared, and
 * whatever armRequestedSoundSlot arms. Returns armRequestedSoundSlot's exit [X, Y], which it enters with
 * X = 0xff (the channel walk runs X past 0).
 *
 * Grounding: [seen].
 */

// Step the row cursor down by two (or three when still high), returning the new position.
function advanceCursor(y) {
  if (y >= 0x55) y = u8(y - 1);
  y = u8(y - 1);
  y = u8(y - 1);
  return y;
}

export function buildSortedSoundRequest(m) {
  const { mem8 } = m;
  mem8[STATUS_FLAGS] = mem8[STATUS_FLAGS] & 0xbf;   // clear the request-in-progress flag (bit6)
  if ((mem8[DSW1_SNAPSHOT] & 0x43) === 0x40) clearChannelStagingBlock(m);  // DIP-gated staging wipe
  queueEaromRegionSave(m);                          // fold the periodic high-score EAROM save in here
  mem8[loc_601] = 0x00;                             // running total across both channels

  let channel = mem8[ACTIVE_SLOT_COUNT] === 0 ? 0 : 3;  // channel select 0 or 3
  while (true) {
    // Seat this channel's sort key triple from its per-channel base cells.
    mem8[COORD_LIST_PTR_LO] = mem8[u8(loc_42 + channel)];
    mem8[COORD_LIST_PTR_HI] = mem8[u8(loc_41 + channel)];
    mem8[loc_2e] = mem8[u8(loc_40 + channel)];
    mem8[SAVED_INDEX2] = channel & 0x01;            // remember channel parity across the sort
    mem8[loc_2b] = 0x00;                            // swap-temp triple
    mem8[loc_2a] = 0x1a;
    mem8[loc_29] = 0x1a;
    mem8[PASS_COUNTER] = 0x00;                      // count settle passes for this channel

    let y = 0xfd;                                   // row cursor, walks downward
    while (true) {
      // Ordered when the row triple is >= the key triple (lexicographic).
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
        // Out of order: bubble the swap down the rest of the table.
        while (true) {
          if (y >= 0xe8) {
            // High region also carries a parallel payload triple that swaps alongside the key.
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

    channel = mem8[SAVED_INDEX2];                   // restore channel parity
    mem8[u16(SLOT_METRIC + channel)] = mem8[PASS_COUNTER];  // record this channel's pass count
    channel = u8(channel - 1);
    if ((channel & 0x80) !== 0) break;              // both channels done
  }

  // Nudge the running total up by one when it sits within [SLOT_METRIC, 0x63).
  const total = mem8[loc_601];
  if (total >= mem8[SLOT_METRIC] && total < 0x63) mem8[loc_601] = u8(mem8[loc_601] + 1);

  // Derive the packed request byte from the mode flag loc_3d, then walk the request.
  const flag = mem8[loc_3d];
  let request = (((flag ^ 0x01) << 2) & 0xff) | flag;
  request = u8(request + 0x05 + ((flag >> 6) & 0x01));
  mem8[REQUEST_BITS] = request;
  return armRequestedSoundSlot(m, channel);
}
