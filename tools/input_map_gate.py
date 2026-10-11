#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Input-map gate: the browser's manifest.inputs map checked against MAME's own input ports.

The web player keys every action through manifest.inputs.actions {port, bit} (runbook §5 web-worker contract
(5)); the pixel and distant gates inject raw port values and never read that map, so a wrong fire bit, a
left key that turns right, a dead coin 2 or a start2 that starts 1P passed every other gate. This asks MAME,
headless, for the truth: each input field's port tag and mask, and the address the maincpu program map
reads that port at (a Lua dump). Then, per manifest action, its MAME field (MAME's standard names, below)
must sit on that port's address (mirror bits honoured) with mask == bit. Also: every keys binding names a
declared action, every ports entry is a port address MAME maps, and every P1/system field of the mapped
ports with a known action name is declared. Fails closed: no MAME, no romset, or an unparsable dump is RED.

  check --game G      exit 0 iff the map matches MAME; prints `input_map: PASS -- G`
  selftest            the comparison on a canned MAME dump, with the wrong-bit / swapped-direction /
                      dead-coin2 / start2-on-start1 mutants that must each go RED
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FIELDS = {"coin": "Coin 1", "coin2": "Coin 2", "service": "Service 1", "start1": "1 Player Start",
          "start2": "2 Players Start", "left": "P1 Left", "right": "P1 Right", "up": "P1 Up",
          "down": "P1 Down", "fire": "P1 Button 1"}

LUA = """local out = {}
for tag, port in pairs(manager.machine.ioport.ports) do
  for name, f in pairs(port.fields) do out[#out + 1] = string.format("FIELD\\t%s\\t%s\\t%d", tag, name, f.mask) end
end
for _, e in ipairs(manager.machine.devices[":maincpu"].spaces["program"].map.entries) do
  if e.read.handlertype == "port" then
    out[#out + 1] = string.format("PORT\\t:%s\\t%d\\t%d\\t%d", e.read.tag, e.address_start, e.address_end, e.address_mirror)
  end
end
local fh = io.open(os.getenv("INPUT_MAP_OUT"), "w")
fh:write(table.concat(out, "\\n") .. "\\n")
fh:close()
manager.machine:exit()
"""


def manifest_inputs(game):
    js = (f'const m=(await import("{os.path.join(REPO, "games", game, "manifest.js")}")).default;'
          'console.log(JSON.stringify({inputs:m.inputs,board:m.board}))')
    r = subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"cannot load games/{game}/manifest.js: {r.stderr.strip()[-200:]}")
    return json.loads(r.stdout)


def mame_dump(driver, rompath):
    with tempfile.TemporaryDirectory() as td:
        lua, out = os.path.join(td, "ports.lua"), os.path.join(td, "ports.txt")
        open(lua, "w").write(LUA)
        env = dict(os.environ, INPUT_MAP_OUT=out, SDL_VIDEODRIVER="dummy")
        r = subprocess.run(["mame", driver, "-rompath", rompath, "-video", "none", "-sound", "none", "-nothrottle",
                            "-skip_gameinfo", "-noreadconfig", "-nowriteconfig", "-cfg_directory", td,
                            "-nvram_directory", td, "-autoboot_script", lua, "-seconds_to_run", "2"],
                           capture_output=True, text=True, env=env, timeout=120)
        if not os.path.exists(out):
            raise RuntimeError(f"MAME wrote no port dump (exit {r.returncode}): {r.stderr.strip()[-200:]}")
        return open(out).read()


def parse_dump(text):
    fields, ports = {}, {}
    for ln in text.splitlines():
        p = ln.split("\t")
        if p[0] == "FIELD" and len(p) == 4:
            fields[p[2]] = (p[1], int(p[3]))
        elif p[0] == "PORT" and len(p) == 5:
            ports.setdefault(p[1], []).append((int(p[2]), int(p[3]), int(p[4])))
    if not fields or not ports:
        raise RuntimeError("MAME port dump has no fields or no port-mapped addresses")
    return fields, ports


def port_at(ports, addr):
    for tag, ranges in ports.items():
        for lo, hi, mirror in ranges:
            if lo <= (addr & ~mirror) <= hi:
                return tag
    return None


def compare(inputs, fields, ports):
    """Problems (empty == the manifest map is MAME's)."""
    bad = []
    actions, keys, declared = inputs.get("actions", {}), inputs.get("keys", {}), inputs.get("ports", {})
    for name, addr in declared.items():
        if port_at(ports, addr) is None:
            bad.append(f"ports.{name} 0x{addr:04x} is not an address MAME maps to an input port")
    for name, act in actions.items():
        fname = FIELDS.get(name)
        if fname is None:
            bad.append(f"action {name}: no MAME field name known for it (extend input_map_gate.FIELDS)")
            continue
        if fname not in fields:
            bad.append(f"action {name}: MAME has no '{fname}' field")
            continue
        tag, mask = fields[fname]
        where = port_at(ports, act["port"])
        if where != tag:
            bad.append(f"action {name}: port 0x{act['port']:04x} reads {where}, but MAME's '{fname}' is on {tag}")
        if act["bit"] != mask:
            bad.append(f"action {name}: bit 0x{act['bit']:02x}, but MAME's '{fname}' mask is 0x{mask:02x}")
    for code, name in keys.items():
        if name not in actions:
            bad.append(f"key {code} -> '{name}', which is not a declared action")
    mapped = {port_at(ports, a) for a in (act["port"] for act in actions.values())}
    for name, fname in FIELDS.items():
        if name not in actions and fname in fields and fields[fname][0] in mapped:
            bad.append(f"MAME field '{fname}' on {fields[fname][0]} has no '{name}' action in the manifest")
    return bad


def check(game):
    hw_driver = None
    try:
        facts = manifest_inputs(game)
        hw = json.load(open(os.path.join(REPO, "boards", facts["board"], "hardware.json")))
        hw_driver = hw["driver"]
        fields, ports = parse_dump(mame_dump(hw_driver, os.path.join(REPO, "games", game, "rom")))
    except FileNotFoundError as e:
        print(f"input_map: SKIP -- {e} (NOT validated)")
        return 1
    except (RuntimeError, OSError, KeyError, ValueError, subprocess.SubprocessError) as e:
        print(f"input_map: FAIL -- {game}: {e}")
        return 1
    bad = compare(facts["inputs"] or {}, fields, ports)
    for b in bad:
        print(f"  - {b}")
    if bad:
        print(f"input_map: FAIL -- {game}: manifest.inputs disagrees with MAME's {hw_driver} ports")
        return 1
    print(f"input_map: PASS -- {game}")
    return 0


CANNED = """FIELD\t:IN0\tCoin 1\t1
FIELD\t:IN0\tCoin 2\t2
FIELD\t:IN0\tService 1\t4
FIELD\t:IN0\t1 Player Start\t8
FIELD\t:IN0\t2 Players Start\t16
FIELD\t:IN1\tP1 Left\t1
FIELD\t:IN1\tP1 Right\t2
FIELD\t:IN1\tP1 Up\t4
FIELD\t:IN1\tP1 Down\t8
FIELD\t:IN1\tP1 Button 1\t16
PORT\t:IN0\t49920\t49920\t3231
PORT\t:IN1\t49952\t49952\t3231
PORT\t:IN2\t49984\t49984\t3231
"""


def selftest():
    good = {"ports": {"in0": 0xc300, "in1": 0xc320, "in2": 0xc340},
            "actions": {"left": {"port": 0xc320, "bit": 0x01}, "right": {"port": 0xc320, "bit": 0x02},
                        "up": {"port": 0xc320, "bit": 0x04}, "down": {"port": 0xc320, "bit": 0x08},
                        "fire": {"port": 0xc320, "bit": 0x10}, "coin": {"port": 0xc300, "bit": 0x01},
                        "coin2": {"port": 0xc300, "bit": 0x02}, "service": {"port": 0xc300, "bit": 0x04},
                        "start1": {"port": 0xc300, "bit": 0x08}, "start2": {"port": 0xc300, "bit": 0x10}},
            "keys": {"Space": "fire", "Digit5": "coin", "Digit2": "start2"}}
    fields, ports = parse_dump(CANNED)
    ok = True

    def mutant(label, edit, want_red=True):
        nonlocal ok
        m = json.loads(json.dumps(good))
        edit(m)
        red = bool(compare(m, fields, ports))
        if red != want_red:
            print(f"selftest FAIL: {label}: {'GREEN' if not red else 'RED'}", file=sys.stderr)
            ok = False

    mutant("control (the real map)", lambda m: None, want_red=False)
    mutant("a mirrored port address reads the same port", lambda m: m["actions"]["coin"].update(port=0xc301),
           want_red=False)
    mutant("fire bit 0x10 -> 0x20", lambda m: m["actions"]["fire"].update(bit=0x20))
    mutant("left bit -> right's", lambda m: m["actions"]["left"].update(bit=0x02))
    mutant("coin2 bit -> 0x80", lambda m: m["actions"]["coin2"].update(bit=0x80))
    mutant("start2 on start1's bit", lambda m: m["actions"]["start2"].update(bit=0x08))
    mutant("fire on the wrong port", lambda m: m["actions"]["fire"].update(port=0xc300))
    mutant("a key bound to an undeclared action", lambda m: m["keys"].update(KeyQ="jump"))
    mutant("coin2 dropped from the manifest", lambda m: m["actions"].pop("coin2"))
    mutant("a declared port MAME does not map", lambda m: m["ports"].update(in3=0xd000))
    try:
        parse_dump("garbage\n")
        print("selftest FAIL: an empty dump parsed", file=sys.stderr)
        ok = False
    except RuntimeError:
        pass
    print("selftest OK" if ok else "selftest FAILED")
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check")
    c.add_argument("--game", required=True)
    sub.add_parser("selftest")
    a = ap.parse_args()
    return selftest() if a.cmd == "selftest" else check(a.game)


if __name__ == "__main__":
    sys.exit(main())
