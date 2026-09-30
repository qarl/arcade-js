#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Delete raw capture dumps once the verdict is in -- the one mechanism every pixel/state caller uses.

A MAME golden (tools/mame_golden.py) and a JS render (games/<g>/tools/render.js) each leave a raw
frames.rgb (~170KB per frame) and the golden a state.bin; a 10-minute run is several GB. Nothing reads
them after the verdict (gates key on the printed verdict line, never on the files), so they are deleted
on PASS, FAIL, an exception, Ctrl-C and SIGTERM/SIGHUP alike. Small artifacts stay: frames.json hashes,
manifests, tapes, reach.json, summary.json.

A signal first stops this process's children (SIGTERM, then wait; SIGKILL after STOP_GRACE seconds), so a
producer mid-capture runs its own cleanup (mame_golden.py removes its temp capture dir the same way)
before the sweep. What can still strand dumps: a SIGKILL of the caller, a child that ignores SIGTERM for
STOP_GRACE seconds, power loss. The cron df+sweep is the backstop for those, and can call `sweep` below.

A sweep never touches an empty path, the filesystem root, $HOME, the repo root, or any ancestor of
those; it prints a refusal and deletes nothing there.

In a suite:
    with raw_dumps(work, keep=a.keep_frames):            # sweep dumps under `work` afterwards
    with raw_dumps(tmp, keep=a.keep_frames, rmtree=True): # a private temp dir: remove it whole
    with raw_dumps(work, keep=..., summary=summary):      # also write summary.json into `work`
A producer with its own temp dir wraps itself in `signals_to_exit()` so its `finally` runs on a signal.

An ad-hoc driver (a shell loop over mame_golden.py + render.js + a differ) wraps itself instead:
    python3 tools/raw_dumps.py run --dir OUT_G --dir OUT_J [--keep-frames] -- CMD ARGS...
which runs CMD in its own process group, sweeps every --dir once that group is gone (forwarding
SIGTERM/SIGINT/SIGHUP to it), and exits with CMD's code. `sweep DIR...` deletes the dumps under DIRs now.
"""
import argparse
import contextlib
import json
import os
import shutil
import signal
import subprocess
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_SUFFIXES = (".rgb", ".avi")
RAW_NAMES = ("state.bin",)
# Dumps sit in the dir a caller names or at most two levels below it (work/<tape>/golden/frames.rgb).
# The walk stops there, so a mistaken --work (a network mount) cannot turn into a tree crawl.
MAX_DEPTH = 2
TRAPPED = (signal.SIGTERM, signal.SIGHUP)
STOP_GRACE = 15
_stopping = False


def is_raw(name):
    return name in RAW_NAMES or name.endswith(RAW_SUFFIXES)


def _refused(top):
    """Why `top` must never be swept or removed, or None. '' is the cwd to os.walk and to rmtree's
    callers; / , $HOME and the repo root (and their ancestors) hold things that are not this run's."""
    if not str(top).strip():
        return "an empty path"
    real = os.path.realpath(top)
    for label, guard in (("the filesystem root", os.sep), ("$HOME", os.path.expanduser("~")),
                         ("the repo root", REPO)):
        g = os.path.realpath(guard)
        if real == g or g.startswith(real.rstrip(os.sep) + os.sep):
            return f"{label} or an ancestor of it"
    return None


def _allowed(top):
    why = _refused(top)
    if why:
        print(f"raw_dumps: refusing to clean {top!r}: {why}", file=sys.stderr)
    return why is None


def raw_files(*dirs):
    """Every raw dump under `dirs` (to MAX_DEPTH, symlinks not followed); a missing or refused dir has none."""
    found = []
    for top in dirs:
        if not _allowed(top) or not os.path.isdir(top):
            continue
        top = os.path.abspath(top)
        base = top.rstrip(os.sep).count(os.sep)
        for root, subdirs, files in os.walk(top, followlinks=False):
            if root.rstrip(os.sep).count(os.sep) - base >= MAX_DEPTH:
                subdirs[:] = []
            found += [os.path.join(root, f) for f in files if is_raw(f)]
    return found


def sweep(*dirs):
    """Delete the raw dumps under `dirs`; returns the paths removed."""
    gone = []
    for path in raw_files(*dirs):
        with contextlib.suppress(FileNotFoundError):
            os.remove(path)
            gone.append(path)
    return gone


def _exited(pid):
    """True once child `pid` has exited (without reaping it: its Popen still collects the status)."""
    try:
        return os.waitid(os.P_PID, pid, os.WEXITED | os.WNOHANG | os.WNOWAIT) is not None
    except ChildProcessError:
        return True


def stop_children(grace=STOP_GRACE):
    """SIGTERM every direct child and wait for it to exit (running its own cleanup); SIGKILL after `grace`."""
    try:
        out = subprocess.run(["pgrep", "-P", str(os.getpid())], capture_output=True, text=True,
                             timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return
    kids = [int(x) for x in out.split()]
    for pid in kids:
        with contextlib.suppress(ProcessLookupError):
            os.kill(pid, signal.SIGTERM)
    deadline = time.monotonic() + grace
    while kids and time.monotonic() < deadline:
        kids = [pid for pid in kids if not _exited(pid)]
        time.sleep(0.05)
    for pid in kids:
        with contextlib.suppress(ProcessLookupError):
            os.kill(pid, signal.SIGKILL)


def _on_signal(signum, _frame):
    global _stopping
    if _stopping:
        return
    _stopping = True
    try:
        stop_children()
    finally:
        _stopping = False
    if signum == signal.SIGINT:
        raise KeyboardInterrupt
    raise SystemExit(128 + signum)


@contextlib.contextmanager
def signals_to_exit():
    """SIGTERM/SIGHUP/SIGINT stop the children, then raise (SystemExit / KeyboardInterrupt) so `finally`
    runs; SIGTERM's default action would skip it. A handler someone else installed (an outer
    signals_to_exit already does this) is left alone."""
    saved = {}
    for sig, default in ((signal.SIGTERM, signal.SIG_DFL), (signal.SIGHUP, signal.SIG_DFL),
                         (signal.SIGINT, signal.default_int_handler)):
        try:
            if signal.getsignal(sig) == default:
                saved[sig] = signal.signal(sig, _on_signal)
        except ValueError:
            break
    try:
        yield
    finally:
        for sig, handler in saved.items():
            signal.signal(sig, handler)


def write_summary(work, summary, keep):
    summary["raw_frames_kept"] = bool(keep)
    try:
        os.makedirs(work, exist_ok=True)
        with open(os.path.join(work, "summary.json"), "w", encoding="utf-8") as fh:
            json.dump(summary, fh, indent=1, default=str)
            fh.write("\n")
    except OSError as e:
        print(f"  warning: could not write summary.json: {e}")


@contextlib.contextmanager
def raw_dumps(*dirs, keep=False, summary=None, rmtree=False):
    """Run the body, then (unless `keep`) delete the raw dumps under `dirs` -- or the dirs themselves
    when `rmtree` -- on every exit path. `summary` (a dict the body fills in) is written to the first
    dir as summary.json before the sweep."""
    with signals_to_exit():
        try:
            yield
        finally:
            if summary is not None and _allowed(dirs[0]):
                write_summary(dirs[0], summary, keep)
            if keep:
                print(f"  raw dumps kept (--keep-frames): {', '.join(dirs)}")
            elif rmtree:
                for d in dirs:
                    if _allowed(d):
                        shutil.rmtree(d, ignore_errors=True)
            else:
                sweep(*dirs)


def _group_alive(pgid):
    try:
        os.killpg(pgid, 0)
        return True
    except (ProcessLookupError, PermissionError):
        return False


def run(cmd, dirs, keep=False, grace=STOP_GRACE):
    """Run `cmd` in its own process group inside raw_dumps(dirs). A signal to this wrapper goes to the whole
    group; the sweep waits until every process in it is gone (SIGKILL after `grace`), so nothing it
    started is still writing. Returns `cmd`'s exit code (or 128+signal)."""
    child = None

    def forward(signum, _frame):
        if child is not None:
            with contextlib.suppress(ProcessLookupError, PermissionError):
                os.killpg(child.pid, signum)

    with raw_dumps(*dirs, keep=keep):
        prev = {s: signal.signal(s, forward) for s in (*TRAPPED, signal.SIGINT)}
        try:
            child = subprocess.Popen(cmd, start_new_session=True)
            rc = child.wait()
        finally:
            if child is not None:
                if child.poll() is None:
                    forward(signal.SIGTERM, None)
                deadline = time.monotonic() + grace
                while (child.poll() is None or _group_alive(child.pid)) and time.monotonic() < deadline:
                    time.sleep(0.05)
                if child.poll() is None or _group_alive(child.pid):
                    forward(signal.SIGKILL, None)
                    child.wait()
            for s, h in prev.items():
                signal.signal(s, h)
    return rc if rc >= 0 else 128 - rc


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="run CMD, then delete the raw dumps under every --dir")
    r.add_argument("--dir", action="append", required=True, help="a dir CMD writes dumps into")
    r.add_argument("--keep-frames", action="store_true", help="keep the dumps (debugging)")
    r.add_argument("argv", nargs=argparse.REMAINDER, help="-- CMD ARGS...")
    s = sub.add_parser("sweep", help="delete the raw dumps under DIRs now")
    s.add_argument("dirs", nargs="+")
    a = p.parse_args(argv)
    if a.cmd == "sweep":
        for path in sweep(*a.dirs):
            print(f"removed {path}")
        return 0
    cmd = a.argv[1:] if a.argv[:1] == ["--"] else a.argv
    if not cmd:
        p.error("run needs a command after --")
    return run(cmd, a.dir, a.keep_frames)


if __name__ == "__main__":
    sys.exit(main())
