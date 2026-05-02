"""
Unit tests for firmware/update.py.

Run with: python3 -m unittest test.firmware.test_update
"""

import base64
import hashlib
import json
import os
import sys
import shutil
import tempfile
import unittest


HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "firmware"))


# Mock 'config' before importing.
fake_config = type(sys)("config")
fake_config.FIRMWARE_VERSION = "test-2.0.0"
fake_config.LANE_COUNT = 6
fake_config.DEBOUNCE_MS = 10
sys.modules["config"] = fake_config


from test.firmware.test_protocol_v2 import (  # noqa: E402
    FakeEngine, FakeGpio, CapturingTransport,
)
import protocol_v2  # noqa: E402
import update as update_mod  # noqa: E402


class _Workdir:
    """Run each test in a temp dir so the staging dir doesn't pollute."""

    def __enter__(self):
        self._old = os.getcwd()
        self._dir = tempfile.mkdtemp(prefix="rallylab-fw-test-")
        os.chdir(self._dir)
        return self._dir

    def __exit__(self, *exc):
        os.chdir(self._old)
        shutil.rmtree(self._dir, ignore_errors=True)


def _make_dispatcher_and_session():
    eng = FakeEngine()
    gpio = FakeGpio()
    disp = protocol_v2.Dispatcher(eng, gpio)
    cap = CapturingTransport()
    sess = disp.new_session(cap.write_line)
    mgr = update_mod.attach(disp, eng)
    # Reset any leftover pending_reboot from prior tests (the Session
    # patch is one-shot but the pending_reboot dict is per-mgr).
    mgr._pending_reboot["at_ms"] = None
    return disp, sess, eng, cap, mgr


def _file(content):
    return {
        "name": "n.py",
        "size": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
        "content": content,
    }


class TestUpdate(unittest.TestCase):
    def test_full_upload_flow(self):
        with _Workdir():
            disp, s, eng, cap, mgr = _make_dispatcher_and_session()

            content = b"# main.py\nprint('hi')\n" * 30
            sha = hashlib.sha256(content).hexdigest()
            s.feed_line(json.dumps({
                "id": 1, "cmd": "update_begin",
                "version": "0.2.1",
                "files": [{"name": "main.py", "size": len(content), "sha256": sha}],
            }))
            s.drain()
            out = cap.parsed()
            self.assertEqual(out[-1]["id"], 1)
            ok = out[-1]["ok"]
            session = ok["session"]
            chunk_size = ok["chunk_size"]

            # Stream chunks.
            cap.reset()
            offset = 0
            req_id = 2
            while offset < len(content):
                blob = content[offset:offset + chunk_size]
                s.feed_line(json.dumps({
                    "id": req_id, "cmd": "update_chunk",
                    "session": session, "name": "main.py",
                    "offset": offset,
                    "data": base64.b64encode(blob).decode("ascii"),
                }))
                offset += len(blob)
                req_id += 1
            s.drain()
            outs = cap.parsed()
            for o in outs:
                self.assertIn("ok", o, msg="chunk error: " + json.dumps(o))
            self.assertEqual(outs[-1]["ok"]["received"], len(content))

            # Commit.
            cap.reset()
            s.feed_line(json.dumps({"id": 99, "cmd": "update_commit",
                                     "session": session}))
            s.drain()
            out = cap.parsed()
            self.assertTrue(out[-1]["ok"]["committed"])

            # File should be in cwd now.
            with open("main.py", "rb") as fh:
                self.assertEqual(fh.read(), content)

            # Reboot is scheduled but not yet fired.
            self.assertFalse(update_mod.should_reboot(mgr))
            # Force the deadline to elapse and check should_reboot fires once.
            mgr._pending_reboot["at_ms"] = 0
            self.assertTrue(update_mod.should_reboot(mgr))
            self.assertFalse(update_mod.should_reboot(mgr))  # idempotent

    def test_busy_when_session_open(self):
        with _Workdir():
            disp, s, eng, cap, mgr = _make_dispatcher_and_session()
            content = b"x" * 16
            sha = hashlib.sha256(content).hexdigest()
            s.feed_line(json.dumps({
                "id": 1, "cmd": "update_begin",
                "version": "1", "files": [{"name": "a.py", "size": 16, "sha256": sha}],
            }))
            s.drain()
            cap.reset()
            s.feed_line(json.dumps({
                "id": 2, "cmd": "update_begin",
                "version": "1", "files": [{"name": "b.py", "size": 16, "sha256": sha}],
            }))
            s.drain()
            out = cap.parsed()
            self.assertEqual(out[-1]["code"], "busy")

    def test_sha_mismatch_rejected(self):
        with _Workdir():
            disp, s, eng, cap, mgr = _make_dispatcher_and_session()
            content = b"hello world"
            wrong_sha = "0" * 64
            s.feed_line(json.dumps({
                "id": 1, "cmd": "update_begin",
                "version": "1",
                "files": [{"name": "a.py", "size": len(content), "sha256": wrong_sha}],
            }))
            s.drain()
            session = cap.parsed()[-1]["ok"]["session"]
            cap.reset()
            s.feed_line(json.dumps({
                "id": 2, "cmd": "update_chunk",
                "session": session, "name": "a.py", "offset": 0,
                "data": base64.b64encode(content).decode("ascii"),
            }))
            s.drain()
            out = cap.parsed()
            self.assertEqual(out[-1]["code"], "bad_args")
            self.assertIn("sha256", out[-1]["err"])

    def test_blocks_wait_race_during_update(self):
        with _Workdir():
            disp, s, eng, cap, mgr = _make_dispatcher_and_session()
            sha = hashlib.sha256(b"x" * 8).hexdigest()
            s.feed_line(json.dumps({
                "id": 1, "cmd": "update_begin",
                "version": "1", "files": [{"name": "a.py", "size": 8, "sha256": sha}],
            }))
            s.drain()
            cap.reset()
            s.feed_line(json.dumps({"id": 2, "cmd": "wait_race"}))
            s.drain()
            out = cap.parsed()
            self.assertEqual(out[-1]["id"], 2)
            self.assertEqual(out[-1]["code"], "bad_state")

    def test_abort_clears_session(self):
        with _Workdir():
            disp, s, eng, cap, mgr = _make_dispatcher_and_session()
            sha = hashlib.sha256(b"x" * 8).hexdigest()
            s.feed_line(json.dumps({
                "id": 1, "cmd": "update_begin",
                "version": "1", "files": [{"name": "a.py", "size": 8, "sha256": sha}],
            }))
            s.drain()
            session = cap.parsed()[-1]["ok"]["session"]
            cap.reset()
            s.feed_line(json.dumps({"id": 2, "cmd": "update_abort",
                                     "session": session}))
            s.drain()
            self.assertEqual(cap.parsed()[-1]["ok"], {})
            # Now another begin should succeed.
            s.feed_line(json.dumps({
                "id": 3, "cmd": "update_begin",
                "version": "2", "files": [{"name": "b.py", "size": 8, "sha256": sha}],
            }))
            s.drain()
            self.assertIn("ok", cap.parsed()[-1])

    def test_rejects_path_traversal(self):
        with _Workdir():
            disp, s, eng, cap, mgr = _make_dispatcher_and_session()
            sha = hashlib.sha256(b"x").hexdigest()
            s.feed_line(json.dumps({
                "id": 1, "cmd": "update_begin",
                "version": "1",
                "files": [{"name": "../etc/passwd", "size": 1, "sha256": sha}],
            }))
            s.drain()
            self.assertEqual(cap.parsed()[-1]["code"], "bad_args")

    def test_commit_fails_when_engine_busy(self):
        with _Workdir():
            disp, s, eng, cap, mgr = _make_dispatcher_and_session()
            content = b"x" * 8
            sha = hashlib.sha256(content).hexdigest()
            s.feed_line(json.dumps({
                "id": 1, "cmd": "update_begin",
                "version": "1", "files": [{"name": "a.py", "size": 8, "sha256": sha}],
            }))
            s.drain()
            session = cap.parsed()[-1]["ok"]["session"]
            s.feed_line(json.dumps({
                "id": 2, "cmd": "update_chunk",
                "session": session, "name": "a.py", "offset": 0,
                "data": base64.b64encode(content).decode("ascii"),
            }))
            s.drain()
            cap.reset()

            eng.phase = "RACING"  # force non-IDLE
            s.feed_line(json.dumps({"id": 99, "cmd": "update_commit",
                                     "session": session}))
            s.drain()
            self.assertEqual(cap.parsed()[-1]["code"], "bad_state")


if __name__ == "__main__":
    unittest.main()
