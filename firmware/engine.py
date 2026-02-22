# engine.py — Race state machine (pure logic, no hardware imports)
#
# States: IDLE -> ARMED -> RACING -> IDLE
#
# The engine has no knowledge of GPIO or serial. It exposes methods that
# are called by gpio_manager (gate/lane events) and serial_handler (commands).

from uuid_gen import uuid4
from config import RACE_TIMEOUT_MS, LANE_COUNT

IDLE = "IDLE"
ARMED = "ARMED"
RACING = "RACING"


class Engine:
    def __init__(self):
        self.phase = IDLE
        self.race_id = None
        self.active_lanes = None      # set of int lane numbers
        self.start_ms = None
        self.times_ms = {}            # lane (int) -> elapsed ms
        self.last_race = None         # dict returned by state command, or None
        self._on_complete = []        # list of callback(result_dict)
        self._gate_ready = True       # tracks physical gate state

    # -- gate ready tracking (independent of race state) -------------------

    def set_gate_ready(self, ready):
        self._gate_ready = ready

    @property
    def gate_ready(self):
        return self._gate_ready

    # -- commands from serial_handler --------------------------------------

    def arm(self, lanes_str, on_complete):
        """IDLE -> ARMED. Parses lanes_str, generates race_id."""
        if lanes_str:
            lanes = set()
            for ch in lanes_str:
                n = int(ch)
                if n < 1 or n > LANE_COUNT:
                    raise ValueError("lane %d out of range 1..%d" % (n, LANE_COUNT))
                if n in lanes:
                    raise ValueError("duplicate lane %d" % n)
                lanes.add(n)
            self.active_lanes = lanes
        else:
            self.active_lanes = set(range(1, LANE_COUNT + 1))

        self.race_id = uuid4()
        self.start_ms = None
        self.times_ms = {}
        self._on_complete = [on_complete]
        self.phase = ARMED

    def add_listener(self, callback):
        """Append a completion listener. Only valid while ARMED or RACING."""
        self._on_complete.append(callback)

    def cancel(self):
        """Cancel any active wait (ARMED -> IDLE). Safe to call in any state."""
        if self.phase == ARMED:
            self.phase = IDLE
            self.race_id = None
            self.active_lanes = None
            self._on_complete = []

    # -- callbacks from gpio_manager ---------------------------------------

    def on_gate_opened(self, now_ms):
        """Gate opened. If ARMED, transition to RACING."""
        self._gate_ready = False
        if self.phase == ARMED:
            self.phase = RACING
            self.start_ms = now_ms

    def on_gate_closed(self, now_ms):
        """Gate closed (returned to ready position)."""
        self._gate_ready = True

    def on_lane_triggered(self, lane, now_ms):
        """A lane sensor fired. Record time if we're racing and lane is active."""
        if self.phase != RACING:
            return
        if lane not in self.active_lanes:
            return
        if lane in self.times_ms:
            return  # already recorded
        self.times_ms[lane] = now_ms - self.start_ms
        if len(self.times_ms) == len(self.active_lanes):
            self._complete()

    # -- timeout -----------------------------------------------------------

    def check_timeout(self, now_ms):
        """Call every loop iteration. Completes race if timeout exceeded."""
        if self.phase != RACING:
            return
        if now_ms - self.start_ms >= RACE_TIMEOUT_MS:
            self._complete()

    # -- internal ----------------------------------------------------------

    def _complete(self):
        """Finalize race, store result, call completion callback."""
        # Build times dict with string keys, only for lanes that finished
        times = {}
        for lane in sorted(self.times_ms):
            times[str(lane)] = self.times_ms[lane]

        result = {
            "race_id": self.race_id,
            "times_ms": times,
        }
        self.last_race = result
        callbacks = self._on_complete

        # Reset state
        self.phase = IDLE
        self.race_id = None
        self.active_lanes = None
        self.start_ms = None
        self.times_ms = {}
        self._on_complete = []

        for cb in callbacks:
            cb(result)
