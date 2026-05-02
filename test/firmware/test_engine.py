"""
Unit tests for firmware/engine.py.

The interesting invariants here are around _on_complete fan-out:
the Dispatcher attaches a *persistent* listener at startup, then
arm() sets a *one-shot* per-race callback. The persistent listener
must keep firing across many races; arm() must not clobber it.
"""

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "firmware"))

import engine  # noqa: E402
from engine import Engine, IDLE, ARMED, RACING  # noqa: E402


class TestEngineListenerLifecycle(unittest.TestCase):
    def test_persistent_listener_fires_every_race(self):
        e = Engine()
        seen = []
        e.add_listener(lambda r: seen.append(r["race_id"]))

        # Race 1
        e.arm("123456")
        e.on_gate_opened(0)
        for lane in range(1, 7):
            e.on_lane_triggered(lane, 100 * lane)
        self.assertEqual(len(seen), 1)
        first_id = seen[0]
        self.assertEqual(e.phase, IDLE)

        # Race 2 — persistent listener must still fire.
        e.arm("123456")
        self.assertEqual(e.phase, ARMED)
        e.on_gate_opened(1000)
        for lane in range(1, 7):
            e.on_lane_triggered(lane, 1000 + 100 * lane)
        self.assertEqual(len(seen), 2,
                         "persistent listener was lost on the second arm")
        self.assertNotEqual(seen[1], first_id)

    def test_one_shot_fires_alongside_persistent(self):
        e = Engine()
        persistent = []
        one_shot = []
        e.add_listener(lambda r: persistent.append(r))

        e.arm("12", on_complete=lambda r: one_shot.append(r))
        e.on_gate_opened(0)
        e.on_lane_triggered(1, 50)
        e.on_lane_triggered(2, 60)
        self.assertEqual(len(persistent), 1)
        self.assertEqual(len(one_shot), 1)

        # Second race: persistent fires, one-shot does NOT (it was a one-shot).
        e.arm("12")
        e.on_gate_opened(100)
        e.on_lane_triggered(1, 150)
        e.on_lane_triggered(2, 160)
        self.assertEqual(len(persistent), 2)
        self.assertEqual(len(one_shot), 1)

    def test_cancel_does_not_clear_persistent_listener(self):
        e = Engine()
        seen = []
        e.add_listener(lambda r: seen.append(r))

        e.arm("12", on_complete=lambda r: None)
        e.cancel()
        self.assertEqual(e.phase, IDLE)

        # Subsequent race must still notify the persistent listener.
        e.arm("12")
        e.on_gate_opened(0)
        e.on_lane_triggered(1, 10)
        e.on_lane_triggered(2, 20)
        self.assertEqual(len(seen), 1)

    def test_timeout_completes_with_partial_times(self):
        e = Engine()
        seen = []
        e.add_listener(lambda r: seen.append(r))

        e.arm("123")
        e.on_gate_opened(0)
        e.on_lane_triggered(1, 100)  # only lane 1 finishes
        e.check_timeout(0)  # no-op, race still active
        e.check_timeout(99999)  # well past RACE_TIMEOUT_MS
        self.assertEqual(len(seen), 1)
        self.assertEqual(set(seen[0]["times_ms"].keys()), {"1"})


if __name__ == "__main__":
    unittest.main()
