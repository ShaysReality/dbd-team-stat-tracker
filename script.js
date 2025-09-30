/* DbD Stat Logger — v2.4
   - Wider left panel; no roster horizontal scroll; remove inline
   - Scrim metrics + Tournament flows
   - Filters, stats, canvas chart (auto-size), import/export
   - LocalStorage persistence
*/
(() => {
  // ---------- DOM helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const el = (tag, attrs = {}, ...children) => {
    const e = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') e.className = v;
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else if (k in e) e[k] = v; else e.setAttribute(k, v);
    });
    children.forEach((c) => e.append(c));
    return e;
  };

  // ---------- Data model & storage ----------
  const STORAGE_KEY = 'dbd_v24_state';
  const DEFAULT_STATE = {
    teams: {}, // name -> { roster: [names] }
    selectedTeam: '',
    matches: [],
    lastId: 0,
  };

  let state = loadState();

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(DEFAULT_STATE);
      const data = JSON.parse(raw);
      data.teams ||= {};
      data.matches ||= [];
      data.selectedTeam ||= '';
      data.lastId ||= 0;
      return data;
    } catch {
      return structuredClone(DEFAULT_STATE);
    }
  }
  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // ---------- Reference data ----------
  const MAPS = [
    'MacMillan — Suffocation Pit','MacMillan — Coal Tower','MacMillan — Ironworks',
    'Autohaven — Blood Lodge','Autohaven — Wreckers Yard','Coldwind — Fractured Cowshed',
    'Coldwind — Rancid Abattoir','Coldwind — Torment Creek','Ormond','Haddonfield',
    'Dead Dawg Saloon','Raccoon City Police Station','Garden of Joy','Sanctum of Wrath',
    'The Game','Léry’s Memorial','Midwich','Gideon','Badham','Mother’s Dwelling'
  ];
  const KILLERS = [
    'Trapper','Wraith','Hillbilly','Nurse','Shape','Hag','Doctor','Huntress','Cannibal',
    'Nightmare','Pig','Clown','Spirit','Legion','Plague','Ghost Face','Oni','Deathslinger',
    'Blight','Twins','Trickster','Nemesis','Cenobite','Artist','Onryō','Dredge','Mastermind',
    'Knight','Skull Merchant','Singularity','Xenomorph','Good Guy','Unknown'
  ];

  // ---------- Wiring DOM ----------
  const els = {
    // header
    btnExportCSV: $('#btnExportCSV'),
    btnExportJSON: $('#btnExportJSON'),
    fileJSON: $('#fileJSON'),
    fileCSV: $('#fileCSV'),
    replaceMode: $('#replaceMode'),
    btnClearAll: $('#btnClearAll'),

    // team mgmt
    teamAddForm: $('#teamAddForm'),
    newTeamName: $('#newTeamName'),
    btnDeleteTeam: $('#btnDeleteTeam'),
    teamSelect: $('#teamSelect'),

    // roster
    memberAddForm: $('#memberAddForm'),
    memberName: $('#memberName'),
    btnClearRoster: $('#btnClearRoster'),
    rosterTableBody: $('#rosterTable tbody'),

    // match form
    matchForm: $('#matchForm'),
    matchTeam: $('#matchTeam'),
    matchMap: $('#matchMap'),
    matchKiller: $('#matchKiller'),
    matchDate: $('#matchDate'),
    matchType: $('#matchType'),
    matchOpponent: $('#matchOpponent'),
    killerPlayer: $('#killerPlayer'),
    survivorResult: $('#survivorResult'),

    // tournament — survivor
    fsSurvivorSide: $('#fsSurvivorSide'),
    survivorPick: $('#survivorPick'),
    selCount: $('#selCount'),
    svrStats: $('#svrStats'),
    ourGensInput: $('#ourGensInput'),
    oppKillerStagesView: $('#oppKillerStagesView'),
    oppKillerFreshView: $('#oppKillerFreshView'),
    btnAutoFromStages: $('#btnAutoFromStages'),

    // tournament — killer
    fsKillerSide: $('#fsKillerSide'),
    ourKillerStagesInput: $('#ourKillerStagesInput'),
    ourKillerFreshInput: $('#ourKillerFreshInput'),
    oppGensInput: $('#oppGensInput'),

    // scrim block
    fsScrim: $('#fsScrim'),
    ourGensScrim: $('#ourGensScrim'),
    ourKillerStagesScrim: $('#ourKillerStagesScrim'),
    ourKillerFreshScrim: $('#ourKillerFreshScrim'),
    oppGensScrim: $('#oppGensScrim'),

    btnDemo: $('#btnDemo'),

    // filters
    fTeam: $('#fTeam'),
    fMap: $('#fMap'),
    fKiller: $('#fKiller'),
    fType: $('#fType'),
    fOpp: $('#fOpp'),
    fPlayer: $('#fPlayer'),
    fFrom: $('#fFrom'),
    fTo: $('#fTo'),
    btnClearFilters: $('#btnClearFilters'),

    // tables & stats
    matchesTableBody: $('#matchesTable tbody'),
    sAvgOurGens: $('#sAvgOurGens'),
    sAvgOppStages: $('#sAvgOppStages'),
    sAvgOurStages: $('#sAvgOurStages'),

    // chart
    chartCanvas: $('#chart'),
  };

  // ---------- Init selects ----------
  function fillSelect(sel, values, withBlank = false) {
    if (!sel) return;
    sel.innerHTML = '';
    if (withBlank) sel.append(el('option', { value: '' }, '--'));
    values.forEach(v => sel.append(el('option', { value: v }, v)));
  }
  fillSelect(els.matchMap, MAPS);
  fillSelect(els.matchKiller, KILLERS);
  fillSelect(els.fMap, MAPS, true);
  fillSelect(els.fKiller, KILLERS, true);

  // ---------- Teams UI ----------
  function refreshTeamsUI() {
    const teamNames = Object.keys(state.teams).sort((a,b)=>a.localeCompare(b));

    [els.teamSelect, els.matchTeam, els.fTeam].forEach((sel) => {
      if (!sel) return;
      sel.innerHTML = '';
      if (sel === els.fTeam) sel.append(el('option', { value: '' }, '--'));
      teamNames.forEach(t => sel.append(el('option', { value: t, selected: t===state.selectedTeam }, t)));
    });

    if (!state.selectedTeam && teamNames.length) state.selectedTeam = teamNames[0];

    refreshKillerPlayerSelect();
    renderRoster();
    saveState();
  }

  function refreshKillerPlayerSelect() {
    const roster = state.teams[state.selectedTeam]?.roster || [];
    if (!els.killerPlayer) return;
    els.killerPlayer.innerHTML = '';
    els.killerPlayer.append(el('option', { value: '' }, '--'));
    roster.forEach(p => els.killerPlayer.append(el('option', { value: p }, p)));
  }

  // Roster table — two columns (# + Name+Remove)
  function renderRoster() {
    const headRow = document.querySelector('#rosterTable thead tr');
    if (headRow) headRow.innerHTML = '<th>#</th><th>Name</th>';

    if (!els.rosterTableBody) return;
    els.rosterTableBody.innerHTML = '';
    const roster = state.teams[state.selectedTeam]?.roster || [];
    roster.forEach((name, idx) => {
      const rmBtn = el('button', {
        class: 'btn btn-ghost btn-mini',
        onclick: () => removeMember(idx),
        type: 'button',
        title: 'Remove from roster'
      }, 'Remove');

      const nameWrap = el('div', { class: 'name-inline' },
        el('span', { class: 'member-name' }, name),
        rmBtn
      );

      const tr = el('tr', {},
        el('td', {}, String(idx + 1)),
        el('td', {}, nameWrap),
      );
      els.rosterTableBody.append(tr);
    });
  }

  function addTeam(name) {
    const t = name.trim();
    if (!t) return;
    if (state.teams[t]) return alert('Team already exists.');
    state.teams[t] = { roster: [] };
    state.selectedTeam = t;
    refreshTeamsUI();
  }
  function deleteTeam() {
    const t = state.selectedTeam;
    if (!t) return;
    if (!confirm(`Delete team "${t}" and its roster? Matches remain.`)) return;
    delete state.teams[t];
    state.selectedTeam = Object.keys(state.teams)[0] || '';
    refreshTeamsUI();
  }
  function addMember(name) {
    const n = name.trim();
    if (!n || !state.selectedTeam) return;
    const roster = state.teams[state.selectedTeam].roster;
    if (roster.includes(n)) return alert('Member already in roster.');
    roster.push(n);
    refreshTeamsUI();
  }
  function removeMember(idx) {
    const roster = state.teams[state.selectedTeam]?.roster;
    if (!roster) return;
    roster.splice(idx,1);
    refreshTeamsUI();
  }
  function clearRoster() {
    const roster = state.teams[state.selectedTeam]?.roster;
    if (!roster) return;
    if (!confirm('Clear roster for selected team?')) return;
    state.teams[state.selectedTeam].roster = [];
    refreshTeamsUI();
  }

  // ---------- Survivor picker & stages ----------
  let survivorSelected = new Set();
  function rebuildSurvivorPicker() {
    if (!els.survivorPick) return;
    els.survivorPick.innerHTML = '';
    const roster = state.teams[state.selectedTeam]?.roster || [];
    roster.forEach(name => {
      const picked = survivorSelected.has(name);
      const chip = el('button', {
        type: 'button',
        class: 'chip' + (picked ? ' chip-on' : ''),
        onclick: () => toggleSurvivor(name)
      }, name);
      els.survivorPick.append(chip);
    });
    if (els.selCount) els.selCount.textContent = String(survivorSelected.size);
    rebuildSurvivorStageInputs();
  }
  function toggleSurvivor(name) {
    if (survivorSelected.has(name)) survivorSelected.delete(name);
    else {
      if (survivorSelected.size >= 4) return alert('Max 4 survivors.');
      survivorSelected.add(name);
    }
    rebuildSurvivorPicker();
  }
  function rebuildSurvivorStageInputs() {
    if (!els.svrStats) return;
    els.svrStats.innerHTML = '';
    Array.from(survivorSelected).forEach(name => {
      const row = el('div', { class: 'row' },
        el('label', { class: 'grow' }, `${name} — Stage (0–3)`,
          el('input', { type: 'number', min: 0, max: 3, value: 0, dataset: { key: name }, class: 'svr-stage' })
        )
      );
      els.svrStats.append(row);
    });
    updateOpponentDerivations();
  }
  function getSurvivorStagesFromUI() {
    const inputs = $$('.svr-stage');
    return inputs.map(inp => ({ name: inp.dataset.key, stage: clampInt(+inp.value, 0, 3) }));
  }
  function clampInt(v, min, max) {
    v = Math.round(v);
    if (Number.isNaN(v)) v = 0;
    return Math.max(min, Math.min(max, v));
  }
  function calcOppKillerFromSurvivors(survArr) {
    const stages = survArr.reduce((sum, s) => sum + clampInt(s.stage,0,3), 0);
    const fresh = survArr.reduce((cnt, s) => cnt + (clampInt(s.stage,0,3) === 0 ? 1 : 0), 0);
    return { stages, fresh };
  }
  function updateOpponentDerivations() {
    if (!els.oppKillerStagesView || !els.oppKillerFreshView) return;
    const survArr = getSurvivorStagesFromUI();
    const { stages, fresh } = calcOppKillerFromSurvivors(survArr);
    els.oppKillerStagesView.textContent = String(stages);
    els.oppKillerFreshView.textContent = String(fresh);
  }

  // ---------- Match form show/hide ----------
  function syncMatchTypeUI() {
    const type = els.matchType.value;
    const isTournament = type === 'Tournament';
    els.fsSurvivorSide?.classList.toggle('hidden', !isTournament);
    els.fsKillerSide?.classList.toggle('hidden', !isTournament);
    const isScrim = type === 'Scrim';
    els.fsScrim?.classList.toggle('hidden', !isScrim);
  }

  // ---------- Add match ----------
  function addMatchFromForm(e) {
    e?.preventDefault?.();

    const team = els.matchTeam.value || state.selectedTeam;
    if (!team) return alert('Pick a team');

    const dateISO = els.matchDate.value ? new Date(els.matchDate.value).toISOString() : new Date().toISOString();
    const type = els.matchType.value || 'Scrim';
    const opponent = els.matchOpponent.value.trim();
    const map = els.matchMap.value || '';
    const killer = els.matchKiller.value || '';
    const killerPlayer = els.killerPlayer.value || '';

    let survivors = [];
    let ourGens = 0, oppKillerStages = 0, oppKillerFresh = 0, ourKillerStages = 0, ourKillerFresh = 0, oppGens = 0, survEscapes = 0;

    if (type === 'Tournament') {
      survivors = getSurvivorStagesFromUI();
      const der = calcOppKillerFromSurvivors(survivors);
      oppKillerStages = der.stages;
      oppKillerFresh = der.fresh;
      ourGens = clampInt(+els.ourGensInput.value, 0, 5);

      ourKillerStages = clampInt(+els.ourKillerStagesInput.value, 0, 12);
      ourKillerFresh = clampInt(+els.ourKillerFreshInput.value, 0, 4);
      oppGens = clampInt(+els.oppGensInput.value, 0, 5);

      survEscapes = clampInt(+els.survivorResult.value, 0, 4);
    } else {
      // Scrim compact values
      survEscapes = clampInt(+els.survivorResult.value, 0, 4);
      ourGens = clampInt(+els.ourGensScrim.value || 0, 0, 5);
      ourKillerStages = clampInt(+els.ourKillerStagesScrim.value || 0, 0, 12);
      ourKillerFresh = clampInt(+els.ourKillerFreshScrim.value || 0, 0, 4);
      oppGens = clampInt(+els.oppGensScrim.value || 0, 0, 5);
      oppKillerStages = 0;
      oppKillerFresh = 0;
      survivors = [];
    }

    const id = ++state.lastId;
    state.matches.unshift({
      id, dateISO, team, type, opponent, map, killer, killerPlayer,
      survEscapes, ourGens, oppKillerStages, oppKillerFresh,
      ourKillerStages, ourKillerFresh, oppGens, survivors
    });

    saveState();
    renderAll();
    clearMatchForm();
  }

  function clearMatchForm() {
    els.matchOpponent.value = '';
    els.killerPlayer.value = '';
    els.survivorResult.value = '0';
    // tournament inputs
    els.ourGensInput && (els.ourGensInput.value = 0);
    els.ourKillerStagesInput && (els.ourKillerStagesInput.value = 0);
    els.ourKillerFreshInput && (els.ourKillerFreshInput.value = 0);
    els.oppGensInput && (els.oppGensInput.value = 0);
    // scrim inputs
    els.ourGensScrim && (els.ourGensScrim.value = 0);
    els.ourKillerStagesScrim && (els.ourKillerStagesScrim.value = 0);
    els.ourKillerFreshScrim && (els.ourKillerFreshScrim.value = 0);
    els.oppGensScrim && (els.oppGensScrim.value = 0);

    survivorSelected.clear();
    rebuildSurvivorPicker();
  }

  // ---------- Filters & table ----------
  function getFilters() {
    const f = {
      team: els.fTeam?.value || '',
      map: els.fMap?.value || '',
      killer: els.fKiller?.value || '',
      type: els.fType?.value || '',
      opp: (els.fOpp?.value || '').trim().toLowerCase(),
      player: (els.fPlayer?.value || '').trim().toLowerCase(),
      from: els.fFrom?.value ? new Date(els.fFrom.value) : null,
      to: els.fTo?.value ? new Date(els.fTo.value) : null,
    };
    if (f.to) f.to.setHours(23,59,59,999);
    return f;
  }
  function applyFilters(matches) {
    const f = getFilters();
    return matches.filter(m => {
      if (f.team && m.team !== f.team) return false;
      if (f.map && m.map !== f.map) return false;
      if (f.killer && m.killer !== f.killer) return false;
      if (f.type && m.type !== f.type) return false;
      if (f.opp && !(m.opponent || '').toLowerCase().includes(f.opp)) return false;
      if (f.player) {
        const inKiller = (m.killerPlayer || '').toLowerCase().includes(f.player);
        const inSurv = (m.survivors || []).some(s => (s.name || '').toLowerCase().includes(f.player));
        if (!inKiller && !inSurv) return false;
      }
      const d = new Date(m.dateISO);
      if (f.from && d < f.from) return false;
      if (f.to && d > f.to) return false;
      return true;
    });
  }
  function renderTable() {
    if (!els.matchesTableBody) return;
    const rows = applyFilters(state.matches);
    els.matchesTableBody.innerHTML = '';
    rows.forEach(m => {
      const sNames = (m.survivors||[]).map(s => `${s.name}:${s.stage}`).join(' / ');
      const tr = el('tr', {},
        el('td', {}, new Date(m.dateISO).toLocaleString()),
        el('td', {}, m.team),
        el('td', {}, m.type),
        el('td', {}, m.opponent || ''),
        el('td', {}, m.map || ''),
        el('td', {}, m.killer || ''),
        el('td', {}, m.killerPlayer || ''),
        el('td', {}, String(m.ourGens || 0)),
        el('td', {}, String(m.survEscapes || 0)),
        el('td', {}, String(m.oppKillerStages || 0)),
        el('td', {}, String(m.oppKillerFresh || 0)),
        el('td', {}, String(m.ourKillerStages || 0)),
        el('td', {}, String(m.ourKillerFresh || 0)),
        el('td', {}, String(m.oppGens || 0)),
        el('td', {}, sNames)
      );
      els.matchesTableBody.append(tr);
    });

    const avg = (arr, sel) => arr.length ? (arr.reduce((a,b)=>a+(+sel(b)||0),0)/arr.length) : 0;
    els.sAvgOurGens.textContent = avg(rows, m=>m.ourGens).toFixed(2);
    els.sAvgOppStages.textContent = avg(rows, m=>m.oppKillerStages).toFixed(2);
    els.sAvgOurStages.textContent = avg(rows, m=>m.ourKillerStages).toFixed(2);

    drawChart(rows.slice(0,30)); // latest 30 filtered
  }

  // ---------- Canvas chart (autosize to container, DPR-aware) ----------
  function drawChart(rows) {
    const c = els.chartCanvas;
    if (!c) return;
    const parent = c.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const cssW = parent.clientWidth;
    const cssH = 260;
    c.width = Math.floor(cssW * dpr);
    c.height = Math.floor(cssH * dpr);
    c.style.width = cssW + 'px';
    c.style.height = cssH + 'px';

    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // scale for crispness

    const W = cssW, H = cssH;
    ctx.clearRect(0,0,W,H);

    if (!rows.length) {
      ctx.fillStyle = '#cbd3ee';
      ctx.font = '14px sans-serif';
      ctx.fillText('No data for current filters', 10, 20);
      return;
    }

    const series = {
      Escapes: rows.map(m => +m.survEscapes || 0),
      OppKStages: rows.map(m => +m.oppKillerStages || 0),
      OurKStages: rows.map(m => +m.ourKillerStages || 0),
    };

    const maxY = Math.max(4, ...series.OppKStages, ...series.OurKStages, ...series.Escapes);
    const padL = 40, padR = 10, padT = 10, padB = 28;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;

    // axes
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, H - padB);
    ctx.lineTo(W - padR, H - padB);
    ctx.stroke();

    // y ticks
    ctx.fillStyle = '#cbd3ee';
    ctx.font = '12px sans-serif';
    const yTicks = 5;
    for (let i=0;i<=yTicks;i++) {
      const v = (maxY * i / yTicks);
      const y = padT + innerH - (v / maxY) * innerH;
      ctx.fillText(v.toFixed(0), 4, y+4);
      ctx.strokeStyle = '#2a2e42';
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.stroke();
    }

    // dotted cap at 4
    const cap = 4;
    const yCap = padT + innerH - (cap / maxY) * innerH;
    ctx.setLineDash([4,4]);
    ctx.strokeStyle = '#bbb';
    ctx.beginPath();
    ctx.moveTo(padL, yCap);
    ctx.lineTo(W - padR, yCap);
    ctx.stroke();
    ctx.setLineDash([]);

    // x positions
    const n = rows.length;
    const xFor = (i) => padL + (innerW * (i / Math.max(1, n-1)));
    const yFor = (v) => padT + innerH - (v / maxY) * innerH;

    const drawSeries = (arr, strokeStyle) => {
      ctx.strokeStyle = strokeStyle; ctx.lineWidth = 2; ctx.beginPath();
      arr.forEach((v,i) => { const x=xFor(i), y=yFor(v); if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); });
      ctx.stroke();
      ctx.fillStyle = strokeStyle;
      arr.forEach((v,i) => { const x=xFor(i), y=yFor(v); ctx.beginPath(); ctx.arc(x,y,2.5,0,Math.PI*2); ctx.fill(); });
    };

    drawSeries(series.Escapes,    '#0d6efd');
    drawSeries(series.OppKStages, '#dc3545');
    drawSeries(series.OurKStages, '#198754');

    // x labels
    ctx.fillStyle = '#cbd3ee';
    ctx.font = '11px sans-serif';
    const step = Math.ceil(n / 8);
    rows.forEach((m, i) => {
      if (i % step !== 0 && i !== n-1) return;
      const x = xFor(i);
      const d = new Date(m.dateISO);
      const label = `${d.getMonth()+1}/${d.getDate()}`;
      ctx.fillText(label, x-10, H-10);
    });
  }
  window.addEventListener('resize', () => drawChart(applyFilters(state.matches).slice(0,30)));

  // ---------- Import/Export ----------
  function exportJSON() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `dbd_stat_v24_${tsFile()}.json`);
  }
  function exportCSV() {
    const headers = [
      'id','dateISO','team','type','opponent','map','killer','killerPlayer',
      'survEscapes','ourGens','oppKillerStages','oppKillerFresh','ourKillerStages','ourKillerFresh','oppGens','survivors'
    ];
    const lines = [headers.join(',')];
    state.matches.forEach(m => {
      const row = [
        m.id, m.dateISO, csv(m.team), csv(m.type), csv(m.opponent), csv(m.map), csv(m.killer), csv(m.killerPlayer),
        m.survEscapes, m.ourGens, m.oppKillerStages, m.oppKillerFresh, m.ourKillerStages, m.ourKillerFresh, m.oppGens,
        csv((m.survivors||[]).map(s=>`${s.name}:${s.stage}`).join('|'))
      ];
      lines.push(row.join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    downloadBlob(blob, `dbd_stat_v24_${tsFile()}.csv`);
  }
  function csv(s) {
    s = (s==null? '' : String(s));
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replaceAll('"', '""') + '"';
    }
    return s;
  }
  function tsFile() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
  async function importJSONFile(file, replace) {
    const text = await file.text();
    const data = JSON.parse(text);
    if (replace) state = data; else mergeStateInPlace(state, data);
    saveState(); renderAll();
  }
  async function importCSVFile(file, replace) {
    const text = await file.text();
    const parsed = parseCSV(text);
    const incoming = csvToState(parsed);
    if (replace) state = incoming; else mergeStateInPlace(state, incoming);
    saveState(); renderAll();
  }
  function parseCSV(text) {
    const rows = [];
    let i = 0, field = '', inQ = false, row = [];
    while (i < text.length) {
      const ch = text[i++];
      if (inQ) {
        if (ch === '"') { if (text[i] === '"') { field += '"'; i++; } else inQ = false; }
        else field += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ',') { row.push(field); field=''; }
        else if (ch === '\n' || ch === '\r') {
          if (field!=='' || row.length) { row.push(field); rows.push(row); row=[]; field=''; }
        } else field += ch;
      }
    }
    if (field!=='' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r=>r.length>1);
  }
  function csvToState(rows) {
    const header = rows[0].map(h=>h.trim());
    const idx = (name) => header.indexOf(name);
    const out = structuredClone(DEFAULT_STATE);
    for (let r=1;r<rows.length;r++) {
      const row = rows[r];
      const survivors = (row[idx('survivors')]||'').split('|').filter(Boolean).map(pair=>{
        const [name,stage] = pair.split(':'); return { name: name||'', stage: clampInt(+stage||0,0,3) };
      });
      out.matches.push({
        id: +row[idx('id')]||0,
        dateISO: row[idx('dateISO')]||new Date().toISOString(),
        team: row[idx('team')]||'',
        type: row[idx('type')]||'Scrim',
        opponent: row[idx('opponent')]||'',
        map: row[idx('map')]||'',
        killer: row[idx('killer')]||'',
        killerPlayer: row[idx('killerPlayer')]||'',
        survEscapes: +row[idx('survEscapes')]||0,
        ourGens: +row[idx('ourGens')]||0,
        oppKillerStages: +row[idx('oppKillerStages')]||0,
        oppKillerFresh: +row[idx('oppKillerFresh')]||0,
        ourKillerStages: +row[idx('ourKillerStages')]||0,
        ourKillerFresh: +row[idx('ourKillerFresh')]||0,
        oppGens: +row[idx('oppGens')]||0,
        survivors,
      });
      out.lastId = Math.max(out.lastId, +row[idx('id')]||0);
    }
    return out;
  }
  function mergeStateInPlace(base, incoming) {
    for (const [t, obj] of Object.entries(incoming.teams||{})) {
      base.teams[t] ||= { roster: [] };
      const set = new Set(base.teams[t].roster);
      for (const n of (obj.roster||[])) set.add(n);
      base.teams[t].roster = Array.from(set);
    }
    const have = new Map(base.matches.map(m => [m.id || m.dateISO, true]));
    for (const m of (incoming.matches||[])) {
      const key = m.id || m.dateISO;
      if (!have.has(key)) base.matches.push(m);
    }
    base.lastId = Math.max(base.lastId||0, incoming.lastId||0, ...base.matches.map(m=>m.id||0));
    if (incoming.selectedTeam) base.selectedTeam = incoming.selectedTeam;
  }

  // ---------- Demo & Clear ----------
  function addDemo() {
    const team = state.selectedTeam || Object.keys(state.teams)[0] || 'Iridescent Rebirth';
    if (!state.teams[team]) state.teams[team] = { roster: ['Shay','Weeve','Styxlz','Danthrax','Saiko','Plasma'] };
    state.selectedTeam = team;

    const maps = ['Garden of Joy','Dead Dawg Saloon','Ormond','Haddonfield'];
    const killers = ['Blight','Huntress','Nurse','Xenomorph'];

    for (let i=0;i<6;i++) {
      const type = i%2===0 ? 'Tournament' : 'Scrim';
      const survivors = type==='Tournament' ? [
        { name: 'Shay', stage: Math.floor(Math.random()*4) },
        { name: 'Weeve', stage: Math.floor(Math.random()*4) },
        { name: 'Styxlz', stage: Math.floor(Math.random()*4) },
        { name: 'Danthrax', stage: Math.floor(Math.random()*4) },
      ] : [];
      const der = calcOppKillerFromSurvivors(survivors);
      const id = ++state.lastId;
      state.matches.unshift({
        id,
        dateISO: new Date(Date.now() - i*86400000).toISOString(),
        team,
        type,
        opponent: 'Rival Esports',
        map: maps[i%maps.length],
        killer: killers[i%killers.length],
        killerPlayer: 'Shay',
        survEscapes: Math.floor(Math.random()*5),
        ourGens: type==='Tournament' ? Math.floor(Math.random()*6) : Math.floor(Math.random()*6),
        oppKillerStages: type==='Tournament' ? der.stages : 0,
        oppKillerFresh: type==='Tournament' ? der.fresh : 0,
        ourKillerStages: type==='Tournament' ? Math.floor(Math.random()*13) : Math.floor(Math.random()*13),
        ourKillerFresh: type==='Tournament' ? Math.floor(Math.random()*5) : Math.floor(Math.random()*5),
        oppGens: type==='Tournament' ? Math.floor(Math.random()*6) : Math.floor(Math.random()*6),
        survivors,
      });
    }
    saveState(); renderAll();
  }
  function clearAll() {
    if (!confirm('This will clear ALL saved teams, rosters, and matches. Continue?')) return;
    state = structuredClone(DEFAULT_STATE);
    saveState(); renderAll();
  }

  // ---------- Render glue ----------
  function renderAll() {
    refreshTeamsUI();
    renderTable();
    syncMatchTypeUI();
    rebuildSurvivorPicker();
    // ensure match team list matches teams
    if (els.matchTeam) {
      const current = els.matchTeam.value;
      els.matchTeam.innerHTML = '';
      Object.keys(state.teams).sort().forEach(t => els.matchTeam.append(el('option', { value: t, selected: t===state.selectedTeam }, t)));
      if (current && state.teams[current]) els.matchTeam.value = current;
    }
    drawChart(applyFilters(state.matches).slice(0,30));
  }

  // ---------- Events ----------
  els.teamAddForm?.addEventListener('submit', (e) => { e.preventDefault(); addTeam(els.newTeamName.value); els.newTeamName.value=''; });
  els.btnDeleteTeam?.addEventListener('click', deleteTeam);
  els.teamSelect?.addEventListener('change', () => { state.selectedTeam = els.teamSelect.value; saveState(); refreshTeamsUI(); });

  els.memberAddForm?.addEventListener('submit', (e) => { e.preventDefault(); addMember(els.memberName.value); els.memberName.value=''; });
  els.btnClearRoster?.addEventListener('click', clearRoster);

  els.svrStats?.addEventListener('input', updateOpponentDerivations);
  els.matchType?.addEventListener('change', () => { syncMatchTypeUI(); rebuildSurvivorPicker(); });
  els.matchTeam?.addEventListener('change', () => { state.selectedTeam = els.matchTeam.value; saveState(); refreshTeamsUI(); rebuildSurvivorPicker(); });
  els.btnAutoFromStages?.addEventListener('click', updateOpponentDerivations);

  els.matchForm?.addEventListener('submit', addMatchFromForm);

  [els.fTeam, els.fMap, els.fKiller, els.fType, els.fOpp, els.fPlayer, els.fFrom, els.fTo]
    .filter(Boolean).forEach(c => c.addEventListener('input', renderTable));
  els.btnClearFilters?.addEventListener('click', () => {
    [els.fTeam, els.fMap, els.fKiller, els.fType].filter(Boolean).forEach(s=>s.value='');
    [els.fOpp, els.fPlayer, els.fFrom, els.fTo].filter(Boolean).forEach(i=>i.value='');
    renderTable();
  });

  els.btnExportJSON?.addEventListener('click', exportJSON);
  els.btnExportCSV?.addEventListener('click', exportCSV);
  els.fileJSON?.addEventListener('change', (e) => { const f = e.target.files[0]; if (!f) return; importJSONFile(f, els.replaceMode?.checked); e.target.value=''; });
  els.fileCSV?.addEventListener('change', (e) => { const f = e.target.files[0]; if (!f) return; importCSVFile(f, els.replaceMode?.checked); e.target.value=''; });

  els.btnDemo?.addEventListener('click', addDemo);
  els.btnClearAll?.addEventListener('click', clearAll);

  // ---------- Boot ----------
  renderAll();
})();
