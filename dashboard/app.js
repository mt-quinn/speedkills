// Speed Kills training dashboard.
const $ = (s, el = document) => el.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(k));
  return e;
};
const api = async (path, body) => {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || r.statusText);
  return j;
};
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const fmt = {
  steps: (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : String(n ?? 0)),
  pct: (x) => (x == null ? '—' : Math.round(x * 100) + '%'),
  elo: (x) => (x == null ? '—' : Math.round(x).toLocaleString()),
  n: (x, d = 1) => (x == null || Number.isNaN(x) ? '—' : Number(x).toFixed(d)),
  dur: (s) => {
    if (s == null) return '—';
    s = Math.max(0, s);
    if (s < 90) return `${Math.round(s)}s`;
    if (s < 5400) return `${Math.round(s / 60)} min`;
    return `${(s / 3600).toFixed(1)} h`;
  },
  ago: (t) => (t ? fmt.dur(Date.now() / 1000 - t) + ' ago' : '—'),
};
const toast = (msg) => {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2600);
};

const S = { runs: [], runId: null, detail: null, metrics: [], gen: null, tab: 'gens', sort: { key: 'gen', dir: -1 }, champion: null, defaults: null, formOpen: null };

// ---------- routing (selection lives in the URL so it survives reloads) ----------
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  return { run: p.get('run'), gen: p.has('gen') ? +p.get('gen') : null };
}
function writeHash() {
  const p = new URLSearchParams();
  if (S.runId) p.set('run', S.runId);
  if (S.gen != null) p.set('gen', S.gen);
  history.replaceState(null, '', '#' + p.toString());
}

// ---------- data ----------
async function refreshRuns() {
  S.runs = await api('/api/runs');
  const ch = await api('/api/champion');
  S.champion = ch.current;
  renderRuns();
  renderChampion();
  if (!S.runId && S.runs.length && !S.formOpen) selectRun(S.runs[0].id);
  if (!S.runs.length && !S.formOpen) showView('empty');
}
async function refreshRun(full = false) {
  if (!S.runId) return;
  const id = S.runId;
  const d = await api(`/api/runs/${id}`);
  if (id !== S.runId) return;
  const newGens = !S.detail || S.detail.gens.length !== d.gens.length;
  S.detail = d;
  const rows = await api(`/api/runs/${id}/metrics?since=${full ? 0 : S.metrics.length}`);
  if (id !== S.runId) return;
  S.metrics = full ? rows : S.metrics.concat(rows);
  if (S.gen == null || (newGens && S.gen === d.gens.length - 2)) S.gen = d.gens.length ? d.gens[d.gens.length - 1].gen : null;
  renderRun();
  if (S.tab === 'log') refreshLog();
}
async function refreshLog() {
  const { lines } = await api(`/api/runs/${S.runId}/log?tail=400`);
  const pre = $('#log');
  const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 20;
  pre.textContent = lines.join('\n') || 'No output yet.';
  if (atBottom) pre.scrollTop = pre.scrollHeight;
}

function selectRun(id, gen = null) {
  if (S.runId !== id) {
    S.runId = id;
    S.detail = null;
    S.metrics = [];
    S.gen = gen;
    destroyCharts();
  } else if (gen != null) S.gen = gen;
  S.formOpen = null;
  showView('run');
  renderRuns();
  writeHash();
  refreshRun(true);
}

function showView(v) {
  $('#empty').hidden = v !== 'empty';
  $('#run').hidden = v !== 'run';
  $('#newRun').hidden = v !== 'new';
}

// ---------- sidebar ----------
function renderRuns() {
  const nav = $('#runs');
  nav.replaceChildren(
    ...S.runs.map((r) => {
      const prog = r.total_steps ? Math.min(1, r.step / r.total_steps) : 0;
      const best = r.best ? `best g${r.best.gen} · ${fmt.elo(r.best.elo)}` : 'no ratings yet';
      return h('button', { class: 'run-item' + (r.id === S.runId ? ' on' : ''), onclick: () => selectRun(r.id) },
        r.parent ? h('div', { class: 'from' }, `↳ from ${r.parent.name ?? r.parent.run} g${r.parent.gen}`) : null,
        h('div', { class: 't' }, h('span', { class: `dot ${r.status}`, title: r.status }), r.name),
        h('div', { class: 'm' }, `${r.gen + 1} gens · ${best}`),
        h('div', { class: 'bar' }, h('i', { style: `width:${prog * 100}%` })),
      );
    }),
  );
}

function renderChampion() {
  const a = $('#champion');
  const c = S.champion;
  a.hidden = !c;
  if (!c) return;
  a.replaceChildren(h('span', {}, '★ Champion'), h('b', {}, `${c.run_name ?? c.run} · g${c.gen}`), h('span', {}, c.rating ? fmt.elo(c.rating.elo) : ''));
  a.onclick = (e) => {
    e.preventDefault();
    selectRun(c.run, c.gen);
  };
}

// ---------- run view ----------
function renderRun() {
  const d = S.detail;
  if (!d) return;
  $('#lineage').replaceChildren(
    ...(d.lineage.length
      ? ['Forked from ', ...d.lineage.flatMap((p, i) => [i ? ' ← ' : '', h('a', { onclick: () => selectRun(p.run, p.gen) }, `${p.name ?? p.run} g${p.gen}`)])]
      : [`Started ${new Date(d.created * 1000).toLocaleString()}`]),
  );
  $('#runName').textContent = d.name;
  const notes = $('#notes');
  if (document.activeElement !== notes) notes.textContent = d.notes || '';
  $('#statusDot').className = `dot ${d.status}`;
  $('#statusText').textContent = d.status;
  const prog = d.total_steps ? d.step / d.total_steps : 0;
  $('#progressFill').style.width = `${Math.min(1, prog) * 100}%`;
  const eta = d.sps && d.status === 'running' ? ` · ${fmt.dur((d.total_steps - d.step) / d.sps)} to go` : '';
  $('#progressText').textContent = `${d.design ? `${d.design} vs ${d.design} · ` : ''}${fmt.steps(d.step)} of ${fmt.steps(d.total_steps)} steps${d.sps ? ` · ${Math.round(d.sps).toLocaleString()} steps/s` : ''}${eta}`;
  const recent = d.gens.slice(-5);
  const noHits = d.gens.length >= 6 && recent.every((g) => !g.hits);
  const err = d.error && ['crashed', 'dead'].includes(d.status) ? d.error : null;
  $('#runError').hidden = !(err || noHits);
  $('#runError').textContent = err || `Warning: no hits landed in the last ${recent.length} generations. The policy isn't learning to shoot; check a replay before spending more compute.`;
  renderControls(d);
  renderStrength(d);
  renderFightStats(d);
  renderTape(d);
  renderGenPanel(d);
  renderTab();
}

function renderControls(d) {
  const c = $('#controls');
  const btns = [];
  const act = async (cmd, msg) => {
    await api(`/api/runs/${d.id}/control`, { command: cmd });
    toast(msg);
    setTimeout(() => refreshRun(), 500);
  };
  if (d.status === 'running') btns.push(h('button', { class: 'ghost', onclick: () => act('pause', 'Pausing after this update…') }, 'Pause'));
  if (d.status === 'paused') btns.push(h('button', { class: 'primary', onclick: () => act('resume', 'Resuming') }, 'Resume'));
  if (['running', 'paused'].includes(d.status)) {
    const stop = h('button', { class: 'danger' }, 'Stop');
    stop.onclick = () => {
      if (stop.dataset.armed) return act('stop', 'Stopping: a final generation will be saved');
      stop.dataset.armed = '1';
      stop.textContent = 'Confirm stop';
      setTimeout(() => { delete stop.dataset.armed; stop.textContent = 'Stop'; }, 3000);
    };
    btns.push(stop);
  }
  if (['stopped', 'finished', 'crashed', 'dead'].includes(d.status)) {
    btns.push(h('button', { class: 'primary', onclick: async () => {
      await api(`/api/runs/${d.id}/resume`, {});
      toast('Continuing from the latest generation');
      setTimeout(() => refreshRun(), 1500);
    } }, 'Continue training'));
  }
  c.replaceChildren(...btns);
}

// ---------- charts ----------
const charts = {};
function destroyCharts() {
  for (const k of Object.keys(charts)) {
    charts[k].destroy();
    delete charts[k];
  }
}
function axisStyle() {
  return { stroke: css('--ink-3'), grid: { stroke: css('--rule'), width: 1 }, ticks: { stroke: css('--rule'), width: 1 }, font: '12px Instrument Sans' };
}
// Hover tooltips for the point(s) under the pointer, placed at each point and pushed apart
// vertically so they never cover each other. Points that truly overlap (within a few pixels) share one
// stacked tooltip. The x label sits in a tag at the top of the hover line.
// Series opt in via `label`, may provide `_fmt(v, i)`, and are skipped with `_skipTip`.
const fmtNum = (v) => (v == null || Number.isNaN(v) ? '—' : Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3));
const TRUE_OVERLAP_PX = 5;
const HOVER_PX = 12; // how close the pointer must be to a point to show its tooltip
const TIP_GAP = 4;
function tooltipPlugin(tipX) {
  let head, pool = [];
  const hideAll = () => { head.hidden = true; pool.forEach((t) => { t.hidden = true; }); };
  return {
    hooks: {
      init: (u) => {
        head = document.createElement('div');
        head.className = 'u-tip-x';
        head.hidden = true;
        u.over.appendChild(head);
        u.over.addEventListener('mouseleave', hideAll);
      },
      setCursor: (u) => {
        const i = u.cursor.idx;
        if (i == null || u.cursor.left < 0) { hideAll(); return; }
        // Only the points actually under the pointer.
        const px = u.valToPos(u.data[0][i], 'x', false);
        const pts = [];
        if (Math.abs(px - u.cursor.left) <= HOVER_PX) {
          u.series.forEach((s, k) => {
            if (k === 0 || !s.show || s._skipTip || !s.label) return;
            const v = u.data[k][i];
            if (v == null || Number.isNaN(v)) return;
            const y = u.valToPos(v, s.scale, false);
            if (Math.abs(y - u.cursor.top) > HOVER_PX) return;
            const color = typeof s.stroke === 'function' ? s.stroke(u, k) : s.stroke;
            const best = s._bestIdx === i ? ' <em class="best">▲ best</em>' : '';
            pts.push({ y, color, label: s.label, text: (s._fmt ? s._fmt(v, i) : fmtNum(v)) + best });
          });
        }
        if (!pts.length) { hideAll(); return; }
        pts.sort((a, b) => a.y - b.y);
        // Group points that genuinely coincide.
        const groups = [];
        for (const p of pts) {
          const g = groups[groups.length - 1];
          if (g && p.y - g.rows[g.rows.length - 1].y < TRUE_OVERLAP_PX) g.rows.push(p);
          else groups.push({ rows: [p] });
        }
        while (pool.length < groups.length) {
          const t = document.createElement('div');
          t.className = 'u-tip';
          u.over.appendChild(t);
          pool.push(t);
        }
        pool.forEach((t, k) => { t.hidden = k >= groups.length; });
        // Fill, measure, then lay out top to bottom without overlaps, keeping inside the plot.
        const H = u.over.clientHeight, Wd = u.over.clientWidth;
        let maxW = 0;
        groups.forEach((g, k) => {
          const t = pool[k];
          t.style.borderLeftColor = g.rows.length === 1 ? g.rows[0].color : 'var(--ink-3)';
          t.innerHTML = g.rows.map((r) => `<div class="r"><i style="background:${r.color}"></i><span>${r.label}</span><b>${r.text}</b></div>`).join('');
          g.h = t.offsetHeight;
          g.top = (g.rows[0].y + g.rows[g.rows.length - 1].y) / 2 - g.h / 2;
          maxW = Math.max(maxW, t.offsetWidth);
        });
        for (let k = 0; k < groups.length; k++) {
          groups[k].top = Math.max(groups[k].top, k ? groups[k - 1].top + groups[k - 1].h + TIP_GAP : 0);
        }
        for (let k = groups.length - 1; k >= 0; k--) {
          const limit = k === groups.length - 1 ? H - groups[k].h : groups[k + 1].top - TIP_GAP - groups[k].h;
          groups[k].top = Math.min(groups[k].top, limit);
        }
        const flip = u.cursor.left + 14 + maxW > Wd;
        groups.forEach((g, k) => {
          const t = pool[k];
          const left = flip ? u.cursor.left - 14 - t.offsetWidth : u.cursor.left + 14;
          t.style.transform = `translate(${left}px, ${g.top}px)`;
          t.classList.toggle('flip', flip);
        });
        head.textContent = tipX(u.data[0][i], i);
        head.hidden = false;
        const hw = head.offsetWidth;
        head.style.transform = `translate(${Math.max(0, Math.min(u.cursor.left - hw / 2, Wd - hw))}px, ${-head.offsetHeight - 4}px)`;
      },
    },
  };
}
// Mark each series' best point (highest, or lowest where `_best: 'min'`) with the accent ▲,
// as on the rating line. The tooltip notes it too.
function markBest(u) {
  const ctx = u.ctx;
  ctx.save();
  ctx.fillStyle = css('--accent');
  ctx.font = `${12 * devicePixelRatio}px Instrument Sans`;
  ctx.textAlign = 'center';
  u.series.forEach((s, k) => {
    s._bestIdx = null;
    if (k === 0 || !s.show || !s._best) return;
    const ys = u.data[k];
    let bi = null;
    for (let i = 0; i < ys.length; i++) {
      const v = ys[i];
      if (v == null || Number.isNaN(v)) continue;
      if (bi == null || (s._best === 'min' ? v < ys[bi] : v > ys[bi])) bi = i;
    }
    if (bi == null) return;
    s._bestIdx = bi;
    const cx = u.valToPos(u.data[0][bi], 'x', true), cy = u.valToPos(ys[bi], s.scale, true);
    ctx.fillText('▲', cx, cy - 8 * devicePixelRatio);
  });
  ctx.restore();
}

const pctFmt = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
const genTip = (x, i) => {
  const g = S.detail?.gens?.[i];
  return g ? `Generation ${g.gen} · ${fmt.steps(g.step)} steps` : `Generation ${x}`;
};

function makeChart(key, el, opts, data) {
  // Charts built while hidden get zero size; wait until visible.
  if (!el.offsetParent || el.clientWidth < 50) return charts[key];
  const width = el.clientWidth;
  const height = el.clientHeight || parseFloat(getComputedStyle(el).height) || 200;
  if (charts[key] && charts[key].root.parentNode === el && charts[key].height > 0) {
    charts[key].setData(data);
    if (Math.abs(charts[key].width - width) > 2) charts[key].setSize({ width, height });
    return charts[key];
  }
  if (charts[key]) charts[key].destroy();
  el.replaceChildren();
  const { tip, ...rest } = opts;
  const plugins = tip ? [tooltipPlugin(tip)] : [];
  charts[key] = new uPlot({ width, height, legend: { show: false }, cursor: { points: { size: 6 } }, plugins, ...rest }, data, el);
  return charts[key];
}
new ResizeObserver(() => {
  for (const c of Object.values(charts)) {
    const w = c.root.parentNode?.clientWidth;
    if (w && Math.abs(c.width - w) > 2) c.setSize({ width: w, height: c.height });
  }
}).observe(document.body);

function renderStrength(d) {
  const gens = d.gens;
  const x = gens.map((g) => g.gen);
  const elo = gens.map((g) => g.rating?.elo ?? null);
  const hi = gens.map((g) => (g.rating ? g.rating.elo + g.rating.sd : null));
  const lo = gens.map((g) => (g.rating ? g.rating.elo - g.rating.sd : null));
  const bot = gens.map((g) => (g.vs_bot == null ? null : g.vs_bot * 100));
  const exc = gens.map((g) => g.excitement ?? null);
  const ax = axisStyle();
  const el = $('#strengthChart');
  const chart = makeChart('strength', el, {
    scales: { x: { time: false }, elo: { auto: true }, pct: { range: [0, 100] } },
    axes: [
      { ...ax, label: 'generation', labelSize: 18, labelFont: '12px Instrument Sans' },
      { ...ax, scale: 'elo', size: 56 },
      { ...ax, scale: 'pct', side: 1, grid: { show: false }, size: 44, values: (u, v) => v.map((t) => t + '%') },
    ],
    series: [
      {},
      { scale: 'elo', stroke: 'transparent', points: { show: false }, _skipTip: true },
      { scale: 'elo', stroke: 'transparent', points: { show: false }, _skipTip: true },
      { label: 'Rating', scale: 'elo', stroke: css('--slate'), width: 2.5, points: { show: true, size: 5, fill: css('--slate') },
        _fmt: (v, i) => { const r = S.detail?.gens?.[i]?.rating; return r ? `${Math.round(r.elo)} ± ${Math.round(r.sd)} (${r.games} games)` : '—'; } },
      { label: 'Win rate vs bots', _best: 'max', scale: 'pct', stroke: css('--moss'), width: 1.5, dash: [5, 4], points: { show: false }, _fmt: (v) => (v == null ? '—' : `${v.toFixed(1)}%`) },
      { label: 'Excitement', _best: 'max', scale: 'pct', stroke: css('--ochre'), width: 1.5, points: { show: false }, _fmt: (v) => (v == null ? '—' : v.toFixed(1)) },
    ],
    tip: genTip,
    bands: [{ series: [1, 2], fill: `color-mix(in oklch, ${css('--slate')} 14%, transparent)` }],
    hooks: {
      ready: [(u) => u.over.addEventListener('click', () => {
        const i = u.cursor.idx;
        if (i != null && S.detail?.gens[i]) selectGen(S.detail.gens[i].gen);
      })],
      draw: [(u) => {
        // Mark the best generation and the champion on the rating line. Reads live data:
        // this hook is created once, with the chart.
        markBest(u);
        const ctx = u.ctx;
        const [x, , , elo] = u.data;
        const d = S.detail;
        if (!d || !x.length) return;
        const best = d.best?.gen;
        const champ = d.champion?.run === d.id ? d.champion.gen : null;
        const mark = (g, ch) => {
          const i = Array.prototype.indexOf.call(x, g);
          if (i < 0 || elo[i] == null) return;
          const cx = u.valToPos(x[i], 'x', true), cy = u.valToPos(elo[i], 'elo', true);
          ctx.save();
          ctx.fillStyle = css('--accent');
          ctx.font = `${14 * devicePixelRatio}px Instrument Sans`;
          ctx.textAlign = 'center';
          ctx.fillText(ch, cx, cy - 10 * devicePixelRatio);
          ctx.restore();
        };
        if (best != null) mark(best, '▲');
        if (champ != null) mark(champ, '★');
        const si = Array.prototype.indexOf.call(x, S.gen);
        if (si >= 0) {
          const cx = u.valToPos(x[si], 'x', true);
          ctx.save();
          ctx.strokeStyle = css('--ink');
          ctx.globalAlpha = 0.35;
          ctx.setLineDash([3 * devicePixelRatio, 3 * devicePixelRatio]);
          ctx.beginPath();
          ctx.moveTo(cx, u.bbox.top);
          ctx.lineTo(cx, u.bbox.top + u.bbox.height);
          ctx.stroke();
          ctx.restore();
        }
      }],
    },
  }, [x, hi, lo, elo, bot, exc]);
}

// Fight stats by generation: the generation panel's numbers, tracked over the run.
const STAT_DEFS = [
  { key: 'hits', label: 'Hits / match', color: '#4cc3ff', f: (g) => g.hits },
  { key: 'bursts', label: 'Fuze bursts / match', color: '#ffb347', f: (g) => g.bursts },
  { key: 'shots', label: 'Shots / match', color: '#8fa6c8', f: (g) => g.shots },
  { key: 'hits_taken', label: 'Hits taken / match', color: '#ff6b4a', best: 'min', f: (g) => g.hits_taken },
  { key: 'near', label: 'Near-misses / match', color: '#e0b24a', f: (g) => g.near_misses },
  { key: 'len', label: 'Match length (min)', color: '#9a8f86', f: (g) => (g.duration == null ? null : g.duration / 60) },
  { key: 'acc', label: 'Accuracy', pct: true, color: '#56b07a', f: (g) => (g.shots ? g.hits / g.shots : null) },
  { key: 'aim', label: 'Aim at the trigger', pct: true, color: '#d4a13a', f: (g) => g.aim_quality },
  { key: 'good', label: 'Good shots', pct: true, color: '#7ab8f5', f: (g) => g.good_shot_rate },
  { key: 'close', label: 'Actual closeness', pct: true, color: '#c77dd6', f: (g) => g.shot_quality },
  { key: 'fuel', label: 'Propellant left', pct: true, color: '#e8e0c8', f: (g) => g.fuel_left },
  { key: 'scoop', label: 'Propellant scooped', pct: true, color: '#6fb6ff', f: (g) => g.fuel_scooped },
  { key: 'kills', label: 'Earned kills', pct: true, color: '#e8553c', f: (g) => g.kill_rate },
];
const statsOn = (() => {
  try { return new Set(JSON.parse(localStorage.getItem('sk-stats') || 'null') || ['hits', 'hits_taken', 'aim', 'good', 'fuel']); }
  catch { return new Set(['hits', 'hits_taken', 'aim', 'good', 'fuel']); }
})();
function renderStatChips() {
  const el = $('#statChips');
  if (el.childElementCount) {
    for (const c of el.children) c.classList.toggle('on', statsOn.has(c.dataset.k));
    return;
  }
  el.replaceChildren(...STAT_DEFS.map((d) => h('button', {
    class: `chip ${d.pct ? 'pct' : ''} ${statsOn.has(d.key) ? 'on' : ''}`, 'data-k': d.key, style: `--c:${d.color}`,
    title: d.pct ? 'percentage (right axis)' : 'per match (left axis)',
    onclick: () => {
      statsOn.has(d.key) ? statsOn.delete(d.key) : statsOn.add(d.key);
      try { localStorage.setItem('sk-stats', JSON.stringify([...statsOn])); } catch {}
      if (charts.stats) { charts.stats.destroy(); delete charts.stats; }
      renderStatChips();
      if (S.detail) renderFightStats(S.detail);
    },
  }, h('i'), d.label)));
}
function renderFightStats(d) {
  renderStatChips();
  const gens = d.gens;
  const x = gens.map((g) => g.gen);
  const shown = STAT_DEFS.filter((s) => statsOn.has(s.key));
  const ax = axisStyle();
  const el = $('#statsChart');
  const key = 'stats';
  const sig = shown.map((s) => s.key).join();
  if (charts[key] && charts[key]._sig !== sig) { charts[key].destroy(); delete charts[key]; }
  const hasPct = shown.some((s) => s.pct), hasCount = shown.some((s) => !s.pct);
  const chart = makeChart(key, el, {
    scales: { x: { time: false }, n: { auto: true, range: (u, lo, hi) => [0, Math.max(1, hi * 1.1)] }, pct: { range: [0, 1] } },
    axes: [
      { ...ax, label: 'generation', labelSize: 18, labelFont: '12px Instrument Sans' },
      { ...ax, scale: 'n', size: 48, show: hasCount || !hasPct },
      { ...ax, scale: 'pct', side: 1, size: 48, grid: { show: !hasCount }, show: hasPct, values: (u, v) => v.map((t) => Math.round(t * 100) + '%') },
    ],
    series: [{}, ...shown.map((s) => ({ label: s.label, _best: s.best || 'max', _fmt: s.pct ? pctFmt : fmtNum, scale: s.pct ? 'pct' : 'n', stroke: s.color, width: 2, dash: s.pct ? [6, 4] : undefined, points: { show: gens.length < 40, size: 4, fill: s.color } }))],
    tip: genTip,
    hooks: {
      ready: [(u) => u.over.addEventListener('click', () => {
        const i = u.cursor.idx;
        if (i != null && S.detail?.gens[i]) selectGen(S.detail.gens[i].gen);
      })],
      draw: [(u) => {
        markBest(u);
        const xs = u.data[0];
        const si = Array.prototype.indexOf.call(xs, S.gen);
        if (si < 0) return;
        const cx = u.valToPos(xs[si], 'x', true);
        const c = u.ctx;
        c.save();
        c.strokeStyle = css('--ink');
        c.globalAlpha = 0.35;
        c.setLineDash([3 * devicePixelRatio, 3 * devicePixelRatio]);
        c.beginPath(); c.moveTo(cx, u.bbox.top); c.lineTo(cx, u.bbox.top + u.bbox.height); c.stroke();
        c.restore();
      }],
    },
  }, [x, ...shown.map((s) => gens.map((g) => { const v = s.f(g); return v == null || Number.isNaN(v) ? null : v; }))]);
  if (chart) chart._sig = sig;
}

// The generation tape: one cell per generation, shaded by rating. The rewind control.
function renderTape(d) {
  const tape = $('#tape');
  const elos = d.gens.map((g) => g.rating?.elo).filter((v) => v != null);
  const lo = Math.min(...elos), hi = Math.max(...elos);
  const champ = d.champion?.run === d.id ? d.champion.gen : null;
  tape.replaceChildren(
    ...d.gens.map((g) => {
      const v = g.rating && hi > lo ? (g.rating.elo - lo) / (hi - lo) : 0.3;
      const marks = [g.gen === champ ? '★' : '', g.gen === d.best?.gen ? '▲' : ''].join('');
      const title = `g${g.gen} · ${fmt.elo(g.rating?.elo)} Elo · ${fmt.pct(g.vs_bot)} vs bots · excitement ${fmt.n(g.excitement, 0)}`;
      return h('button', { class: 'g' + (g.gen === S.gen ? ' sel' : ''), style: `--v:${v.toFixed(3)}`, title, 'aria-label': title, role: 'option', 'aria-selected': g.gen === S.gen ? 'true' : 'false', onclick: () => selectGen(g.gen) }, marks ? h('span', { class: 'mk' }, marks) : null);
    }),
  );
  // The generation being built: live progress through training, then evaluation.
  const pr = d.progress;
  const live = pr && ['running', 'paused'].includes(d.status) && !d.gens.some((g) => g.gen === pr.gen);
  const hint = $('#tapeHint');
  if (live) {
    const frac = pr.total ? Math.min(1, pr.done / pr.total) : 0;
    const evaluating = pr.phase === 'evaluating';
    const label = evaluating
      ? `Generation ${pr.gen}: evaluating, ${pr.done} of ${pr.total} matches played`
      : `Generation ${pr.gen}: training, ${Math.round(frac * 100)}% (${pr.done} of ${pr.total} updates)`;
    tape.append(h('div', { class: `g pending ${evaluating ? 'eval' : ''}`, title: label, 'aria-label': label, role: 'progressbar', 'aria-valuenow': Math.round(frac * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 },
      h('i', { style: `width:${frac * 100}%` })));
    hint.textContent = label + (d.status === 'paused' ? ' (paused)' : '');
    hint.classList.add('live');
  } else {
    hint.textContent = 'Click a generation (or use ← →) to inspect, replay, promote or fork it.';
    hint.classList.remove('live');
  }
  // Keep the selected generation visible by scrolling the tape sideways only (never the page),
  // and only when the selection changes.
  const sel = tape.querySelector('.sel');
  const selKey = `${d.id}/${S.gen}`;
  if (sel && tape.dataset.shown !== selKey) {
    tape.dataset.shown = selKey;
    const left = sel.offsetLeft - tape.offsetLeft, right = left + sel.offsetWidth;
    if (left < tape.scrollLeft) tape.scrollLeft = left - 8;
    else if (right > tape.scrollLeft + tape.clientWidth) tape.scrollLeft = right - tape.clientWidth + 8;
  }
}
$('#tape').addEventListener('keydown', (e) => {
  if (!S.detail) return;
  const gens = S.detail.gens.map((g) => g.gen);
  const i = gens.indexOf(S.gen);
  if (e.key === 'ArrowRight' && i < gens.length - 1) selectGen(gens[i + 1]);
  if (e.key === 'ArrowLeft' && i > 0) selectGen(gens[i - 1]);
  if (e.key === 'End') selectGen(gens[gens.length - 1]);
  if (e.key === 'Home') selectGen(gens[0]);
});

function selectGen(g) {
  S.gen = g;
  S.formOpen = null;
  writeHash();
  renderRun();
}

// ---------- generation panel ----------
const ENDING_COLORS = () => ({
  slug: css('--slate'), ram: css('--ochre'), planet: css('--ink-2'), atmosphere: css('--warn'),
  asteroid: css('--ink-3'), zone: css('--bad'), wall: css('--bad'), decision: css('--rule'), draw: css('--paper-3'),
});
function endingsBar(endings) {
  const tot = Object.values(endings || {}).reduce((a, b) => a + b, 0) || 1;
  const col = ENDING_COLORS();
  return h('span', { class: 'endings', title: Object.entries(endings || {}).map(([k, v]) => `${k} ${v}`).join(' · ') },
    ...Object.entries(endings || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => h('i', { style: `width:${(v / tot) * 100}%;background:${col[k] || css('--ink-3')}` })));
}

function renderGenPanel(d) {
  const p = $('#genPanel');
  const g = d.gens.find((x) => x.gen === S.gen);
  if (!g) {
    p.replaceChildren(h('p', { class: 'panel-empty' }, d.gens.length ? 'Select a generation on the tape.' : 'The first generation is being evaluated…'));
    return;
  }
  if (p.dataset.key === `${d.id}/${g.gen}/${S.formOpen}` && p.dataset.gens == d.gens.length && p.dataset.champ == String(d.champion?.key)) return;
  p.dataset.key = `${d.id}/${g.gen}/${S.formOpen}`;
  p.dataset.gens = d.gens.length;
  p.dataset.champ = String(d.champion?.key);
  const isChamp = d.champion?.key === g.key;
  const isBest = d.best?.gen === g.gen;
  const isLatest = g.gen === d.gens[d.gens.length - 1].gen;
  const acc = g.shots ? g.hits / g.shots : null;

  const replays = (g.replays || []).map((r) => {
    const opp = r.opponent === 'bot' ? 'scripted bot' : `g${r.opponent.split('/g')[1] * 1}`;
    const result = r.winner === 0 ? 'won' : r.winner === 1 ? 'lost' : 'draw';
    const title = `${d.name} · g${g.gen} vs ${opp}`;
    const url = `/viewer/?replay=${encodeURIComponent(`/replays/${g.run || d.id}/${r.file}`)}&title=${encodeURIComponent(title)}`;
    return h('a', { class: 'replay', href: url, target: '_blank', rel: 'noopener' },
      h('span', { class: 'play' }, '▶'),
      h('span', {}, h('div', { class: 'who' }, `vs ${opp}`), h('div', { class: 'res' }, `${r.presets[0]} vs ${r.presets[1]} · ${result} · ${fmt.dur(r.duration)}`)),
      h('span', { class: 'res' }, `★${Math.round(r.excitement)}`),
    );
  });

  const byDesign = Object.entries(g.vs_bot_by_design || {}).map(([k, v]) =>
    h('div', { class: 'row' }, h('span', {}, k), h('span', { class: 'track' }, h('i', { style: `width:${v * 100}%` })), h('b', {}, fmt.pct(v))));

  const actions = h('div', { class: 'actions' });
  if (S.formOpen === 'promote') actions.append(promoteForm(d, g));
  else if (S.formOpen === 'fork') actions.append(forkForm(d, g));
  else {
    actions.append(
      isChamp ? h('button', { class: 'ghost', disabled: true }, '★ This is the champion') :
        h('button', { class: 'primary accent', onclick: () => { S.formOpen = 'promote'; renderGenPanel(d); } }, 'Make this the champion'),
      h('button', { class: 'ghost', onclick: () => { S.formOpen = 'fork'; renderGenPanel(d); } }, 'Fork a new run from here'),
    );
  }

  p.replaceChildren(
    h('h2', {}, `Generation ${g.gen}`),
    h('div', { class: 'tags' },
      isChamp ? h('span', { class: 'tag accent' }, '★ champion') : null,
      isBest ? h('span', { class: 'tag accent' }, '▲ best rated') : null,
      isLatest ? h('span', { class: 'tag' }, 'latest') : null,
      g.inherited ? h('span', { class: 'tag', title: 'Trained in the parent run, before this fork.' }, `from ${g.inherited}`) : null),
    h('p', { class: 'sub' }, `${fmt.steps(g.step)} steps · ${fmt.dur(g.wall)} into the run · ${fmt.ago(g.created)}`),
    h('div', { class: 'kv' },
      h('span', {}, 'Rating'), h('b', { class: 'big' }, fmt.elo(g.rating?.elo)),
      h('span', {}, 'Uncertainty'), h('b', {}, g.rating ? `± ${Math.round(g.rating.sd)} (${g.rating.games} games)` : '—'),
      h('span', {}, 'Win rate vs bots'), h('b', {}, fmt.pct(g.vs_bot)),
      h('span', {}, 'Win rate vs earlier gens'), h('b', {}, fmt.pct(g.vs_league)),
      h('span', {}, 'Earned kills'), h('b', {}, fmt.pct(g.kill_rate)),
      h('span', {}, 'Excitement'), h('b', {}, fmt.n(g.excitement, 0)),
      h('span', {}, 'Match length'), h('b', {}, fmt.dur(g.duration)),
      h('span', {}, 'Hits / shots per match'), h('b', {}, `${fmt.n(g.hits)} / ${fmt.n(g.shots)} (${fmt.pct(acc)})`),
      g.bursts != null ? h('span', {}, 'Of which fuze bursts', h('small', { title: 'Hits include proximity bursts: a round passing within 15 m of the hull bursts for reduced damage.' }, ' ⓘ')) : null,
      g.bursts != null ? h('b', {}, fmt.n(g.bursts)) : null,
      h('span', {}, 'Hits taken per match'), h('b', {}, fmt.n(g.hits_taken)),
      h('span', {}, 'Near-misses / match'), h('b', {}, fmt.n(g.near_misses)),
      h('span', {}, 'Aim at the trigger', h('small', { title: 'Predicted closeness of each shot when fired (0–100%).' }, ' ⓘ')), h('b', {}, fmt.pct(g.aim_quality)),
      h('span', {}, 'Good shots', h('small', { title: 'Share of shots whose predicted pass was within 20 m when fired.' }, ' ⓘ')), h('b', {}, fmt.pct(g.good_shot_rate)),
      h('span', {}, 'Actual closeness', h('small', { title: 'How close shots really came (50 m score; 100% = every shot a hit).' }, ' ⓘ')), h('b', {}, fmt.pct(g.shot_quality)),
      h('span', {}, 'Propellant left'), h('b', {}, fmt.pct(g.fuel_left)),
      g.fuel_scooped != null ? h('span', {}, 'Propellant scooped', h('small', { title: 'Scooped from the air by skipping, per match, in tanks (100% = one full tank).' }, ' ⓘ')) : null,
      g.fuel_scooped != null ? h('b', {}, fmt.pct(g.fuel_scooped)) : null,
    ),
    replays.length ? h('div', { class: 'section-label' }, 'Watch') : null,
    h('div', { class: 'replays' }, ...replays),
    byDesign.length ? h('div', { class: 'section-label' }, 'Vs bots, by own design') : null,
    h('div', { class: 'bars' }, ...byDesign),
    g.damage_by ? h('div', { class: 'section-label' }, 'Where its hull went (per match)') : null,
    g.damage_by ? h('div', { class: 'bars' }, ...Object.entries(g.damage_by).filter(([, x]) => x > 0.5).sort((a, b) => b[1] - a[1]).map(([k, x]) =>
      h('div', { class: 'row' }, h('span', {}, k), h('span', { class: 'track' }, h('i', { style: `width:${Math.min(100, (x / 850) * 100)}%;background:${ENDING_COLORS()[k] || css('--ink-3')}` })), h('b', {}, Math.round(x))))) : null,
    g.root_causes && Object.keys(g.root_causes).length ? h('p', { class: 'meta' }, 'Root cause of its deaths: ' + Object.entries(g.root_causes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')) : null,
    h('div', { class: 'section-label' }, 'How its matches ended'),
    h('div', {}, endingsBar(g.endings), ' ', h('span', { class: 'meta' }, Object.entries(g.endings || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '))),
    actions,
  );
}

function promoteForm(d, g) {
  const note = h('input', { placeholder: 'Why this one? (optional)' });
  return h('div', { class: 'inline-form' },
    h('strong', {}, `Make g${g.gen} the champion?`),
    h('span', { class: 'meta' }, 'Copies its weights to models/champion.pt. The previous champion stays in the history.'),
    h('label', {}, 'Note', note),
    h('div', { class: 'btns' },
      h('button', { class: 'ghost', onclick: () => { S.formOpen = null; renderGenPanel(d); } }, 'Cancel'),
      h('button', { class: 'primary accent', onclick: async () => {
        await api(`/api/runs/${d.id}/promote`, { gen: g.gen, note: note.value });
        S.formOpen = null;
        toast(`g${g.gen} is the champion`);
        await refreshRuns();
        await refreshRun();
      } }, 'Make champion')));
}

function forkForm(d, g) {
  const cfg = d.config || {};
  const name = h('input', { value: `${d.name}-g${g.gen}` });
  const fields = [
    ['lr', 'Learning rate', cfg.lr],
    ['ent_coef', 'Entropy bonus', cfg.ent_coef],
    ['total_steps', 'Total steps', cfg.total_steps],
    ['reward.engage', 'Proximity reward', cfg.reward?.engage],
  ].map(([k, label, v]) => ({ k, input: h('input', { value: v ?? '' }), label }));
  const extra = h('textarea', { placeholder: '{"reward": {"dealt": 1.5}}' });
  return h('div', { class: 'inline-form' },
    h('strong', {}, `Fork from g${g.gen}`),
    h('span', { class: 'meta' }, 'Starts a new run from these weights. Its league inherits every generation up to here.'),
    h('label', {}, 'Name', name),
    h('div', { class: 'row2' }, ...fields.map((f) => h('label', {}, f.label, f.input))),
    h('label', {}, 'Other overrides (JSON)', extra),
    h('div', { class: 'btns' },
      h('button', { class: 'ghost', onclick: () => { S.formOpen = null; renderGenPanel(d); } }, 'Cancel'),
      h('button', { class: 'primary', onclick: async () => {
        let over = {};
        try { over = extra.value.trim() ? JSON.parse(extra.value) : {}; } catch { return toast('Overrides must be valid JSON'); }
        for (const f of fields) {
          const v = parseFloat(f.input.value);
          const cur = f.k.split('.').reduce((o, p) => o?.[p], cfg);
          if (!Number.isNaN(v) && v !== cur) setPath(over, f.k, v);
        }
        const { id } = await api(`/api/runs/${d.id}/fork`, { gen: g.gen, name: name.value, config: over });
        toast('Fork started');
        await refreshRuns();
        selectRun(id);
      } }, 'Start fork')));
}
function setPath(o, path, v) {
  const ps = path.split('.');
  let cur = o;
  for (const p of ps.slice(0, -1)) cur = cur[p] ??= {};
  cur[ps[ps.length - 1]] = v;
}

// ---------- tabs ----------
$('#tabs').addEventListener('click', (e) => {
  const t = e.target.dataset.tab;
  if (!t) return;
  S.tab = t;
  for (const b of $('#tabs').children) b.classList.toggle('on', b.dataset.tab === t);
  for (const k of ['gens', 'health', 'style', 'log']) $(`#tab-${k}`).hidden = k !== t;
  renderTab();
  if (t === 'log') refreshLog();
});

function renderTab() {
  if (S.tab === 'gens') renderGenTable();
  if (S.tab === 'health') renderHealth();
  if (S.tab === 'style') renderStyle();
}

const GEN_COLS = [
  ['gen', 'Gen', (g) => g.gen, (g) => `g${g.gen}`],
  ['step', 'Steps', (g) => g.step, (g) => fmt.steps(g.step)],
  ['elo', 'Rating', (g) => g.rating?.elo ?? -1e9, (g) => (g.rating ? `${fmt.elo(g.rating.elo)} ±${Math.round(g.rating.sd)}` : '—')],
  ['vs_bot', 'vs bots', (g) => g.vs_bot ?? -1, (g) => fmt.pct(g.vs_bot)],
  ['vs_league', 'vs gens', (g) => g.vs_league ?? -1, (g) => fmt.pct(g.vs_league)],
  ['excitement', 'Excitement', (g) => g.excitement ?? -1, (g) => fmt.n(g.excitement, 0)],
  ['duration', 'Length', (g) => g.duration ?? 0, (g) => fmt.dur(g.duration)],
  ['hits', 'Hits', (g) => g.hits ?? -1, (g) => fmt.n(g.hits)],
  ['acc', 'Accuracy', (g) => (g.shots ? g.hits / g.shots : -1), (g) => fmt.pct(g.shots ? g.hits / g.shots : null)],
  ['near', 'Near-misses', (g) => g.near_misses ?? 0, (g) => fmt.n(g.near_misses)],
  ['endings', 'Endings', () => 0, (g) => endingsBar(g.endings)],
];
function renderGenTable() {
  const d = S.detail;
  const el = $('#tab-gens');
  if (!d.gens.length) return el.replaceChildren(h('p', { class: 'panel-empty' }, 'Generations appear here as they are evaluated.'));
  const col = GEN_COLS.find((c) => c[0] === S.sort.key) || GEN_COLS[0];
  const rows = [...d.gens].sort((a, b) => (col[2](a) - col[2](b)) * S.sort.dir);
  const champKey = d.champion?.key;
  el.replaceChildren(h('table', {},
    h('thead', {}, h('tr', {}, ...GEN_COLS.map(([k, label]) => h('th', { class: k === S.sort.key ? 'sorted' : '', onclick: () => {
      S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : -1 };
      renderGenTable();
    } }, label + (k === S.sort.key ? (S.sort.dir < 0 ? ' ↓' : ' ↑') : ''))))),
    h('tbody', {}, ...rows.map((g) => h('tr', {
      class: [g.gen === S.gen ? 'sel' : '', g.gen === d.best?.gen ? 'best' : '', g.key === champKey ? 'champ' : ''].join(' '),
      onclick: () => selectGen(g.gen),
    }, ...GEN_COLS.map((c) => h('td', {}, c[3](g)))))),
  ));
}

function miniGrid(container, specs, xs, xLabel, tipX, best = false) {
  if (container.dataset.built !== specs.map((s) => s.key).join()) {
    container.replaceChildren(...specs.map((s) => h('div', { class: 'mini' }, h('h3', {}, s.title), s.note ? h('p', {}, s.note) : null, h('div', { class: 'c', id: `c-${s.key}` }))));
    container.dataset.built = specs.map((s) => s.key).join();
    for (const s of specs) if (charts[s.key]) { charts[s.key].destroy(); delete charts[s.key]; }
  }
  const ax = axisStyle();
  const pal = [css('--slate'), css('--moss'), css('--ochre'), css('--accent')];
  for (const s of specs) {
    const el = $(`#c-${s.key}`);
    makeChart(s.key, el, {
      scales: { x: { time: false }, y: s.range ? { range: s.range } : { auto: true } },
      axes: [{ ...ax, values: (u, v) => v.map(xLabel) }, { ...ax, size: 48, values: s.pct ? (u, v) => v.map((t) => Math.round(t * 100) + '%') : undefined }],
      series: [{}, ...s.series.map((ser, i) => ({ label: ser.label || s.title, _best: best ? ser.best || 'max' : null, _fmt: s.pct ? pctFmt : fmtNum, stroke: ser.color || pal[i], width: 1.6, points: { show: xs.length < 40 } }))],
      hooks: best ? { draw: [markBest] } : undefined,
      tip: tipX,
    }, [xs, ...s.series.map((ser) => ser.values)]);
  }
}

function smooth(vals, k = 5) {
  const out = [];
  for (let i = 0; i < vals.length; i++) {
    const w = vals.slice(Math.max(0, i - k + 1), i + 1).filter((v) => v != null && Number.isFinite(v));
    out.push(w.length ? w.reduce((a, b) => a + b, 0) / w.length : null);
  }
  return out;
}

function renderHealth() {
  const m = S.metrics;
  const el = $('#tab-health');
  if (!m.length) return el.replaceChildren(h('p', { class: 'panel-empty' }, 'Training metrics appear after the first update.'));
  const xs = m.map((r) => r.step);
  const col = (k) => smooth(m.map((r) => r[k]));
  const win = (k) => smooth(m.map((r) => r.win_rate?.[k] ?? null), 10);
  miniGrid(el, [
    { key: 'h-ret', title: 'Episode return', note: 'Shaped reward per match (learner).', series: [{ values: col('ep_return') }] },
    { key: 'h-win', title: 'Win rate by opponent', note: 'Slate: bots · moss: itself · ochre: past generations.', pct: true, range: [0, 1], series: [{ label: 'vs bots', values: win('bot') }, { label: 'vs itself', values: win('self') }, { label: 'vs past generations', values: win('pool') }] },
    { key: 'h-ent', title: 'Policy entropy', note: 'Falling = committing to a style. Collapsing fast = trouble.', series: [{ values: col('entropy') }] },
    { key: 'h-kl', title: 'Approx. KL & clip fraction', note: 'Update size. Healthy: KL ≲ 0.02.', series: [{ label: 'Approx. KL', values: col('approx_kl') }, { label: 'Clip fraction', values: col('clip_frac') }] },
    { key: 'h-vl', title: 'Value loss', series: [{ values: col('value_loss') }] },
    { key: 'h-ev', title: 'Explained variance', note: 'How well the critic predicts returns (1 = perfect).', series: [{ values: col('explained_var') }] },
    { key: 'h-hits', title: 'Hits & shots per match (training)', note: 'Slate: hits · moss: shots. Hits must leave zero early or nothing is being learned.', series: [{ label: 'Hits', values: col('hits') }, { label: 'Shots', values: col('shots') }] },
    { key: 'h-sq', title: 'Aim at the trigger (training)', note: 'Ochre: predicted closeness of each shot when fired (the rewarded signal) · slate: share of shots predicted within 20 m. This must climb first; hits follow.', pct: true, series: [{ label: 'Aim at the trigger', values: col('aim_quality'), color: css('--ochre') }, { label: 'Good shots', values: col('good_shot_rate') }] },
    { key: 'h-fuel', title: 'Propellant left & scooped', note: 'Slate: left at the end · moss: scooped from the air per match (in tanks).', pct: true, series: [{ label: 'Left at the end', values: col('fuel_left') }, { label: 'Scooped', values: col('fuel_scooped') }] },
    { key: 'h-cur', title: 'Curriculum', note: 'Slate: aiming scaffold · moss: passive-bot share · ochre: bot share · vermilion: orbit-safety scaffold · blue: refuelling scaffold.', series: [{ label: 'Aiming scaffold', values: col('aim_weight') }, { label: 'Passive-bot share', values: col('p_passive') }, { label: 'Bot share', values: col('p_bot') }, { label: 'Orbit-safety scaffold', values: col('safety_weight') }, { label: 'Refuelling scaffold', values: col('scoop_weight'), color: '#6fb6ff' }] },
    { key: 'h-sps', title: 'Throughput', note: 'Learner decisions per second.', series: [{ values: col('sps') }] },
    { key: 'h-time', title: 'Time per update (s)', note: 'Slate: rollout (sim + inference) · moss: PPO update. Watch for creep.', series: [{ label: 'Rollout (s)', values: col('rollout_s') }, { label: 'PPO update (s)', values: col('update_s') }] },
    { key: 'h-exc', title: 'Excitement (training matches)', series: [{ values: col('excitement'), color: css('--ochre') }] },
  ], xs, fmt.steps, (x, i) => {
    const r = S.metrics[i];
    return r ? `Update ${r.update} · ${fmt.steps(r.step)} steps · g${r.gen + 1} in progress` : fmt.steps(x);
  });
}

function renderStyle() {
  const gens = S.detail.gens;
  const el = $('#tab-style');
  if (!gens.length) return el.replaceChildren(h('p', { class: 'panel-empty' }, 'Fight-style trends appear as generations are evaluated.'));
  const xs = gens.map((g) => g.gen);
  const v = (f) => gens.map((g) => { const x = f(g); return x == null || Number.isNaN(x) ? null : x; });
  miniGrid(el, [
    { key: 's-hits', title: 'Hits landed / taken per match', note: 'Slate: landed · moss: taken.', series: [{ label: 'Hits landed', values: v((g) => g.hits) }, { label: 'Hits taken', best: 'min', values: v((g) => g.hits_taken) }] },
    { key: 's-acc', title: 'Aim & accuracy', note: 'Ochre: aim at the trigger · moss: good-shot rate · slate: hits per shot.', pct: true, series: [{ label: 'Hits per shot', values: v((g) => (g.shots ? g.hits / g.shots : null)) }, { label: 'Good shots', values: v((g) => g.good_shot_rate) }, { label: 'Aim at the trigger', values: v((g) => g.aim_quality), color: css('--ochre') }] },
    { key: 's-near', title: 'Near-misses per match', note: 'Dodges and whiskers: the crowd-pleasers.', series: [{ values: v((g) => g.near_misses), color: css('--ochre') }] },
    { key: 's-lead', title: 'Lead changes per match', series: [{ values: v((g) => g.lead_changes) }] },
    { key: 's-len', title: 'Match length & first blood (s)', series: [{ label: 'Match length (s)', values: v((g) => g.duration) }, { label: 'First blood (s)', values: v((g) => g.first_blood) }] },
    { key: 's-close', title: 'Time within 400 m', pct: true, series: [{ values: v((g) => g.close_frac) }] },
    { key: 's-fuel', title: 'Propellant left & scooped', note: 'Slate: left at the end · moss: scooped by skipping, per match (in tanks).', pct: true, series: [{ label: 'Left at the end', values: v((g) => g.fuel_left) }, { label: 'Scooped', values: v((g) => g.fuel_scooped) }] },
    { key: 's-kill', title: 'Earned kills', note: 'Share of evaluation matches won by an earned kill.', pct: true, series: [{ values: v((g) => g.kill_rate), color: css('--accent') }] },
    { key: 's-dec', title: 'Matches going to decision', pct: true, series: [{ values: v((g) => g.decision_rate) }] },
    { key: 's-air', title: 'Atmosphere time (s / match)', note: 'Skips: aerobraking and refuelling.', series: [{ values: v((g) => g.atmo_time) }] },
  ], xs, (t) => `g${t}`, genTip, true);
}

// ---------- notes ----------
$('#notes').addEventListener('blur', async (e) => {
  if (!S.runId) return;
  await api(`/api/runs/${S.runId}/notes`, { notes: e.target.textContent.trim() });
});
$('#notes').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });

// ---------- new run ----------
async function openNewRun() {
  S.defaults ??= await api('/api/defaults');
  const D = S.defaults;
  S.formOpen = 'new';
  const field = (k, label, hint) => {
    const v = k.split('.').reduce((o, p) => o?.[p], D);
    const input = h('input', { value: v, 'data-k': k, inputmode: 'decimal' });
    return h('label', {}, label, input, hint ? h('small', {}, hint) : null);
  };
  const name = h('input', { value: 'run', 'aria-label': 'Run name' });
  const adv = h('textarea', { placeholder: '{"hidden": 384}' });
  const form = $('#newRun');
  form.replaceChildren(
    h('h1', {}, 'New run'),
    h('p', {}, 'One policy learns to fly all three designs against scripted bots, itself, and its past generations. Defaults are a sensible start; every generation is kept, so you can rewind if it goes sideways.'),
    h('div', { class: 'fieldset' }, h('label', {}, 'Name', name)),
    h('h3', { class: 'group-title' }, 'Scale'),
    h('div', { class: 'fieldset' },
      field('total_steps', 'Total steps', 'Learner decisions'),
      field('num_envs', 'Parallel matches'),
      field('gen_every', 'Updates per generation', 'Each generation is evaluated and recorded')),
    h('h3', { class: 'group-title' }, 'Rewards'),
    h('div', { class: 'fieldset' },
      field('reward.kill', 'Kill', 'Full credit when earned'),
      field('reward.death', 'Death', 'Penalty for being destroyed'),
      field('reward.dealt', 'Damage dealt', 'Per fraction of enemy hull'),
      field('reward.taken', 'Damage taken', 'Penalty per fraction of own hull'),
      field('reward.decision', 'Win on points', 'At the bell, on hull'),
      field('reward.stalemate', 'Stalemate', 'Penalty to both if no kill by the bell'),
      field('reward.shot', 'Shot closeness', 'Per round, at the trigger, by its predicted pass'),
      field('reward.shot_radius', 'Tight radius (m)', 'Rewards the last few metres'),
      field('reward.shot_wide', 'Wide radius (m)', 'Gradient from far out'),
      field('reward.engage', 'Proximity', 'Per second at contact, scaling to 0 at the range'),
      field('reward.engage_range', 'Proximity range (m)')),
    h('h3', { class: 'group-title' }, 'Opponents'),
    h('div', { class: 'fieldset' },
      field('opp_bot_start', 'Bots at start', 'Share of matches'),
      field('opp_bot_end', 'Bots later'),
      field('opp_self', 'Self-play share')),
    h('details', {}, h('summary', {}, 'Learning & advanced'),
      h('div', { class: 'fieldset' }, field('lr', 'Learning rate'), field('ent_coef', 'Entropy bonus'), field('gamma', 'Discount'), field('hidden', 'Network width')),
      h('label', {}, 'Other overrides (JSON)', adv)),
    h('div', { class: 'form-btns' },
      h('button', { class: 'primary', onclick: async (e) => {
        e.target.disabled = true;
        let over = {};
        try { over = adv.value.trim() ? JSON.parse(adv.value) : {}; } catch { e.target.disabled = false; return toast('Overrides must be valid JSON'); }
        for (const inp of form.querySelectorAll('input[data-k]')) {
          const k = inp.dataset.k;
          const cur = k.split('.').reduce((o, p) => o?.[p], D);
          const v = parseFloat(inp.value);
          if (!Number.isNaN(v) && v !== cur) setPath(over, k, v);
        }
        try {
          const { id } = await api('/api/runs', { name: name.value || 'run', config: over });
          toast('Training started');
          await refreshRuns();
          selectRun(id);
        } catch (err) {
          e.target.disabled = false;
          toast('Could not start: ' + err.message.slice(0, 120));
        }
      } }, 'Start training'),
      h('button', { class: 'ghost', onclick: () => { S.formOpen = null; if (S.runId) selectRun(S.runId); else showView(S.runs.length ? 'run' : 'empty'); } }, 'Cancel')),
  );
  showView('new');
  name.focus();
  name.select();
}
$('#btnNew').onclick = openNewRun;
$('#btnNewEmpty').onclick = openNewRun;

// ---------- boot ----------
const init = readHash();
if (init.run) {
  S.runId = init.run;
  S.gen = init.gen;
  showView('run');
  refreshRun(true);
}
refreshRuns();
setInterval(() => { refreshRuns().catch(console.error); if (S.formOpen !== "new") refreshRun().catch(console.error); }, 3000);
