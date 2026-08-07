// SPDX-License-Identifier: GPL-3.0-only
/** loc_0b93 — the foreground loop: take commands off the ring, one at a time, forever.
 *
 * A read cursor names a cell of the 64-cell ring. While that cell's high bit is set it holds no
 * command and the loop simply looks again, which is what makes this a loop with no exit of its
 * own: the ring is refilled from outside it. When the cell is occupied, its byte and the byte
 * after it are taken, both cells are marked free again, and the cursor steps two on and wraps
 * inside the ring. The low four bits of the command byte index a table of sixteen addresses and
 * the one selected is run with the argument byte in hand; where it lands afterwards is the exit
 * test, because it is handed a fixed place to come back to and anything else means it has gone
 * somewhere the loop does not own.
 *
 * The two cells are freed BEFORE the command runs, so a command that posts another one can reuse
 * the pair it arrived in. Nothing here bounds how long a command takes or checks that the cursor
 * started inside the ring — a cursor above the ring's length reads past it once and is folded
 * back on the way out. LIVE-OUT: memory, and whatever the command left behind. */

import { u16, u8 } from "../../../core/int.js";
import { fetchWideTableWord } from "./fetchWideTableWord.js";
import { COMMAND_READ_CURSOR, COMMAND_RING } from "./names.js";

const RING_CELLS = 64;
const FREE = 255;
const OCCUPIED_BIT = 0x80;
const HANDLERS = 0x0bbc;
const HANDLER_BITS = 0x0f;
const COME_BACK_TO = 0x0b90;

export function loc_0b93(m) {
  const { regs, mem8 } = m;
  for (;;) {
    const commandCell = u16(COMMAND_RING + mem8[COMMAND_READ_CURSOR]);
    if (mem8[commandCell] & OCCUPIED_BIT) continue;

    const command = mem8[commandCell];
    mem8[commandCell] = FREE;
    const argumentCell = u16(commandCell + 1);
    const argument = mem8[argumentCell];
    mem8[argumentCell] = FREE;
    mem8[COMMAND_READ_CURSOR] = u8(argumentCell + 1) & (RING_CELLS - 1);

    regs.hl = HANDLERS;
    regs.a = command;
    regs.and(HANDLER_BITS);
    fetchWideTableWord(m);
    const handler = regs.de;

    regs.c = command;
    regs.b = argument;
    regs.a = argument;
    regs.de = COME_BACK_TO;
    regs.hl = handler;
    m.push16(COME_BACK_TO);
    m.call(handler);
    if (m.pc !== COME_BACK_TO) return m.call(m.pc);
  }
}
