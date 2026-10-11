// SPDX-License-Identifier: GPL-3.0-only
/** verifyImageSignatureThenStartAttractDemoOrDerail — a phase-1 attract sub-step arm (computed
 * dispatch off the phase-1 table at inner sub-step 12, no static call site). It reads the folded
 * program-image signature the self-check banked at TAMPER_IMAGE_SIGNATURE and compares it against a
 * fixed byte. The two agree on a genuine image, where the self-check fold always lands on that byte,
 * so the mismatch arm is dead: it is only ever reached on a tampered image, and there it derails
 * into a data-run-as-code landing that destroys control rather than reporting. There is no faithful
 * transcription of that landing as a routine, so this arm raises where it would derail instead.
 *
 * On the genuine image it starts the attract-mode autopilot demo: it parks the caption sprites,
 * seeds the demo autopilot heading script, then clears the two-player flag, player two's lives, the
 * play-active flag and the inner sequence sub-step, stocks player one with one life, and winds the
 * outer sequence on to its last phase (3) — the phase where the demo actually flies. Because
 * PLAY_ACTIVE is cleared rather than raised, this is the demo run, not a real game.
 *
 * LIVE-OUT: memory only. The arm is reached by computed dispatch and its successor reloads every
 * register it uses before reading one, so no register is live out.
 * ROM 0x2730-0x2754. Grounding: [seen] (names.js ROUTINES 0x2730). */

import {
  TAMPER_IMAGE_SIGNATURE,
  TWO_PLAYER_GAME,
  PLAYER_TWO_LIVES,
  PLAY_ACTIVE,
  SEQUENCE_SUBSTEP,
  PLAYER_ONE_LIVES,
  SEQUENCE_PHASE,
} from "./names.js";
import { hideCaptionSprites } from "./hideCaptionSprites.js";
import { seedDemoAutopilotScript } from "./seedDemoAutopilotScript.js";
import { NotImplemented } from "../../../boards/timeplt/io.js";

// The value a genuine image's self-check fold must land on.
const EXPECTED_SIGNATURE = 0x76;
// The outer sequence's last phase — where the attract demo run lives.
const ROUND_ENGINE_PHASE = 0x03;
// One life for the autopilot demonstration.
const DEMO_LIVES = 0x01;

export function verifyImageSignatureThenStartAttractDemoOrDerail(m) {
  const { mem8 } = m;

  const signature = mem8[TAMPER_IMAGE_SIGNATURE];
  if (signature !== EXPECTED_SIGNATURE) {
    throw new NotImplemented(
      "verifyImageSignatureThenStartAttractDemoOrDerail: the image-signature self-check fold reached " +
        "its mismatch arm; a genuine image always matches, so this is a tampered image",
    );
  }

  hideCaptionSprites(m);
  seedDemoAutopilotScript(m);

  mem8[TWO_PLAYER_GAME] = 0;
  mem8[PLAYER_TWO_LIVES] = 0;
  mem8[PLAY_ACTIVE] = 0;
  mem8[SEQUENCE_SUBSTEP] = 0;
  mem8[PLAYER_ONE_LIVES] = DEMO_LIVES;
  mem8[SEQUENCE_PHASE] = ROUND_ENGINE_PHASE;
}
