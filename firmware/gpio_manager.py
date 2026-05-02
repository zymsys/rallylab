# gpio_manager.py — GPIO setup, polling debounce, edge detection
#
# All pins are input with internal pull-up. A pressed button / triggered
# sensor pulls the pin LOW. We poll every loop iteration and only fire
# edge callbacks after the value has been stable for DEBOUNCE_MS.

from machine import Pin
from config import LANE_PINS, GATE_PIN, GATE_INVERT, SHARED_PIN7, DEBOUNCE_MS


class GpioManager:
    def __init__(self):
        # -- lane pins -----------------------------------------------------
        self._lane_pins = {}     # lane_num (int) -> Pin object
        self._lane_state = {}    # lane_num -> debounced value (0 or 1)
        self._lane_raw = {}      # lane_num -> last raw reading
        self._lane_stable = {}   # lane_num -> timestamp when raw value last changed
        self._lane_last_edge = {}  # lane_num -> ms of last edge (for dbg)

        for lane, gpio in LANE_PINS.items():
            pin = Pin(gpio, Pin.IN, Pin.PULL_UP)
            self._lane_pins[lane] = pin
            val = pin.value()
            self._lane_state[lane] = val
            self._lane_raw[lane] = val
            self._lane_stable[lane] = 0
            self._lane_last_edge[lane] = 0

        # -- gate pin ------------------------------------------------------
        self._gate_pin = Pin(GATE_PIN, Pin.IN, Pin.PULL_UP)
        gate_val = self._gate_pin.value()
        self._gate_state = gate_val
        self._gate_raw = gate_val
        self._gate_stable = 0
        self._gate_last_edge = 0

        # -- callbacks (set by main.py) ------------------------------------
        self.on_gate_opened = None   # callback(now_ms)
        self.on_gate_closed = None   # callback(now_ms)
        self.on_lane_triggered = None  # callback(lane_num, now_ms)
        self.on_edge = None          # callback(info_dict) — for dbg_watch

        # -- watch-all state (populated by start_watch/stop_watch) ---------
        self._watch_pins = None      # gpio_num (int) -> Pin, or None
        self._watch_state = None
        self._watch_raw = None
        self._watch_stable = None

        # Build reverse lookup: gpio_num -> label for configured pins
        self._gpio_labels = {}
        self._gpio_labels[GATE_PIN] = {"pin": "gate"}
        for lane, gpio in LANE_PINS.items():
            self._gpio_labels[gpio] = {"pin": "lane", "lane": lane}

    def poll(self, now_ms):
        """Read all pins, apply debounce, fire edge callbacks."""
        self._poll_gate(now_ms)
        self._poll_lanes(now_ms)
        self._poll_watch(now_ms)

    def _poll_gate(self, now_ms):
        raw = self._gate_pin.value()
        if raw != self._gate_raw:
            self._gate_raw = raw
            self._gate_stable = now_ms

        if raw != self._gate_state:
            if now_ms - self._gate_stable >= DEBOUNCE_MS:
                self._gate_state = raw
                self._gate_last_edge = now_ms
                self._handle_gate_edge(raw, now_ms)

    def _handle_gate_edge(self, pin_value, now_ms):
        """Interpret a gate edge, accounting for GATE_INVERT and SHARED_PIN7."""
        if GATE_INVERT:
            # Breadboard: button press = falling edge (pin 1->0) = gate OPEN
            #             button release = rising edge (pin 0->1) = gate CLOSED (ready)
            if pin_value == 0:
                self._fire_edge("gate", "opened", None, now_ms, GATE_PIN)
                if self.on_gate_opened:
                    self.on_gate_opened(now_ms)
            else:
                self._fire_edge("gate", "closed", None, now_ms, GATE_PIN)
                if self.on_gate_closed:
                    self.on_gate_closed(now_ms)
        else:
            # Real reed switch: rising edge (pin 0->1) = gate OPEN (reed opens)
            #                   falling edge (pin 1->0) = gate CLOSED (reed closes)
            if pin_value == 1:
                self._fire_edge("gate", "opened", None, now_ms, GATE_PIN)
                if self.on_gate_opened:
                    self.on_gate_opened(now_ms)
            else:
                if SHARED_PIN7:
                    # Falling edge on shared pin during a race = Lane 2 finish
                    self._fire_edge("lane", "triggered", 2, now_ms, GATE_PIN)
                    if self.on_lane_triggered:
                        self.on_lane_triggered(2, now_ms)
                else:
                    self._fire_edge("gate", "closed", None, now_ms, GATE_PIN)
                    if self.on_gate_closed:
                        self.on_gate_closed(now_ms)

    def _poll_lanes(self, now_ms):
        for lane, pin in self._lane_pins.items():
            raw = pin.value()
            if raw != self._lane_raw[lane]:
                self._lane_raw[lane] = raw
                self._lane_stable[lane] = now_ms

            if raw != self._lane_state[lane]:
                if now_ms - self._lane_stable[lane] >= DEBOUNCE_MS:
                    self._lane_state[lane] = raw
                    self._lane_last_edge[lane] = now_ms
                    if raw == 0:
                        # Falling edge (pull-up to ground) = car arrived.
                        self._fire_edge("lane", "triggered", lane, now_ms, LANE_PINS[lane])
                        if self.on_lane_triggered:
                            self.on_lane_triggered(lane, now_ms)
                    else:
                        # Rising edge = sensor cleared. The race engine
                        # ignores this (timing only uses the trigger),
                        # but v2 live-status subscribers need it to flip
                        # back to clear in the operator UI.
                        self._fire_edge("lane", "cleared", lane, now_ms, LANE_PINS[lane])

    # -- watch-all mode (scans GP0-GP22) ---------------------------------

    def start_watch(self):
        """Set up monitoring on all GP0-GP22 not already configured."""
        configured = set()
        configured.add(GATE_PIN)
        for gpio in LANE_PINS.values():
            configured.add(gpio)

        self._watch_pins = {}
        self._watch_state = {}
        self._watch_raw = {}
        self._watch_stable = {}

        for gp in range(0, 23):
            if gp in configured:
                continue
            pin = Pin(gp, Pin.IN, Pin.PULL_UP)
            val = pin.value()
            self._watch_pins[gp] = pin
            self._watch_state[gp] = val
            self._watch_raw[gp] = val
            self._watch_stable[gp] = 0

    def stop_watch(self):
        """Tear down watch-all pins."""
        self._watch_pins = None
        self._watch_state = None
        self._watch_raw = None
        self._watch_stable = None

    def _poll_watch(self, now_ms):
        """Poll all watch-all pins for edges."""
        if not self._watch_pins:
            return
        for gp, pin in self._watch_pins.items():
            raw = pin.value()
            if raw != self._watch_raw[gp]:
                self._watch_raw[gp] = raw
                self._watch_stable[gp] = now_ms
            if raw != self._watch_state[gp]:
                if now_ms - self._watch_stable[gp] >= DEBOUNCE_MS:
                    self._watch_state[gp] = raw
                    if self.on_edge:
                        edge = "fall" if raw == 0 else "rise"
                        self.on_edge({"gpio": gp, "edge": edge, "ms": now_ms})

    def _fire_edge(self, pin_type, edge, lane, now_ms, gpio_num=None):
        """Notify on_edge callback if set (for dbg_watch)."""
        if self.on_edge:
            info = {"gpio": gpio_num, "pin": pin_type, "edge": edge, "ms": now_ms}
            if lane is not None:
                info["lane"] = lane
            self.on_edge(info)

    # -- query methods for serial commands ---------------------------------

    def is_gate_ready(self):
        """Gate is ready when the debounced state indicates closed/ready."""
        if GATE_INVERT:
            return self._gate_state == 1  # not pressed = ready
        else:
            return self._gate_state == 0  # reed closed = ready

    def read_gate_raw(self):
        return self._gate_pin.value()

    def gate_dbg(self):
        return {
            "raw": self._gate_pin.value(),
            "debounced": self._gate_state,
            "invert": GATE_INVERT,
            "pull": "up",
            "last_edge_ms": self._gate_last_edge,
        }

    def lanes_dbg(self):
        result = {}
        for lane in sorted(self._lane_pins):
            result[str(lane)] = {
                "raw": self._lane_pins[lane].value(),
                "debounced": self._lane_state[lane],
                "invert": False,
                "pull": "up",
                "last_edge_ms": self._lane_last_edge[lane],
            }
        return result
