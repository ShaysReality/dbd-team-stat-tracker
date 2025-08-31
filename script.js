/* ============================================================
   DbD Stat Logger — Scrims & Tournaments
   - Scrim: only Survivor Result + Killer Player visible
   - Tournament: show Survivor Side (stages → Opponent Killer Result) and Killer Side (our killer result + opponent gens)
   Dev notes (stored per match):
   {
     id, date, teamId, teamName, type, opponent, map, killer, killerPlayer,
     survivorResult,               // 0..4
     ourGens,                      // 0..5, survivor side (tournament only)
     oppKillerStages, oppKillerFresh, // derived from survivor stages
     ourKillerStages, ourKillerFresh, // manual inputs (tournament only)
     oppGens,                      // 0..5, vs our killer (tournament only)
     survivors: [names],           // up to 4
     players: [{name,stage}]       // '0'|'1st'|'2nd'|'death'  (tournament only)
   }
   CSV headers include both sides.
============================================================ */

// ---------- Canonical lists ----------
const ALL_MAPS = [
  "Azarov's Resting Place","Blood Lodge","Coal Tower","Dead Dawg Saloon","Disturbed Ward",
  "Dvarka Deepwood","Eyrie of Crows","Family Residence","Father Campbell's Chapel","Fractured Cowshed",
  "Garden of Joy","Gas Heaven","Greenville Square","Grim Pantry","Groaning Storehouse",
  "Ironworks of Misery","Lampkin Lane","Midwich Elementary School","Mount Ormond Resort","Mother's Dwelling",
  "Nostromo Wreckage","R.P.D. East Wing","R.P.D. West Wing","Rancid Abattoir","Rotten Fields",
  "Sanctum of Wrath","Security Room","Shelter Woods","Suffocation Pit","The Game",
  "The Pale Rose","The Shattered Square","The Temple of Purgation","The Thompson House","Toba Landing",
  "Torment Creek","Treatment Theatre","Withered Isle","Wrecker's Yard","Wretched Shop",
].sort();

const ALL_KILLERS = [
  "The Trapper","The Wraith","The Hillbilly","The Nurse","The Shape","The Hag","The Doctor",
  "The Huntress","The Cannibal","The Nightmare","The Pig","The Clown","The Spirit","The Legion",
  "The Plague","The Ghost Face","The Demogorgon","The Oni","The Deathslinger","The Executioner",
  "The Blight","The Twins","The Trickster","The Nemesis","The Cenobite","The Artist","The Onryō",
  "The Dredge","The Knight","The Skull Merchant","The Singularity","The Xenomorph","The Good Guy",
  "The Unknown","The Mastermind","The Animatronic","The Ghoul","The Houndmaster","Dracula","The Lich","The Dark Lord"
].sort();

// ---------- Storage / State ----------
const KEY = 'dbd-stat-logger-v9';
let state = loadState();
function loadState(){
  try { return JSON.parse(localStorage.getItem(KEY)) || { teams:[], matches:[] }; }
  catch { return { teams:[], matches:[] }; }
}
function saveState(){ localStorage.setItem(KEY, JSON.stringify(state)); }

// ---------- DOM ----------
const teamAddForm   = document.getElementById('teamAddForm');
const newTeamName   = document.getElementById('newTeamName');
const teamSelect    = document.getElementById('teamSelect');
const btnDeleteTeam = document.getElementById('btnDeleteTeam');

const memberAddForm = document.getElementById('memberAddForm');
const memberName    = document.getElementById('memberName');
const btnClearRoster= document.getElementById('btnClearRoster');
const rosterTableBody = document.querySelector('#rosterTable tbody');

const matchForm     = document.getElementById('matchForm');
const matchTeam     = document.getElementById('matchTeam');
const matchMapSel   = document.getElementById('matchMap');
const matchKillerSel= document.getElementById('matchKiller');
const matchDate     = document.getElementById('matchDate');
const matchType     = document.getElementById('matchType');
const matchOpponent = document.getElementById('matchOpponent');

const killerPlayer  = document.getElementById('killerPlayer');
const survivorResult= document.getElementById('survivorResult');

const fsSurvivorSide = document.getElementById('fsSurvivorSide');
const survivorPick  = document.getElementById('survivorPick');
const selCountEl    = document.getElementById('selCount');
const svrStatsWrap  = document.getElementById('svrStats');
const ourGensInput  = document.getElementById('ourGensInput');
const btnAutoFromStages = document.getElementById('btnAutoFromStages');
const oppKillerStagesView = document.getElementById('oppKillerStagesView');
const oppKillerFreshView  = document.getElementById('oppKillerFreshView');

const fsKillerSide  = document.getElementById('fsKillerSide');
const ourKillerStagesInput = document.getElementById('ourKillerStagesInput');
const ourKillerFreshInput  = document.getElementById('ourKillerFreshInput');
const oppGensInput   = document.getElementById('oppGensInput');

const matchesTableBody = document.querySelector('#matchesTable tbody');
const sAvgOurGens = document.getElementById('sAvgOurGens');
const sAvgOppStages = document.getElementById('sAvgOppStages');
const sAvgOurStages = document.getElementById('sAvgOurStages');

const btnExportCSV = document.getElementById('btnExportCSV');
const btnExportJSON= document.getElementById('btnExportJSON');
const btnClearAll  = document.getElementById('btnClearAll');
const btnDemo      = document.getElementById('btnDemo');

const fileJSON = document.getElementById('fileJSON');
const fileCSV  = document.getElementById('fileCSV');
const replaceMode = document.getElementById('replaceMode');

const fTeam   = document.getElementById('fTeam');
const fMapSel = document.getElementById('fMap');
const fKillerSel = document.getElementById('fKiller');
const fType   = document.getElementById('fType');
const fOpp    = document.getElementById('fOpp');
const fPlayer = document.getElementById('fPlayer');
const fFrom   = document.getElementById('fFrom');
const fTo     = document.getElementById('fTo');
const btnClearFilters = document.getElementById('btnClearFilters');

const chart = document.getElementById('chart');
const ctx   = chart.getContext('2d');

// ---------- Utils ----------
const uid = (p='id') => `${p}_${Math.random().toString(36).slice(2,9)}`;
const byId = (arr,id) => arr.find(x=>x.id===id);
const sum = arr => arr.reduce((a,b)=>a+b,0);
const avg = arr => arr.length ? sum(arr)/arr.length : 0;
const fmt2 = n => Number.isFinite(n) ? n.toFixed(2) : '0.00';
function toCSV(rows){
  return rows.map(r => r.map(v=>{
    const s = String(v ?? '');
    return /[,"\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  }).join(',')).join('\n');
}
function download(filename, text){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], {type:'text/plain'}));
  a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}
function populateSelect(selectEl, items, blankLabel){
  selectEl.innerHTML = "";
  if(blankLabel !== undefined){
    const blank = document.createElement("option");
    blank.value = ""; blank.textContent = blankLabel;
    selectEl.appendChild(blank);
  }
  items.forEach(v=>{
    const o = document.createElement("option"); o.value = v; o.textContent = v; selectEl.appendChild(o);
  });
}
function parseCSV(text){
  const rows = [];
  let i=0, field='', row=[], inQ=false;
  while(i<text.length){
    const c = text[i];
    if (inQ){
      if (c === '"'){ if (text[i+1] === '"'){ field += '"'; i++; } else inQ=false; }
      else field += c;
    } else {
      if (c === '"') inQ=true;
      else if (c === ','){ row.push(field); field=''; }
      else if (c === '\n'){ row.push(field); rows.push(row); row=[]; field=''; }
      else if (c === '\r'){ /* ignore */ }
      else field += c;
    }
    i++;
  }
  if (field.length || row.length){ row.push(field); rows.push(row); }
  return rows;
}
const stageToNum = s => (s==='1st'?1 : s==='2nd'?2 : s==='death'?3 : 0);

// ---------- Type-driven visibility ----------
function updateTypeVisibility(){
  const t = matchType.value;
  const scrim = (t === 'Scrim');
  fsSurvivorSide.classList.toggle('hidden', !(!scrim && t)); // only tournament
  fsKillerSide.classList.toggle('hidden', !(!scrim && t));   // only tournament
  // Survivor Result + Killer Player always visible; "Our Gens" etc only in tournament (already in fieldsets)
}
matchType.addEventListener('change', updateTypeVisibility);

// ---------- Team UI ----------
function renderTeamsUI(){
  const prevTeamMgmt  = teamSelect.value || '';
  const prevTeamMatch = matchTeam.value || '';
  const prevTeamFilter= fTeam.value || '';

  teamSelect.innerHTML = '';
  matchTeam.innerHTML  = '';
  fTeam.innerHTML      = '';

  const mkBlank = (label) => { const o=document.createElement('option'); o.value=''; o.textContent=label; return o; };
  teamSelect.appendChild(mkBlank('-- select team --'));
  matchTeam.appendChild(mkBlank('-- select team --'));
  fTeam.appendChild(mkBlank('-- all teams --'));

  state.teams.forEach(t=>{
    const o1=document.createElement('option'); o1.value=t.id; o1.textContent=t.name; teamSelect.appendChild(o1);
    const o2=document.createElement('option'); o2.value=t.id; o2.textContent=t.name; matchTeam.appendChild(o2);
    const o3=document.createElement('option'); o3.value=t.id; o3.textContent=t.name; fTeam.appendChild(o3);
  });

  const hasId = id => state.teams.some(t=>t.id===id);
  if (prevTeamMgmt && hasId(prevTeamMgmt)) teamSelect.value = prevTeamMgmt;
  if (prevTeamMatch && hasId(prevTeamMatch)) matchTeam.value = prevTeamMatch;
  if (prevTeamFilter==='' || hasId(prevTeamFilter)) fTeam.value = prevTeamFilter;

  populateSelect(matchMapSel, ALL_MAPS, "-- map --");
  populateSelect(matchKillerSel, ALL_KILLERS, "-- killer --");
  populateSelect(fMapSel, ["(all maps)", ...ALL_MAPS], "-- all maps --");
  populateSelect(fKillerSel, ["(all killers)", ...ALL_KILLERS], "-- all killers --");

  renderRosterTable();
  syncRosterForMatch();
  updateTypeVisibility();
}

function renderRosterTable(){
  const tid = teamSelect.value;
  const team = byId(state.teams, tid);
  rosterTableBody.innerHTML = '';
  (team?.roster || []).forEach((name,i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i+1}</td>
      <td>${name}</td>
      <td><button class="btn btn-ghost" data-del="${i}">Remove</button></td>
    `;
    rosterTableBody.appendChild(tr);
  });
  rosterTableBody.querySelectorAll('[data-del]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const idx = Number(btn.dataset.del);
      if(!team) return;
      team.roster.splice(idx,1);
      saveState();
      renderRosterTable();
      if (matchTeam.value === tid) syncRosterForMatch();
    });
  });
}

// ---------- Survivor chips + killer player select ----------
let selectedSurvivors = [];
function syncRosterForMatch(){
  const tid = matchTeam.value;
  const team = byId(state.teams, tid);
  const roster = (team?.roster || []).slice();

  killerPlayer.innerHTML = '';
  populateSelect(killerPlayer, ['(none)', ...roster], '(none)');

  survivorPick.innerHTML = '';
  selectedSurvivors = selectedSurvivors.filter(n => roster.includes(n));
  roster.forEach(name=>{
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (selectedSurvivors.includes(name) ? ' on' : '');
    chip.textContent = name;
    chip.addEventListener('click', ()=>{
      const on = selectedSurvivors.includes(name);
      if (on){
        selectedSurvivors = selectedSurvivors.filter(n=>n!==name);
        chip.classList.remove('on');
      } else {
        if (selectedSurvivors.length >= 4) return;
        selectedSurvivors.push(name);
        chip.classList.add('on');
      }
      selCountEl.textContent = String(selectedSurvivors.length);
      renderSvrStatsInputs();
      updateOppKillerDerived(); // refresh derived opponent killer result
    });
    survivorPick.appendChild(chip);
  });
  selCountEl.textContent = String(selectedSurvivors.length);
  renderSvrStatsInputs();
  updateOppKillerDerived();
}

// ---------- Survivor stage rows ----------
function renderSvrStatsInputs(){
  const STAGES = ["0","1st","2nd","death"];
  const prev = new Map();
  svrStatsWrap.querySelectorAll('.stageSelect').forEach(sel=>{
    prev.set(sel.dataset.name, sel.value);
  });

  svrStatsWrap.innerHTML = '';
  selectedSurvivors.forEach(n=>{
    const row = document.createElement('div');
    row.className = 'svr-row';

    const nameInp = document.createElement('input');
    nameInp.className = 'svrName';
    nameInp.type = 'text';
    nameInp.value = n;
    nameInp.readOnly = true;

    const stageSel = document.createElement('select');
    stageSel.className = 'stageSelect';
    stageSel.setAttribute('data-name', n);
    STAGES.forEach(s=>{
      const o = document.createElement('option'); o.value = s; o.textContent = s; stageSel.appendChild(o);
    });
    if (prev.has(n)) stageSel.value = prev.get(n);
    stageSel.addEventListener('input', updateOppKillerDerived);

    row.appendChild(nameInp);
    row.appendChild(stageSel);
    svrStatsWrap.appendChild(row);
  });
}

const stageToTotals = (players) => {
  const nums = players.map(p=> stageToNum(p.stage));
  return { stages: sum(nums), fresh: nums.filter(x=>x>=1).length };
};
function readCurrentPlayers(){
  const rows = [];
  selectedSurvivors.forEach(n=>{
    const v = (svrStatsWrap.querySelector(`.stageSelect[data-name="${CSS.escape(n)}"]`)?.value || '0');
    rows.push({ name:n, stage:v });
  });
  return rows;
}
function updateOppKillerDerived(){
  // live view for tournament; scrim ignores
  const totals = stageToTotals(readCurrentPlayers());
  oppKillerStagesView.textContent = String(totals.stages);
  oppKillerFreshView.textContent  = String(totals.fresh);
}
btnAutoFromStages.addEventListener('click', updateOppKillerDerived);

// ---------- Tables / Stats / Chart ----------
function renderMatchesTable(){
  const rows = getFilteredMatches();
  matchesTableBody.innerHTML = '';
  rows.forEach(m=>{
    const packPlayers = (m.players||[]).map(p=> `${p.name}: ${p.stage}`).join(' / ');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(m.date).toLocaleString()}</td>
      <td>${m.teamName || '—'}</td>
      <td>${m.type || '—'}</td>
      <td>${m.opponent || '—'}</td>
      <td>${m.map || '—'}</td>
      <td>${m.killer || '—'}</td>
      <td>${m.killerPlayer || '—'}</td>
      <td>${m.ourGens ?? '—'}</td>
      <td>${m.survivorResult ?? '—'}</td>
      <td>${m.oppKillerStages ?? '—'}</td>
      <td>${m.oppKillerFresh ?? '—'}</td>
      <td>${m.ourKillerStages ?? '—'}</td>
      <td>${m.ourKillerFresh ?? '—'}</td>
      <td>${m.oppGens ?? '—'}</td>
      <td>${packPlayers}</td>
    `;
    matchesTableBody.appendChild(tr);
  });
}
function renderQuickStats(){
  const rows = getFilteredMatches();
  const ourG = rows.map(m=>Number(m.ourGens)).filter(Number.isFinite);
  const oppKS= rows.map(m=>Number(m.oppKillerStages)).filter(Number.isFinite);
  const ourKS= rows.map(m=>Number(m.ourKillerStages)).filter(Number.isFinite);
  sAvgOurGens.textContent   = fmt2(avg(ourG));
  sAvgOppStages.textContent = fmt2(avg(oppKS));
  sAvgOurStages.textContent = fmt2(avg(ourKS));
}
function renderChart(){
  // Escapes (0–4), Opp Killer Stages (0–12), Our Killer Stages (0–12)
  const rows = getFilteredMatches().slice(-16);
  const padL = 44, padR = 16, padT = 24, padB = 34;
  const w = chart.width - padL - padR;
  const h = chart.height - padT - padB;

  const maxEsc = 4, maxStages = 12;
  const scaleY = (v,max) => padT + h - (v/max)*h;
  const n = Math.max(rows.length,1), groupW = w/n, barW = Math.max(10,(groupW-10)/3);
  const y0 = padT + h, x0 = padL;

  ctx.clearRect(0,0,chart.width,chart.height);

  // axes
  ctx.strokeStyle = '#3a4450';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, padT); ctx.lineTo(x0, y0); ctx.lineTo(x0 + w, y0);
  ctx.stroke();

  // y ticks (0..12)
  ctx.fillStyle = '#9aa4ad';
  ctx.font = '12px system-ui, Segoe UI, Roboto, Arial';
  for (let t = 0; t <= 12; t += 2) {
    const y = scaleY(t, maxStages);
    ctx.strokeStyle = t === 0 ? '#3a4450' : '#25303a';
    ctx.setLineDash([t===0 ? 0 : 4, 4]);
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + w, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(String(t), x0 - 26, y + 4);
  }

  // dotted guide at 4 (escapes cap)
  const yFour = scaleY(4, maxStages);
  ctx.strokeStyle = '#465363';
  ctx.setLineDash([6,6]);
  ctx.beginPath(); ctx.moveTo(x0, yFour); ctx.lineTo(x0 + w, yFour); ctx.stroke();
  ctx.setLineDash([]);

  // bars
  rows.forEach((m,i)=>{
    const gx = x0 + i*groupW + 4;

    // Escapes
    ctx.fillStyle = '#00ffff';
    const yEsc = scaleY(Number(m.survivorResult)||0, maxEsc);
    ctx.fillRect(gx, yEsc, barW, y0 - yEsc);

    // Opp Killer Stages (from our survivor side)
    ctx.fillStyle = '#58a6ff';
    const yOpp = scaleY(Number(m.oppKillerStages)||0, maxStages);
    ctx.fillRect(gx + barW + 3, yOpp, barW, y0 - yOpp);

    // Our Killer Stages (from our killer side)
    ctx.fillStyle = '#ff7b7b';
    const yOur = scaleY(Number(m.ourKillerStages)||0, maxStages);
    ctx.fillRect(gx + barW*2 + 6, yOur, barW, y0 - yOur);
  });

  // axis labels
  ctx.fillStyle = '#cbd5e1';
  ctx.fillText('Recent Matches →', x0 + w - 120, y0 + 24);
  ctx.save();
  ctx.translate(14, padT + h/2);
  ctx.rotate(-Math.PI/2);
  ctx.fillText('Value (Esc 0–4 • Stages 0–12)', -90, 0);
  ctx.restore();
}

// ---------- Filters ----------
function passesFilters(m){
  if (fTeam.value && m.teamId !== fTeam.value) return false;
  if (fMapSel.value && fMapSel.value !== "(all maps)" && m.map !== fMapSel.value) return false;
  if (fKillerSel.value && fKillerSel.value !== "(all killers)" && m.killer !== fKillerSel.value) return false;
  if (fType.value && m.type !== fType.value) return false;
  if (fOpp.value && !String(m.opponent||'').toLowerCase().includes(fOpp.value.toLowerCase())) return false;
  if (fPlayer.value){
    const needle = fPlayer.value.toLowerCase();
    const hit = (m.players||[]).some(p=> String(p.name||'').toLowerCase().includes(needle));
    if(!hit) return false;
  }
  if (fFrom.value){
    const from = new Date(fFrom.value+'T00:00:00Z').getTime();
    if (new Date(m.date).getTime() < from) return false;
  }
  if (fTo.value){
    const to = new Date(fTo.value+'T23:59:59Z').getTime();
    if (new Date(m.date).getTime() > to) return false;
  }
  return true;
}
function getFilteredMatches(){
  return state.matches.slice().sort((a,b)=> new Date(b.date)-new Date(a.date)).filter(passesFilters);
}

// ---------- Render All ----------
function renderAll(){
  renderTeamsUI();
  renderMatchesTable();
  renderQuickStats();
  renderChart();
}
renderAll();

// ---------- Events: Teams ----------
teamAddForm.addEventListener('submit', (e)=>{
  e.preventDefault();
  const name = newTeamName.value.trim();
  if(!name) return;
  const newTeam = { id: uid('t'), name, roster: [] };
  state.teams.push(newTeam);
  saveState(); newTeamName.value='';
  renderTeamsUI();
  teamSelect.value = newTeam.id; renderRosterTable();
  matchTeam.value = newTeam.id;  syncRosterForMatch();
});
teamSelect.addEventListener('change', ()=>{ renderRosterTable(); });
btnDeleteTeam.addEventListener('click', ()=>{
  const tid = teamSelect.value; if(!tid) return;
  if(!confirm('Delete selected team and its roster? (Matches remain with teamName snapshot)')) return;
  state.teams = state.teams.filter(t=>t.id!==tid);
  saveState(); renderTeamsUI();
  if (state.teams.length){
    teamSelect.value = state.teams[0].id; renderRosterTable();
    matchTeam.value = state.teams[0].id;  syncRosterForMatch();
  }
});
memberAddForm.addEventListener('submit', (e)=>{
  e.preventDefault();
  const tid = teamSelect.value; if(!tid) return alert('Select a team first.');
  const name = memberName.value.trim(); if(!name) return;
  const team = byId(state.teams, tid); if(!team) return;
  if(!team.roster.includes(name)) team.roster.push(name);
  saveState(); memberName.value = '';
  renderRosterTable();
  if (matchTeam.value === tid) syncRosterForMatch();
});
btnClearRoster.addEventListener('click', ()=>{
  const tid = teamSelect.value; if(!tid) return;
  const team = byId(state.teams, tid); if(!team) return;
  if(!confirm('Clear entire roster for this team?')) return;
  team.roster=[]; saveState(); renderRosterTable();
  if (matchTeam.value === tid) syncRosterForMatch();
});

// ---------- Events: Match form ----------
matchTeam.addEventListener('change', ()=>{ syncRosterForMatch(); });

btnDemo.addEventListener('click', ()=>{
  if(!state.teams.length){
    const t1 = { id: uid('t'), name:'ShaysReality', roster:['Meg','Claudette','Feng','David','Nea','Kate'] };
    const t2 = { id: uid('t'), name:'RivalZ', roster:['Ace','Jake','Yui','Jeff','Nancy','Zarina'] };
    state.teams.push(t1,t2);
  }
  const t1 = state.teams[0], t2 = state.teams[1] || state.teams[0];

  // Demo tournament match (both sides filled)
  const surv = ['Meg','Claudette','Feng','David'];
  const stages = ['1st','2nd','0','death'];
  const totals = stageToTotals(stages.map((s,i)=>({name:surv[i], stage:s})));
  state.matches.push({
    id: uid('m'),
    date: new Date().toISOString(),
    teamId: t1.id, teamName: t1.name,
    type: 'Tournament', opponent:'RivalZ',
    map:'Groaning Storehouse', killer:'The Nurse', killerPlayer:'Meg',
    survivorResult: 2,
    ourGens: 3,
    oppKillerStages: totals.stages,
    oppKillerFresh: totals.fresh,
    ourKillerStages: 7,
    ourKillerFresh: 4,
    oppGens: 3,
    survivors: surv,
    players: surv.map((n,i)=>({name:n, stage:stages[i]}))
  });
  // Demo scrim (minimal)
  state.matches.push({
    id: uid('m'),
    date: new Date().toISOString(),
    teamId: t1.id, teamName: t1.name,
    type: 'Scrim', opponent:'—',
    map:'Lampkin Lane', killer:'The Blight', killerPlayer:'Nea',
    survivorResult: 1,
    ourGens: null, oppKillerStages: null, oppKillerFresh: null,
    ourKillerStages: null, ourKillerFresh: null, oppGens: null,
    survivors: [], players: []
  });

  saveState(); renderAll();
});

matchForm.addEventListener('submit', (e)=>{
  e.preventDefault();

  const tid = matchTeam.value; if(!tid) return alert('Select a team.');
  const team = byId(state.teams, tid);
  const teamName = team?.name || '';

  const type = matchType.value;
  const isTournament = (type === 'Tournament');

  // Base fields (always)
  const base = {
    id: uid('m'),
    date: matchDate.value ? new Date(matchDate.value).toISOString() : new Date().toISOString(),
    teamId: tid, teamName,
    type,
    opponent: matchOpponent.value.trim(),
    map: matchMapSel.value,
    killer: matchKillerSel.value,
    killerPlayer: (killerPlayer.value && killerPlayer.value !== '(none)') ? killerPlayer.value : '',
    survivorResult: Number(survivorResult.value||0),
  };

  // Tournament: collect survivor side & killer side
  let survivors = [], players = [];
  let ourGens = null, oppKillerStages = null, oppKillerFresh = null;
  let ourKillerStages = null, ourKillerFresh = null, oppGens = null;

  if (isTournament){
    // Survivors must be exactly 4 for tournament survivor side to compute opponent killer result
    survivors = selectedSurvivors.slice();
    if (survivors.length !== 4) return alert('For Tournament, pick exactly 4 survivors.');
    players = readCurrentPlayers();

    const totals = stageToTotals(players);
    oppKillerStages = totals.stages;
    oppKillerFresh  = totals.fresh;

    ourGens = Number(ourGensInput.value || 0);
    ourGens = Math.max(0, Math.min(5, ourGens));

    // Killer side manual
    ourKillerStages = Math.max(0, Math.min(12, Number(ourKillerStagesInput.value||0)));
    ourKillerFresh  = Math.max(0, Math.min(4,  Number(ourKillerFreshInput.value||0)));
    oppGens         = Math.max(0, Math.min(5,  Number(oppGensInput.value||0)));
  } else {
    // Scrim: minimal — ignore survivors list & extra numbers
    survivors = [];
    players = [];
  }

  const m = {
    ...base,
    ourGens, oppKillerStages, oppKillerFresh,
    ourKillerStages, ourKillerFresh, oppGens,
    survivors, players
  };

  state.matches.push(m);
  saveState();

  matchForm.reset();
  selectedSurvivors = [];
  survivorPick.innerHTML = '';
  svrStatsWrap.innerHTML = '';
  oppKillerStagesView.textContent = '0';
  oppKillerFreshView.textContent = '0';
  renderAll();
});

// ---------- Filters / Exports ----------
[fTeam,fMapSel,fKillerSel,fType,fOpp,fPlayer,fFrom,fTo].forEach(el =>
  el.addEventListener('input', ()=>{ renderMatchesTable(); renderQuickStats(); renderChart(); })
);
btnClearFilters.addEventListener('click', ()=>{
  fTeam.value=''; fMapSel.value=''; fKillerSel.value=''; fType.value='';
  fOpp.value=''; fPlayer.value=''; fFrom.value=''; fTo.value='';
  renderMatchesTable(); renderQuickStats(); renderChart();
});

// ---------- Export ----------
btnExportCSV.addEventListener('click', ()=>{
  const rows = [[
    'date','team','type','opponent','map','killer','killer_player',
    'our_gens','survivor_result',
    'opp_killer_stages','opp_killer_fresh',
    'our_killer_stages','our_killer_fresh','opp_gens',
    's1_name','s1_stage','s2_name','s2_stage','s3_name','s3_stage','s4_name','s4_stage'
  ]];
  state.matches.forEach(m=>{
    const P = (m.players||[]);
    rows.push([
      new Date(m.date).toISOString(),
      m.teamName||'', m.type||'', m.opponent||'',
      m.map||'', m.killer||'', m.killerPlayer||'',
      m.ourGens ?? '', m.survivorResult ?? '',
      m.oppKillerStages ?? '', m.oppKillerFresh ?? '',
      m.ourKillerStages ?? '', m.ourKillerFresh ?? '', m.oppGens ?? '',
      P[0]?.name||'', P[0]?.stage||'',
      P[1]?.name||'', P[1]?.stage||'',
      P[2]?.name||'', P[2]?.stage||'',
      P[3]?.name||'', P[3]?.stage||''
    ]);
  });
  download('dbd_matches.csv', toCSV(rows));
});
btnExportJSON.addEventListener('click', ()=> download('dbd_stats.json', JSON.stringify(state,null,2)));

btnClearAll.addEventListener('click', ()=>{
  if(!confirm('Delete ALL teams & matches?')) return;
  state = { teams:[], matches:[] }; saveState(); renderAll();
});

// ---------- Import (JSON / CSV) ----------
fileJSON.addEventListener('change', async (e)=>{
  const f = e.target.files?.[0]; if(!f) return;
  const text = await f.text();
  try{
    const obj = JSON.parse(text);
    const incoming = { teams: Array.isArray(obj.teams)?obj.teams:[], matches: Array.isArray(obj.matches)?obj.matches:[] };

    if (replaceMode.checked){
      state = incoming;
    } else {
      const nameToId = new Map(state.teams.map(t=>[t.name.toLowerCase(), t.id]));
      incoming.teams.forEach(t=>{
        if(!nameToId.has((t.name||'').toLowerCase())){
          const tid = uid('t');
          state.teams.push({ id:tid, name:t.name||`Team ${state.teams.length+1}`, roster:Array.isArray(t.roster)?t.roster.slice():[] });
          nameToId.set((t.name||'').toLowerCase(), tid);
        }
      });
      const sig = m => `${new Date(m.date).toISOString()}|${m.teamName||''}|${m.map||''}|${m.killer||''}|${m.type||''}`;
      const existing = new Set(state.matches.map(sig));
      incoming.matches.forEach(m=>{
        const copy = JSON.parse(JSON.stringify(m));
        if (!copy.id) copy.id = uid('m');
        if (!copy.teamId && copy.teamName){
          const id = nameToId.get((copy.teamName||'').toLowerCase());
          if (id) copy.teamId = id;
        }
        if (!existing.has(sig(copy))) state.matches.push(copy);
      });
    }
    saveState(); renderAll();
    alert('JSON imported successfully.');
  }catch{ alert('Invalid JSON file.'); }
  finally{ fileJSON.value=''; }
});

fileCSV.addEventListener('change', async (e)=>{
  const f = e.target.files?.[0]; if(!f) return;
  const text = await f.text();
  try{
    const rows = parseCSV(text);
    if (!rows.length) throw new Error('Empty CSV');
    const header = rows[0].map(h=>h.trim().toLowerCase());
    const idx = name => header.indexOf(name);

    // required
    ['date','team','map','killer'].forEach(k=>{ if(idx(k)===-1) throw new Error(`Missing column: ${k}`); });

    const col = {
      date: idx('date'),
      team: idx('team'),
      type: idx('type'),
      opp:  idx('opponent'),
      map:  idx('map'),
      killer: idx('killer'),
      killer_player: idx('killer_player'),
      our_gens: idx('our_gens'),
      survRes: idx('survivor_result'),
      oppKS: idx('opp_killer_stages'),
      oppKF: idx('opp_killer_fresh'),
      ourKS: idx('our_killer_stages'),
      ourKF: idx('our_killer_fresh'),
      oppG:  idx('opp_gens'),
      s1n: idx('s1_name'), s1s: idx('s1_stage'),
      s2n: idx('s2_name'), s2s: idx('s2_stage'),
      s3n: idx('s3_name'), s3s: idx('s3_stage'),
      s4n: idx('s4_name'), s4s: idx('s4_stage')
    };

    const nameToId = new Map(state.teams.map(t=>[t.name.toLowerCase(), t.id]));
    if (replaceMode.checked){ state = { teams:[], matches:[] }; }

    for (let r=1;r<rows.length;r++){
      const row = rows[r];
      const teamName = (row[col.team]||'').trim();
      if (!teamName) continue;

      if (!nameToId.has(teamName.toLowerCase())){
        const tid = uid('t'); state.teams.push({ id:tid, name:teamName, roster:[] }); nameToId.set(teamName.toLowerCase(), tid);
      }
      const teamId = nameToId.get(teamName.toLowerCase());

      const players = [];
      [['s1n','s1s'],['s2n','s2s'],['s3n','s3s'],['s4n','s4s']].forEach(([cn,cs])=>{
        const n = (col[cn] >= 0 ? row[col[cn]] : '').trim();
        const s = (col[cs] >= 0 ? row[col[cs]] : '').trim();
        if (n) players.push({ name:n, stage:s||'0' });
      });

      const m = {
        id: uid('m'),
        date: new Date(row[col.date]).toISOString(),
        teamId, teamName,
        type: col.type>=0 ? row[col.type] : '',
        opponent: col.opp>=0 ? row[col.opp] : '',
        map: row[col.map] || '',
        killer: row[col.killer] || '',
        killerPlayer: col.killer_player>=0 ? (row[col.killer_player]||'') : '',
        ourGens: col.our_gens>=0 ? Number(row[col.our_gens]||0) : null,
        survivorResult: col.survRes>=0 ? Number(row[col.survRes]||0) : null,
        oppKillerStages: col.oppKS>=0 ? Number(row[col.oppKS]||0) : null,
        oppKillerFresh:  col.oppKF>=0 ? Number(row[col.oppKF]||0) : null,
        ourKillerStages: col.ourKS>=0 ? Number(row[col.ourKS]||0) : null,
        ourKillerFresh:  col.ourKF>=0 ? Number(row[col.ourKF]||0) : null,
        oppGens: col.oppG>=0 ? Number(row[col.oppG]||0) : null,
        survivors: players.map(p=>p.name),
        players
      };

      const sig = x=> `${x.date}|${x.teamName}|${x.map}|${x.killer}|${x.type}`;
      const exists = state.matches.some(x=>sig(x)===sig(m));
      if(!exists) state.matches.push(m);
    }

    saveState(); renderAll();
    alert('CSV imported successfully.');
  }catch(err){
    console.error(err);
    alert('Invalid CSV format. Ensure headers match export (see new schema).');
  }finally{
    fileCSV.value='';
  }
});

// ---------- Init ----------
function init(){ renderAll(); }
init();
