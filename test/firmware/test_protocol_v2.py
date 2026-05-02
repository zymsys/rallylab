"""
Unit tests for firmware/protocol_v2.py.

Run with: python3 -m unittest test/firmware/test_protocol_v2.py

These tests run on CPython, not on the Pico. They mock the Engine and
GpioManager surfaces that protocol_v2.Dispatcher depends on, so we can
iterate on the protocol without flashing hardware.
"""

import json
import os
import sys
import unittest

# Make firmware/ importable.
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "firmware"))


# ── Fakes ───────────────────────────────────────────────────────────


class FakeEngine:
    def __init__(self, lane_count=6):
        self.phase = "IDLE"
        self.race_id = None
        self.active_lanes = None
        self.last_race = None
        self.gate_ready = True
        self._listeners = []
        self._cancelled = False
        self._lane_count = lane_count

    # -- engine-style API used by Dispatcher ---------------------------
    def add_listener(self, cb):
        self._listeners.append(cb)

    def arm(self, lanes_str, on_complete=None):
        if lanes_str:
            self.active_lanes = set(int(c) for c in lanes_str)
        else:
            self.active_lanes = set(range(1, self._lane_count + 1))
        self.race_id = "test-race-id"
        self.phase = "ARMED"
        if on_complete is not None:
            self._listeners.append(on_complete)

    def cancel(self):
        if self.phase == "ARMED":
            self.phase = "IDLE"
            self.race_id = None
            self.active_lanes = None
        self._cancelled = True

    # -- helpers used by tests -----------------------------------------
    def fire_complete(self, times):
        result = {"race_id": self.race_id or "tr-1", "times_ms": times}
        self.last_race = result
        self.phase = "IDLE"
        # Persistent listeners survive across races; matches real Engine.
        for cb in list(self._listeners):
            cb(result)


class FakeGpio:
    def __init__(self, lane_count=6):
        self._lane_count = lane_count
        self.on_edge = None
        self._lane_state = {l: 1 for l in range(1, lane_count + 1)}

    def gate_dbg(self):
        return {"raw": 1, "debounced": 1, "invert": False, "pull": "up", "last_edge_ms": 0}

    def lanes_dbg(self):
        return {
            str(l): {"raw": s, "debounced": s, "invert": False, "pull": "up", "last_edge_ms": 0}
            for l, s in self._lane_state.items()
        }

    # Convenience for tests.
    def fire_lane(self, lane, ms):
        self._lane_state[lane] = 0
        if self.on_edge:
            self.on_edge({"gpio": 0, "pin": "lane", "lane": lane, "edge": "triggered", "ms": ms})

    def fire_gate(self, opened, ms):
        if self.on_edge:
            self.on_edge({"gpio": 0, "pin": "gate", "edge": "opened" if opened else "closed", "ms": ms})


# Stub the firmware config module before importing protocol_v2.
fake_config = type(sys)("config")
fake_config.FIRMWARE_VERSION = "test-2.0.0"
fake_config.LANE_COUNT = 6
fake_config.DEBOUNCE_MS = 10
sys.modules["config"] = fake_config

import protocol_v2  # noqa: E402


# ── Helpers ─────────────────────────────────────────────────────────


class CapturingTransport:
    """Captures lines that the session would have written."""

    def __init__(self):
        self.lines = []

    def write_line(self, line):
        self.lines.append(line)
        return True  # accepted

    def parsed(self):
        return [json.loads(l) for l in self.lines]

    def reset(self):
        self.lines = []


def make_session(queue_cap=32):
    eng = FakeEngine()
    gpio = FakeGpio()
    disp = protocol_v2.Dispatcher(eng, gpio)
    cap = CapturingTransport()
    s = disp.new_session(cap.write_line, queue_cap=queue_cap)
    return disp, s, eng, gpio, cap


def feed_and_drain(s, line, cap):
    s.feed_line(line)
    s.drain()
    return cap.parsed()


# ── Tests ───────────────────────────────────────────────────────────


class TestInfo(unittest.TestCase):
    def test_info_returns_protocol_2(self):
        _, s, _, _, cap = make_session()
        out = feed_and_drain(s, json.dumps({"id": 1, "cmd": "info"}), cap)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["id"], 1)
        self.assertEqual(out[0]["ok"]["protocol"], "2.0")
        self.assertEqual(out[0]["ok"]["lane_count"], 6)
        self.assertIn("topics", out[0]["ok"])

    def test_info_human_form(self):
        _, s, _, _, cap = make_session()
        out = feed_and_drain(s, "info", cap)
        self.assertEqual(len(out), 1)
        # Human form should auto-assign a negative id.
        self.assertEqual(out[0]["id"], -1)
        self.assertEqual(out[0]["ok"]["protocol"], "2.0")

    def test_human_form_increments_negative(self):
        _, s, _, _, cap = make_session()
        feed_and_drain(s, "info", cap)
        feed_and_drain(s, "info", cap)
        out = cap.parsed()
        self.assertEqual(out[0]["id"], -1)
        self.assertEqual(out[1]["id"], -2)

    def test_blank_and_comment_lines_ignored(self):
        _, s, _, _, cap = make_session()
        feed_and_drain(s, "", cap)
        feed_and_drain(s, "   ", cap)
        feed_and_drain(s, "# this is a comment", cap)
        self.assertEqual(cap.lines, [])


class TestBadFrame(unittest.TestCase):
    def test_unparseable_json(self):
        _, s, _, _, cap = make_session()
        out = feed_and_drain(s, "{not json", cap)
        self.assertEqual(out[0]["err"], "could not parse JSON")
        self.assertEqual(out[0]["code"], "bad_frame")

    def test_missing_cmd(self):
        _, s, _, _, cap = make_session()
        out = feed_and_drain(s, json.dumps({"id": 1, "no_cmd": "info"}), cap)
        self.assertEqual(out[0]["code"], "bad_frame")

    def test_unknown_cmd(self):
        _, s, _, _, cap = make_session()
        out = feed_and_drain(s, json.dumps({"id": 1, "cmd": "blarg"}), cap)
        self.assertEqual(out[0]["id"], 1)
        self.assertEqual(out[0]["code"], "not_supported")


class TestSubscribe(unittest.TestCase):
    def test_subscribe_to_gate_returns_initial_state(self):
        _, s, _, _, cap = make_session()
        feed_and_drain(s, json.dumps({"id": 7, "cmd": "subscribe", "topics": ["gate"]}), cap)
        out = cap.parsed()
        # First the ok, then the initial state push.
        self.assertEqual(out[0], {"id": 7, "ok": {"sub": 7, "topics": ["gate"]}})
        self.assertEqual(out[1]["sub"], 7)
        self.assertEqual(out[1]["event"], "state")
        self.assertEqual(out[1]["gate_ready"], True)

    def test_subscribe_to_lanes_pushes_initial_per_lane(self):
        _, s, _, gpio, cap = make_session()
        feed_and_drain(s, json.dumps({"id": 7, "cmd": "subscribe", "topics": ["lanes"]}), cap)
        out = cap.parsed()
        # ok + 6 lane state events (we mocked 6 lanes)
        self.assertEqual(len(out), 1 + 6)
        self.assertEqual(out[0]["ok"]["sub"], 7)
        for lane_event in out[1:]:
            self.assertEqual(lane_event["sub"], 7)
            self.assertEqual(lane_event["event"], "state")

    def test_subscribe_unknown_topic_listed(self):
        _, s, _, _, cap = make_session()
        feed_and_drain(s, json.dumps({"id": 7, "cmd": "subscribe",
                                       "topics": ["gate", "bogus"]}), cap)
        out = cap.parsed()
        self.assertEqual(out[0]["ok"]["topics"], ["gate"])
        self.assertEqual(out[0]["ok"]["unknown"], ["bogus"])

    def test_subscribe_no_recognized(self):
        _, s, _, _, cap = make_session()
        feed_and_drain(s, json.dumps({"id": 7, "cmd": "subscribe",
                                       "topics": ["bogus"]}), cap)
        out = cap.parsed()
        self.assertEqual(out[0]["code"], "bad_args")

    def test_subscribe_human_form_positional(self):
        _, s, _, _, cap = make_session()
        feed_and_drain(s, "subscribe gate lanes", cap)
        out = cap.parsed()
        self.assertEqual(out[0]["ok"]["topics"], ["gate", "lanes"])

    def test_unsubscribe(self):
        _, s, _, _, cap = make_session()
        feed_and_drain(s, json.dumps({"id": 7, "cmd": "subscribe", "topics": ["gate"]}), cap)
        cap.reset()
        feed_and_drain(s, json.dumps({"id": 8, "cmd": "unsubscribe", "sub": 7}), cap)
        out = cap.parsed()
        self.assertEqual(out[0], {"id": 8, "ok": {}})


class TestEvents(unittest.TestCase):
    def test_lane_edge_pushes_lanes_event(self):
        disp, s, _, gpio, cap = make_session()
        feed_and_drain(s, "subscribe lanes", cap)
        cap.reset()
        gpio.fire_lane(3, 5190)
        s.drain()
        out = cap.parsed()
        # One edge fires both the 'edges' topic (not subscribed) and the
        # 'lanes' topic (subscribed). Only the lanes one should arrive.
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["event"], "state")
        self.assertEqual(out[0]["lane"], 3)
        self.assertTrue(out[0]["triggered"])

    def test_edges_topic_includes_gate_and_lane(self):
        disp, s, _, gpio, cap = make_session()
        feed_and_drain(s, "subscribe edges", cap)
        cap.reset()
        gpio.fire_lane(2, 100)
        gpio.fire_gate(True, 200)
        s.drain()
        out = cap.parsed()
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0]["event"], "edge")
        self.assertEqual(out[0]["pin"], "lane")
        self.assertEqual(out[1]["pin"], "gate")

    def test_gate_state_change_via_tick(self):
        disp, s, eng, _, cap = make_session()
        feed_and_drain(s, "subscribe gate", cap)
        cap.reset()
        # Flip gate ready.
        eng.gate_ready = False
        disp.tick()
        out = cap.parsed()
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["event"], "state")
        self.assertFalse(out[0]["gate_ready"])


class TestWaitRace(unittest.TestCase):
    def test_wait_race_blocks_until_complete(self):
        _, s, eng, _, cap = make_session()
        feed_and_drain(s, json.dumps({"id": 11, "cmd": "wait_race",
                                       "lanes": "12"}), cap)
        # Engine is now ARMED; no response yet.
        self.assertEqual(cap.lines, [])
        eng.fire_complete({"1": 2150, "2": 2300})
        s.drain()
        out = cap.parsed()
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["id"], 11)
        self.assertEqual(out[0]["ok"]["times_ms"], {"1": 2150, "2": 2300})

    def test_wait_race_after_returns_immediately_if_changed(self):
        _, s, eng, _, cap = make_session()
        eng.last_race = {"race_id": "u-1", "times_ms": {"1": 2000}}
        feed_and_drain(s, json.dumps({"id": 11, "cmd": "wait_race",
                                       "after": "u-old"}), cap)
        out = cap.parsed()
        self.assertEqual(out[0]["id"], 11)
        self.assertEqual(out[0]["ok"]["race_id"], "u-1")

    def test_wait_race_concurrent_with_dbg(self):
        # The whole point of v2: dbg works mid-race.
        _, s, eng, _, cap = make_session()
        feed_and_drain(s, json.dumps({"id": 11, "cmd": "wait_race"}), cap)
        feed_and_drain(s, json.dumps({"id": 12, "cmd": "dbg"}), cap)
        out = cap.parsed()
        # dbg should have responded; wait_race is still pending.
        ids = [o["id"] for o in out]
        self.assertIn(12, ids)
        self.assertNotIn(11, ids)

    def test_cancel_wait_race(self):
        _, s, eng, _, cap = make_session()
        feed_and_drain(s, json.dumps({"id": 11, "cmd": "wait_race"}), cap)
        feed_and_drain(s, json.dumps({"id": 99, "cmd": "cancel",
                                       "target": 11}), cap)
        out = cap.parsed()
        # Should see two frames: cancelled error for 11, ok for 99.
        ids = {(o.get("id"), o.get("ok") is not None, o.get("err")) for o in out}
        self.assertIn((11, False, "cancelled by host"), ids)
        self.assertIn((99, True, None), ids)
        # Engine should be back to IDLE.
        self.assertEqual(eng.phase, "IDLE")


class TestWaitGate(unittest.TestCase):
    def test_wait_gate_immediate_when_ready(self):
        _, s, eng, _, cap = make_session()
        eng.gate_ready = True
        feed_and_drain(s, json.dumps({"id": 12, "cmd": "wait_gate"}), cap)
        out = cap.parsed()
        self.assertEqual(out[0]["id"], 12)
        self.assertTrue(out[0]["ok"]["gate_ready"])

    def test_wait_gate_resolves_on_tick(self):
        disp, s, eng, _, cap = make_session()
        eng.gate_ready = False
        feed_and_drain(s, json.dumps({"id": 12, "cmd": "wait_gate"}), cap)
        self.assertEqual(cap.lines, [])
        eng.gate_ready = True
        disp.tick()
        out = cap.parsed()
        # Both the wait_gate response and the gate.state push (no sub here)
        # The session didn't subscribe so only the wait_gate ok appears.
        ids = [o.get("id") for o in out if "id" in o]
        self.assertIn(12, ids)


class TestBackpressure(unittest.TestCase):
    def test_overflow_drops_events_and_emits_marker(self):
        disp, s, _, gpio, cap = make_session(queue_cap=4)
        # Subscribe to edges so push events go through.
        feed_and_drain(s, json.dumps({"id": 1, "cmd": "subscribe",
                                       "topics": ["edges"]}), cap)
        # Don't drain — fill the queue past cap.
        # The subscribe response + the (no initial-state for edges) is in
        # the queue already; cap.lines has 1 entry from the drain above.
        cap.reset()  # we want to start fresh observation

        # Stop the transport from accepting (simulate slow consumer):
        # We'll bypass drain entirely. Push 8 edges into a queue capped at 4.
        for i in range(8):
            gpio.fire_lane((i % 6) + 1, 100 + i)

        # Now drain everything — we should see at most 4 frames,
        # and at least one overflow marker.
        s.drain()
        out = cap.parsed()
        # Count overflow markers.
        markers = [o for o in out if o.get("event") == "overflow"]
        self.assertGreaterEqual(len(markers), 1)
        for m in markers:
            self.assertGreater(m["dropped"], 0)


class TestReset(unittest.TestCase):
    def test_reset_clears_pending_and_subs(self):
        _, s, eng, _, cap = make_session()
        feed_and_drain(s, json.dumps({"id": 7, "cmd": "subscribe",
                                       "topics": ["gate"]}), cap)
        feed_and_drain(s, json.dumps({"id": 11, "cmd": "wait_race"}), cap)
        cap.reset()
        feed_and_drain(s, json.dumps({"id": 99, "cmd": "reset"}), cap)
        out = cap.parsed()
        ids = [o.get("id") for o in out]
        self.assertIn(99, ids)
        # Pending wait_race should be cancelled.
        self.assertIn(11, ids)


if __name__ == "__main__":
    unittest.main()
