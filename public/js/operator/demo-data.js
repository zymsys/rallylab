/**
 * operator/demo-data.js — Race day demo data seeder with configurable dialog.
 * Generates realistic participant names from a pre-populated pool.
 */

const FIRST_NAMES = [
  'Ava', 'Liam', 'Mia', 'Noah', 'Emma', 'Ethan', 'Chloe', 'Lucas',
  'Isla', 'Leo', 'Sophia', 'Jake', 'Lily', 'Mason', 'Olivia', 'Billy',
  'Sarah', 'Tommy', 'Ella', 'Owen', 'Zoe', 'Finn', 'Ruby', 'Caleb',
  'Harper', 'Wyatt', 'Aria', 'Dylan', 'Luna', 'Jack', 'Nora', 'Ryan',
  'Hazel', 'Cole', 'Ivy', 'Max', 'Stella', 'Sam', 'Piper', 'Kai',
  'Quinn', 'Reid', 'Wren', 'Jude', 'Clara', 'Theo', 'Maeve', 'Asher'
];

const LAST_NAMES = [
  'Moreau', 'Nguyen', 'Brown', 'Johnson', 'Garcia', 'Patel', 'Thompson',
  'Chen', 'Rodriguez', 'Wilson', 'Kim', 'Okafor', 'Foster', 'Tanaka',
  'Blackwood', 'Singh', 'Rivera', 'Campbell', 'Tremblay', 'Leblanc',
  'MacLeod', 'Byrne', 'Mueller', 'Jensen', 'Dubois', 'Kowalski',
  'Fontaine', 'Nakamura', 'Ibrahim', 'Johansson', 'Kapoor', 'Lam'
];

function generateNames(count) {
  const names = new Set();
  // Shuffle both arrays each time to get variety
  const firsts = [...FIRST_NAMES].sort(() => Math.random() - 0.5);
  const lasts = [...LAST_NAMES].sort(() => Math.random() - 0.5);

  let fi = 0, li = 0;
  while (names.size < count) {
    const name = `${firsts[fi % firsts.length]} ${lasts[li % lasts.length]}`;
    if (!names.has(name)) {
      names.add(name);
    }
    fi++;
    if (fi % firsts.length === 0) li++;
    // Safety: if we've exhausted all combos (shouldn't happen for reasonable counts)
    if (fi > firsts.length * lasts.length) break;
  }
  return [...names].slice(0, count);
}

const SECTIONS = [
  { key: 'beavers', name: 'Beaver Buggies', defaultCount: 6 },
  { key: 'kubkars', name: 'Kub Kars', defaultCount: 7 },
  { key: 'scouts',  name: 'Scout Trucks', defaultCount: 5 }
];

/**
 * Show the demo data configuration dialog, then generate and load data.
 */
export function showDemoDataDialog(ctx) {
  const backdrop = document.getElementById('dialog-backdrop');
  const dialog = document.getElementById('dialog');

  const sectionRows = SECTIONS.map(s => `
    <tr>
      <td><strong>${s.name}</strong></td>
      <td><input type="number" class="form-input" data-section="${s.key}"
           min="0" max="30" value="${s.defaultCount}" style="width:5rem"></td>
    </tr>
  `).join('');

  dialog.innerHTML = `
    <div class="dialog-header">
      <h2>Load Demo Data</h2>
      <button class="dialog-close" aria-label="Close">&times;</button>
    </div>
    <div class="dialog-body">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Section</th><th>Participants</th></tr></thead>
          <tbody>${sectionRows}</tbody>
        </table>
      </div>
      <div class="form-group" style="margin-top:1rem">
        <label>Check-in status</label>
        <select class="form-input" id="dlg-checkin-mode" style="width:auto">
          <option value="none">None checked in</option>
          <option value="all">All checked in</option>
          <option value="random">Random (60-80%)</option>
        </select>
      </div>
    </div>
    <div class="dialog-footer">
      <button class="btn btn-secondary" data-action="cancel">Cancel</button>
      <button class="btn btn-primary" data-action="load">Load Demo Data</button>
    </div>
  `;

  backdrop.classList.remove('hidden');
  backdrop.setAttribute('aria-hidden', 'false');

  const close = () => {
    backdrop.classList.add('hidden');
    backdrop.setAttribute('aria-hidden', 'true');
    dialog.innerHTML = '';
  };

  const onKey = (e) => {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
  dialog.querySelector('.dialog-close').onclick = close;
  dialog.querySelector('[data-action="cancel"]').onclick = close;

  dialog.querySelector('[data-action="load"]').onclick = async () => {
    const btn = dialog.querySelector('[data-action="load"]');
    btn.disabled = true;
    btn.textContent = 'Loading...';

    try {
      // Gather config from form
      const checkin = dialog.querySelector('#dlg-checkin-mode').value;
      const config = SECTIONS.map(s => {
        const count = parseInt(dialog.querySelector(`[data-section="${s.key}"]`).value, 10) || 0;
        return { ...s, count, checkin };
      }).filter(s => s.count > 0);

      await generateDemoData(ctx, config);
      close();
      ctx.showToast('Demo data loaded', 'success');
      ctx.navigate('rally-home', {});
    } catch (e) {
      ctx.showToast(e.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Load Demo Data';
    }
  };
}

async function generateDemoData(ctx, sectionConfigs) {
  const { clearAndRebuild, appendAndRebuild } = await import('./app.js');
  await clearAndRebuild();

  const now = Date.now();
  const rallyId = crypto.randomUUID();

  await appendAndRebuild({
    type: 'RallyCreated',
    rally_id: rallyId,
    rally_name: 'Kub Kars Rally 2026',
    rally_date: '2026-03-15',
    created_by: 'operator',
    timestamp: now
  });

  // Generate all names at once to avoid duplicates across sections
  const totalCount = sectionConfigs.reduce((sum, s) => sum + s.count, 0);
  const allNames = generateNames(totalCount);
  let nameIdx = 0;

  for (const sec of sectionConfigs) {
    const sectionId = crypto.randomUUID();

    await appendAndRebuild({
      type: 'SectionCreated',
      rally_id: rallyId,
      section_id: sectionId,
      section_name: sec.name,
      timestamp: now + 1
    });

    const participants = [];
    for (let i = 0; i < sec.count; i++) {
      participants.push({
        participant_id: crypto.randomUUID(),
        name: allNames[nameIdx++]
      });
    }

    await appendAndRebuild({
      type: 'RosterUpdated',
      rally_id: rallyId,
      section_id: sectionId,
      participants,
      timestamp: now + 2
    });

    // Rebuild state to get assigned car numbers for check-in
    const { rebuildFromStore } = await import('./app.js');
    await rebuildFromStore();
    const state = window.__rallylab?.state;
    const rdSec = state?.race_day.sections[sectionId];
    const assignedParticipants = rdSec ? rdSec.participants : participants.map((p, i) => ({ ...p, car_number: i + 1 }));

    // Check-in
    if (sec.checkin === 'all') {
      for (const p of assignedParticipants) {
        await appendAndRebuild({
          type: 'CarArrived',
          section_id: sectionId,
          car_number: p.car_number,
          timestamp: now + 3
        });
      }
    } else if (sec.checkin === 'random') {
      const shuffled = [...assignedParticipants].sort(() => Math.random() - 0.5);
      const checkInCount = Math.max(2, Math.floor(assignedParticipants.length * (0.6 + Math.random() * 0.2)));
      for (let i = 0; i < checkInCount; i++) {
        await appendAndRebuild({
          type: 'CarArrived',
          section_id: sectionId,
          car_number: shuffled[i].car_number,
          timestamp: now + 3
        });
      }
    }
  }
}
