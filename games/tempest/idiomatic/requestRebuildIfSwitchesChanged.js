// SPDX-License-Identifier: GPL-3.0-only
import { DSW2_SNAPSHOT, INPUT_SNAPSHOT_HI, DSW_DIFFICULTY, INPUT_SNAPSHOT_LO } from "./names.js";
import { decodeOptionSwitches } from "./decodeOptionSwitches.js";
import { raiseRebuildRequestBits } from "./raiseRebuildRequestBits.js";
import { switchesUnchangedReturn } from "./switchesUnchangedReturn.js";

/**
 * requestRebuildIfSwitchesChanged — request a control-block rebuild when the DIP/option
 * switches have moved since last cached. ROM 0xac20.
 *
 * Role in the machine: the operator DIP switches select difficulty, coinage, lives, etc.
 * Those settings feed the control blocks the game builds each round. This routine detects a
 * change in the decoded switch state and, only on a change, raises the pending-rebuild
 * request bits so the control-block rebuilder (loc_abac) regenerates from the template. On
 * no change it takes a shared no-op tail and leaves everything alone.
 *
 * Behavior: first re-decode the live option/switch snapshot (decodeOptionSwitches refreshes
 * the DSW2 and difficulty snapshot cells). Then compare two masked fields against their
 * cached targets: (DSW2_SNAPSHOT & 0xf8) vs INPUT_SNAPSHOT_HI, and (DSW_DIFFICULTY & 0x03)
 * vs INPUT_SNAPSHOT_LO. If both match, the switches are unchanged — take switchesUnchangedReturn
 * (does nothing, returns). If either differs, call raiseRebuildRequestBits to set the
 * pending-rebuild request bits, which the rebuilder later consumes and re-latches these
 * same cached targets from.
 *
 * Live-out: on a mismatch, the pending-rebuild request bits raised by raiseRebuildRequestBits;
 * the snapshot cells refreshed by decodeOptionSwitches either way. Returns decodeOptionSwitches' exit [X, Y],
 * which is the ROM's (neither tail loads X or Y). Grounding: [seen].
 */
export function requestRebuildIfSwitchesChanged(m) {
  const { mem8 } = m;
  // Refresh the live snapshot cells from the hardware switch reads before comparing.
  const exit = decodeOptionSwitches(m);
  // Match = both masked fields still equal their cached targets (top 5 bits of DSW2, low 2 of difficulty).
  const match =
    (mem8[DSW2_SNAPSHOT] & 0xf8) === mem8[INPUT_SNAPSHOT_HI] &&
    (mem8[DSW_DIFFICULTY] & 0x03) === mem8[INPUT_SNAPSHOT_LO];
  // Unchanged: shared no-op tail, no rebuild requested.
  if (match) switchesUnchangedReturn();
  // Changed: raise the pending-rebuild request bits for the control-block rebuilder.
  else raiseRebuildRequestBits(m);
  return exit;
}
