/**
 * fake-track/track-renderer.js — Track DOM rendering and race animation.
 * Horizontal layout (left-to-right). Builds the visual track, stages cars,
 * animates races, handles reset button.
 */

// 8-color palette for cars (indexed by car_number % 8)
const CAR_COLORS = [
  '#e74c3c', // red
  '#3498db', // blue
  '#2ecc71', // green
  '#f39c12', // orange
  '#9b59b6', // purple
  '#1abc9c', // teal
  '#e67e22', // dark orange
  '#e84393', // pink
];

function carColor(car_number) {
  return CAR_COLORS[(car_number - 1) % CAR_COLORS.length];
}

// ─── Create Track ───────────────────────────────────────────────

/**
 * Build the static track DOM structure (horizontal: left-to-right).
 * Layout: [gate] [start line] [track surface with lanes stacked vertically] [finish line] [reset area]
 * @param {HTMLElement} container
 * @param {number} laneCount
 */
export function createTrack(container, laneCount) {
  container.innerHTML = '';

  // Gate area (left side)
  const gateArea = document.createElement('div');
  gateArea.className = 'ft-gate-area';
  const gateBtn = document.createElement('button');
  gateBtn.className = 'ft-gate-btn';
  gateBtn.disabled = true;
  gateBtn.innerHTML = 'RELEASE<br>GATE <span class="ft-gate-icon">&#9654;</span>';
  gateArea.appendChild(gateBtn);
  container.appendChild(gateArea);

  // Start line (vertical)
  const startLine = document.createElement('div');
  startLine.className = 'ft-line ft-start-line';
  container.appendChild(startLine);

  // Track surface with lanes (stacked top-to-bottom, cars race left-to-right)
  const surface = document.createElement('div');
  surface.className = 'ft-surface';

  for (let i = 1; i <= laneCount; i++) {
    const lane = document.createElement('div');
    lane.className = 'ft-lane';
    lane.dataset.lane = i;

    const label = document.createElement('div');
    label.className = 'ft-lane-label';
    label.textContent = `Lane ${i}`;
    lane.appendChild(label);

    // Car placeholder
    const carSlot = document.createElement('div');
    carSlot.className = 'ft-car-slot';
    lane.appendChild(carSlot);

    surface.appendChild(lane);

    // Lane divider (horizontal line between lanes)
    if (i < laneCount) {
      const divider = document.createElement('div');
      divider.className = 'ft-lane-divider';
      surface.appendChild(divider);
    }
  }
  container.appendChild(surface);

  // Finish line (vertical)
  const finishLine = document.createElement('div');
  finishLine.className = 'ft-line ft-finish-line';
  container.appendChild(finishLine);

  // Reset button area (right side) — always visible, starts disabled
  const resetArea = document.createElement('div');
  resetArea.className = 'ft-reset-area';
  const resetBtn = document.createElement('button');
  resetBtn.className = 'ft-reset-btn';
  resetBtn.textContent = 'RESET SWITCHES';
  resetBtn.disabled = true;
  resetArea.appendChild(resetBtn);
  container.appendChild(resetArea);
}

// ─── Show Idle Message ──────────────────────────────────────────

/**
 * Show idle/waiting message on the track.
 * @param {HTMLElement} container
 */
export function showIdle(container) {
  const surface = container.querySelector('.ft-surface');
  if (!surface) return;

  // Clear car slots
  surface.querySelectorAll('.ft-car-slot').forEach(slot => {
    slot.innerHTML = '';
  });

  // Show idle message
  let idle = surface.querySelector('.ft-idle-message');
  if (!idle) {
    idle = document.createElement('div');
    idle.className = 'ft-idle-message';
    idle.textContent = 'Waiting for operator to stage a race...';
    surface.appendChild(idle);
  }
}

// ─── Stage Cars ─────────────────────────────────────────────────

/**
 * Place car elements at the start (left side) of their lanes.
 * @param {HTMLElement} container
 * @param {Array<{lane: number, car_number: number, name: string}>} lanes
 */
export function stageCars(container, lanes) {
  const surface = container.querySelector('.ft-surface');
  if (!surface) return;

  // Remove idle message
  const idle = surface.querySelector('.ft-idle-message');
  if (idle) idle.remove();

  // Clear existing cars
  surface.querySelectorAll('.ft-car').forEach(c => c.remove());

  for (const { lane, car_number, name } of lanes) {
    const laneEl = surface.querySelector(`.ft-lane[data-lane="${lane}"]`);
    if (!laneEl) continue;

    const slot = laneEl.querySelector('.ft-car-slot');
    const car = document.createElement('div');
    car.className = 'ft-car';
    car.dataset.lane = lane;
    car.style.setProperty('--car-color', carColor(car_number));
    car.style.left = '0%';

    const numEl = document.createElement('div');
    numEl.className = 'ft-car-number';
    numEl.textContent = `#${car_number}`;
    car.appendChild(numEl);

    const nameEl = document.createElement('div');
    nameEl.className = 'ft-car-name';
    nameEl.textContent = name || '';
    car.appendChild(nameEl);

    slot.innerHTML = '';
    slot.appendChild(car);
  }
}

// ─── Run Race Animation ─────────────────────────────────────────

/**
 * Animate cars racing left to right.
 * @param {HTMLElement} container
 * @param {Array<{lane: number, car_number: number, name: string}>} lanes
 * @param {Object} times_ms - { "1": 2845, "2": 3102 }
 * @param {Function} onComplete - called when all cars finish
 * @returns {{ cancel: Function }}
 */
export function runRace(container, lanes, times_ms, onComplete) {
  const surface = container.querySelector('.ft-surface');
  if (!surface) {
    onComplete();
    return { cancel: () => {} };
  }

  let cancelled = false;
  let animId = null;
  const startTime = performance.now();

  // Easing: ease-in only (accelerate from gate, no deceleration at finish)
  function ease(t) {
    return t * t;
  }

  // Sort by finish time for place labels
  const sortedLanes = lanes.slice().sort((a, b) => {
    return (times_ms[String(a.lane)] || Infinity) - (times_ms[String(b.lane)] || Infinity);
  });

  const finishedLanes = new Set();

  function frame(now) {
    if (cancelled) return;

    const elapsed = now - startTime;
    let allDone = true;

    for (const { lane } of lanes) {
      const car = surface.querySelector(`.ft-car[data-lane="${lane}"]`);
      if (!car) continue;

      const carTime = times_ms[String(lane)];
      const progress = Math.min(1, elapsed / carTime);
      const easedProgress = ease(progress);

      // Position car left-to-right, stopping with right edge at finish
      car.style.left = `calc(${easedProgress * 100}% - ${easedProgress * 72}px)`;

      if (progress >= 1 && !finishedLanes.has(lane)) {
        finishedLanes.add(lane);
        // Add place label
        const place = sortedLanes.findIndex(l => l.lane === lane) + 1;
        const placeEl = document.createElement('div');
        placeEl.className = 'ft-car-place';
        if (place <= 3) placeEl.classList.add(`ft-place-${place}`);
        placeEl.textContent = place === 1 ? '1st' : place === 2 ? '2nd' : place === 3 ? '3rd' : `${place}th`;
        car.appendChild(placeEl);
      }

      if (progress < 1) allDone = false;
    }

    if (allDone) {
      // Brief pause to show results, then callback
      setTimeout(() => {
        if (!cancelled) onComplete();
      }, 1500);
      return;
    }

    animId = requestAnimationFrame(frame);
  }

  animId = requestAnimationFrame(frame);

  return {
    cancel: () => {
      cancelled = true;
      if (animId) cancelAnimationFrame(animId);
    }
  };
}

// ─── Reset Button ───────────────────────────────────────────────

/**
 * Enable the reset button for interaction.
 * @param {HTMLElement} container
 * @param {Function} onReset - called when button is clicked
 */
export function showResetButton(container, onReset) {
  const btn = container.querySelector('.ft-reset-btn');
  if (!btn) return;

  btn.disabled = false;
  btn.classList.remove('ft-reset-done');
  btn.textContent = 'RESET SWITCHES';
  btn.onclick = () => {
    btn.disabled = true;
    btn.classList.add('ft-reset-done');
    btn.textContent = 'READY';
    btn.onclick = null;
    onReset();
  };
}

// ─── Reset Track ────────────────────────────────────────────────

/**
 * Clear track state for next heat.
 * @param {HTMLElement} container
 */
export function resetTrack(container) {
  // Clear cars
  const surface = container.querySelector('.ft-surface');
  if (surface) {
    surface.querySelectorAll('.ft-car').forEach(c => c.remove());
    const idle = surface.querySelector('.ft-idle-message');
    if (idle) idle.remove();
  }

  // Disable reset button
  const resetBtn = container.querySelector('.ft-reset-btn');
  if (resetBtn) {
    resetBtn.disabled = true;
    resetBtn.classList.remove('ft-reset-done');
    resetBtn.textContent = 'RESET SWITCHES';
    resetBtn.onclick = null;
  }

  // Reset gate
  const gate = container.querySelector('.ft-gate-btn');
  if (gate) {
    gate.disabled = true;
    gate.classList.remove('ft-gate-ready', 'ft-gate-released');
  }
}
