// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0a37 — hand-optimized rewrite of the translated routine at ROM 0x0A37,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (sub_309f at 0x309f, the task enqueue) is
 * reached through `m.call`, the routine registry (games/dkong/routines.js), so it
 * resolves to the oracle or to a future optimized rewrite. Only the RAM name
 * GAME_SUBSTATE is imported (from ram.js).
 */

import { GAME_SUBSTATE } from "./ram.js";

/**
 * loc_0a37 -- in-game sub-state 5: queue the opening tasks, advance the sub-state,
 * seed three VRAM cells.  [ROM 0x0A37-0x0A62]
 *
 *   0a37  11 04 03   ld  de,0x0304   ; task [opcode 0x03, arg 0x04]
 *   0a3a  cd 9f 30   call 0x309f     ;   -> sub_309f enqueues [D,E] on the task ring
 *   0a3d  11 02 02   ld  de,0x0202   ; task [opcode 0x02, arg 0x02]
 *   0a40  cd 9f 30   call 0x309f
 *   0a43  11 00 02   ld  de,0x0200   ; task [opcode 0x02, arg 0x00]
 *   0a46  cd 9f 30   call 0x309f
 *   0a49  11 00 06   ld  de,0x0600   ; task [opcode 0x06, arg 0x00]
 *   0a4c  cd 9f 30   call 0x309f
 *   0a4f  21 0a 60   ld  hl,0x600a
 *   0a52  34         inc (hl)         ; GAME_SUBSTATE += 1  (5 -> 6)
 *   0a55  3e 01      ld  a,0x01
 *   0a58  32 40 77   ld  (0x7740),a   ; seed VRAM cell 0x7740 = 0x01
 *   0a5a  3e 25      ld  a,0x25
 *   0a5d  32 20 77   ld  (0x7720),a   ; seed VRAM cell 0x7720 = 0x25
 *   0a5f  3e 20      ld  a,0x20
 *   0a62  32 00 77   ld  (0x7700),a   ; seed VRAM cell 0x7700 = 0x20
 *   ...  ret
 *
 * WHAT IT DOES. Dispatched by loc_06fe (the GAME_STATE==3 sub-state dispatcher,
 * 0x0702 table index 5) once, when GAME_SUBSTATE (0x600A) == 5, during the opening
 * setup of a credited game. It enqueues four fixed task descriptors [D=opcode,
 * E=arg] on the task ring via sub_309f (0x309f) -- the same enqueue handler_01c3
 * uses -- then advances GAME_SUBSTATE by one (5 -> 6, so this handler runs exactly
 * once), and seeds three fixed VRAM cells (0x7740/0x7720/0x7700). It is straight-
 * line: NO data-dependent branch, one path for every entry.
 *
 * INPUTS.  RAM: none read for control (the four DE descriptors are ROM immediates).
 *   sub_309f reads/updates the ring write pointer (0x60B0) + ring (0x60C0) itself.
 * OUTPUTS. RAM: four task-ring slots enqueued (via sub_309f), GAME_SUBSTATE (0x600A)
 *   incremented, VRAM 0x7740=0x01 / 0x7720=0x25 / 0x7700=0x20. The three VRAM writes
 *   keep the oracle's busOffset argument (10). Registers on exit: HL=0x600A, A=0x20,
 *   DE=0x0600 (sub_309f preserves D/E), F = the flags `inc (hl)` set (S/Z/H/P/V from
 *   0x600A's new value); the later `ld a,nn` / `ld (nn),a` touch no flag, so that
 *   `inc (hl)` result is F on exit.
 *
 * FLAGS. The only flag-setting instruction is `inc (hl)` at 0x0A52; it is kept as
 * the oracle's `regs.incMem8` so S/Z/H/P/V match exactly. Nothing downstream is
 * proven to read them (the next dispatch reloads A/F), but the unit gate compares
 * the whole register file including F, so the `inc (hl)` is left verbatim.
 *
 * ATOMIC -- cycles COLLAPSED to one total per instruction-run, TOTAL preserved.
 * loc_0a37 runs INSIDE the NMI with the mask cleared (nothing re-enters the NMI),
 * it is a SHORT setup routine (~800 t incl. its four sub_309f calls, vs a 50688 t
 * frame), and its one callee sub_309f is a LEAF (it makes no m.call, cannot span a
 * frame, is not an interruptible in-game handler like loc_06fe's gameplay dispatch).
 * The NMI fires just PAST the frame boundary, so loc_0a37 executes ~50000 t away
 * from the next boundary -- no state-sample can fall inside it, making its internal
 * cycle distribution unobservable. So per the README §2 rule the per-instruction
 * m.step charges collapse to one total per run: each ld-de+call segment to 27 t
 * (10+17) charged at 0x309f before the call, which PRESERVES the cumulative cycle
 * count at every sub_309f entry (so any hypothetical boundary inside sub_309f lands
 * identically to the oracle), and the eight-instruction tail to 81 t (10+11+7+13+7+
 * 13+7+13) before the ret's own 10 t. The harness confirms EQUAL whole+unit; and
 * the TOTAL is load-bearing -- stripping the charges to zero diverges (the NMI's
 * total cost sets the main-loop spin count = the PRNG entropy, README §2), so the
 * total is preserved, only its distribution dropped.
 */
export function loc_0a37(m) {
  const { regs, mem } = m;

  // Enqueue four fixed task descriptors [D=opcode, E=arg] on the ring via sub_309f.
  // Each segment's 27 t (ld de 10 + call 17) is charged at 0x309f before the call,
  // so the cumulative cycle count entering sub_309f matches the oracle exactly.
  regs.de = 0x0304; m.push16(0x0a3d); m.step(0x309f, 27); m.call(0x309f);
  regs.de = 0x0202; m.push16(0x0a43); m.step(0x309f, 27); m.call(0x309f);
  regs.de = 0x0200; m.push16(0x0a49); m.step(0x309f, 27); m.call(0x309f);
  regs.de = 0x0600; m.push16(0x0a4f); m.step(0x309f, 27); m.call(0x309f);

  // Advance the sub-state (5 -> 6) so this handler runs exactly once; `inc (hl)`
  // kept verbatim so F matches.
  regs.hl = GAME_SUBSTATE;             // ld hl,0x600a
  regs.incMem8(mem, regs.hl);          // inc (hl) -- GAME_SUBSTATE += 1

  // Seed three fixed VRAM cells (busOffset 10 preserved from the oracle).
  regs.a = 0x01; mem.write8(0x7740, regs.a, 10);
  regs.a = 0x25; mem.write8(0x7720, regs.a, 10);
  regs.a = 0x20; mem.write8(0x7700, regs.a, 10);

  // Tail total 10+11+7+13+7+13+7+13 = 81 t, charged once at the ret address.
  m.step(0x0a62, 81);
  m.ret(); // ret -- charges its own 10 t
}
