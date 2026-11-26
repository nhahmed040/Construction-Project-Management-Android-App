/* Construction schedule logic: task dates, manpower, equipment, cash flow, payments, Gantt rows and
   import from the contractor's schedule workbook (Task / Manpower / Equipment / Cash Flow sheets).
   Pure functions, no DOM access, so it can be tested in Node.

   Tasks are the project's BoQ rows. Per task the project keeps p.sched.tasks[id] = { dur, start, par, mp, eq, split }. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./logic.js'), require('./norms.js'));
  else root.CBSched = factory(root.CBLogic, root.CBNorms);
})(this, function (L, NORMS) {
  'use strict';

  var DAY = 86400000;
  var r2 = L.round2;

  /* ---------- dates and working days ---------- */
  function toDays(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY) : null;
  }
  function fromDays(n) { return new Date(n * DAY).toISOString().slice(0, 10); }
  function dow(n) { return ((n + 4) % 7 + 7) % 7; } // 0 = Sunday (1970-01-01 was a Thursday)
  function offMap(s) {
    var o = {}, h = {}, any = false;
    ((s && s.off) || [0]).forEach(function (d) { o[d] = true; });
    ((s && s.hol) || []).forEach(function (x) {   // holidays and other days nobody works: { from, to, name }
      var a = toDays(x.from), b = toDays(x.to || x.from);
      if (a == null || b == null) return;
      for (var d = a; d <= Math.max(a, b) && d - a < 400; d++) { h[d] = true; any = true; }
    });
    if (any) Object.defineProperty(o, 'h', { value: h, enumerable: false });
    return o;
  }
  function isOff(off, n) { return !!(off[dow(n)] || (off.h && off.h[n])); }
  /* the fixed public holidays of Ethiopia in one Gregorian year (Easter, Eid and other moving days are added by hand) */
  function holidaysEthiopia(y) {
    var leapNext = ((y + 1) % 4 === 0 && ((y + 1) % 100 !== 0 || (y + 1) % 400 === 0)), leap = (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0));
    function d(m, day) { return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day; }
    return [
      { from: d(1, 7), name: 'Genna (Christmas)' }, { from: d(1, leap ? 20 : 19), name: 'Timkat (Epiphany)' }, { from: d(3, 2), name: 'Victory of Adwa' },
      { from: d(5, 1), name: 'International Labour Day' }, { from: d(5, 5), name: 'Patriots\' Victory Day' }, { from: d(5, 28), name: 'Downfall of the Derg' },
      { from: d(9, leapNext ? 12 : 11), name: 'Enkutatash (New Year)' }, { from: d(9, leapNext ? 28 : 27), name: 'Meskel (Finding of the True Cross)' }
    ];
  }
  function nextWork(n, off) { var g = 0; while (isOff(off, n) && g < 400) { n += 1; g += 1; } return n; }
  /* finish day of a task: dur working days from start (a part of a day still uses that day) */
  function finishOf(start, dur, off) {
    var steps = Math.max(1, Math.ceil(dur - 1e-9)), d = nextWork(start, off);
    for (var i = 1; i < steps; i++) d = nextWork(d + 1, off);
    return d;
  }
  function workList(a, b, off) {
    var out = [];
    for (var d = a; d <= b; d++) if (!isOff(off, d)) out.push(d);
    return out.length ? out : [a];
  }
  function workCount(a, b, off) { return workList(a, b, off).length; }

  function prevWork(n, off) { var g = 0; while (isOff(off, n) && g < 400) { n -= 1; g += 1; } return n; }
  /* move n working days from a day (n may be negative or 0) */
  function addWork(d, n, off) {
    if (!n) return nextWork(d, off);
    var step = n > 0 ? 1 : -1, k = Math.abs(n);
    d = step > 0 ? nextWork(d, off) : prevWork(d, off);
    for (var i = 0; i < k; i++) { d += step; d = step > 0 ? nextWork(d, off) : prevWork(d, off); }
    return d;
  }
  function startFromFinish(fin, dur, off) {
    var steps = Math.max(1, Math.ceil(dur - 1e-9)), d = prevWork(fin, off);
    for (var i = 1; i < steps; i++) d = prevWork(d - 1, off);
    return d;
  }
  /* working days from a to b (negative when b is before a) */
  function gapWork(a, b, off) { return b >= a ? workCount(a, b, off) - 1 : -(workCount(b, a, off) - 1); }

  /* ---------- links between tasks ----------
     A task keeps p.sched.tasks[id].pred = [{ id, type: FS|SS|FF|SF, lag }]. Lag is in working days; a negative lag is a lead (overlap).
       FS  successor starts after the predecessor finishes      SS  successor starts after the predecessor starts
       FF  successor finishes after the predecessor finishes     SF  successor finishes after the predecessor starts
     Without a pred list a task follows the BoQ order (after the previous task, or with it when `par`). */
  var LINK_TYPES = ['FS', 'SS', 'FF', 'SF'];
  /* earliest start of the successor that the link allows */
  function linkStart(type, lag, P, dur, off) {
    if (type === 'SS') return addWork(P.sd, lag, off);
    if (type === 'FF') return startFromFinish(addWork(P.fd, lag, off), dur, off);
    if (type === 'SF') return startFromFinish(addWork(P.sd, lag, off), dur, off);
    return addWork(P.fd, 1 + lag, off);
  }
  /* latest finish of the predecessor that the link allows, given the successor's late dates */
  function linkLateFinish(type, lag, S, durP, off) {
    if (type === 'SS') return finishOf(addWork(S.ls, -lag, off), durP, off);
    if (type === 'FF') return addWork(S.lf, -lag, off);
    if (type === 'SF') return finishOf(addWork(S.lf, -lag, off), durP, off);
    return addWork(S.ls, -(1 + lag), off);
  }

  /* ---------- schedule rows (BoQ order) ---------- */
  function levelOf(i) { return i.kind === 'group' ? 0 : i.kind === 'line' ? 1 : 2; }

  function compute(p) {
    var s = p.sched, off = offMap(s), rows = [];
    var projStart = toDays(s.start) != null ? toDays(s.start) : (toDays(p.startDate) != null ? toDays(p.startDate) : toDays(L.todayStr()));
    var byId = {}, prevId = null, curHead = null, lastHead = null, nest = s.nest || {};
    p.boq.forEach(function (i) {
      if (i.kind === 'sum') { curHead = lastHead = null; return; }
      var lvl = levelOf(i), amount = lvl === 2 ? i.qty * i.rate : 0;
      if (lvl < 2) curHead = lastHead = null;
      var row = { id: i.id, level: lvl, kind: i.kind || (amount > 0 ? 'item' : 'plain'), no: i.no || '', desc: i.desc, unit: i.unit || '', qty: i.qty, rate: i.rate, amount: amount, done: i.done || 0, dur: 0, sd: null, fd: null, start: '', finish: '', pct: 0, earned: 0 };
      if (lvl === 2) {
        var t = s.tasks[String(i.id)] || { dur: 0, mp: {}, eq: {} };
        row.task = t; row.dur = t.dur; row.earned = i.done * i.rate;
        row.pct = i.qty > 0 ? Math.min(100, i.done / i.qty * 100) : 0;
        if (t.dur > 0) {
          row.manual = !!t.start; row.sched = true; row.preds = []; row.seq = prevId;
          byId[String(i.id)] = row; prevId = String(i.id);
        }
      }
      // the four levels: group 0, line 1, heading-type item 2, item 3 under a heading (or 2 straight under a line)
      row.depth = lvl;
      if (lvl === 2) {
        if (L.isHeading(i)) { row.head = true; row.children = []; row.depth = 2; curHead = lastHead = row; }
        else {
          var nv = nest[String(i.id)], par = nv === 'in' ? lastHead : nv === 'out' ? null : (curHead && (!i.no || /^[a-z]\s?[.)]?$/.test(String(i.no).trim())) ? curHead : null);
          if (par) { row.parent = par.id; row.depth = 3; par.children.push(row); }
          else if (nv !== 'in') curHead = null;
        }
      }
      rows.push(row);
    });
    rows.forEach(function (r, k) { r.n = k + 1; });   // the task ID: the row number, as in MS Project
    var ids = Object.keys(byId);
    // the links of every scheduled task (explicit list, or the BoQ order)
    ids.forEach(function (id) {
      var r = byId[id], t = r.task;
      if (Array.isArray(t.pred)) {
        t.pred.forEach(function (q) {
          var pid = String(q.id);
          if (pid !== id && byId[pid] && !r.preds.some(function (x) { return x.id === pid && x.type === q.type; })) r.preds.push({ id: pid, type: q.type, lag: q.lag || 0 });
        });
        r.explicit = true;
      } else if (r.seq != null && !r.manual) {
        r.preds.push({ id: r.seq, type: t.par ? 'SS' : 'FS', lag: 0, implicit: true });
      }
    });
    // order the tasks so every predecessor comes first; a link that would close a loop is dropped
    var state = {}, order = [];
    function visit(id) {
      state[id] = 1;
      var r = byId[id];
      r.preds = r.preds.filter(function (q) {
        if (state[q.id] === 1) { r.cycle = true; return false; }
        if (!state[q.id]) visit(q.id);
        return true;
      });
      state[id] = 2; order.push(id);
    }
    ids.forEach(function (id) { if (!state[id]) visit(id); });
    // forward pass
    order.forEach(function (id) {
      var r = byId[id], t = r.task, d = t.dur, wanted = null;
      r.preds.forEach(function (q) {
        var st = linkStart(q.type, q.lag, byId[q.id], d, off);
        wanted = wanted == null ? st : Math.max(wanted, st);
      });
      var st;
      if (r.manual) {
        st = nextWork(toDays(t.start), off);
        if (r.explicit && wanted != null && wanted > st) r.conflict = gapWork(st, wanted, off);
      } else {
        st = wanted != null ? wanted : projStart;
        if (t.snet && toDays(t.snet) != null) st = Math.max(st, toDays(t.snet));
        st = nextWork(st, off);
        if (t.delay > 0) st = addWork(st, Math.round(t.delay), off);
      }
      r.sd = st; r.fd = finishOf(st, d, off);
      r.start = fromDays(r.sd); r.finish = fromDays(r.fd);
    });
    // backward pass: late dates, total float and the critical path
    var projFin = null;
    ids.forEach(function (id) { projFin = projFin == null ? byId[id].fd : Math.max(projFin, byId[id].fd); });
    var succ = {};
    ids.forEach(function (id) { succ[id] = []; });
    ids.forEach(function (id) { byId[id].preds.forEach(function (q) { succ[q.id].push({ id: id, type: q.type, lag: q.lag }); }); });
    for (var k = order.length - 1; k >= 0; k--) {
      var r2 = byId[order[k]], lf = projFin;
      succ[order[k]].forEach(function (e) { lf = Math.min(lf, linkLateFinish(e.type, e.lag, byId[e.id], r2.task.dur, off)); });
      r2.lf = lf; r2.ls = startFromFinish(lf, r2.task.dur, off);
      r2.tf = gapWork(r2.sd, r2.ls, off);
      r2.critical = r2.tf <= 0;
      var ff = gapWork(r2.fd, projFin, off);
      succ[order[k]].forEach(function (e) {
        var S2 = byId[e.id], need = linkStart(e.type, e.lag, r2, S2.task.dur, off);
        ff = Math.min(ff, gapWork(need, S2.sd, off));
      });
      r2.ff = Math.max(0, ff);
      r2.lateStart = fromDays(r2.ls); r2.lateFinish = fromDays(r2.lf);
    }
    // headings take the range, value and progress of what is under them
    rows.forEach(function (h, k) {
      if (h.level === 2) return;
      var amt = 0, earned = 0, lo = null, hi = null, crit = false, tf = null;
      for (var j = k + 1; j < rows.length && rows[j].level > h.level; j++) {
        var r = rows[j];
        if (r.level !== 2) continue;
        if (!r.head) { amt += r.amount; earned += r.earned; }
        if (r.sd != null) {
          lo = lo == null ? r.sd : Math.min(lo, r.sd); hi = hi == null ? r.fd : Math.max(hi, r.fd);
          if (r.critical) crit = true;
          tf = tf == null ? r.tf : Math.min(tf, r.tf);
        }
      }
      h.amount = amt; h.earned = earned; h.pct = amt > 0 ? Math.min(100, earned / amt * 100) : 0;
      if (lo != null) { h.sd = lo; h.fd = hi; h.start = fromDays(lo); h.finish = fromDays(hi); h.dur = workCount(lo, hi, off); h.critical = crit; h.tf = tf; }
    });
    rows.forEach(function (h) {   // heading-type items: the range, value and progress of their own sub-items
      if (!h.head) return;
      var amt = 0, earned = 0, lo = null, hi = null, crit = false, tf = null;
      h.children.forEach(function (r) {
        amt += r.amount; earned += r.earned;
        if (r.sd != null) { lo = lo == null ? r.sd : Math.min(lo, r.sd); hi = hi == null ? r.fd : Math.max(hi, r.fd); if (r.critical) crit = true; tf = tf == null ? r.tf : Math.min(tf, r.tf); }
      });
      h.sumAmount = amt; h.sumEarned = earned; h.pct = amt > 0 ? Math.min(100, earned / amt * 100) : 0;
      if (lo != null) { h.sd = lo; h.fd = hi; h.start = fromDays(lo); h.finish = fromDays(hi); h.dur = workCount(lo, hi, off); h.critical = crit; h.tf = tf; }
    });
    var lo2 = null, hi2 = null, n = 0;
    rows.forEach(function (r) {
      if (r.level === 2 && !r.head && r.sd != null) { n += 1; lo2 = lo2 == null ? r.sd : Math.min(lo2, r.sd); hi2 = hi2 == null ? r.fd : Math.max(hi2, r.fd); }
    });
    var total = 0, earnedAll = 0, critical = [], conflicts = [], cycles = [];
    rows.forEach(function (r) {
      if (r.level !== 2) return;
      total += r.amount; earnedAll += r.earned;
      if (r.sched && r.critical) critical.push(r.id);
      if (r.conflict) conflicts.push(r.id);
      if (r.cycle) cycles.push(r.id);
    });
    critical.sort(function (a, b) { return byId[String(a)].sd - byId[String(b)].sd || byId[String(a)].fd - byId[String(b)].fd; });
    return {
      rows: rows, off: off, count: n, sd: lo2, fd: hi2,
      start: lo2 == null ? '' : fromDays(lo2), finish: hi2 == null ? '' : fromDays(hi2),
      workDays: lo2 == null ? 0 : workCount(lo2, hi2, off), calDays: lo2 == null ? 0 : hi2 - lo2 + 1,
      total: total, earned: earnedAll, pct: total > 0 ? earnedAll / total * 100 : 0,
      critical: critical, conflicts: conflicts, cycles: cycles, byId: byId,
      byN: rows.reduce(function (m, r) { m[r.n] = r; return m; }, {})
    };
  }

  /* the tasks that follow each task: { id: [{ id, type, lag }] } (the mirror of the predecessors) */
  function successors(sc) {
    var out = {};
    sc.rows.forEach(function (r) {
      if (!r.sched) return;
      r.preds.forEach(function (q) { (out[q.id] = out[q.id] || []).push({ id: String(r.id), type: q.type, lag: q.lag || 0, implicit: !!q.implicit }); });
    });
    return out;
  }

  /* put an item under the heading-type item above it ('in'), or take it out ('out'); '' returns to the automatic rule */
  function setNest(p, id, mode) {
    var s = p.sched; s.nest = s.nest || {};
    if (mode === 'in' || mode === 'out') s.nest[String(id)] = mode; else delete s.nest[String(id)];
  }

  /* "3, 5SS+2, 7FF-1" <-> links. Numbers are task IDs (row numbers). Returns { list, error } with the task ids stored internally. */
  function parseLinks(text, sc, selfId) {
    var out = [], bad = null;
    String(text || '').split(/[,;]+/).forEach(function (part) {
      part = part.trim();
      if (!part || bad) return;
      var m = /^(\d+)\s*(FS|SS|FF|SF)?\s*([+-]\s*\d+(?:\.\d+)?)?\s*d?$/i.exec(part);
      if (!m) { bad = { part: part, why: 'format' }; return; }
      var row = sc.byN[+m[1]];
      if (!row || !row.sched) { bad = { part: part, why: 'task' }; return; }
      if (String(row.id) === String(selfId)) { bad = { part: part, why: 'self' }; return; }
      var ty = (m[2] || 'FS').toUpperCase();
      if (out.some(function (q) { return q.id === String(row.id) && q.type === ty; })) { bad = { part: part, why: 'twice' }; return; }
      out.push({ id: String(row.id), type: (m[2] || 'FS').toUpperCase(), lag: Math.round(Number((m[3] || '0').replace(/\s+/g, '')) || 0) });
    });
    return { list: out, error: bad };
  }
  function formatLinks(list, sc) {
    return (list || []).map(function (q) {
      var r = sc.byId[String(q.id)];
      return (r ? r.n : '?') + (q.type !== 'FS' || q.lag ? q.type : '') + (q.lag ? (q.lag > 0 ? '+' : '') + q.lag : '');
    }).join(', ');
  }

  /* What generate would do, worked out on a copy: nothing is changed. Returns the rows to show and a summary. */
  function preview(p, opts) {
    var copy = JSON.parse(JSON.stringify(p)), before = compute(p), was = {};
    before.rows.forEach(function (r) { if (r.level === 2) was[String(r.id)] = (r.dur || 0) + '|' + (r.start || '') + '|' + formatLinks(r.sched ? r.preds : (r.task && r.task.pred) || [], before); });
    var res = generate(copy, opts), sc = compute(copy), rows = [], typeOf = {}, keptWhy = {};
    (res.plan || []).forEach(function (x) { typeOf[String(x.id)] = x; });
    (res.keptList || []).forEach(function (x) { keptWhy[String(x.id)] = x.why; });
    var changed = 0, manDays = 0, byKey = function (iso) { return iso.slice(0, 7); };
    sc.rows.forEach(function (r) {
      if (r.level !== 2) return;
      var key = String(r.id), x = typeOf[key], tk = copy.sched.tasks[key] || {};
      var crew = Object.keys(tk.mp || {}).map(function (rid) {
        var role = copy.sched.roles.filter(function (q) { return String(q.id) === rid; })[0];
        return role ? role.name + ' ' + tk.mp[rid] : '';
      }).filter(Boolean);
      var row = { id: r.id, n: r.n, no: r.no, desc: r.desc, unit: r.unit, qty: r.qty, planned: !!x, kept: keptWhy[key] || '', type: x ? x.type : (tk.tpl || ''), label: x ? x.label : '',
        matched: x ? x.matched : true, per: x ? x.per : 0, gangs: tk.gangs || 0, dur: r.dur, start: r.start, finish: r.finish, crew: crew,
        links: formatLinks(r.sched ? r.preds : tk.pred || [], sc), split: tk.split || null };
      if (x && was[key] !== (r.dur || 0) + '|' + (r.start || '') + '|' + formatLinks(r.sched ? r.preds : tk.pred || [], sc)) changed += 1;
      rows.push(row);
    });
    var mp = manpower(copy, sc, byKey);
    return { rows: rows, finish: sc.finish, start: sc.start, workDays: sc.workDays, critical: sc.critical.length, count: sc.count, manDays: mp.totalDays, peak: mp.peak,
      tasks: res.tasks || 0, matched: res.matched || 0, general: res.general || 0, kept: res.kept || 0, mult: res.mult || 1, fits: res.fits, end: res.end || '', strategy: res.strategy || 'boq', changed: changed };
  }

  /* Would linking `id` after `predId` close a loop? (used by the editor) */
  function wouldLoop(p, id, predId) {
    var seen = {};
    function reaches(from, target) {   // does `from` depend (directly or not) on `target`?
      if (from === target) return true;
      if (seen[from]) return false;
      seen[from] = true;
      var t = p.sched.tasks[from];
      return !!(t && Array.isArray(t.pred) && t.pred.some(function (q) { return reaches(String(q.id), target); }));
    }
    return reaches(String(predId), String(id));
  }

  /* Delays: tasks that should have finished (or started) by `asOf` but have not are pushed on: a started task gets the
     time it still needs from that day, a task that has not started cannot start before that day. Every task linked after
     them moves by itself; tasks with a manually fixed date are left where they are and reported. */
  function reschedule(p, asOfIso, apply) {
    var asOf = toDays(asOfIso), res = { extended: [], delayed: [], preserved: [] };
    if (asOf == null) return res;
    var sc = compute(p), off = sc.off;
    sc.rows.forEach(function (r) {
      if (r.level !== 2 || !r.sched || !(r.qty > 0) || r.pct >= 100 || r.sd >= asOf) return;
      var t = r.task, startedPct = r.pct > 0;
      var late = r.fd < asOf || (!startedPct && r.sd < asOf);
      if (!late) return;
      if (r.manual) { res.preserved.push(r.id); return; }
      if (startedPct) {
        var elapsed = workCount(r.sd, prevWork(asOf - 1, off), off);
        var nd = Math.round((elapsed + Math.max(0.25, r.dur * (1 - r.pct / 100))) * 4) / 4;
        if (nd > r.dur) { res.extended.push({ id: r.id, from: r.dur, to: nd }); if (apply) t.dur = nd; }
      } else {
        var sn = fromDays(nextWork(asOf, off));
        if (t.snet !== sn) { res.delayed.push({ id: r.id, from: r.start, to: sn }); if (apply) t.snet = sn; }
      }
    });
    return res;
  }

  /* Spread the project's working days over the priced tasks by value (a quick first plan). */
  function autoDurations(p) {
    var s = p.sched, off = offMap(s), a = toDays(s.start || p.startDate), b = toDays(p.endDate);
    var days = a != null && b != null && b >= a ? workCount(a, b, off) : 60;
    var items = p.boq.filter(function (i) { return L.isItemRow(i) && !L.isHeading(i); });
    var total = items.reduce(function (x, i) { return x + i.qty * i.rate; }, 0);
    if (!items.length || total <= 0) return 0;
    items.forEach(function (i) {
      var t = s.tasks[String(i.id)] || (s.tasks[String(i.id)] = { dur: 0, start: '', par: false, mp: {}, eq: {} });
      t.dur = Math.max(0.5, Math.round(days * (i.qty * i.rate) / total * 2) / 2);
      t.start = ''; t.par = false;
    });
    return items.length;
  }

  /* ---------- manpower and equipment ---------- */
  function monthDefault(iso) { return iso.slice(0, 7); }
  function usage(p, sc, list, field, keyFn, permanent) {
    keyFn = keyFn || monthDefault;
    var off = sc.off, byId = {}, daily = {}, months = {}, order = [];
    list.forEach(function (r) { byId[r.id] = { item: r, peak: 0, days: 0, months: {}, perDay: {} }; });
    sc.rows.forEach(function (row) {
      if (row.level !== 2 || row.sd == null) return;
      var t = row.task, days = workList(row.sd, row.fd, off), w = Math.min(1, row.dur / days.length);
      Object.keys(t[field] || {}).forEach(function (k) {
        var u = byId[k], n = t[field][k];
        if (!u) return;
        days.forEach(function (d) {
          u.perDay[d] = (u.perDay[d] || 0) + n;
          daily[d] = (daily[d] || 0) + n;
          var mk = keyFn(fromDays(d));
          u.months[mk] = (u.months[mk] || 0) + n * w;
          months[mk] = true;
        });
        u.days += n * row.dur;
      });
    });
    var span = sc.sd == null ? [] : workList(sc.sd, sc.fd, off);
    var allMonths = {};
    span.forEach(function (d) { allMonths[keyFn(fromDays(d))] = true; });
    Object.keys(months).forEach(function (m) { allMonths[m] = true; });
    order = Object.keys(allMonths).sort();
    var out = list.map(function (r) {
      var u = byId[r.id], peak = 0;
      Object.keys(u.perDay).forEach(function (d) { if (u.perDay[d] > peak) peak = u.perDay[d]; });
      var res = { item: r, peak: peak, days: r2(u.days), months: {}, always: false };
      Object.keys(u.months).forEach(function (m) { res.months[m] = r2(u.months[m]); });
      if (permanent && r.type === 'permanent') {   // permanent staff are on site for the whole project
        res.always = true; res.peak = r.count; res.days = r2(r.count * span.length);
        order.forEach(function (m) {
          var c = span.filter(function (d) { return keyFn(fromDays(d)) === m; }).length;
          res.months[m] = r2(r.count * c);
        });
      }
      return res;
    });
    var hist = Object.keys(daily).map(Number).sort(function (a, b) { return a - b; }).map(function (d) { return { day: d, date: fromDays(d), n: daily[d] }; });
    return { rows: out, months: order, hist: hist, totalDays: r2(out.reduce(function (x, r) { return x + r.days; }, 0)), peak: hist.reduce(function (m, h) { return Math.max(m, h.n); }, 0) };
  }
  function manpower(p, sc, keyFn) { return usage(p, sc, p.sched.roles, 'mp', keyFn, true); }
  function equipment(p, sc, keyFn) { return usage(p, sc, p.sched.equip, 'eq', keyFn, false); }

  /* ---------- cash flow ---------- */
  /* Direct cost shares (material / labour / equipment), as parts of the 83 that is left after miscellaneous, overhead and
     profit (2 + 7.5 + 7.5). Applied to another pool they are scaled to fit it. Withholding tax is not a cost share: it is
     taken off each payment (p.wht). */
  var PRESETS = {
    general: [65, 15, 3], earth_mach: [3, 15, 65], earth_lab: [3, 65, 15],
    backfill: [40, 20, 23], mobil: [5, 18, 60], hardcore: [40, 28, 15], lean: [62, 15, 6], concrete: [60, 15, 8], rebar: [72, 9, 2], formwork: [38, 40, 5],
    hcb: [62, 18, 3], plaster: [45, 35, 3], roof: [66, 14, 3], tile: [62, 18, 3], carp: [63, 16, 4], plumb: [70, 10, 3], elec: [69, 11, 3]
  };
  /* the preset the BoQ generator gives each type of work (tasks you set by hand are never touched) */
  var TPL_PRESET = { mobil: 'mobil', hardcore: 'hardcore', lean: 'lean', concrete: 'concrete', rebar: 'rebar', formwork: 'formwork', hcb: 'hcb', masonry: 'hcb',
    plaster: 'plaster', pointing: 'plaster', paint: 'plaster', roof: 'roof', tile: 'tile', carp: 'carp', metal: 'carp', glaze: 'carp', plumb: 'plumb', elec: 'elec' };

  function indirectPct(cf) { return r2(cf.misc + cf.overhead + cf.profit); }
  function poolOf(cf) { return Math.max(0, r2(100 - indirectPct(cf))); }
  /* scale three shares so that they add up to the pool */
  function fitSplit(sp, pool) {
    var sum = sp[0] + sp[1] + sp[2];
    if (!(sum > 0)) return [pool, 0, 0];
    var m = r2(sp[0] * pool / sum), l = r2(sp[1] * pool / sum);
    return [m, l, r2(pool - m - l)];
  }
  function presetList(cf) {
    var out = Object.keys(PRESETS).map(function (k) { return { id: k, split: PRESETS[k] }; });
    (cf.presets || []).forEach(function (q, i) { out.push({ id: 'u' + i, name: q.name, split: q.split }); });
    return out;
  }
  function presetSplit(cf, id) {
    if (PRESETS[id]) return fitSplit(PRESETS[id], poolOf(cf));
    var m = /^u(\d+)$/.exec(id || ''), q = m && cf.presets && cf.presets[+m[1]];
    return q ? fitSplit(q.split, poolOf(cf)) : null;
  }
  function splitOf(p, id) {
    var cf = p.sched.cf, t = p.sched.tasks[String(id)], pool = poolOf(cf);
    var sp = t && t.split ? t.split : cf.defSplit;
    var m = sp[0], l = sp[1], e = sp.length > 2 ? sp[2] : pool - m - l;
    return { mat: m, lab: l, eq: Math.max(0, r2(e)), pool: pool, over: Math.abs(m + l + e - pool) > 0.01 || e < -0.005, custom: !!(t && t.split) };
  }

  function cashflow(p) {
    var cf = p.sched.cf, vat = p.vat, wht = p.wht || 0, rows = [];
    var tot = { amount: 0, mat: 0, lab: 0, eq: 0, misc: 0, oh: 0, profit: 0, wht: 0, vat: 0 };
    p.boq.forEach(function (i) {
      if (!L.isItemRow(i) || L.isHeading(i)) return;
      var a = i.qty * i.rate, sp = splitOf(p, i.id);
      var r = { id: i.id, no: i.no, desc: i.desc, unit: i.unit, qty: i.qty, rate: i.rate, amount: a, split: sp,
        mat: a * sp.mat / 100, lab: a * sp.lab / 100, eq: a * sp.eq / 100,
        misc: a * cf.misc / 100, oh: a * cf.overhead / 100, profit: a * cf.profit / 100, wht: a * wht / 100, vat: a * vat / 100 };
      Object.keys(tot).forEach(function (k) { tot[k] += r[k]; });
      rows.push(r);
    });
    var direct = tot.mat + tot.lab + tot.eq, indirect = tot.misc + tot.oh + tot.profit;
    var shares = {};
    ['mat', 'lab', 'eq', 'misc', 'oh', 'profit'].forEach(function (k) { shares[k] = tot.amount > 0 ? tot[k] / tot.amount : 0; });
    return { rows: rows, totals: tot, direct: direct, indirect: indirect, shares: shares, withVat: tot.amount + tot.vat, whtPct: wht,
      net: tot.amount + tot.vat - tot.wht, vatPct: vat };
  }

  /* value of work planned up to and including day dayN (linear over each task's working days) */
  function earnedBy(sc, dayN) {
    var v = 0;
    sc.rows.forEach(function (row) {
      if (row.level !== 2 || !(row.amount > 0)) return;
      if (row.sd == null) { if (sc.fd != null && dayN >= sc.fd) v += row.amount; return; }
      if (dayN >= row.fd) v += row.amount;
      else if (dayN >= row.sd) v += row.amount * workCount(row.sd, dayN, sc.off) / workCount(row.sd, row.fd, sc.off);
    });
    return v;
  }
  function ordinal(n) { return n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'); }

  function payments(p, sc) {
    sc = sc || compute(p);
    var cfw = cashflow(p), cf = p.sched.cf, total = cfw.totals.amount;
    var adv = total * cf.advPct / 100, list = [];
    var cuts = cf.cuts.slice();
    if (sc.sd != null) {
      if (!cuts.length) for (var k = 1; k <= cf.interim; k++) cuts.push(fromDays(sc.sd + Math.round((sc.fd - sc.sd) * k / (cf.interim + 1))));
    } else cuts = [];
    function add(name, kind, date, amount) {
      var x = { name: name, kind: kind, date: date, amount: amount, vat: amount * p.vat / 100, wht: amount * (p.wht || 0) / 100 };
      x.total = x.amount + x.vat; x.net = x.total - x.wht;
      ['mat', 'lab', 'eq', 'misc', 'oh', 'profit'].forEach(function (c) { x[c] = amount * cfw.shares[c]; });
      list.push(x);
    }
    if (adv > 0) add('Advance payment', 'adv', sc.start || p.startDate || '', adv);
    var prevE = 0, used = adv, factor = 1 - cf.advPct / 100;
    cuts.forEach(function (d, i) {
      var e = earnedBy(sc, toDays(d)), amt = Math.max(0, (e - prevE) * factor);
      add(ordinal(i + 1) + ' payment', 'interim', d, amt);
      prevE = e; used += amt;
    });
    add(sc.sd == null && !cuts.length ? 'Payment' : 'Final payment', 'final', sc.finish || '', Math.max(0, total - used));
    var cum = 0;
    list.forEach(function (x) { cum += x.amount; x.cum = cum; x.cumPct = total > 0 ? cum / total * 100 : 0; });
    return { list: list, cuts: cuts, total: total, totals: sumPayments(list), shares: cfw.shares, cf: cfw };
  }
  function sumPayments(list) {
    var t = { amount: 0, vat: 0, total: 0, net: 0, mat: 0, lab: 0, eq: 0, misc: 0, oh: 0, profit: 0, wht: 0 };
    list.forEach(function (x) { Object.keys(t).forEach(function (k) { t[k] += x[k]; }); });
    return t;
  }

  /* planned value per month (for the S-curve table) */
  function monthlyValue(p, sc, keyFn) {
    keyFn = keyFn || monthDefault;
    if (sc.sd == null) return [];
    var months = {}, order = [];
    for (var d = sc.sd; d <= sc.fd; d++) {
      var k = keyFn(fromDays(d));
      if (!months[k]) { months[k] = { key: k, last: d }; order.push(k); }
      months[k].last = d;
    }
    var prev = 0, total = sc.total || 1;
    return order.map(function (k) {
      var e = earnedBy(sc, months[k].last), r = { key: k, value: e - prev, cum: e, pct: e / total * 100 };
      prev = e;
      return r;
    });
  }

  /* ---------- generate the schedule from the BoQ ----------
     Every priced BoQ item is matched (by its description and unit) to a type of work. A type knows the output of a
     standard crew per working day, the crew, the equipment and the material / labour share of the price. The duration is
     quantity / output. The output figures follow the Badesa Corridor schedule workbook and are only a starting point:
     tap any task to change what the app proposed. */
  var STD_ROLES = [
    ['Project Manager', 'permanent'], ['Store Keeper', 'permanent'], ['Surveyor', 'permanent'], ['Foreman', 'permanent'], ['Accountant', 'permanent'], ['Cashier', 'permanent'],
    ['Daily Labour', 'temporary'], ['Mason', 'temporary'], ['Carpenter', 'temporary'], ['Helper', 'temporary'], ['Plasterer', 'temporary'], ['Bar Bender', 'temporary'], ['Tiler', 'temporary'],
    ['Chiseler', 'temporary'], ['Welder', 'temporary'], ['Painter', 'temporary'], ['Glazier', 'temporary'], ['Electrician', 'temporary'], ['Plumber', 'temporary'],
    ['Mixer Operator', 'temporary'], ['Vibrator Operator', 'temporary'], ['Compactor Operator', 'temporary'], ['Truck Driver', 'temporary'], ['Backhoe Loader Operator', 'temporary'], ['Loader Operator', 'temporary'], ['Excavator Operator', 'temporary'], ['Pick Up Driver', 'temporary']
  ];
  var STD_EQUIP = [
    ['Concrete Mixer', 'Rental'], ['Vibrator', 'Rental'], ['Plate Compactor', 'Rental'], ['Pick Up Vehicle', 'Rental'], ['Dump Truck', 'Rental'], ['Backhoe Loader', 'Rental'],
    ['Generator', 'Rental'], ['Welding Machine', 'Rental'], ['Grinder', 'Rental'], ['Driller', 'Rental'], ['Excavator', 'Rental'], ['Loader', 'Rental'], ['Water Tanker', 'Own'], ['Other Tools', 'Own']
  ];
  var LAB = 'Daily Labour', FM = 'Foreman';
  /* per: output per crew-day (a number, or { def, 'M³': n, ... } by unit). units: only for these units. Order matters: first match wins. */
  var TEMPLATES = [
    { id: 'clear', label: 'Site clearing / topsoil', re: /clear(ing)? (off |away |of )?(the )?(site|shrub|bush|vegetation)|site clearing|removing of the top|shrubs|organic soil|top\s?soil|grub(bing)?|strip(ping)? (the )?(site|top)/, units: ['M²', 'M³', 'LS'], per: { def: 300, 'M³': 60 }, crew: { Surveyor: 1, Foreman: 1, 'Daily Labour': 6, 'Backhoe Loader Operator': 1, 'Pick Up Driver': 1 }, eq: { 'Backhoe Loader': 1, 'Pick Up Vehicle': 1 } },
    { id: 'mobil', label: 'Mobilization / site works', re: /mobili[sz]ation|site handover|site clearing|setting out|site office/, per: { def: 0.34 }, crew: { 'Project Manager': 1, 'Store Keeper': 1, Surveyor: 1, Foreman: 1, 'Pick Up Driver': 1 }, eq: {} },
    { id: 'kerb', label: 'Kerb / edge stone', re: /kerb|curb\s?stone|edge stone|channel stone/, units: ['M'], per: { def: 60 }, crew: { Foreman: 1, 'Daily Labour': 3, Mason: 2, Helper: 2 }, eq: {} },
    { id: 'drain', label: 'Drainage pipes / culverts', re: /^(?!.*excavat)(?=.*(clean\s?outs?|vent\s?caps?|(drain|sewer|culvert|hume)\w*[ -]?(pipe|line)?|(lay|laying|supply).{0,30}(drain|sewer)))/, units: ['M', 'Nº', 'PCS', 'LS'], per: { def: 25, 'Nº': 6 }, crew: { Foreman: 1, 'Daily Labour': 6, Mason: 1, Plumber: 1 }, eq: {} },
    { id: 'cobble', label: 'Cobblestone paving', re: /cobble/, per: { def: 35 }, crew: { Foreman: 1, 'Daily Labour': 4, Mason: 4, Helper: 4 }, eq: {} },
    { id: 'asphalt', label: 'Asphalt / bituminous surfacing', re: /asphalt|tack coat|prime coat|wearing course|bituminous (surface|course)/, units: ['M²', 'M³', 'M'], per: { def: 300, 'M³': 60 }, crew: { Foreman: 1, 'Daily Labour': 10, 'Roller Operator': 1 }, eq: { 'Road Roller': 1 } },
    { id: 'termite', label: 'Termite / soil treatment', re: /termite|soil poison|anti[- ]?termite/, units: ['M²', 'M', 'LS'], per: { def: 300 }, crew: { Foreman: 1, 'Daily Labour': 3 }, eq: {} },
    { id: 'fence', label: 'Fencing and gates', re: /fenc(e|ing)|\bgates?\b(?! valve)|barbed|chain\s?link|razor wire/, units: ['M', 'Nº', 'PCS', 'LS'], per: { def: 25, 'Nº': 1 }, crew: { Foreman: 1, 'Daily Labour': 4, Mason: 2, Welder: 1 }, eq: { 'Welding Machine': 1 } },
    { id: 'waterproof', label: 'Waterproofing / damp-proofing', re: /waterproof|damp\s?proof|bitumen|bituminous|\bdpc\b|\bdpm\b|membrane/, units: ['M²', 'M', 'LS'], per: { def: 120 }, crew: { Foreman: 1, 'Daily Labour': 3, Helper: 2 }, eq: {} },
    { id: 'septic', label: 'Septic tank / manholes', re: /septic|manhole|inspection chamber|soak\s?(away|pit)|\bsump\b|catch\s?pit/, units: ['Nº', 'PCS', 'LS', 'M³'], per: { def: 0.5, 'M³': 4 }, crew: { Foreman: 1, 'Daily Labour': 4, Mason: 3, Helper: 3 }, eq: {} },
    { id: 'tank', label: 'Water tank and pump', re: /water tank|\btank\b|reservoir|booster|\bpump/, units: ['Nº', 'PCS', 'LS', 'SET'], per: { def: 0.5 }, crew: { Foreman: 1, 'Daily Labour': 2, Plumber: 2 }, eq: {} },
    { id: 'cart', label: 'Cart away', re: /cart\s?away|carta?way|haul away|dispose|surplus/, per: { def: 96 }, crew: { Foreman: 1, 'Daily Labour': 6, 'Truck Driver': 1, 'Pick Up Driver': 1 }, eq: { 'Dump Truck': 1, 'Backhoe Loader': 1 }, preset: 'earth_mach' },
    { id: 'backfill', label: 'Backfill and compaction', re: /back\s?fill|compact|ram in layers|fill(ing)? around|(fill|filling) .{0,40}(excavated|selected) (material|soil)/, per: { def: 45 }, crew: { Foreman: 1, 'Daily Labour': 12, 'Compactor Operator': 1, 'Pick Up Driver': 1 }, eq: { 'Plate Compactor': 1, 'Pick Up Vehicle': 1 }, preset: 'backfill' },
    { id: 'excav', label: 'Excavation', re: /excavat|trench|\bpit\b|\bdig/, per: { def: 96 }, crew: { Surveyor: 1, Foreman: 1, 'Daily Labour': 6, 'Backhoe Loader Operator': 1, 'Pick Up Driver': 1 }, eq: { 'Backhoe Loader': 1, 'Pick Up Vehicle': 1 }, preset: 'earth_mach' },
    { id: 'hardcore', label: 'Hardcore / aggregate', re: /hard\s?core|stone soling|crushed|aggregate|gravel|blinding|sand fill/, per: { def: 100, 'M³': 55 }, crew: { Foreman: 1, 'Daily Labour': 9, Mason: 3, Helper: 3 }, eq: { 'Plate Compactor': 1 } },
    { id: 'formwork', label: 'Formwork', re: /form\s?work|shuttering/, units: ['M²', 'M', 'LS'], per: { def: 80, M: 81 }, crew: { Foreman: 1, 'Daily Labour': 4, Carpenter: 4, Helper: 4 }, eq: {} },
    { id: 'rebar', label: 'Reinforcement bars', re: /bar\b|bars\b|rebar|reinforcement|stirrup|stirup/, units: ['KG'], per: { def: 258 }, crew: { Foreman: 1, 'Daily Labour': 2, 'Bar Bender': 2 }, eq: {} },
    { id: 'plaster', label: 'Plastering', re: /plaster|gypsum (plaster|finish)|chalk/, per: { def: 45 }, crew: { Foreman: 1, 'Daily Labour': 2, Plasterer: 2, Helper: 2 }, eq: {} },
    { id: 'hcb', label: 'Hollow block walling', re: /hollow block|\bhcb\b|block\s?work|blockwall|block wall/, per: { def: 40 }, crew: { Foreman: 1, 'Daily Labour': 2, Mason: 2, Helper: 2 }, eq: {} },
    { id: 'pointing', label: 'Pointing', re: /pointing/, per: { def: 16 }, crew: { Foreman: 1, 'Daily Labour': 1, Mason: 1, Helper: 1 }, eq: {} },
    { id: 'masonry', label: 'Stone masonry', re: /masonry|stone wall|foundation wall/, per: { def: 8 }, crew: { Foreman: 1, 'Daily Labour': 2, Mason: 1, Helper: 1 }, eq: {} },
    { id: 'paint', label: 'Painting', re: /paint|emulsion|varnish|enamel|thermoplastic|marking/, per: { def: 100 }, crew: { Foreman: 1, 'Daily Labour': 2, Painter: 2 }, eq: {} },
    { id: 'skirting', label: 'Skirting / wall tile fixing', re: /skirting|dado/, units: ['M', 'M²'], per: { def: 50, M: 50 }, crew: { Foreman: 1, 'Daily Labour': 2, Tiler: 2, Helper: 2 }, eq: {} },
    { id: 'tile', label: 'Tiling / paving', re: /\btile|tiling|ceramic|terrazzo|terrazo|paving|marble|granite|flooring/, per: { def: 43 }, crew: { Foreman: 1, 'Daily Labour': 4, Tiler: 4, Helper: 3 }, eq: {} },
    { id: 'lean', label: 'Lean concrete / screed', re: /lean concrete|screed|\bc-?7\b|blinding concrete/, per: { def: 25 }, crew: { Foreman: 1, 'Daily Labour': 6, Mason: 2, Helper: 2, 'Mixer Operator': 1 }, eq: { 'Concrete Mixer': 1 } },
    { id: 'concrete', label: 'Concrete', re: /concrete|\bc-?\d{2}\b|\brcc?\b|mass concrete|cast in situ/, per: { def: 10, 'M²': 25 }, crew: { Foreman: 1, 'Daily Labour': 12, Mason: 2, Helper: 2, 'Mixer Operator': 1, 'Vibrator Operator': 1 }, eq: { 'Concrete Mixer': 1, Vibrator: 1 } },
    { id: 'roof', label: 'Roofing', re: /roof|corrugated|iron sheet|polycarbonate|gutter|down\s?pipe|flashing|ridge cap|fascia/, per: { def: 35, M: 50 }, crew: { Foreman: 1, 'Daily Labour': 1, Carpenter: 1, Helper: 1 }, eq: {} },
    { id: 'ceiling', label: 'Ceiling boards / gypsum', re: /^(?!.*(light|lamp|\bled\b|fitting)).*(ceiling|gypsum board|cornice)/, units: ['M²', 'M'], per: { def: 40, M: 60 }, crew: { Foreman: 1, 'Daily Labour': 1, Carpenter: 2, Helper: 2 }, eq: {} },
    { id: 'carp', label: 'Carpentry / timber', re: /morale|timber|purlin|truss|eucalyptus|zigba|carpent|batten|joiner|pile\b|cabinet|cupboard|wardrobe/, per: { def: 40, M: 70 }, crew: { Foreman: 1, 'Daily Labour': 2, Carpenter: 2, Helper: 2 }, eq: {} },
    { id: 'metal', label: 'Metal doors and windows', re: /\bdoors?\b|\bwindows?\b|grill|steel frame|metal (door|window|frame)|railing|handrail/, per: { def: 10 }, crew: { Foreman: 1, 'Daily Labour': 1, Welder: 1, Helper: 1 }, eq: { 'Welding Machine': 1, Grinder: 1 } },
    { id: 'glaze', label: 'Glazing', re: /glaz|glass/, per: { def: 12 }, crew: { Foreman: 1, Glazier: 1 }, eq: {} },
    { id: 'plumb', label: 'Plumbing / sanitary', re: /pipe|plumb|valve|toilet|\bwash|sanitary|\bwc\b|basin|\btap\b|elbow|\bppr\b|\bsink\b|towel|soap|toilet paper|mirror|shower/, per: { def: 50, 'Nº': 4, PCS: 4, M: 74 }, crew: { Foreman: 1, 'Daily Labour': 2, Plumber: 2 }, eq: {} },
    { id: 'elec', label: 'Electrical', re: /electric|wire|cable|conduit|socket|switch|\blight|lamp|breaker|distribution|\bdb\b|fitting|\bpoints?\b|earthing|\bpanel|outlet|\brj ?45\b|\bdata\b/, per: { def: 8, M: 300 }, crew: { Foreman: 1, Electrician: 1, 'Daily Labour': 1 }, eq: {} }
  ];
  var DEFAULTS = { 'M³': 10, 'M²': 40, M: 50, KG: 250, PCS: 4, 'Nº': 4, LS: 0.34, SET: 1 };
  var DEFAULT_TPL = { id: 'general', label: 'General work', crew: { Foreman: 1, 'Daily Labour': 4 }, eq: {} };

  /* ---------- the norms library: 141 activities in 18 categories, matched to BoQ lines in two steps ----------
     1. the type of work above (kerb, formwork, plaster...) is found from the words of the BoQ line;
     2. NORM_RULES pick the activity inside that type (footing, column or slab formwork...). Rules are tried on the line's own
        words first, then on the words of the heading above it; the first entry of each list is the default. */
  var NORM_RULES = {
    clear: [['et001'], [/strip|remov\w* of the top|top\s?soil/, 'et002']],
    excav: [['et003'], [/rock/, 'et005'], [/hard (soil|murram)|\bhard\b/, 'et004'], [/drain/, 'et115'], [/water (pipe )?trench|pipe trench/, 'et121'], [/bulk|reduce level|machine|mechani|road/, 'et122']],
    backfill: [['et006'], [/compact|mechani|in layers|ram/, 'et007']],
    hardcore: [['et009'], [/sand/, 'et008']],
    lean: [['et011'], [/screed/, 'et048']],
    concrete: [['et016'], [/slab|floor|roof|stair/, 'et016'], [/footing|foundation|strip|\bpad\b|tie beam|grade beam|plinth/, 'et012'], [/column/, 'et014'], [/beam|lintel|kerb|curb/, 'et015'], [/walk\s?way|pavement|apron/, 'et112'], [/ditch|drain|channel|culvert/, 'et116', ['M']]],
    formwork: [['et023'], [/slab|floor|roof/, 'et023'], [/footing|foundation|strip|\bpad\b|plinth/, 'et020'], [/column/, 'et021'], [/beam|lintel|grade/, 'et022'], [/stair/, 'et024'], [/dismantl|strik/, 'et025']],
    rebar: [['et031'], [/slab|floor|roof/, 'et031'], [/footing|foundation|strip|\bpad\b/, 'et028'], [/column/, 'et029'], [/beam|lintel|grade/, 'et030'], [/stair/, 'et032']],
    hcb: [['et035'], [/lintel/, 'et040', ['M']], [/partition/, 'et039'], [/\b(10|100)\s?(cm|mm)\b/, 'et033'], [/\b(15|150)\s?(cm|mm)\b/, 'et034'], [/\b(20|200)\s?(cm|mm)\b/, 'et035'], [/brick/, 'et036']],
    masonry: [['et037'], [/foundation|substructure|under|footing/, 'et038']],
    pointing: [['et047']],
    plaster: [['et041'], [/external|outside|exterior/, 'et042'], [/ceiling/, 'et043'], [/screed/, 'et044'], [/rough\s?cast/, 'et045'], [/skim/, 'et046']],
    paint: [['et073'], [/ceiling/, 'et075'], [/door/, 'et070', ['Nº']], [/exterior|outside|external/, 'et074'], [/wood|varnish|vanish/, 'et076'], [/metal|steel|iron|oil paint/, 'et077'], [/putty/, 'et078'], [/primer/, 'et071'], [/one coat/, 'et072']],
    roof: [['et056'], [/gutter/, 'et062'], [/down\s?pipe/, 'et063'], [/truss/, 'et058', ['Nº']], [/membrane|waterproof/, 'et059'], [/insulation/, 'et061'], [/screed/, 'et060']],
    tile: [['et049'], [/porcelain/, 'et050'], [/marble/, 'et051'], [/granite/, 'et052'], [/terrazzo|terrazo/, 'et053'], [/interlock|pavers?\b/, 'et113']],
    skirting: [['et054']],
    ceiling: [['et100'], [/pvc/, 'et104'], [/framework|suspended/, 'et101'], [/joint/, 'et103']],
    carp: [['carp'], [/door/, 'et064', ['Nº']], [/frame/, 'et066', ['Nº']]],
    metal: [['metal'], [/door/, 'et065', ['Nº']], [/alumin.{0,30}(window|door)|window/, 'et067', ['Nº']], [/alumin.{0,30}frame/, 'et068', ['M²']]],
    glaze: [['et069']],
    plumb: [['et079'], [/\b(110|160|200|250|315)\s?mm/, 'et080'], [/ppr|hot|cold|water supply|g\.?i\b/, 'et083'], [/waste|soil pipe|drain/, 'et082'], [/wash\s?basin|hand\s?wash|lavatory/, 'et085', ['Nº']], [/\bwc\b|toilet|water closet|squat|turkish/, 'et086', ['Nº']], [/sink/, 'et087', ['Nº']], [/floor drain|clean\s?out|vent\s?cap/, 'et084', ['Nº']]],
    elec: [['et093'], [/conduit/, 'et090'], [/cable/, 'et092'], [/switch/, 'et094'], [/socket|outlet/, 'et095'], [/light|lamp|fixture|luminaire/, 'et096'], [/distribution|\bdb\b|panel|breaker/, 'et097'], [/earth/, 'et098']],
    drain: [['et082'], [/sewer/, 'et120'], [/floor drain|clean\s?out|vent\s?cap/, 'et084', ['Nº']]],
    septic: [['et118']],
    tank: [['et088']],
    kerb: [['et114']],
    cobble: [['et113']],
    asphalt: [['et129'], [/\b(ton|tonne)\b/, 'et128']],
    fence: [['et136']]
  };
  var NORM_BY_ID = {}, NORM_TEMPLATES = [], TRADE_OF_NORM = {};
  Object.keys(NORM_RULES).forEach(function (tr) { NORM_RULES[tr].forEach(function (r) { var id = r.length === 1 ? r[0] : r[1]; if (/^et\d/.test(id) && !TRADE_OF_NORM[id]) TRADE_OF_NORM[id] = tr; }); });
  function legacyById(id) { for (var i = 0; i < TEMPLATES.length; i++) if (TEMPLATES[i].id === id) return TEMPLATES[i]; return null; }
  (NORMS ? NORMS.NORMS : []).forEach(function (n) {
    var tr = TRADE_OF_NORM[n.id], lg = tr && legacyById(tr), per = {}, crew = {}, maxc = 0, minc = 0;
    if (lg) Object.keys(lg.per || {}).forEach(function (k) { per[k] = lg.per[k]; });
    per[n.unit] = n.out; if (per.def == null || !lg) per.def = n.out;
    Object.keys(n.crew).forEach(function (r) { crew[r] = n.crew[r][1]; maxc += n.crew[r][2]; minc += n.crew[r][0]; });
    var t = { id: n.id, trade: tr || 'misc', cat: n.cat, code: n.code, label: n.name, unit: n.unit, per: per, crew: crew, eq: lg ? lg.eq : {}, preset: lg && lg.preset, lo: n.lo, hi: n.hi, grade: n.grade, minCrew: minc, maxCrew: maxc, norm: true };
    NORM_TEMPLATES.push(t); NORM_BY_ID[n.id] = t;
  });
  function refine(tpl, it, head) {
    var rules = tpl && NORM_RULES[tpl.id];
    if (!rules) return tpl;
    var own = String(it.desc || '').toLowerCase(), both = head ? (String(head).toLowerCase() + ' ' + own) : own, pick = null;
    function scan(text) {
      for (var i = rules.length - 1; i >= 1; i--) {   // later, more specific rules win
        var r = rules[i];
        if (r[2] && r[2].indexOf(it.unit) < 0) continue;
        if (r[0].test(text)) return r[1];
      }
      return null;
    }
    pick = scan(own) || scan(both) || rules[0][0];
    return NORM_BY_ID[pick] || legacyById(pick) || tpl;
  }

  function matchText(d, u) {
    for (var i = 0; i < TEMPLATES.length; i++) {
      var t = TEMPLATES[i];
      if (t.units && t.units.indexOf(u) < 0) continue;
      if (t.re.test(d)) return t;
    }
    return null;
  }
  // an item's own words first; a sub-item such as "a) To footing" also takes the words of the heading above it
  function templateOf(item, head) {
    var d = String(item.desc || '').toLowerCase(), u = item.unit;
    return matchText(d, u) || (head ? matchText(String(head).toLowerCase() + ' ' + d, u) : null);
  }
  // heading text above each sub-item (same nesting rule as the schedule rows)
  function headsOf(p) {
    var out = {}, cur = null, last = null, prevItem = null, run = [], open = false, text = '', nest = (p.sched && p.sched.nest) || {};
    function reset() { cur = last = prevItem = null; run = []; open = false; text = ''; }
    p.boq.forEach(function (i) {
      if (i.kind === 'sum') { reset(); return; }
      if (L.isHeading(i)) {   // a block of description lines (qty 0, no rate) belongs to the item that follows it
        if (!open) { run = []; open = true; }
        run.push(String(i.desc || '')); text = run.join(' ').slice(0, 400); cur = last = i; prevItem = null; return;
      }
      if (!L.isItemRow(i)) { reset(); return; }
      var immediate = open; open = false;
      var isDitto = /^\s*(ditto|do\b|same as)/i.test(String(i.desc || '')), isLetter = /^[a-z]\s?[.)]?$/.test(String(i.no || '').trim()), noNo = !String(i.no || '').trim();
      var fragment = String(i.desc || '').length <= 40 || /^[a-z(]/.test(String(i.desc || '')) || /^(dia|size|approx)/i.test(String(i.desc || ''));
      var nv = nest[String(i.id)], par = nv === 'in' ? last : nv === 'out' ? null : (cur && (noNo || isLetter) ? cur : null);
      if (par) out[String(i.id)] = text; else if (nv !== 'in') cur = null;
      if (!par) {
        // no words of its own for a work type: the block of lines just above, else the item above (fragments, ditto, a) b) c)), else the heading it sits under
        if (noNo && immediate && text) out[String(i.id)] = text;
        else if ((isDitto || isLetter || (noNo && fragment)) && prevItem) out[String(i.id)] = prevItem.desc;
        else if (text) out[String(i.id)] = text;
      }
      if (!isDitto && !isLetter && (!noNo || matchText(String(i.desc || '').toLowerCase(), i.unit))) prevItem = i;
    });
    return out;
  }
  function templateById(id) { if (NORM_BY_ID[id]) return NORM_BY_ID[id]; for (var i = 0; i < TEMPLATES.length; i++) if (TEMPLATES[i].id === id) return TEMPLATES[i]; return id === 'general' ? DEFAULT_TPL : null; }
  function outputOf(tpl, unit) {
    if (!tpl || !tpl.per) return DEFAULTS[unit] || 20;
    return tpl.per[unit] != null ? tpl.per[unit] : tpl.per.def;
  }
  // an item measured in m² that states its thickness ("10 cm thick") is a volume for the work types that are rated per m³
  var BY_VOLUME = { concrete: 1, lean: 1, hardcore: 1, backfill: 1, masonry: 1 };
  function volumeType(tpl) { return !!BY_VOLUME[tpl.trade || tpl.id]; }
  function thickness(it) {
    var m = /(\d+(?:\.\d+)?)\s*(cm|mm)\s*(?:thick|thickness|depth|deep)|(?:thick|thickness)\s*(?:of)?\s*(\d+(?:\.\d+)?)\s*(cm|mm)/i.exec(String(it.desc || ''));
    if (!m) return 0;
    var v = parseFloat(m[1] || m[3]), u = (m[2] || m[4]).toLowerCase();
    v = u === 'mm' ? v / 1000 : v / 100;
    return v > 0.01 && v < 2 ? v : 0;
  }
  var MIN_DUR = 0.5;
  function roundDur(d) {
    if (!(d > 0)) return 0.25;
    if (d < 0.5) return Math.max(0.25, Math.ceil(d / 0.25 - 1e-9) * 0.25);
    return Math.round(d * 2) / 2;
  }
  function nkey(s) { return String(s).toLowerCase().replace(/[^a-z]/g, ''); }
  function ensure(list, name, make) {
    var k = nkey(name);
    for (var i = 0; i < list.length; i++) if (nkey(list[i].name) === k || (k === 'foreman' && nkey(list[i].name) === 'forman')) return list[i];
    var x = make(); list.push(x); return x;
  }

  /* ---------- presets: the setup of a project as a named, re-usable set of parts ---------- */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  var BUILTIN_PRESETS = [
    { id: 'b_building', name: 'Building', builtin: true, note: 'Houses, offices, health posts, schools', parts: {
      prod: { hours: 8, factor: 1, types: {} },
      mp: STD_ROLES.map(function (r) { return { name: r[0], type: r[1], person: '', count: r[1] === 'permanent' ? 1 : 0 }; }),
      eq: STD_EQUIP.map(function (e) { return { name: e[0], source: e[1] }; }),
      cf: { misc: 2, overhead: 7.5, profit: 7.5, defSplit: [65, 15, 3], presets: [], advPct: 20, interim: 3 } } },
    { id: 'b_road', name: 'Road / corridor', builtin: true, note: 'Kerb, cobble, terrazzo, asphalt, hardcore, road marking. Starting figures: adjust to your crews', parts: {
      prod: { hours: 8, factor: 1, types: {
        et114: { gangs: 2 }, et113: { gangs: 2 }, et130: { gangs: 2 }, et129: { gangs: 2 }
      } },
      mp: STD_ROLES.map(function (r) { return { name: r[0], type: r[1], person: '', count: r[1] === 'permanent' ? 1 : 0 }; }).concat([{ name: 'Grader Operator', type: 'temporary', person: '', count: 0 }, { name: 'Roller Operator', type: 'temporary', person: '', count: 0 }]),
      eq: STD_EQUIP.map(function (e) { return { name: e[0], source: e[1] }; }).concat([{ name: 'Grader', source: 'Rental' }, { name: 'Road Roller', source: 'Rental' }]),
      cf: { misc: 2, overhead: 7.5, profit: 7.5, defSplit: [50, 15, 12], presets: [], advPct: 15, interim: 3 } } },
    { id: 'b_rainy', name: 'Rainy season (slower)', builtin: true, note: 'Output about 20% lower on all work', parts: { prod: { hours: 8, factor: 0.8, types: {}, keepTypes: true } } },
    { id: 'b_remote', name: 'Remote site (slower)', builtin: true, note: 'Poor access: output about 15% lower', parts: { prod: { hours: 8, factor: 0.85, types: {}, keepTypes: true } } },
    { id: 'b_fast', name: 'Fast crews', builtin: true, note: 'Experienced crews: output about 15% higher', parts: { prod: { hours: 8, factor: 1.15, types: {}, keepTypes: true } } }
  ];
  var PRESET_PARTS = ['prod', 'mp', 'eq', 'cf'];
  /* built-in presets (not hidden) first, then the user's own */
  function presetLibrary(user, hidden) {
    hidden = hidden || [];
    return BUILTIN_PRESETS.filter(function (b) { return hidden.indexOf(b.id) < 0; }).concat((user || []).map(function (u) { return { id: u.id, name: u.name, parts: u.parts }; }));
  }
  /* a preset from the project's present setup; `want` lists the parts to keep */
  function presetFromProject(p, name, want) {
    var s = p.sched, parts = {};
    want = want || PRESET_PARTS;
    if (want.indexOf('prod') >= 0) parts.prod = clone(prodOf(p));
    if (want.indexOf('mp') >= 0 && s.roles.length) parts.mp = s.roles.map(function (r) { return { name: r.name, type: r.type, person: r.person || '', count: r.count || 0 }; });
    if (want.indexOf('eq') >= 0 && s.equip.length) parts.eq = s.equip.map(function (e) { return { name: e.name, source: e.source }; });
    if (want.indexOf('cf') >= 0) { var c = s.cf; parts.cf = clone({ misc: c.misc, overhead: c.overhead, profit: c.profit, defSplit: c.defSplit, presets: c.presets || [], advPct: c.advPct, interim: c.interim }); }
    return L.sanitizePreset({ name: name, parts: parts });
  }
  var DEFAULT_MODES = { prod: 'replace', mp: 'merge', eq: 'merge', cf: 'replace' };
  /* apply the chosen parts. modes: { prod|mp|eq|cf: 'replace' | 'merge' } (a part left out is not applied). Returns counts. */
  function applyPreset(p, pre, modes) {
    var s = p.sched, pa = pre.parts || {}, out = { prod: 0, mp: 0, eq: 0, cf: 0, removed: 0 };
    if (modes.prod && pa.prod) {
      var cur = clone(prodOf(p)), src = pa.prod;
      if (modes.prod === 'replace') {
        cur.hours = src.hours; cur.factor = src.factor;
        if (!src.keepTypes) cur.types = clone(src.types || {});
        else Object.keys(src.types || {}).forEach(function (k) { cur.types[k] = clone(src.types[k]); });
      } else {
        if (cur.hours === 8) cur.hours = src.hours;
        if (cur.factor === 1) cur.factor = src.factor;
        Object.keys(src.types || {}).forEach(function (k) { if (!cur.types[k]) cur.types[k] = clone(src.types[k]); });
      }
      s.prod = L.sanitizeProd(cur); out.prod = 1;
    }
    function sync(list, items, mode, make, copy, usedIds) {
      var seen = {};
      items.forEach(function (it) {
        var ex = null, k = nkey(it.name);
        for (var i = 0; i < list.length; i++) if (nkey(list[i].name) === k || (k === 'foreman' && nkey(list[i].name) === 'forman')) { ex = list[i]; break; }
        seen[ex ? ex.id : 'new' + k] = true;
        if (ex) { if (mode === 'replace') copy(ex, it); }
        else { list.push(make(it)); out[list === s.roles ? 'mp' : 'eq'] += 1; }
        if (ex) seen[ex.id] = true;
      });
      if (mode === 'replace') {   // drop what the preset does not have, unless a task uses it
        for (var j = list.length - 1; j >= 0; j--) {
          var keep = false, x = list[j];
          items.forEach(function (it) { if (nkey(it.name) === nkey(x.name)) keep = true; });
          if (!keep && !usedIds[String(x.id)]) { list.splice(j, 1); out.removed += 1; }
        }
      }
    }
    var usedR = {}, usedE = {};
    Object.keys(s.tasks).forEach(function (k) { Object.keys(s.tasks[k].mp || {}).forEach(function (r) { usedR[r] = true; }); Object.keys(s.tasks[k].eq || {}).forEach(function (r) { usedE[r] = true; }); });
    if (modes.mp && pa.mp) sync(s.roles, pa.mp, modes.mp, function (it) { return { id: L.newId(), name: it.name, type: it.type, person: it.person || '', count: it.count || 0 }; }, function (ex, it) { ex.type = it.type; ex.person = it.person || ex.person; ex.count = it.count; }, usedR);
    if (modes.eq && pa.eq) sync(s.equip, pa.eq, modes.eq, function (it) { return { id: L.newId(), name: it.name, source: it.source }; }, function (ex, it) { ex.source = it.source; }, usedE);
    if (modes.cf && pa.cf) {
      var cf = s.cf, sc = pa.cf;
      if (modes.cf === 'replace') { cf.misc = sc.misc; cf.overhead = sc.overhead; cf.profit = sc.profit; cf.defSplit = sc.defSplit.slice(); cf.advPct = sc.advPct; cf.interim = sc.interim; cf.legacy = false; cf.presets = clone(sc.presets || []); }
      else {
        cf.presets = cf.presets || [];
        (sc.presets || []).forEach(function (q) {
          if (cf.presets.length >= 8 || cf.presets.some(function (z) { return nkey(z.name) === nkey(q.name); })) return;
          var c2 = clone(q); if (cf.presets.some(function (z) { return z.id === c2.id; })) c2.id = L.newId(); cf.presets.push(c2);
        });
      }
      out.cf = 1;
    }
    return out;
  }

  /* ---------- productivity assumptions ----------
     p.sched.prod = { hours, factor, types: { <type id>: { per:{unit:output}, crew:{role:n}, eq:{machine:n}, preset } } }
     Only what you changed is stored; everything else comes from TEMPLATES. */
  function prodOf(p) { return p.sched.prod || { hours: 8, factor: 1, maxDays: 20, types: {} }; }
  function effTpl(p, tpl) {
    var o = prodOf(p).types[tpl.id];
    if (!o) return tpl;
    var e = {};
    Object.keys(tpl).forEach(function (k) { e[k] = tpl[k]; });
    if (o.per) { e.per = {}; Object.keys(tpl.per || {}).forEach(function (k) { e.per[k] = tpl.per[k]; }); Object.keys(o.per).forEach(function (k) { e.per[k] = o.per[k]; }); }
    if (o.crew) e.crew = o.crew;
    if (o.eq) e.eq = o.eq;
    if (o.preset != null) e.preset = o.preset;
    if (o.gangs > 0) e.gangs = o.gangs;
    return e;
  }
  /* the output per crew-day the generator uses: 8 hours and a factor of 1 give the table figure */
  function speedOf(p) { var pr = prodOf(p); return (pr.hours / 8) * pr.factor; }

  /* ---------- trade logic ----------
     For each type of work: which other types it follows, with what kind of link. f = overlap as a part of the predecessor's
     duration (an SS link waits f * its duration); lag is in working days. Every link points to a type that comes earlier in
     the building order, so the links cannot loop. Items of one type are chained in BoQ order (one crew). */
  var TRADE = {
    excav: [{ t: ['clear', 'mobil'], type: 'FS' }],
    drain: [{ t: ['excav', 'clear', 'mobil'], type: 'FS' }],
    septic: [{ t: ['excav', 'clear', 'mobil'], type: 'FS' }],
    termite: [{ t: ['backfill', 'hardcore', 'excav'], type: 'FS' }],
    kerb: [{ t: ['hardcore', 'backfill', 'excav', 'clear'], type: 'FS' }],
    cobble: [{ t: ['kerb', 'hardcore', 'backfill', 'excav'], type: 'FS' }],
    asphalt: [{ t: ['kerb', 'hardcore', 'backfill', 'excav'], type: 'FS' }],
    fence: [{ t: ['clear', 'mobil'], type: 'FS' }],
    waterproof: [{ t: ['concrete', 'hcb'], type: 'FS' }],
    tank: [{ t: ['concrete', 'hcb'], type: 'FS' }],
    ceiling: [{ t: ['roof', 'plaster', 'hcb'], type: 'FS' }],
    skirting: [{ t: ['tile', 'plaster'], type: 'FS' }],
    cart: [{ t: ['excav'], type: 'SS', lag: 1 }, { t: ['excav'], type: 'FF', lag: 1 }],
    masonry: [{ t: ['excav', 'mobil'], type: 'FS' }],
    backfill: [{ t: ['masonry', 'excav', 'mobil'], type: 'FS' }],
    hardcore: [{ t: ['backfill', 'masonry', 'excav', 'mobil'], type: 'FS' }],
    lean: [{ t: ['hardcore', 'backfill', 'masonry', 'excav', 'mobil'], type: 'FS' }],
    formwork: [{ t: ['lean', 'hardcore', 'backfill', 'masonry', 'excav', 'mobil'], type: 'FS' }],
    rebar: [{ t: ['formwork'], type: 'SS', lag: 1 }, { t: ['lean', 'hardcore', 'backfill', 'masonry', 'excav', 'mobil'], type: 'FS' }],
    concrete: [{ t: ['formwork'], type: 'FS' }, { t: ['rebar'], type: 'FS' }],
    hcb: [{ t: ['concrete'], type: 'SS', f: 0.5 }, { t: ['concrete'], type: 'FF', lag: 1 }],
    roof: [{ t: ['hcb', 'concrete'], type: 'SS', f: 0.7 }, { t: ['hcb', 'concrete'], type: 'FF', lag: 1 }],
    carp: [{ t: ['roof', 'hcb', 'concrete'], type: 'FS' }],
    plaster: [{ t: ['hcb', 'masonry', 'concrete'], type: 'SS', f: 0.5 }, { t: ['hcb', 'masonry', 'concrete'], type: 'FF', lag: 1 }],
    pointing: [{ t: ['masonry', 'hcb'], type: 'FS' }],
    plumb: [{ t: ['hcb', 'masonry', 'concrete'], type: 'SS', f: 0.4 }],
    elec: [{ t: ['hcb', 'masonry', 'concrete'], type: 'SS', f: 0.4 }],
    metal: [{ t: ['plaster', 'hcb'], type: 'FS' }],
    glaze: [{ t: ['metal', 'plaster', 'hcb'], type: 'FS' }],
    tile: [{ t: ['plaster', 'hcb', 'concrete'], type: 'FS' }],
    paint: [{ t: ['plaster', 'carp', 'roof', 'hcb'], type: 'FS' }]
  };

  /* links for the items in `list` ([{ id, type, dur, g0, g1 }] in BoQ order); returns { id: [links] } */
  function tradeLinks(list) {
    var out = {};
    function nearest(cands, k) {   // the candidate closest to position k, the earlier one when equal
      var best = null, bd = 1e9;
      cands.forEach(function (c) { var d = Math.abs(c.k - k) + (c.k > k ? 0.5 : 0); if (d < bd) { bd = d; best = c; } });
      return best;
    }
    list.forEach(function (x, k) {
      var links = [];
      function add(target, type, lag) {
        if (!target || target.id === x.id) return;
        if (links.some(function (q) { return q.id === target.id && q.type === type; })) return;
        links.push({ id: target.id, type: type, lag: lag });
      }
      var rules = TRADE[x.type] || [];
      rules.forEach(function (rule) {
        var hit = null;
        for (var i = 0; i < rule.t.length && !hit; i++) {
          var cands = list.filter(function (y) { return y.type === rule.t[i] && y.id !== x.id; });
          var scopes = [cands.filter(function (y) { return y.g1 === x.g1; }), cands.filter(function (y) { return y.g0 === x.g0; }), cands.filter(function (y) { return y.k < k; })];
          for (var sc = 0; sc < scopes.length && !hit; sc++) if (scopes[sc].length) hit = nearest(scopes[sc], k);
        }
        if (!hit) return;
        var lag = rule.lag || 0;
        if (rule.f) lag = Math.round(rule.f * hit.dur);
        add(hit, rule.type, lag);
      });
      // the same kind of work follows the one before it (one crew)
      var prevSame = null;
      for (var j = k - 1; j >= 0; j--) if (list[j].type === x.type) { prevSame = list[j]; break; }
      add(prevSame, 'FS', 0);
      // nothing to follow: go after the item before it, except the very first
      if (!links.length && k > 0) add(list[k - 1], 'FS', 0);
      out[x.id] = links;
    });
    return out;
  }

  /* opts: { only: 'all' | 'empty', end: 'YYYY-MM-DD' }. Fills p.sched in place. Returns a summary. */
  /* duration and crew of one task for g gangs of the activity's norm crew. A task that needs less than half a gang-day gets a
     smaller crew (never fewer than two people), so man-days follow the quantity. Site staff (foreman, surveyor...) are not in
     a gang: they are the permanent roles of the project and are counted once for the whole site. */
  function isPermanentRole(n) { var pm = STD_ROLES.filter(function (r) { return r[0] === n; })[0]; return !!(pm && pm[1] === 'permanent'); }
  function crewPlan(x, g) {
    g = Math.max(0.5, Math.min(10, Math.round(g * 2) / 2));
    var crew = x.tpl.crew || {}, names = Object.keys(crew).filter(function (n) { return x.tpl.id === 'mobil' || !isPermanentRole(n); });
    var raw = x.qty / (x.per * g), f = Math.min(1, raw / MIN_DUR), full = 0, cnt = {}, got = 0;
    names.forEach(function (n) { full += crew[n] * g; cnt[n] = crew[n] > 0 ? Math.max(f < 1 ? 0 : 1, Math.round(crew[n] * g * f)) : 0; got += cnt[n]; });
    if (f < 1 && full > 0) {
      var order = names.slice().sort(function (a, b) { return crew[b] - crew[a]; }), want = Math.min(2, Math.round(full));
      for (var k = 0; got < want && k < 12; k++) { cnt[order[k % order.length]] += 1; got += 1; }
    }
    var ratio = full > 0 ? Math.max(got / full, 0.01) : 1, out = {};
    names.forEach(function (n) { if (cnt[n] > 0) out[n] = cnt[n]; });
    return { dur: roundDur(x.qty / (x.per * g * ratio)), crew: out, gangs: g };
  }
  /* gangs when the type does not fix them: one gang, or more when a task would run longer than the longest task allowed
     (Productivity: longest task), up to 4 gangs */
  function autoGangs(p, x) {
    var md = prodOf(p).maxDays;
    if (!(md > 0) || !(x.per > 0)) return 1;
    return Math.max(1, Math.min(4, Math.ceil(x.qty / x.per / md * 2) / 2));
  }
  /* the plan data of one BoQ item (type, output, quantity), as generate uses it */
  function planOf(p, it, heads, typeId) {
    var base = typeId ? templateById(typeId) : refine(templateOf(it, heads[String(it.id)]), it, heads[String(it.id)]), tpl = base || DEFAULT_TPL;
    var eff = effTpl(p, tpl), unit = it.unit, qty = it.qty, th = volumeType(tpl) && it.unit === 'M²' ? thickness(it) : 0;
    if (th) { unit = 'M³'; qty = it.qty * th; }
    return { it: it, tpl: eff, base: tpl, per: outputOf(eff, unit) * speedOf(p), qty: qty, matched: !!base };
  }
  /* change the number of gangs of one task: its duration and crew are worked out again */
  function setGangs(p, id, g) {
    var s = p.sched, t = s.tasks[String(id)], it = p.boq.filter(function (i) { return String(i.id) === String(id); })[0];
    if (!t || !it) return false;
    var x = planOf(p, it, headsOf(p), t.tpl), cp = crewPlan(x, g);
    t.gangs = cp.gangs; t.dur = cp.dur; t.mp = {};
    Object.keys(cp.crew).forEach(function (n) {
      var perm = STD_ROLES.filter(function (r) { return r[0] === n; })[0];
      var role = ensure(s.roles, n, function () { return { id: L.newId(), name: n, type: perm ? perm[1] : 'temporary', person: '', count: 0 }; });
      t.mp[String(role.id)] = cp.crew[n];
    });
    return true;
  }
  /* is the crew of this task what the generator gave it (so changing the gangs may replace it)? */
  function crewIsAuto(p, id) {
    var s = p.sched, t = s.tasks[String(id)], it = p.boq.filter(function (i) { return String(i.id) === String(id); })[0];
    if (!t || !it || !t.gangs) return true;
    var x = planOf(p, it, headsOf(p), t.tpl), cp = crewPlan(x, t.gangs), have = {};
    Object.keys(t.mp || {}).forEach(function (k) { var r = s.roles.filter(function (z) { return String(z.id) === k; })[0]; if (r && t.mp[k] > 0 && !isPermanentRole(r.name)) have[r.name] = t.mp[k]; });
    return JSON.stringify(Object.keys(have).sort().map(function (k) { return [k, have[k]]; })) === JSON.stringify(Object.keys(cp.crew).sort().map(function (k) { return [k, cp.crew[k]]; }));
  }
  function generate(p, opts) {
    opts = opts || {};
    var s = p.sched, only = opts.only === 'empty' ? 'empty' : 'all', off = offMap(s);
    var strategy = opts.strategy === 'trade' ? 'trade' : 'boq', skip = opts.skip || {}, types = opts.types || {};
    var items = p.boq.filter(function (i) { return L.isItemRow(i) && !L.isHeading(i); });
    if (!items.length) return { tasks: 0 };
    if (!s.roles.length) STD_ROLES.forEach(function (r) { if (r[1] === 'permanent') s.roles.push({ id: L.newId(), name: r[0], type: 'permanent', person: '', count: 1 }); });
    var plan = [], matched = 0, general = 0, general_names = [], kept = [], heads = headsOf(p);
    items.forEach(function (it) {
      var key = String(it.id), cur = s.tasks[key];
      if (skip[key]) { kept.push({ id: it.id, why: 'skip' }); return; }
      var forced = opts.force && opts.force[key];
      if (cur && cur.dur > 0 && cur.start && !forced) { kept.push({ id: it.id, why: 'manual' }); return; }   // a manual date is not overwritten
      if (only === 'empty' && cur && cur.dur > 0 && !forced) { kept.push({ id: it.id, why: 'has' }); return; }
      var x0 = planOf(p, it, heads, types[key]), tpl = x0.base;
      if (!x0.matched) { general += 1; if (general_names.length < 5) general_names.push((it.no ? it.no + ' ' : '') + it.desc.slice(0, 40)); } else matched += 1;
      plan.push(x0);
    });
    if (!plan.length) return { tasks: 0, kept: items.length, keptList: kept };
    // the position of every item in the BoQ and the headings above it (for the trade links)
    var info = {}, g0 = -1, g1 = -1, pos = 0;
    p.boq.forEach(function (i, idx) {
      if (i.kind === 'group') { g0 = idx; g1 = -1; return; }
      if (i.kind === 'line') { g1 = idx; return; }
      if (L.isItemRow(i) && !L.isHeading(i)) info[String(i.id)] = { k: pos++, g0: g0, g1: g1 };
    });
    var planById = {};
    plan.forEach(function (x) { planById[String(x.it.id)] = x; });
    var endDay = opts.end && L.isDate(opts.end) ? toDays(opts.end) : null, mult = 1, finishDay = null, fits = null;
    function apply(m) {
      plan.forEach(function (x) {
        var key = String(x.it.id), t = s.tasks[key] || (s.tasks[key] = { dur: 0, start: '', par: false, mp: {}, eq: {} });
        var cp = crewPlan(x, (x.tpl.gangs || autoGangs(p, x)) * m);
        t.dur = cp.dur; t.start = ''; t.par = false; t.tpl = x.base.id; t.gangs = cp.gangs;
        t.mp = {}; t.eq = {};
        Object.keys(cp.crew).forEach(function (n) {
          var perm = STD_ROLES.filter(function (r) { return r[0] === n; })[0];
          var role = ensure(s.roles, n, function () { return { id: L.newId(), name: n, type: perm ? perm[1] : 'temporary', person: '', count: perm && perm[1] === 'permanent' ? 1 : 0 }; });
          t.mp[String(role.id)] = cp.crew[n];
        });
        Object.keys(x.tpl.eq || {}).forEach(function (n) {
          var src = STD_EQUIP.filter(function (e) { return e[0] === n; })[0];
          var eq = ensure(s.equip, n, function () { return { id: L.newId(), name: n, source: src ? src[1] : 'Rental' }; });
          if (x.tpl.eq[n] > 0) t.eq[String(eq.id)] = x.tpl.eq[n];
        });
        var pid = x.tpl.preset || TPL_PRESET[x.tpl.trade || x.tpl.id];
        if (pid === 'earth_mach' && /trench|manual|by hand|hand dug/i.test(x.it.desc || '')) pid = 'earth_lab';
        var sp = pid ? presetSplit(s.cf, pid) : null, def = s.cf.defSplit;
        if (sp && !(Math.abs(sp[0] - def[0]) < 0.01 && Math.abs(sp[1] - def[1]) < 0.01 && Math.abs(sp[2] - def[2]) < 0.01)) t.split = sp; else delete t.split;
        delete t.pred; delete t.delay; delete t.snet;
      });
      if (strategy === 'trade') {
        var list = [];
        items.forEach(function (it) {
          var key = String(it.id), tk = s.tasks[key];
          if (!tk || !(tk.dur > 0)) return;
          var pl = planById[key], inf = info[key];
          var bt = pl ? pl.base : (templateById(tk.tpl) || templateOf(it, heads[key]) || DEFAULT_TPL);
          list.push({ id: key, type: bt.trade || bt.id, dur: tk.dur, k: list.length, g0: inf.g0, g1: inf.g1 });
        });
        var links = tradeLinks(list);
        plan.forEach(function (x) { var key = String(x.it.id); if (links[key]) s.tasks[key].pred = links[key]; });
      }
    }
    for (mult = 1; mult <= 10; mult++) {
      apply(mult);
      var sc = compute(p);
      finishDay = sc.fd;
      if (endDay == null || sc.fd == null || sc.fd <= endDay) break;
    }
    if (mult > 10) mult = 10;
    if (endDay != null && finishDay != null) fits = finishDay <= endDay;
    return { tasks: plan.length, matched: matched, general: general, generalNames: general_names, kept: kept.length, keptList: kept, plan: plan.map(function (x) { return { id: x.it.id, type: x.base.id, label: x.base.label, per: x.per, matched: x.matched }; }), strategy: strategy, mult: mult, finish: finishDay == null ? '' : fromDays(finishDay), end: opts.end || '', fits: fits };
  }

  /* ---------- progress against the plan ----------
     Planned progress of a task on a day = share of its working days that have passed (0 before the start, 1 after the finish).
     Actual progress = BoQ quantity done / quantity. A task is "late" when it should be finished and is not, or when it is
     more than TOLERANCE behind the plan. */
  var TOLERANCE = 0.10;
  function progress(p, sc, asOfIso) {
    sc = sc || compute(p);
    var asOf = toDays(asOfIso || L.todayStr()), by = {}, plannedV = 0, actualV = 0, total = 0, late = [], done = 0, started = 0;
    sc.rows.forEach(function (r) {
      if (r.level !== 2 || !(r.amount > 0)) return;
      var planned = 0, actual = r.qty > 0 ? Math.min(1, r.done / r.qty) : 0, status;
      if (r.sd != null) planned = asOf >= r.fd ? 1 : asOf < r.sd ? 0 : workCount(r.sd, asOf, sc.off) / workCount(r.sd, r.fd, sc.off);
      if (actual >= 0.999) status = 'done';
      else if (r.sd == null) status = actual > 0 ? 'ontrack' : 'unplanned';
      else if (asOf > r.fd) status = 'late';
      else if (planned - actual > TOLERANCE) status = 'late';
      else if (asOf < r.sd) status = actual > 0 ? 'ahead' : 'upcoming';
      else status = actual > planned + 1e-9 ? 'ahead' : 'ontrack';
      var info = { planned: planned, actual: actual, status: status, daysLate: status === 'late' && r.fd != null && asOf > r.fd ? workCount(r.fd + 1, asOf, sc.off) : 0 };
      by[r.id] = info;
      total += r.amount; plannedV += r.amount * planned; actualV += r.amount * actual;
      if (status === 'done') done += 1;
      if (actual > 0) started += 1;
      if (status === 'late') late.push({ row: r, info: info, gap: r.amount * (planned - actual) });
    });
    sc.rows.forEach(function (h) {   // heading-type items: value-weighted planned / actual of their sub-items
      if (!h.head) return;
      var amt = 0, pv = 0, av = 0, lateN = 0;
      h.children.forEach(function (x) { var i = by[x.id]; if (!i) return; amt += x.amount; pv += x.amount * i.planned; av += x.amount * i.actual; if (i.status === 'late') lateN += 1; });
      by[h.id] = { planned: amt > 0 ? pv / amt : 0, actual: amt > 0 ? av / amt : 0, status: lateN ? 'late' : 'ontrack', late: lateN };
    });
    sc.rows.forEach(function (h, k) {   // headings: value-weighted planned / actual of what is under them
      if (h.level === 2) return;
      var amt = 0, pv = 0, av = 0, lateN = 0;
      for (var j = k + 1; j < sc.rows.length && sc.rows[j].level > h.level; j++) {
        var x = sc.rows[j], i = by[x.id];
        if (!i || x.head) continue;
        amt += x.amount; pv += x.amount * i.planned; av += x.amount * i.actual;
        if (i.status === 'late') lateN += 1;
      }
      by[h.id] = { planned: amt > 0 ? pv / amt : 0, actual: amt > 0 ? av / amt : 0, status: lateN ? 'late' : 'ontrack', late: lateN };
    });
    late.sort(function (a, b) { return b.gap - a.gap; });
    var pPct = total > 0 ? plannedV / total : 0, aPct = total > 0 ? actualV / total : 0;
    return {
      asOf: fromDays(asOf), by: by, total: total, plannedValue: plannedV, actualValue: actualV, plannedPct: pPct, actualPct: aPct,
      gapValue: actualV - plannedV, ratio: plannedV > 0 ? actualV / plannedV : null,
      late: late, lateCount: late.length, doneCount: done, startedCount: started,
      beforeStart: sc.sd != null && asOf < sc.sd, afterEnd: sc.fd != null && asOf > sc.fd
    };
  }

  /* ---------- import from the schedule workbook ---------- */
  function text(v) { return v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); }
  function lc(v) { return text(v).toLowerCase(); }
  function numOf(v) { if (typeof v === 'number') return isFinite(v) ? v : null; var s = text(v).replace(/,/g, ''); if (!/^-?\d+(\.\d+)?$/.test(s)) return null; return Number(s); }
  function parseDate(v) {
    if (typeof v === 'number' && v > 20000 && v < 80000) return fromDays(Math.round(v) - 25569); // Excel serial
    var m = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(text(v));
    if (!m) { var m2 = /(\d{4})-(\d{2})-(\d{2})/.exec(text(v)); return m2 ? m2[0] : ''; }
    var y = +m[3]; if (y < 100) y += 2000;
    var iso = y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    return L.isDate(iso) ? iso : '';
  }
  function parseDur(v) {
    if (typeof v === 'number') return v;
    var m = /(\d+(\.\d+)?)\s*(day|d)/i.exec(text(v));
    return m ? Number(m[1]) : 0;
  }
  function nameKey(s) { return lc(s).replace(/[^a-z]/g, '').slice(0, 5); }

  function findHeader(rows, needles) {
    for (var i = 0; i < Math.min(rows.length, 60); i++) {
      var cells = rows[i].map(lc);
      if (needles.every(function (n) { return cells.some(function (c) { return c === n || c.indexOf(n) === 0; }); })) return i;
    }
    return -1;
  }
  function colOf(cells, label, from) {
    for (var c = from || 0; c < cells.length; c++) if (lc(cells[c]) === label || lc(cells[c]).indexOf(label) === 0) return c;
    return -1;
  }
  /* the row above the header (searching up) with most labels to the right of col `after` */
  function labelRow(rows, h, after, min) {
    var best = -1, bestN = 0;
    for (var i = Math.max(0, h - 10); i < h; i++) {
      var n = 0;
      for (var c = after + 1; c < rows[i].length; c++) if (text(rows[i][c])) n += 1;
      if (n >= min && n > bestN) { best = i; bestN = n; }
    }
    return best;
  }
  function headerInfo(rows) {
    var info = { name: '', client: '', location: '', contractor: '', cost: 0, start: '', end: '' };
    var seenFirst = false;
    for (var i = 0; i < Math.min(rows.length, 14); i++) {
      var cells = rows[i];
      for (var c = 0; c < cells.length; c++) {
        var s = text(cells[c]), m;
        if (!s) continue;
        if (!seenFirst) { info.contractor = s; seenFirst = true; }
        if ((m = /^project\s*:\s*-?\s*(.+)$/i.exec(s)) && !info.name) info.name = m[1].trim();
        else if ((m = /^client\s*:\s*-?\s*(.+)$/i.exec(s)) && !info.client) info.client = m[1].trim();
        else if ((m = /^location\s*:\s*-?\s*(.+)$/i.exec(s)) && !info.location) info.location = m[1].trim();
        else if ((m = /^project cost\s*:\s*-?\s*([\d,.]+)/i.exec(s)) && !info.cost) info.cost = Number(m[1].replace(/,/g, '')) || 0;
        else if (/project time span/i.test(s)) {
          var ds = [];
          for (var k = c + 1; k < cells.length; k++) { var d = parseDate(cells[k]); if (d) ds.push(d); }
          if (ds.length) { info.start = ds[0]; info.end = ds[1] || ''; }
        }
      }
    }
    return info;
  }

  /* Reads a schedule-style sheet. kind 'tasks' fills items; always returns the table of rows with a duration. */
  function readTable(rows, usesType) {
    var h = findHeader(rows, ['task name', 'duration']);
    if (h < 0) return null;
    var hc = rows[h], nameCol = colOf(hc, 'task name');
    var cols = { unit: colOf(hc, 'unit'), qty: colOf(hc, 'qty'), rate: colOf(hc, 'rate'), amount: colOf(hc, 'amount'), dur: colOf(hc, 'duration'), start: colOf(hc, 'start'), fin: colOf(hc, 'finish') };
    var noCol = colOf(hc, 'no'), typeCol = -1;
    var firstData = rows[h + 1] || [];
    if (usesType && nameCol > 0 && /^[GSTBM]$/.test(text(rows[h + 2] && rows[h + 2][nameCol - 1]) || text(firstData[nameCol - 1]))) typeCol = nameCol - 1;
    var lr = labelRow(rows, h, cols.fin, 3);
    var labels = [];
    if (lr >= 0) for (var c = cols.fin + 1; c < rows[lr].length; c++) if (text(rows[lr][c])) labels.push({ col: c, name: text(rows[lr][c]) });
    // markers above the labels: "Permanent" / "Temporarly" / "Rent" / "Owned"
    var marks = [];
    for (var i = Math.max(0, h - 10); i < h; i++) for (var cc = cols.fin + 1; cc < rows[i].length; cc++) {
      var s = lc(rows[i][cc]);
      if (s && i !== lr && /permanent|temporar|rent|owned/.test(s)) marks.push({ col: cc, s: s });
    }
    var out = [];
    for (var r = h + 1; r < rows.length; r++) {
      var row = rows[r];
      var desc = text(row[nameCol]);
      if (!desc) continue;
      out.push({ idx: r, row: row, type: typeCol >= 0 ? text(row[typeCol]) : '', no: noCol >= 0 ? text(row[noCol]) : '', desc: desc });
    }
    return { cols: cols, nameCol: nameCol, rows: out, labels: labels, marks: marks, typeCol: typeCol };
  }

  /* sheets: [{ name, rows }] (CBXlsxRead.read). Returns { info, items, roles, equip, cf, total, vatPct, notes[] } */
  function parseWorkbook(sheets) {
    var notes = [], tables = [];
    sheets.forEach(function (sh) {
      var t = readTable(sh.rows, true) || null;
      if (t) tables.push({ sheet: sh, t: t, equip: /equip|meesha/i.test(sh.name) || /equip|meesha/i.test(text((sh.rows[0] || []).join(' ')) + text((sh.rows[1] || []).join(' ')) + text((sh.rows[2] || []).join(' '))) });
    });
    var prim = tables.filter(function (x) { return !x.equip; })[0] || tables[0];
    if (!prim) return null;
    var T = prim.t, info = headerInfo(prim.sheet.rows);
    var tempCol = -1;
    T.marks.forEach(function (m) { if (/temporar/.test(m.s) && tempCol < 0) tempCol = m.col; });
    var roles = T.labels.map(function (lb, i) {
      var permanent = tempCol >= 0 ? lb.col < tempCol : i < 6;
      return { col: lb.col, name: lb.name, type: permanent ? 'permanent' : 'temporary', person: '', count: 1 };
    });
    var items = [], total = 0, vatAmt = 0, projRow = null, firstG = true;
    T.rows.forEach(function (r) {
      var c = T.cols, row = r.row, ty = r.type;
      var qty = numOf(row[c.qty]), rate = numOf(row[c.rate]), amount = numOf(row[c.amount]);
      var dur = parseDur(row[c.dur]), start = parseDate(row[c.start]);
      if (ty === 'M' || /^(total|vat)\b/i.test(r.desc)) {
        if (/^vat/i.test(r.desc)) vatAmt = amount || 0; else if (/^total\s*\.?$/i.test(r.desc)) total = amount || 0;
        return;
      }
      if (ty === 'G' && firstG) { firstG = false; if (!info.name || lc(r.desc) === lc(info.name) || !r.no) { projRow = { dur: dur, start: start, finish: parseDate(row[c.fin]) }; return; } }
      var it = { no: '', desc: r.desc.slice(0, 2000), unit: '', qty: 0, rate: 0, kind: '', dur: dur, start: start, finish: parseDate(row[c.fin]), mp: {} };
      if (ty === 'G') { it.kind = 'group'; it.dur = 0; it.start = ''; }
      else if (ty === 'S') { it.kind = 'line'; it.desc = (r.no ? r.no + '. ' : '') + it.desc; it.dur = 0; it.start = ''; }
      else {
        it.no = r.no; it.unit = text(row[c.unit]); it.qty = qty || 0; it.rate = rate || 0;
        if (ty === 'B') { it.dur = 0; it.start = ''; }
        else roles.forEach(function (ro) { var n = numOf(row[ro.col]); if (n > 0) it.mp[ro.name] = n; });
      }
      it.src = r.idx;
      items.push(it);
    });
    // equipment sheet: aligned to the first sheet by the rows that have a duration
    var equip = [];
    var eqT = tables.filter(function (x) { return x.equip && x !== prim; })[0] || (prim.equip ? prim : null);
    if (eqT) {
      var E = eqT.t;
      // owned equipment is marked with * in every task row (the "Owned" label can sit above another column)
      equip = E.labels.map(function (lb) {
        var star = E.rows.some(function (r) { return text(r.row[lb.col]) === '*'; });
        return { col: lb.col, name: lb.name.replace(/\s*\(\*\)\s*$/, ''), source: star ? 'Own' : 'Rental' };
      });
      var a = T.rows.filter(function (r) { return parseDur(r.row[T.cols.dur]) > 0; }), b = E.rows.filter(function (r) { return parseDur(r.row[E.cols.dur]) > 0; });
      if (a.length === b.length) {
        var map = {};
        a.forEach(function (r, i) { map[r.idx] = b[i]; });
        items.forEach(function (it) {
          var er = map[it.src];
          if (!er) return;
          it.eq = {};
          equip.forEach(function (eq) { var n = numOf(er.row[eq.col]); if (n > 0) it.eq[eq.name] = n; });
        });
      } else notes.push('equipment sheet rows do not match the task sheet, equipment per task was not imported');
    }
    // cash flow sheet: split of each priced item (material / labour / equipment ...)
    var cf = null;
    sheets.forEach(function (sh) {
      if (cf) return;
      var h = findHeader(sh.rows, ['task name', 'material']);
      if (h < 0) return;
      var hc = sh.rows[h], nc = colOf(hc, 'task name');
      var col = { amount: colOf(hc, 'amount'), mat: colOf(hc, 'material'), lab: colOf(hc, 'labor'), eq: colOf(hc, 'equipment'), misc: colOf(hc, 'miscel'), oh: colOf(hc, 'over'), profit: colOf(hc, 'profit'), wht: colOf(hc, 'with') };
      if (col.lab < 0) col.lab = colOf(hc, 'labour');
      var list = [];
      for (var r = h + 1; r < sh.rows.length; r++) {
        var row = sh.rows[r], a = numOf(row[col.amount]), m = numOf(row[col.mat]);
        if (!text(row[nc]) || /^(total|vat)/i.test(text(row[nc])) || !(a > 0) || m == null) continue;
        list.push({ a: a, m: m, l: numOf(row[col.lab]) || 0, e: numOf(row[col.eq]) || 0, misc: numOf(row[col.misc]) || 0, oh: numOf(row[col.oh]) || 0, profit: numOf(row[col.profit]) || 0, wht: numOf(row[col.wht]) || 0 });
      }
      if (list.length) cf = list;
    });
    var priced = items.filter(function (it) { return it.kind === '' && it.qty * it.rate > 0; });
    var cfSet = null;
    if (cf && cf.length === priced.length) {
      priced.forEach(function (it, i) {
        var x = cf[i];
        it.split = [Math.round(x.m / x.a * 10000) / 100, Math.round(x.l / x.a * 10000) / 100];
      });
      var f = cf[0];
      cfSet = { misc: Math.round(f.misc / f.a * 10000) / 100, overhead: Math.round(f.oh / f.a * 10000) / 100, profit: Math.round(f.profit / f.a * 10000) / 100 };
    } else if (cf) notes.push('cash flow sheet rows do not match the task sheet, material / labour / equipment shares were not imported');
    // people: names and required numbers of the permanent staff
    sheets.forEach(function (sh) {
      sh.rows.forEach(function (row) {
        for (var c = 2; c < Math.min(row.length, 8); c++) {
          var s = lc(row[c]);
          if (s !== 'permanent' && s !== 'temporary') continue;
          var nm = text(row[c - 2]), person = text(row[c - 1]), cnt = numOf(row[c + 1]);
          if (!nm) break;
          var key = nameKey(nm);
          roles.forEach(function (ro) {
            if (nameKey(ro.name) === key) { ro.type = s; if (person) ro.person = person; if (cnt != null && s === 'permanent') ro.count = cnt; }
          });
          break;
        }
      });
    });
    var vatPct = total > 0 && vatAmt > 0 ? Math.round(vatAmt / total * 1000) / 10 : 0;
    return { info: info, proj: projRow, items: items, roles: roles, equip: equip, cf: cfSet, total: total, vatPct: vatPct, notes: notes };
  }

  /* put parsed data into a project (in place). Existing BoQ, tasks, roles and equipment are replaced. */
  function applyImport(p, d, opts) {
    opts = opts || {};
    var ids = { role: {}, equip: {} }, sched = p.sched;
    if (d.cf) Object.keys(d.cf).forEach(function (k) { sched.cf[k] = d.cf[k]; });
    var roles = d.roles.map(function (r) { var id = L.newId(); ids.role[r.name] = id; return { id: id, name: r.name, type: r.type, person: r.person, count: r.type === 'permanent' ? r.count : 0 }; });
    var equip = d.equip.map(function (e) { var id = L.newId(); ids.equip[e.name] = id; return { id: id, name: e.name, source: e.source }; });
    var boq = [], tasks = {}, stretched = 0;
    d.items.forEach(function (it) {
      var id = L.newId(), row = { id: id, no: it.kind ? '' : it.no, desc: it.desc, unit: it.unit, qty: it.qty, rate: it.rate, done: 0 };
      if (it.kind) row.kind = it.kind;
      boq.push(row);
      if (!it.kind) {
        var t = { dur: it.dur || 0, start: it.start || '', par: false, mp: {}, eq: {} };
        // the workbook's own start and finish win when they cover more working days than the stated duration
        if (t.start && it.finish && toDays(it.finish) >= toDays(t.start)) {
          var span = workCount(toDays(t.start), toDays(it.finish), offMap(sched));
          if (span > Math.ceil(t.dur - 1e-9)) { t.dur = span; stretched += 1; }
        }
        Object.keys(it.mp || {}).forEach(function (n) { if (ids.role[n]) t.mp[ids.role[n]] = it.mp[n]; });
        Object.keys(it.eq || {}).forEach(function (n) { if (ids.equip[n]) t.eq[ids.equip[n]] = it.eq[n]; });
        var ds = sched.cf.defSplit, pl = poolOf(sched.cf);
        if (it.split) { var isp = [it.split[0], it.split[1], Math.max(0, r2(pl - it.split[0] - it.split[1]))]; if (!(Math.abs(isp[0] - ds[0]) < 0.01 && Math.abs(isp[1] - ds[1]) < 0.01 && Math.abs(isp[2] - ds[2]) < 0.01)) t.split = isp; }
        tasks[String(id)] = t;
      }
    });
    p.boq = boq; p.boqLines = 2;
    sched.roles = roles; sched.equip = equip; sched.tasks = tasks;
    d.stretched = stretched;
    if (d.proj && d.proj.start) sched.start = d.proj.start;
    if (!p.startDate && (d.info.start || (d.proj && d.proj.start))) p.startDate = d.info.start || d.proj.start;
    if (!p.endDate && (d.info.end || (d.proj && d.proj.finish))) p.endDate = d.info.end || d.proj.finish;
    if (d.vatPct > 0 && opts.setVat !== false) p.vat = d.vatPct;
    if (d.total > 0 && opts.setContract !== false) p.contractSum = r2(d.total);
    return p;
  }

  /* ---------- text for lists ---------- */
  function fmtNum(n) { return (Math.round(n * 100) / 100).toLocaleString('en', { maximumFractionDigits: 2 }); }

  return {
    toDays: toDays, fromDays: fromDays, dow: dow, isOff: isOff, holidaysEthiopia: holidaysEthiopia, nextWork: nextWork, finishOf: finishOf, workList: workList, workCount: workCount, offMap: offMap,
    compute: compute, setNest: setNest, successors: successors, OTHER_TEMPLATES: TEMPLATES.filter(function (t) { return !NORM_RULES[t.id] || (NORM_RULES[t.id][0][0] && !NORM_BY_ID[NORM_RULES[t.id][0][0]]); }), autoGangs: autoGangs, setGangs: setGangs, crewIsAuto: crewIsAuto, crewPlan: crewPlan, planOf: planOf, refine: refine, NORM_TEMPLATES: NORM_TEMPLATES, NORM_CATS: NORMS ? NORMS.CATS : [], BUILTIN_PRESETS: BUILTIN_PRESETS, PRESET_PARTS: PRESET_PARTS, DEFAULT_MODES: DEFAULT_MODES, presetLibrary: presetLibrary, presetFromProject: presetFromProject, applyPreset: applyPreset, preview: preview, effTpl: effTpl, prodOf: prodOf, speedOf: speedOf, TRADE: TRADE, tradeLinks: tradeLinks, parseLinks: parseLinks, formatLinks: formatLinks, reschedule: reschedule, wouldLoop: wouldLoop, LINK_TYPES: LINK_TYPES, addWork: addWork, generate: generate, templateOf: templateOf, headsOf: headsOf, templateById: templateById, outputOf: outputOf, TEMPLATES: TEMPLATES, STD_ROLES: STD_ROLES, STD_EQUIP: STD_EQUIP, progress: progress, TOLERANCE: TOLERANCE, autoDurations: autoDurations, manpower: manpower, equipment: equipment,
    PRESETS: PRESETS, presetList: presetList, presetSplit: presetSplit, fitSplit: fitSplit, poolOf: poolOf, splitOf: splitOf, indirectPct: indirectPct, cashflow: cashflow, earnedBy: earnedBy, payments: payments, monthlyValue: monthlyValue,
    parseWorkbook: parseWorkbook, applyImport: applyImport, parseDate: parseDate, parseDur: parseDur, fmtNum: fmtNum
  };
});
