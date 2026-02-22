# config.py — Pin mapping and constants
# This is the one file builders edit for their specific track wiring.

FIRMWARE_VERSION = "0.1.0"
PROTOCOL_VERSION = "1.0"

# ---------------------------------------------------------------------------
# Breadboard preset (7 buttons on a breadboard, no real track)
# Lanes 1-6 on GP2-GP7, gate button on GP8
# ---------------------------------------------------------------------------
LANE_PINS = {
    1: 12,   # GP12
    2: 13,   # GP13
    3: 15,   # GP15
    4: 10,   # GP10
    5: 6,    # GP6
    6: 5,    # GP5
}
GATE_PIN = 8  # GP8

# True  = breadboard mode (button press = gate open, release = gate ready)
# False = real reed switch (reed opens on gate release = gate open)
GATE_INVERT = True

# True if Lane 2 and start gate share Pin 7 on the DA-15 connector
SHARED_PIN7 = False

# ---------------------------------------------------------------------------
# Real track preset: dedicated gate (lanes skip Pin 7)
# Uncomment and replace the block above if your track uses lanes 1,3-7
# ---------------------------------------------------------------------------
# LANE_PINS = {
#     1: 2,   # DA-15 pin 10 -> GP2
#     2: 3,   # DA-15 pin 2  -> GP3   (physical lane 3)
#     3: 4,   # DA-15 pin 13 -> GP4   (physical lane 4)
#     4: 5,   # DA-15 pin 11 -> GP5   (physical lane 5)
#     5: 6,   # DA-15 pin 6  -> GP6   (physical lane 6)
#     6: 7,   # DA-15 pin 3  -> GP7   (physical lane 7)
# }
# GATE_PIN = 8      # DA-15 pin 7 -> GP8 (dedicated)
# GATE_INVERT = False
# SHARED_PIN7 = False

# ---------------------------------------------------------------------------
# Real track preset: shared Pin 7 (Lane 2 + start gate on same wire)
# Uncomment and replace the block above if your track uses lanes 1-6
# ---------------------------------------------------------------------------
# LANE_PINS = {
#     1: 2,   # DA-15 pin 10 -> GP2
#     # Lane 2 is handled via SHARED_PIN7 on the gate pin
#     3: 4,   # DA-15 pin 2  -> GP4
#     4: 5,   # DA-15 pin 13 -> GP5
#     5: 6,   # DA-15 pin 11 -> GP6
#     6: 7,   # DA-15 pin 6  -> GP7
# }
# GATE_PIN = 3      # DA-15 pin 7 -> GP3 (shared with Lane 2)
# GATE_INVERT = False
# SHARED_PIN7 = True

LANE_COUNT = 6
DEBOUNCE_MS = 10
RACE_TIMEOUT_MS = 15000
