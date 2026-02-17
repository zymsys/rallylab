# Kub Kars — Track Hardware Interface

**Source:** SuperTimer manual, Appendix B ("Fixing the cable or making a test box")

---

## 1. Connector

The track uses a **15-pin DA-15 connector** (the same form factor as old PC game ports). The pin numbering follows the embossed numbers on the SuperTimer Lane Interface Card connector.

```
  ┌─────────────────────┐
  │  8  7  6  5  4  3  2  1  │   (top row, pins 1–8)
  │   15 14 13 12 11 10  9   │   (bottom row, pins 9–15)
  └─────────────────────┘
```

---

## 2. Lane Finish Sensors

Each lane has a **normally-open switch** between its signal pin and a common (ground) pin. The switch **closes momentarily** when a car crosses the finish line.

| Lane | Signal Pin | Common Pin | Wire Colour |
|------|-----------|------------|-------------|
| 1    | 10        | 4          | Brown       |
| 2    | 7         | 4          | Red         |
| 3    | 2         | 4          | Orange      |
| 4    | 13        | 5          | Yellow      |
| 5    | 11        | 5          | Green       |
| 6    | 6         | 5          | Blue        |
| 7    | 3         | 5          | White       |

- Lanes 1–3 share common pin **4**.
- Lanes 4–7 share common pin **5**.
- Pins 4, 5, and 12 are all ground and are interchangeable.

---

## 3. Start Gate

The start gate uses a **magnetic reed switch**.

| Signal Pin | Common Pins | Wire Colour |
|-----------|-------------|-------------|
| 7         | 4, 5        | Red / Black |

Behaviour:

- **Closed** when the magnet is near (gate is down, cars staged)
- **Opens** when the gate releases (magnet moves away, race starts)

This is the **inverse** of the lane sensors: lane sensors close on car arrival; the start gate opens on race start.

### Pin 7 Sharing (Lane 2 + Start Gate)

Pin 7 carries **both** the Lane 2 finish sensor and the Start Gate reed switch, wired in parallel to ground. This works because the two switches have opposite resting states and transition at different times:

| Phase            | Reed Switch | Lane 2 Switch | Pin 7 (with pull-up) |
|------------------|-------------|---------------|----------------------|
| Cars staged      | CLOSED      | OPEN          | **LOW**              |
| Gate drops       | OPENS       | OPEN          | **HIGH**             |
| Lane 2 finishes  | OPEN        | CLOSES        | **LOW**              |

The signal sequence on Pin 7 is unambiguous in normal operation:

1. **Rising edge** (LOW → HIGH) = race start
2. **Falling edge** (HIGH → LOW) = Lane 2 finish

Firmware reads both signals from one GPIO by tracking the state machine phase.

**Limitations of shared Pin 7:**

- **Gate closed during a race** — if the operator pushes the gate back down while cars are running, the reed switch closes and Pin 7 goes LOW. Firmware cannot distinguish this from Lane 2 finishing. Lane 2 would get a bogus time.
- **`gate` / `wait_gate` during a race** — Pin 7 cannot report gate state while it is being used for Lane 2. These endpoints should only report meaningful state when the engine is IDLE (between races).
- **Pre-race gate fiddling** is safe as long as the firmware only arms on `wait_race` and ignores Pin 7 edges while IDLE.

These limitations only apply if the track wires Lane 2 to Pin 7. See Section 6 for the actual track configuration.

---

## 4. Power and Ground

| Pins       | Function                                         |
|-----------|--------------------------------------------------|
| 1, 8, 9, 15 | Wired to 5V supply. **DO NOT CONNECT.**         |
| 4, 5, 12  | Ground (computer case / cable shield). Interchangeable. |

---

## 5. Cable Notes

- 10 µF polarized electrolytic capacitors are present on the lane end of the cable (working voltage > 6V, negative lead on common). These provide hardware debouncing. They are not required in a test box.
- Pin 12 also carries the cable shield.

---

## 6. Actual Track Configuration

The physical track has **6 lanes**. The SuperTimer wiring supports up to 7.

**TBD — pending cable inspection:** The 6 physical lanes may be wired to:

- **Lanes 1–6** (pins 10, 7, 2, 13, 11, 6) — Lane 2 shares Pin 7 with the start gate. The shared-pin limitations from Section 3 apply.
- **Lanes 1, 3–7** (pins 10, 2, 13, 11, 6, 3) — Pin 7 is exclusively the start gate. No sharing issues. This is the better wiring if the builder planned for it.

A continuity test from each lane sensor to the DA-15 pins will confirm which mapping is used.

---

## 7. Pico Controller Mapping

When building the Pico-based track controller (see [03-track-controller-protocol.md](03-track-controller-protocol.md)), the Pico GPIO must interface with this connector:

- **6 lane inputs** — each GPIO reads a normally-open switch to ground. Enable internal pull-ups; a **low** (falling edge) signal means a car has arrived.
- **1 start gate input (Pin 7)** — reads the reed switch. Rising edge (LOW → HIGH) = gate opened, race started. If Lane 2 shares this pin, the same GPIO also detects Lane 2 finish (falling edge) via the state machine described in Section 3.
- The 5V pins (1, 8, 9, 15) must be left **unconnected** on the Pico side.
- Ground pins (4, 5, 12) connect to Pico GND.

### GPIO Assignment (TBD pending lane mapping)

**If lanes skip Pin 7 (preferred — no sharing):**

| Function   | DA-15 Pin | Pico GPIO | Notes              |
|-----------|----------|-----------|---------------------|
| Lane 1    | 10       | GP2       |                     |
| Lane 3    | 2        | GP3       |                     |
| Lane 4    | 13       | GP4       |                     |
| Lane 5    | 11       | GP5       |                     |
| Lane 6    | 6        | GP6       |                     |
| Lane 7    | 3        | GP7       |                     |
| Start Gate| 7        | GP8       | Dedicated — no conflicts |
| Ground    | 4, 5, 12 | GND       |                     |

**If Lane 2 uses Pin 7 (shared):**

| Function        | DA-15 Pin | Pico GPIO | Notes                        |
|----------------|----------|-----------|-------------------------------|
| Lane 1         | 10       | GP2       |                               |
| Lane 2 + Start | 7        | GP3       | Dual-purpose (see Section 3)  |
| Lane 3         | 2        | GP4       |                               |
| Lane 4         | 13       | GP5       |                               |
| Lane 5         | 11       | GP6       |                               |
| Lane 6         | 6        | GP7       |                               |
| Ground         | 4, 5, 12 | GND       |                               |

---

## 8. Physical Lane Constraints

### 8.1 Scout Trucks — Alternate Lanes

Scout Truck cars are wider than standard Kub Kar or Beaver Buggy cars and cannot fit in adjacent lanes. When racing Scout Trucks, only **every other lane** is used (e.g., lanes 1, 3, 5 on a 6-lane track).

This is configured via the `available_lanes` field on `SectionStarted`:

```json
{
  "type": "SectionStarted",
  "available_lanes": [1, 3, 5],
  ...
}
```

The scheduler, audience display, and track controller all use this lane set. See `07-heat-scheduling.md` for how the scheduler assigns participants to non-sequential lane numbers.

### 8.2 Lane Hardware Failures

If a lane sensor fails mid-race, the Operator can remove the lane without stopping the event using a `LanesChanged` event. See `04-domain-events.md` §3.10. The heat schedule regenerates for remaining heats using the reduced lane set.

---

**End of Track Hardware Interface**
