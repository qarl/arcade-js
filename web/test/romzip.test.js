// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence gate for the in-browser ROM loader.
 *
 * web/romzip.js lets a visitor drop their own dkong.zip on the player instead of
 * running `make rom`. That is only trustworthy if it produces EXACTLY what the
 * CLI builder produces, so the strong test here runs the browser code path over
 * the real zip and asserts, per image: declared size, declared sha256, AND
 * byte-for-byte equality with games/dkong/rom/*.bin as written by
 * tools/build-rom.mjs. If the two ever diverge, this fails.
 *
 * The zip is copyrighted and not committed, so it is found the same way the CLI
 * finds it ($ROMZIP, else ~/Downloads/<manifest.rom.zip>) and the tests that need
 * it skip cleanly when it is absent — same convention as the ROM guards in
 * games/dkong/test/boot.test.js and boards/dkong/test/board.test.js. The
 * zip-reader tests below need no ROM and run on any clone: they drive readZip()
 * over an archive built in memory here.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import manifest from "../../games/dkong/manifest.js";
import { assembleImages, basename, findEntry, readZip, sha256Hex } from "../romzip.js";

const ZIP = process.env.ROMZIP || join(homedir(), "Downloads", manifest.rom.zip);
const ZIP_PRESENT = existsSync(ZIP);
/** node:test wrapper that skips (with a clear reason) when the zip is absent. */
function zipTest(name, optsOrFn, maybeFn) {
  const fn = maybeFn || optsOrFn;
  const opts = maybeFn ? { ...optsOrFn } : {};
  if (!ZIP_PRESENT) {
    opts.skip = `skipped: romset not found at ${ZIP} — set ROMZIP=/path/to/${manifest.rom.zip}`;
  }
  return nodeTest(name, opts, fn);
}

const ROM_DIR = new URL("../../games/dkong/rom/", import.meta.url);
const IMAGE_NAMES = Object.keys(manifest.rom.images);
const ROM_BUILT = IMAGE_NAMES.every((n) => existsSync(new URL(`${n}.bin`, ROM_DIR)));

// ---------------------------------------------------------------------------
// A tiny ZIP writer, so the reader can be tested without any copyrighted data.
// Deliberately writes a DIFFERENT extra-field length in the local header than in
// the central directory: that is legal, common in the wild, and the exact thing
// that breaks a reader which computes the data offset from the central
// directory's lengths instead of the local header's.
// ---------------------------------------------------------------------------
function u16(n) { return [n & 0xff, (n >> 8) & 0xff]; }
function u32(n) { return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]; }

async function deflateRaw(bytes) {
  const src = new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
  const reader = src.pipeThrough(new CompressionStream("deflate-raw")).getReader();
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

/** @param {Array<{name:string, data:Uint8Array, method:0|8}>} members */
async function makeZip(members, comment = "") {
  const enc = new TextEncoder();
  const local = [];
  const central = [];
  let offset = 0;
  for (const m of members) {
    const name = enc.encode(m.name);
    const payload = m.method === 8 ? await deflateRaw(m.data) : Buffer.from(m.data);
    const localExtra = Buffer.from([0xff, 0xff, 0x02, 0x00, 0x41, 0x42]); // 6 bytes, local only
    local.push(Buffer.concat([
      Buffer.from([...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(m.method),
                   ...u16(0), ...u16(0), ...u32(0),
                   ...u32(payload.length), ...u32(m.data.length),
                   ...u16(name.length), ...u16(localExtra.length)]),
      Buffer.from(name), localExtra, payload,
    ]));
    central.push(Buffer.concat([
      Buffer.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(m.method),
                   ...u16(0), ...u16(0), ...u32(0),
                   ...u32(payload.length), ...u32(m.data.length),
                   ...u16(name.length), ...u16(0), ...u16(0), // extraLen 0 != local's 6
                   ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]),
      Buffer.from(name),
    ]));
    offset += local[local.length - 1].length;
  }
  const localBlob = Buffer.concat(local);
  const centralBlob = Buffer.concat(central);
  const tail = Buffer.from(enc.encode(comment));
  const eocd = Buffer.from([...u32(0x06054b50), ...u16(0), ...u16(0),
                            ...u16(members.length), ...u16(members.length),
                            ...u32(centralBlob.length), ...u32(localBlob.length),
                            ...u16(tail.length)]);
  return new Uint8Array(Buffer.concat([localBlob, centralBlob, eocd, tail]));
}

// ---------------------------------------------------------------------------
// Reader tests — no ROM required.
// ---------------------------------------------------------------------------

nodeTest("readZip reads stored + deflated members, using the LOCAL header's lengths", async () => {
  const stored = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253]);
  const packable = new Uint8Array(4096).fill(0xa5); // compresses hard, so method 8 is real
  const zip = await makeZip([
    { name: "c-2k.bpr", data: stored, method: 0 },
    { name: "dkongj/5g.cpu", data: packable, method: 8 },
    { name: "sub/", data: new Uint8Array(0), method: 0 }, // directory entry: skipped
  ], "TORRENTZIPPED-DEADBEEF"); // archive comment: EOCD is NOT at the very end

  const entries = await readZip(zip);
  assert.deepEqual([...entries.keys()], ["c-2k.bpr", "dkongj/5g.cpu"]);
  assert.deepEqual(entries.get("c-2k.bpr"), stored);
  assert.deepEqual(entries.get("dkongj/5g.cpu"), packable);
});

nodeTest("findEntry matches by basename, shallowest first; basename() splits paths", async () => {
  const root = new Uint8Array([1, 1, 1]);
  const nested = new Uint8Array([2, 2, 2]);
  const zip = await makeZip([
    { name: "deep/dir/v_5h_b.bin", data: nested, method: 0 },
    { name: "v_5h_b.bin", data: root, method: 0 },
    { name: "flat/only.bin", data: new Uint8Array([9]), method: 0 },
  ]);
  const entries = await readZip(zip);
  assert.equal(basename("dkongj/5g.cpu"), "5g.cpu");
  assert.equal(basename("5g.cpu"), "5g.cpu");
  // Root-level part wins over a clone directory's same-named copy.
  assert.deepEqual(findEntry(entries, "v_5h_b.bin"), root);
  // A part named at root is still found inside a nested romset layout.
  assert.deepEqual(findEntry(entries, "only.bin"), new Uint8Array([9]));
  assert.equal(findEntry(entries, "not-in-here.bin"), null);
});

nodeTest("sha256Hex matches the known digest of the empty input and of 'abc'", async () => {
  assert.equal(await sha256Hex(new Uint8Array(0)),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(await sha256Hex(new TextEncoder().encode("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

nodeTest("assembleImages fails explicitly and names the missing parts", async () => {
  const zip = await makeZip([{ name: "unrelated.bin", data: new Uint8Array([0]), method: 0 }]);
  const { ok, images, report } = await assembleImages(zip, manifest.rom);
  assert.equal(ok, false);
  assert.equal(images, null, "no partial success: images must be null when anything failed");
  assert.equal(report.length, IMAGE_NAMES.length, "the report covers every declared image");
  for (const r of report) {
    assert.equal(r.ok, false);
    assert.deepEqual(r.missingParts, manifest.rom.images[r.name].parts);
  }
});

nodeTest("assembleImages reports a hash mismatch when the parts are the wrong bytes", async () => {
  // Right filenames, right sizes, wrong content: the size check alone would pass,
  // so this pins that the sha256 is what actually gates loading.
  const spec = manifest.rom.images.proms;
  const sizes = { "c-2k.bpr": 256, "c-2j.bpr": 256, "v-5e.bpr": 256 };
  const zip = await makeZip(spec.parts.map((p) => (
    { name: p, data: new Uint8Array(sizes[p]).fill(0x5a), method: 8 }
  )));
  const { ok, images, report } = await assembleImages(zip, { images: { proms: spec } });
  assert.equal(ok, false);
  assert.equal(images, null);
  assert.equal(report[0].actualSize, spec.size, "size matched...");
  assert.notEqual(report[0].actualSha256, spec.sha256, "...but the sha256 did not");
  assert.deepEqual(report[0].missingParts, []);
});

// ---------------------------------------------------------------------------
// The real proof — needs the visitor's own zip.
// ---------------------------------------------------------------------------

zipTest("assembleImages() on the real romset verifies every declared image", async () => {
  const { ok, images, report } = await assembleImages(new Uint8Array(readFileSync(ZIP)), manifest.rom);
  for (const r of report) {
    assert.deepEqual(r.missingParts, [], `${r.name}: missing parts ${r.missingParts.join(", ")}`);
    assert.equal(r.actualSize, r.expectedSize, `${r.name}: size`);
    assert.equal(r.actualSha256, r.expectedSha256, `${r.name}: sha256`);
    assert.equal(r.ok, true);
  }
  assert.equal(ok, true);
  assert.deepEqual(Object.keys(images).sort(), IMAGE_NAMES.slice().sort());
  // The images handed to the engine really are the verified bytes.
  for (const name of IMAGE_NAMES) {
    assert.equal(images[name].length, manifest.rom.images[name].size);
    assert.equal(await sha256Hex(images[name]), manifest.rom.images[name].sha256);
  }
});

zipTest("the browser loader is byte-identical to `make rom` output", { skip: ROM_BUILT ? false
  : "skipped: games/dkong/rom/*.bin not built — run 'make -C games/dkong rom'" }, async () => {
  const { ok, images } = await assembleImages(new Uint8Array(readFileSync(ZIP)), manifest.rom);
  assert.equal(ok, true);
  for (const name of IMAGE_NAMES) {
    const cli = new Uint8Array(readFileSync(new URL(`${name}.bin`, ROM_DIR)));
    assert.deepEqual(images[name], cli,
      `${name}.bin: drag-and-drop assembly differs from tools/build-rom.mjs output`);
  }
});
