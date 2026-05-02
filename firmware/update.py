# update.py — In-band firmware update command family.
#
# Implements the update_begin / update_chunk / update_commit / update_abort
# commands used by the host to flash new firmware over the existing v2
# connection (serial or HTTP). See specs/11-firmware-update.md.
#
# Files are streamed in base64 chunks into a /_stage directory, validated
# with sha256, then atomically renamed into root on commit, followed by a
# soft reset.

try:
    import json
except ImportError:
    import ujson as json  # MicroPython fallback

import os
import time
import binascii

try:
    import hashlib
    _HAS_SHA256 = True
except Exception:
    _HAS_SHA256 = False


STAGE_DIR = "_stage"
SESSION_TIMEOUT_MS = 30000

# Per-transport chunk caps (bytes after base64 decode).
SERIAL_CHUNK = 256
HTTP_CHUNK = 1024


def _ticks():
    try:
        return time.ticks_ms()
    except AttributeError:
        return int(time.monotonic() * 1000)


def _ticks_diff(a, b):
    try:
        return time.ticks_diff(a, b)
    except AttributeError:
        return a - b


def _ensure_stage():
    try:
        os.mkdir(STAGE_DIR)
    except OSError:
        pass


def _path(name):
    return STAGE_DIR + "/" + name


def _wipe_stage():
    try:
        for n in os.listdir(STAGE_DIR):
            try:
                os.remove(_path(n))
            except OSError:
                pass
        try:
            os.rmdir(STAGE_DIR)
        except OSError:
            pass
    except OSError:
        pass


def _safe_name(n):
    # Reject anything with a path separator. Keep us in the leaf namespace.
    if not n or "/" in n or "\\" in n or n.startswith("."):
        return False
    return True


class UpdateSession:
    """Tracks state between update_begin and update_commit/abort."""

    def __init__(self, version, files, chunk_size):
        self.version = version
        self.files = {f["name"]: f for f in files}  # name -> {size,sha256}
        self.received = {f["name"]: 0 for f in files}
        self.hashers = {}
        self.chunk_size = chunk_size
        self.session_id = "u-%d" % _ticks()
        self.last_activity = _ticks()
        if _HAS_SHA256:
            for n in self.files:
                self.hashers[n] = hashlib.sha256()


class UpdateManager:
    """Owns the (single) active update session and dispatches update_*."""

    def __init__(self, engine, default_chunk=SERIAL_CHUNK):
        self._engine = engine
        self._default_chunk = default_chunk
        self._session = None

    def is_active(self):
        return self._session is not None

    def tick(self):
        """Auto-abort sessions that have gone idle."""
        if self._session is None:
            return
        if _ticks_diff(_ticks(), self._session.last_activity) > SESSION_TIMEOUT_MS:
            _wipe_stage()
            self._session = None

    # ── Command handlers — return (ok_payload, err_code, err_msg). ──

    def begin(self, args):
        if self._session is not None:
            return None, "busy", "another update session is open"
        version = args.get("version")
        files = args.get("files")
        if not isinstance(version, str) or not isinstance(files, list) or not files:
            return None, "bad_args", "manifest requires version and files[]"
        for f in files:
            if not isinstance(f, dict):
                return None, "bad_args", "file entry must be an object"
            if not _safe_name(f.get("name")):
                return None, "bad_args", "invalid filename: " + str(f.get("name"))
            size = f.get("size")
            if not isinstance(size, int) or size < 0 or size > 1000000:
                return None, "bad_args", "invalid file size"
            if "sha256" in f and not isinstance(f["sha256"], str):
                return None, "bad_args", "sha256 must be a hex string"

        _ensure_stage()
        # Truncate any pre-existing staged files.
        for f in files:
            try:
                os.remove(_path(f["name"]))
            except OSError:
                pass

        self._session = UpdateSession(version, files, self._default_chunk)
        return {
            "session": self._session.session_id,
            "chunk_size": self._session.chunk_size,
        }, None, None

    def chunk(self, args):
        s = self._session
        if s is None:
            return None, "bad_state", "no active update session"
        if args.get("session") != s.session_id:
            return None, "bad_args", "session mismatch"
        name = args.get("name")
        if name not in s.files:
            return None, "bad_args", "unknown file: " + str(name)
        offset = args.get("offset")
        if offset != s.received[name]:
            return None, "bad_args", "offset out of order (expected %d)" % s.received[name]
        b64 = args.get("data")
        if not isinstance(b64, str):
            return None, "bad_args", "data must be base64 string"
        try:
            blob = binascii.a2b_base64(b64)
        except Exception:
            return None, "bad_args", "could not decode base64"
        if len(blob) > s.chunk_size:
            return None, "bad_args", "chunk exceeds chunk_size"

        # Append to the staged file.
        try:
            with open(_path(name), "ab") as fh:
                fh.write(blob)
        except OSError as e:
            return None, "internal", "filesystem write failed: " + str(e)

        s.received[name] += len(blob)
        if name in s.hashers:
            s.hashers[name].update(blob)
        s.last_activity = _ticks()

        # On final chunk, validate sha256.
        expected = s.files[name].get("sha256")
        if s.received[name] >= s.files[name]["size"]:
            if expected and _HAS_SHA256:
                got = binascii.hexlify(s.hashers[name].digest()).decode("ascii")
                if got != expected.lower():
                    # Reset this file so the host can retry it.
                    try:
                        os.remove(_path(name))
                    except OSError:
                        pass
                    s.received[name] = 0
                    s.hashers[name] = hashlib.sha256()
                    return None, "bad_args", "sha256 mismatch on " + name
        return {"received": s.received[name]}, None, None

    def commit(self, args):
        s = self._session
        if s is None:
            return None, "bad_state", "no active update session"
        if args.get("session") != s.session_id:
            return None, "bad_args", "session mismatch"
        # Verify all files complete.
        for name, meta in s.files.items():
            if s.received[name] < meta["size"]:
                return None, "bad_state", name + " is incomplete"
        # Refuse only when cars are physically running. ARMED (waiting
        # for the gate) is safe to cancel — auto-cancel rather than
        # forcing the host to do a separate cancel dance.
        if self._engine.phase == "RACING":
            return None, "bad_state", "race in progress — wait for it to finish"
        if self._engine.phase == "ARMED":
            self._engine.cancel()

        # Atomic-ish swap: rename staged → root.
        for name in s.files:
            try:
                try:
                    os.remove(name)
                except OSError:
                    pass
                os.rename(_path(name), name)
            except OSError as e:
                return None, "internal", "rename failed: " + str(e)

        _wipe_stage()
        self._session = None

        # Schedule reboot after we've returned. Caller must call
        # finish_commit_reboot() ~500ms later.
        return {"committed": True, "rebooting_in_ms": 500}, None, None

    def abort(self, args):
        s = self._session
        if s is None:
            return {}, None, None  # idempotent
        if args.get("session") != s.session_id:
            return None, "bad_args", "session mismatch"
        _wipe_stage()
        self._session = None
        return {}, None, None


def attach(dispatcher, engine, default_chunk=SERIAL_CHUNK):
    """Wire UpdateManager into the v2 Dispatcher's command table.

    Returns the UpdateManager so main.py can drive the post-commit
    reboot timer (since we want to send the OK frame *before* rebooting).
    """
    from protocol_v2 import Session

    mgr = UpdateManager(engine, default_chunk=default_chunk)
    mgr._pending_reboot = {"at_ms": None}

    # Register this manager as the current one. The Session class-level
    # slot lets the patched dispatch find the active manager — important
    # for tests where multiple Dispatchers are created in sequence.
    Session._update_mgr = mgr

    if getattr(Session, "_update_attached", False):
        return mgr

    original_dispatch = Session._dispatch

    def patched_dispatch(self, req_id, cmd, args):
        m = getattr(Session, "_update_mgr", None)
        if m is not None:
            if cmd == "update_begin":
                ok, code, msg = m.begin(args)
                if code:
                    self._send_err(req_id, code, msg)
                else:
                    self._ok(req_id, ok)
                return
            if cmd == "update_chunk":
                ok, code, msg = m.chunk(args)
                if code:
                    self._send_err(req_id, code, msg)
                else:
                    self._ok(req_id, ok)
                return
            if cmd == "update_commit":
                ok, code, msg = m.commit(args)
                if code:
                    self._send_err(req_id, code, msg)
                else:
                    self._ok(req_id, ok)
                    m._pending_reboot["at_ms"] = _ticks() + ok["rebooting_in_ms"]
                return
            if cmd == "update_abort":
                ok, code, msg = m.abort(args)
                if code:
                    self._send_err(req_id, code, msg)
                else:
                    self._ok(req_id, ok)
                return
            # Block race commands while an update is in progress.
            if m.is_active() and cmd in ("wait_race", "wait_gate"):
                self._send_err(req_id, "bad_state", "update in progress")
                return
        original_dispatch(self, req_id, cmd, args)

    Session._dispatch = patched_dispatch
    Session._update_attached = True
    return mgr


def should_reboot(mgr):
    """Returns True if the post-commit reboot delay has elapsed."""
    pr = getattr(mgr, "_pending_reboot", None)
    if not pr or pr["at_ms"] is None:
        return False
    if _ticks_diff(_ticks(), pr["at_ms"]) >= 0:
        pr["at_ms"] = None
        return True
    return False


def perform_reboot():
    """Soft-reset the device. Called from main.py after the OK has flushed."""
    try:
        import machine
        machine.soft_reset()
    except Exception:
        # On CPython tests, just exit.
        import sys
        sys.exit(0)
