// SPDX-License-Identifier: GPL-3.0-only
/** noOpSequencePhase2Tail — an arrival point with nothing to do: no cell is read or written, no register moves.
 *
 * ROM 0x181D (frozen lift translated/loc_181d.js): a lone `ret`. Grounding: [seen] (names.js ROUTINES
 * 0x181d: "an arrival point with nothing to do: no cell is read or written and no register moves").
 *
 * Role in the machine: the sequence machine has four outer phases (SEQUENCE_PHASE) and, for phases 1
 * to 3, every sub-step arm is followed by that phase's SHARED TAIL, which runs after the arm on every
 * dispatch (mechanisms.md, the phase table). Phase 1's tail lets a credit or free-play start cut into
 * attract, and phase 3's is advanceAttractTowardGameStart. Phase 2 -- the credit / push-start state --
 * has this tail, and it does nothing: dispatchSequencePhase2SubStepArm runs the arm the sub-step
 * selects and then returns through here, as the ROM does.
 */

export function noOpSequencePhase2Tail() {
}
