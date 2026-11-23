/* Screens for the construction schedule: Schedule, Manpower, Equipment, Cash flow and Gantt chart.
   Every function receives the app's helper bag `A` (see app.js), so this file has no private access to the app. */
(function () {
  'use strict';

  var S = window.CBSched, L = window.CBLogic;
  var gantt = { gw: 16, asOf: '' };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var STD_ROLES = [
    ['Project Manager', 'permanent'], ['Store Keeper', 'permanent'], ['Surveyor', 'permanent'], ['Foreman', 'permanent'], ['Accountant', 'permanent'], ['Cashier', 'permanent'],
    ['Daily Labour', 'temporary'], ['Mason', 'temporary'], ['Carpenter', 'temporary'], ['Helper', 'temporary'], ['Plasterer', 'temporary'], ['Bar Bender', 'temporary'], ['Tiler', 'temporary'],
    ['Chiseler', 'temporary'], ['Welder', 'temporary'], ['Painter', 'temporary'], ['Glazier', 'temporary'], ['Electrician', 'temporary'], ['Plumber', 'temporary'],
    ['Mixer Operator', 'temporary'], ['Vibrator Operator', 'temporary'], ['Compactor Operator', 'temporary'], ['Truck Driver', 'temporary'], ['Backhoe Loader Operator', 'temporary'], ['Pick Up Driver', 'temporary']
  ];
  var STD_EQUIP = [
    ['Concrete Mixer', 'Rental'], ['Vibrator', 'Rental'], ['Plate Compactor', 'Rental'], ['Pick Up Vehicle', 'Rental'], ['Dump Truck', 'Rental'], ['Backhoe Loader', 'Rental'],
    ['Generator', 'Rental'], ['Welding Machine', 'Rental'], ['Grinder', 'Rental'], ['Driller', 'Rental'], ['Water Tanker', 'Own'], ['Other Tools', 'Own']
  ];

  function ctx(p, A) {
    var C = A.cal();
    var c = { p: p, A: A, t: A.t, el: A.el, btn: A.btn, kv: A.kv, panel: A.panel };
    c.keyFn = function (iso) { return C.monthKey(iso); };
    c.monthLabel = function (k) {
      if (C.id === 'ethiopian') return C.monthLabel(k, A.lang());
      var m = /^(\d{4})-(\d{2})$/.exec(k);
      return m ? MONTHS[+m[2] - 1] + ' ' + m[1].slice(2) : k;
    };
    c.sc = S.compute(p);
    return c;
  }
  function range(c) { return c.sc.sd == null ? '' : c.A.fmtDate(c.sc.start) + ' → ' + c.A.fmtDate(c.sc.finish); }
  function days(n) { return (Math.round(n * 100) / 100) + ' ' + 'd'; }
  function num(n) { return S.fmtNum(n); }

  function noteIfEmpty(c, body) {
    if (c.p.boq.length) return false;
    body.appendChild(c.el('p', 'empty', c.t('sch_no_tasks')));
    var row = c.el('div', 'btnrow');
    row.appendChild(c.btn(c.t('sch_import'), 'primary', function () { pickImport(c, false); }));
    body.appendChild(row);
    return true;
  }

  /* ---------- import / export ---------- */
  var fileInput = null;
  function pickImport(c, asNew) {
    if (!fileInput) {
      fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      fileInput.hidden = true;
      document.body.appendChild(fileInput);
    }
    fileInput.onchange = function () {
      var file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      var reader = new FileReader();
      reader.onerror = function () { c.A.toast(c.t('restore_fail')); };
      reader.onload = function () {
        window.CBXlsxRead.read(reader.result).then(function (sheets) {
          var d = S.parseWorkbook(sheets);
          if (!d || !d.items.length) { c.A.toast(c.t('sch_import_none')); return; }
          confirmImport(c, d, asNew);
        }).catch(function () { c.A.toast(c.t('restore_fail')); });
      };
      reader.readAsArrayBuffer(file);
    };
    fileInput.click();
  }
  function confirmImport(c, d, asNew) {
    var A = c.A, t = c.t, tasks = d.items.filter(function (i) { return !i.kind; }).length;
    var msg = t('sch_import_ask', { tasks: tasks, roles: d.roles.length, equip: d.equip.length, name: d.info.name || '' });
    if (d.notes.length) msg += '\n\n' + d.notes.join('\n');
    if (!asNew) {
      if (c.p.certs.length) { A.toast(t('sch_import_certs')); return; }
      if (c.p.boq.length) msg += '\n\n' + t('sch_import_replace');
    }
    if (!window.confirm(msg)) return;
    if (asNew) {
      var np = L.sanitizeProject({ name: d.info.name || 'Project', client: d.info.client, location: d.info.location, contractor: d.info.contractor, vat: 15, wht: 3, retention: 5, advancePct: 20, recoveryPct: 20, vatWhtPct: 50 }, 1);
      S.applyImport(np, d);
      np = L.sanitizeProject(np, 1);
      A.addProject(np);
      A.toast(t('sch_imported'));
      return;
    }
    var p = c.p;
    S.applyImport(p, d);
    var clean = L.sanitizeProject(p, 1);
    Object.keys(p).forEach(function (k) { delete p[k]; });
    Object.assign(p, clean);
    A.save(); A.rerender();
    A.toast(t('sch_imported') + (d.stretched ? ' · ' + t('sch_stretched', { n: d.stretched }) : ''));
  }
  function exportExcel(c) {
    var p = c.p;
    c.A.saveWorkbook('Schedule-' + c.A.safeName(p.name), window.CBSchedExcel.workbook(p, { keyFn: c.keyFn, monthLabel: c.monthLabel }));
  }

  /* ---------- progress against the plan ---------- */
  function asOfDate() { return gantt.asOf && L.isDate(gantt.asOf) ? gantt.asOf : L.todayStr(); }
  function pct(n) { return (Math.round(n * 1000) / 10) + '%'; }
  var STATUS_ICON = { late: '🔴', ontrack: '🟢', ahead: '🔵', done: '✅', upcoming: '⚪', unplanned: '⚪' };

  function progressPanel(c, body, g) {
    var A = c.A, t = c.t, money = A.money;
    var pn = c.panel(t('sch_progress'));
    pn.appendChild(c.kv(t('sch_as_of'), A.fmtDate(g.asOf) + (gantt.asOf ? '' : ' (' + t('sch_today') + ')')));
    if (g.beforeStart) pn.appendChild(c.el('p', 'muted small', t('sch_before_start')));
    pn.appendChild(c.kv(t('sch_planned_pct'), pct(g.plannedPct)));
    pn.appendChild(c.kv(t('sch_actual_pct'), pct(g.actualPct), g.actualPct + 1e-9 >= g.plannedPct ? 'pos' : 'neg'));
    var bars = c.el('div', 'pvp');
    [['pvp-plan', g.plannedPct], ['pvp-act', g.actualPct]].forEach(function (x) {
      var b = c.el('div', 'pbar'), f = c.el('i', x[0]); f.style.width = Math.min(100, Math.round(x[1] * 100)) + '%'; b.appendChild(f); bars.appendChild(b);
    });
    pn.appendChild(bars);
    pn.appendChild(c.kv(t('sch_planned_value'), money(L.round2(g.plannedValue))));
    pn.appendChild(c.kv(t('sch_actual_value'), money(L.round2(g.actualValue))));
    var gap = L.round2(g.gapValue);
    pn.appendChild(c.kv(gap >= 0 ? t('sch_ahead_by') : t('sch_behind_by'), money(Math.abs(gap)), gap >= 0 ? 'pos' : 'neg', true));
    if (g.ratio != null) pn.appendChild(c.kv(t('sch_ratio'), (Math.round(g.ratio * 100) / 100).toFixed(2)));
    pn.appendChild(c.kv(t('sch_late_tasks'), String(g.lateCount), g.lateCount ? 'neg' : 'pos'));
    pn.appendChild(c.kv(t('sch_done_tasks'), String(g.doneCount)));
    if (g.late.length) {
      pn.appendChild(c.el('div', 'srchgrp', t('sch_late_list')));
      g.late.slice(0, 8).forEach(function (x) {
        var r = x.row, line = c.el('div', 'srow lv2 bad');
        line.tabIndex = 0; line.setAttribute('role', 'button');
        line.appendChild(c.el('div', 'stitle', (r.no ? r.no + '  ' : '') + r.desc));
        line.appendChild(c.el('div', 'smeta', t('sch_planned') + ' ' + pct(x.info.planned) + ' · ' + t('sch_actual') + ' ' + pct(x.info.actual) + (x.info.daysLate ? ' · ' + x.info.daysLate + ' ' + t('sch_days_late') : '')));
        line.addEventListener('click', function () { editTask(c, r); });
        pn.appendChild(line);
      });
      if (g.late.length > 8) pn.appendChild(c.el('p', 'muted small', t('sch_more_late', { n: g.late.length - 8 })));
    }
    var row = c.el('div', 'btnrow');
    row.appendChild(c.btn(t('sch_update_progress'), 'primary', function () { A.goSection('boq'); }));
    row.appendChild(c.btn(t('sch_change_date'), '', function () { editAsOf(c); }));
    pn.appendChild(row);
    pn.appendChild(c.el('p', 'muted small', t('sch_progress_note', { n: Math.round(S.TOLERANCE * 100) })));
    body.appendChild(pn);
  }
  function editAsOf(c) {
    var t = c.t;
    c.A.openForm({
      title: t('sch_change_date'),
      fields: [
        { key: 'd', label: t('sch_as_of'), type: 'date', value: asOfDate() },
        { key: 'today', label: t('sch_use_today'), type: 'select', value: gantt.asOf ? 'no' : 'yes', options: [{ value: 'yes', label: t('sch_today') }, { value: 'no', label: t('sch_this_date') }] }
      ],
      onSubmit: function (v) {
        gantt.asOf = v.today === 'yes' || !L.isDate(v.d) ? '' : v.d;
        c.A.rerender();
        return null;
      }
    });
  }

  /* ---------- Schedule ---------- */
  function secSchedule(body, p, A) {
    var c = ctx(p, A), t = c.t, sc = c.sc;
    var pn = c.panel(t('sch_summary'));
    if (sc.count) {
      pn.appendChild(c.kv(t('sch_period'), range(c)));
      pn.appendChild(c.kv(t('sch_workdays'), String(sc.workDays)));
      pn.appendChild(c.kv(t('sch_caldays'), String(sc.calDays)));
      pn.appendChild(c.kv(t('sch_tasks'), String(sc.count)));
      pn.appendChild(c.kv(t('sch_value'), A.money(L.round2(sc.total))));
      pn.appendChild(c.kv(t('physical_pct'), (Math.round(sc.pct * 10) / 10) + '%'));
    } else pn.appendChild(c.el('p', 'muted small', t('sch_not_planned')));
    var off = p.sched.off.length === 0 ? t('sch_rest_none') : p.sched.off.length === 1 ? t('sch_rest_sun') : t('sch_rest_sat_sun');
    pn.appendChild(c.kv(t('sch_rest'), off));
    var row = c.el('div', 'btnrow');
    row.appendChild(c.btn(t('sch_import'), '', function () { pickImport(c, false); }));
    row.appendChild(c.btn(t('sch_auto'), '', function () {
      if (!window.confirm(t('sch_auto_ask'))) return;
      var n = S.autoDurations(p);
      if (!n) { A.toast(t('sch_auto_none')); return; }
      A.save(); A.rerender(); A.toast(t('sch_auto_done', { n: n }));
    }));
    row.appendChild(c.btn(t('sch_settings'), '', function () { editSettings(c); }));
    if (p.boq.length) row.appendChild(c.btn(t('sch_export'), '', function () { exportExcel(c); }));
    pn.appendChild(row);
    body.appendChild(pn);
    if (noteIfEmpty(c, body)) return;
    var g = S.progress(p, sc, asOfDate());
    if (sc.count) progressPanel(c, body, g);

    var list = c.panel(null);
    list.classList.add('schedlist');
    sc.rows.forEach(function (r) {
      var line = c.el('div', 'srow lv' + r.level + (r.level === 2 && r.kind === 'plain' ? ' plain' : ''));
      var title = c.el('div', 'stitle', (r.no ? r.no + '  ' : '') + r.desc);
      line.appendChild(title);
      if (r.level === 2) {
        var meta = c.el('div', 'smeta');
        if (r.sd != null) meta.appendChild(c.el('span', null, A.fmtDate(r.start) + (r.finish !== r.start ? ' → ' + A.fmtDate(r.finish) : '') + ' · ' + days(r.dur)));
        else meta.appendChild(c.el('span', 'muted', t('sch_set_duration')));
        if (r.amount > 0) meta.appendChild(c.el('span', null, A.money(L.round2(r.amount))));
        line.appendChild(meta);
        var gi = g.by[r.id];
        if (gi) { line.classList.add('st-' + gi.status); title.textContent = (STATUS_ICON[gi.status] || '') + ' ' + title.textContent; }
        if (r.amount > 0) { var bar = c.el('div', 'pbar'); var f = c.el('i'); f.style.width = Math.min(100, Math.round(r.pct)) + '%'; bar.appendChild(f); line.appendChild(bar); }
        line.addEventListener('click', function () { editTask(c, r); });
        line.tabIndex = 0;
        line.setAttribute('role', 'button');
      } else if (r.sd != null) {
        line.appendChild(c.el('div', 'smeta', A.fmtDate(r.start) + ' → ' + A.fmtDate(r.finish) + ' · ' + days(r.dur)));
      }
      list.appendChild(line);
    });
    body.appendChild(list);
  }

  function editSettings(c) {
    var p = c.p, t = c.t, s = p.sched;
    c.A.openForm({
      title: t('sch_settings'),
      fields: [
        { key: 'start', label: t('sch_start'), type: 'date', value: s.start },
        { key: 'rest', label: t('sch_rest'), type: 'select', value: s.off.length === 0 ? 'none' : s.off.length === 1 ? 'sun' : 'satsun',
          options: [{ value: 'sun', label: t('sch_rest_sun') }, { value: 'satsun', label: t('sch_rest_sat_sun') }, { value: 'none', label: t('sch_rest_none') }] },
        { type: 'note', text: t('sch_start_note') }
      ],
      onSubmit: function (v) {
        s.start = L.isDate(v.start) ? v.start : '';
        s.off = v.rest === 'none' ? [] : v.rest === 'satsun' ? [0, 6] : [0];
        c.A.save(); c.A.rerender();
        return null;
      }
    });
  }

  function editTask(c, r) {
    var p = c.p, t = c.t, id = String(r.id);
    var task = p.sched.tasks[id] || (p.sched.tasks[id] = { dur: 0, start: '', par: false, mp: {}, eq: {} });
    var mode = task.start ? 'fixed' : task.par ? 'with' : 'after';
    c.A.openForm({
      title: (r.no ? r.no + ' ' : '') + r.desc.slice(0, 60),
      fields: [
        { key: 'dur', label: t('sch_duration'), type: 'number', min: 0, step: '0.25', value: task.dur || '', ph: '0' },
        { key: 'mode', label: t('sch_starts'), type: 'select', value: mode,
          options: [{ value: 'after', label: t('sch_after_prev') }, { value: 'with', label: t('sch_with_prev') }, { value: 'fixed', label: t('sch_fixed') }] },
        { key: 'start', label: t('sch_start'), type: 'date', value: task.start, showFor: { key: 'mode', values: ['fixed'] } },
        { type: 'note', text: r.sd != null ? t('sch_now') + ' ' + c.A.fmtDate(r.start) + ' → ' + c.A.fmtDate(r.finish) : t('sch_set_duration') }
      ],
      onSubmit: function (v) {
        if (v.mode === 'fixed' && !L.isDate(v.start)) return t('required');
        task.dur = Math.min(9999, Math.max(0, Math.round(v.dur * 100) / 100));
        task.par = v.mode === 'with';
        task.start = v.mode === 'fixed' ? v.start : '';
        c.A.save(); c.A.rerender();
        return null;
      }
    });
  }

  /* ---------- Manpower and Equipment ---------- */
  function usageSection(body, p, A, kind) {
    var c = ctx(p, A), t = c.t, isMp = kind === 'mp';
    var list = isMp ? p.sched.roles : p.sched.equip, field = isMp ? 'mp' : 'eq';
    var usage = isMp ? S.manpower(p, c.sc, c.keyFn) : S.equipment(p, c.sc, c.keyFn);
    var pn = c.panel(isMp ? t('sch_roles') : t('sch_machines'));
    if (c.sc.count) {
      if (isMp) { pn.appendChild(c.kv(t('sch_peak'), String(usage.peak))); }
      pn.appendChild(c.kv(isMp ? t('sch_manday_total') : t('sch_machday_total'), num(usage.totalDays)));
    }
    if (!list.length) pn.appendChild(c.el('p', 'muted small', isMp ? t('sch_no_roles') : t('sch_no_machines')));
    usage.rows.forEach(function (u) {
      var r = c.el('div', 'urow');
      r.tabIndex = 0; r.setAttribute('role', 'button');
      var left = c.el('div', 'meta');
      left.appendChild(c.el('div', 'title', u.item.name));
      var sub = isMp ? (u.item.type === 'permanent' ? t('sch_permanent') : t('sch_temporary')) + (u.item.person ? ' · ' + u.item.person : '') : (u.item.source === 'Own' ? t('sch_own') : t('sch_rental'));
      left.appendChild(c.el('div', 'detail', sub));
      r.appendChild(left);
      var right = c.el('div', 'uright');
      right.appendChild(c.el('b', null, String(u.peak || 0)));
      right.appendChild(c.el('span', 'muted small', ' · ' + num(u.days) + ' ' + (isMp ? t('sch_mandays') : t('sch_machdays'))));
      r.appendChild(right);
      r.addEventListener('click', function () { isMp ? editRole(c, u.item) : editMachine(c, u.item); });
      pn.appendChild(r);
    });
    var row = c.el('div', 'btnrow');
    row.appendChild(c.btn(isMp ? t('sch_add_role') : t('sch_add_machine'), 'primary', function () { isMp ? editRole(c, null) : editMachine(c, null); }));
    if (!list.length) row.appendChild(c.btn(t('sch_add_standard'), '', function () {
      (isMp ? STD_ROLES : STD_EQUIP).forEach(function (x) {
        list.push(isMp ? { id: L.newId(), name: x[0], type: x[1], person: '', count: x[1] === 'permanent' ? 1 : 0 } : { id: L.newId(), name: x[0], source: x[1] });
      });
      A.save(); A.rerender();
    }));
    pn.appendChild(row);
    body.appendChild(pn);
    if (!p.boq.length) { noteIfEmpty(c, body); return; }

    if (list.length && c.sc.count) {
      // month grid
      var grid = c.panel(isMp ? t('sch_by_month_mp') : t('sch_by_month_eq'));
      var wrap = c.el('div', 'tablewrap'), tb = document.createElement('table');
      tb.className = 'gridtable';
      var hr = document.createElement('tr');
      hr.appendChild(c.el('th', 'sticky', isMp ? t('sch_role') : t('sch_machine')));
      usage.months.forEach(function (m) { hr.appendChild(c.el('th', null, c.monthLabel(m))); });
      tb.appendChild(hr);
      usage.rows.forEach(function (u) {
        if (!u.days && !u.peak) return;
        var tr = document.createElement('tr');
        tr.appendChild(c.el('td', 'sticky', u.item.name));
        usage.months.forEach(function (m) { tr.appendChild(c.el('td', u.months[m] ? 'on' : '', u.months[m] ? num(u.months[m]) : '')); });
        tb.appendChild(tr);
      });
      wrap.appendChild(tb);
      grid.appendChild(wrap);
      grid.appendChild(c.el('p', 'muted small', isMp ? t('sch_grid_note_mp') : t('sch_grid_note_eq')));
      body.appendChild(grid);

      if (isMp && usage.hist.length) {
        var hp = c.panel(t('sch_daily_head'));
        var chart = c.el('div', 'histo');
        var max = usage.peak || 1;
        usage.hist.forEach(function (h) {
          var b = c.el('i'); b.style.height = Math.max(2, Math.round(h.n / max * 100)) + '%'; b.title = c.A.fmtDate(h.date) + ': ' + h.n;
          chart.appendChild(b);
        });
        hp.appendChild(chart);
        hp.appendChild(c.el('p', 'muted small', t('sch_peak') + ': ' + usage.peak));
        body.appendChild(hp);
      }
    }

    // per task assignment
    var tp = c.panel(isMp ? t('sch_crew') : t('sch_machines_per_task'));
    if (!list.length) tp.appendChild(c.el('p', 'muted small', isMp ? t('sch_no_roles') : t('sch_no_machines')));
    else {
      tp.appendChild(c.el('p', 'muted small', t('sch_tap_assign')));
      c.sc.rows.forEach(function (r) {
        if (r.level !== 2 || r.kind === 'plain' && !r.dur) return;
        var line = c.el('div', 'srow lv2');
        line.tabIndex = 0; line.setAttribute('role', 'button');
        line.appendChild(c.el('div', 'stitle', (r.no ? r.no + '  ' : '') + r.desc));
        var parts = [];
        list.forEach(function (x) { var n = r.task && r.task[field] ? r.task[field][String(x.id)] : 0; if (n > 0) parts.push(x.name + ' ' + n); });
        line.appendChild(c.el('div', 'smeta', parts.length ? parts.join(' · ') : t('sch_none_assigned')));
        line.addEventListener('click', function () { editAssign(c, r, list, field); });
        tp.appendChild(line);
      });
    }
    body.appendChild(tp);
  }

  function editAssign(c, r, list, field) {
    var t = c.t, p = c.p, id = String(r.id);
    var task = p.sched.tasks[id] || (p.sched.tasks[id] = { dur: 0, start: '', par: false, mp: {}, eq: {} });
    var fields = list.map(function (x) {
      return { key: 'k' + x.id, label: x.name, type: 'number', min: 0, step: '1', noCalc: true, value: task[field][String(x.id)] || '', ph: '0' };
    });
    c.A.openForm({
      title: (r.no ? r.no + ' ' : '') + r.desc.slice(0, 60),
      fields: fields,
      focus: false,
      onSubmit: function (v) {
        var out = {};
        list.forEach(function (x) { var n = Math.round(v['k' + x.id]); if (n > 0) out[String(x.id)] = Math.min(n, 9999); });
        task[field] = out;
        c.A.save(); c.A.rerender();
        return null;
      }
    });
  }

  function dropFromTasks(p, id, field) {
    Object.keys(p.sched.tasks).forEach(function (k) { delete p.sched.tasks[k][field][String(id)]; });
  }
  function editRole(c, role) {
    var t = c.t, p = c.p, isNew = !role, x = role || { name: '', type: 'temporary', person: '', count: 1 };
    c.A.openForm({
      title: isNew ? t('sch_add_role') : t('sch_edit_role'),
      fields: [
        { key: 'name', label: t('sch_role'), type: 'text', value: x.name, required: true },
        { key: 'type', label: t('sch_emp_type'), type: 'select', value: x.type, options: [{ value: 'permanent', label: t('sch_permanent') }, { value: 'temporary', label: t('sch_temporary') }] },
        { key: 'person', label: t('sch_person'), type: 'text', value: x.person, showFor: { key: 'type', values: ['permanent'] } },
        { key: 'count', label: t('sch_required_no'), type: 'number', min: 0, step: '1', noCalc: true, value: x.count, showFor: { key: 'type', values: ['permanent'] } }
      ],
      onSubmit: function (v) {
        var clean = { name: v.name.slice(0, 60), type: v.type, person: v.type === 'permanent' ? v.person.slice(0, 60) : '', count: v.type === 'permanent' ? Math.max(0, Math.round(v.count)) : 0 };
        if (isNew) { clean.id = L.newId(); p.sched.roles.push(clean); } else Object.assign(role, clean);
        c.A.save(); c.A.rerender();
        return null;
      },
      onDelete: isNew ? null : function () {
        if (!window.confirm(t('sch_confirm_delete', { name: role.name }))) return false;
        p.sched.roles = p.sched.roles.filter(function (r) { return r.id !== role.id; });
        dropFromTasks(p, role.id, 'mp');
        c.A.save(); c.A.rerender();
        return true;
      }
    });
  }
  function editMachine(c, m) {
    var t = c.t, p = c.p, isNew = !m, x = m || { name: '', source: 'Rental' };
    c.A.openForm({
      title: isNew ? t('sch_add_machine') : t('sch_edit_machine'),
      fields: [
        { key: 'name', label: t('sch_machine'), type: 'text', value: x.name, required: true },
        { key: 'source', label: t('sch_source'), type: 'select', value: x.source, options: [{ value: 'Rental', label: t('sch_rental') }, { value: 'Own', label: t('sch_own') }] }
      ],
      onSubmit: function (v) {
        var clean = { name: v.name.slice(0, 60), source: v.source === 'Own' ? 'Own' : 'Rental' };
        if (isNew) { clean.id = L.newId(); p.sched.equip.push(clean); } else Object.assign(m, clean);
        c.A.save(); c.A.rerender();
        return null;
      },
      onDelete: isNew ? null : function () {
        if (!window.confirm(t('sch_confirm_delete', { name: m.name }))) return false;
        p.sched.equip = p.sched.equip.filter(function (r) { return r.id !== m.id; });
        dropFromTasks(p, m.id, 'eq');
        c.A.save(); c.A.rerender();
        return true;
      }
    });
  }

  /* ---------- Cash flow ---------- */
  function secCash(body, p, A) {
    var c = ctx(p, A), t = c.t, cf = p.sched.cf, cfw = S.cashflow(p), money = A.money;
    if (noteIfEmpty(c, body)) return;
    var pay = S.payments(p, c.sc);

    var st = c.panel(t('sch_cf_settings'));
    st.appendChild(c.kv(t('sch_misc'), cf.misc + '%'));
    st.appendChild(c.kv(t('sch_overhead'), cf.overhead + '%'));
    st.appendChild(c.kv(t('sch_profit'), cf.profit + '%'));
    st.appendChild(c.kv(t('sch_wht'), cf.wht + '%'));
    st.appendChild(c.kv(t('sch_default_split'), t('sch_material') + ' ' + cf.defSplit[0] + '% · ' + t('sch_labour') + ' ' + cf.defSplit[1] + '% · ' + t('sch_equip') + ' ' + Math.max(0, L.round2(100 - S.indirectPct(cf) - cf.defSplit[0] - cf.defSplit[1])) + '%'));
    st.appendChild(c.kv(t('sch_adv'), cf.advPct + '%'));
    st.appendChild(c.kv(t('sch_interim'), String(cf.cuts.length || cf.interim)));
    st.appendChild(c.btn(t('sch_edit'), 'block', function () { editCf(c); }));
    body.appendChild(st);

    var tp = c.panel(t('sch_cost_summary'));
    var T = cfw.totals;
    tp.appendChild(c.kv(t('sch_material'), money(L.round2(T.mat))));
    tp.appendChild(c.kv(t('sch_labour'), money(L.round2(T.lab))));
    tp.appendChild(c.kv(t('sch_equip'), money(L.round2(T.eq))));
    tp.appendChild(c.kv(t('sch_direct'), money(L.round2(cfw.direct)), 'total'));
    tp.appendChild(c.kv(t('sch_misc'), money(L.round2(T.misc))));
    tp.appendChild(c.kv(t('sch_overhead'), money(L.round2(T.oh))));
    tp.appendChild(c.kv(t('sch_profit'), money(L.round2(T.profit)), 'pos'));
    tp.appendChild(c.kv(t('sch_wht'), money(L.round2(T.wht))));
    tp.appendChild(c.kv(t('sch_indirect'), money(L.round2(cfw.indirect)), 'total'));
    tp.appendChild(c.kv(t('sch_total_excl'), money(L.round2(T.amount)), 'total'));
    tp.appendChild(c.kv('+ VAT (' + p.vat + '%)', money(L.round2(T.vat))));
    tp.appendChild(c.kv(t('contract_incl_vat'), money(L.round2(cfw.withVat)), 'total'));
    body.appendChild(tp);

    var pp = c.panel(t('sch_payments'));
    pay.list.forEach(function (x) {
      var d = document.createElement('details');
      d.className = 'paydet';
      var sm = document.createElement('summary');
      var name = x.kind === 'adv' ? t('sch_pay_adv') : x.kind === 'final' ? t('sch_pay_final') : x.name;
      sm.appendChild(c.el('span', null, name + (x.date ? ' · ' + A.fmtDate(x.date) : '')));
      sm.appendChild(c.el('b', null, money(L.round2(x.amount))));
      d.appendChild(sm);
      d.appendChild(c.kv(t('sch_material'), money(L.round2(x.mat))));
      d.appendChild(c.kv(t('sch_labour'), money(L.round2(x.lab))));
      d.appendChild(c.kv(t('sch_equip'), money(L.round2(x.eq))));
      d.appendChild(c.kv(t('sch_misc'), money(L.round2(x.misc))));
      d.appendChild(c.kv(t('sch_overhead'), money(L.round2(x.oh))));
      d.appendChild(c.kv(t('sch_profit'), money(L.round2(x.profit))));
      d.appendChild(c.kv(t('sch_wht'), money(L.round2(x.wht))));
      d.appendChild(c.kv('VAT', money(L.round2(x.vat))));
      d.appendChild(c.kv(t('sch_total_incl'), money(L.round2(x.total)), 'total'));
      d.appendChild(c.kv(t('sch_cum'), (Math.round(x.cumPct * 10) / 10) + '%'));
      pp.appendChild(d);
    });
    pp.appendChild(c.kv(t('sch_total_excl'), money(L.round2(pay.totals.amount)), 'total'));
    var prow = c.el('div', 'btnrow');
    prow.appendChild(c.btn(t('sch_cutoffs'), '', function () { editCuts(c, pay); }));
    if (cf.cuts.length) prow.appendChild(c.btn(t('sch_cutoffs_auto'), '', function () { cf.cuts = []; A.save(); A.rerender(); }));
    pp.appendChild(prow);
    body.appendChild(pp);

    var mv = S.monthlyValue(p, c.sc, c.keyFn);
    if (mv.length) {
      var mp = c.panel(t('sch_monthly'));
      var max = mv.reduce(function (m, x) { return Math.max(m, x.value); }, 1);
      mv.forEach(function (x) {
        var r = c.el('div', 'mrow');
        r.appendChild(c.el('span', 'mk', c.monthLabel(x.key)));
        var b = c.el('div', 'mbar'), f = c.el('i'); f.style.width = Math.round(x.value / max * 100) + '%'; b.appendChild(f); r.appendChild(b);
        r.appendChild(c.el('span', 'mv', money(L.round2(x.value)) + ' · ' + Math.round(x.pct) + '%'));
        mp.appendChild(r);
      });
      mp.appendChild(c.el('p', 'muted small', t('sch_monthly_note')));
      body.appendChild(mp);
    }

    var lp = c.panel(t('sch_split_list'));
    lp.appendChild(c.el('p', 'muted small', t('sch_split_note')));
    cfw.rows.forEach(function (x) {
      var line = c.el('div', 'srow lv2' + (x.split.over ? ' bad' : ''));
      line.tabIndex = 0; line.setAttribute('role', 'button');
      line.appendChild(c.el('div', 'stitle', (x.no ? x.no + '  ' : '') + x.desc));
      line.appendChild(c.el('div', 'smeta', money(L.round2(x.amount)) + ' · ' + x.split.mat + '/' + x.split.lab + '/' + x.split.eq + '%' + (x.split.custom ? ' ✎' : '')));
      line.addEventListener('click', function () { editSplit(c, x); });
      lp.appendChild(line);
    });
    body.appendChild(lp);
    if (p.boq.length) body.appendChild(c.btn(t('sch_export'), 'block', function () { exportExcel(c); }));
  }

  function editCf(c) {
    var t = c.t, cf = c.p.sched.cf;
    c.A.openForm({
      title: t('sch_cf_settings'),
      fields: [
        { key: 'misc', label: t('sch_misc') + ' %', type: 'number', min: 0, max: 100, value: cf.misc },
        { key: 'overhead', label: t('sch_overhead') + ' %', type: 'number', min: 0, max: 100, value: cf.overhead },
        { key: 'profit', label: t('sch_profit') + ' %', type: 'number', min: 0, max: 100, value: cf.profit },
        { key: 'wht', label: t('sch_wht') + ' %', type: 'number', min: 0, max: 100, value: cf.wht },
        { key: 'mat', label: t('sch_material') + ' % (' + t('sch_default_split') + ')', type: 'number', min: 0, max: 100, value: cf.defSplit[0] },
        { key: 'lab', label: t('sch_labour') + ' % (' + t('sch_default_split') + ')', type: 'number', min: 0, max: 100, value: cf.defSplit[1] },
        { key: 'adv', label: t('sch_adv') + ' %', type: 'number', min: 0, max: 100, value: cf.advPct },
        { key: 'interim', label: t('sch_interim'), type: 'number', min: 0, max: 20, step: '1', noCalc: true, value: cf.interim },
        { type: 'note', text: t('sch_cf_note') }
      ],
      onSubmit: function (v) {
        var ind = v.misc + v.overhead + v.profit + v.wht;
        if (ind > 100 || v.mat + v.lab + ind > 100.005) return t('sch_split_over');
        cf.misc = v.misc; cf.overhead = v.overhead; cf.profit = v.profit; cf.wht = v.wht;
        cf.defSplit = [v.mat, v.lab]; cf.advPct = Math.min(100, v.adv);
        var n = Math.max(0, Math.min(20, Math.round(v.interim)));
        if (n !== cf.interim) cf.cuts = [];
        cf.interim = n;
        c.A.save(); c.A.rerender();
        return null;
      }
    });
  }
  function editSplit(c, x) {
    var t = c.t, p = c.p, cf = p.sched.cf, pool = Math.max(0, L.round2(100 - S.indirectPct(cf)));
    var task = p.sched.tasks[String(x.id)] || (p.sched.tasks[String(x.id)] = { dur: 0, start: '', par: false, mp: {}, eq: {} });
    c.A.openForm({
      title: x.desc.slice(0, 60),
      fields: [
        { key: 'preset', label: t('sch_preset'), type: 'select', value: 'keep',
          options: [{ value: 'keep', label: t('sch_preset_keep') }, { value: 'general', label: t('sch_preset_general') }, { value: 'earthwork', label: t('sch_preset_earth') }, { value: 'backfill', label: t('sch_preset_back') }, { value: 'default', label: t('sch_preset_default') }] },
        { key: 'mat', label: t('sch_material') + ' %', type: 'number', min: 0, max: 100, value: x.split.mat },
        { key: 'lab', label: t('sch_labour') + ' %', type: 'number', min: 0, max: 100, value: x.split.lab },
        { type: 'note', text: t('sch_split_pool', { pool: pool }) }
      ],
      onSubmit: function (v) {
        if (v.preset === 'default') { delete task.split; }
        else {
          var sp = v.preset !== 'keep' && S.PRESETS[v.preset] ? S.PRESETS[v.preset] : [v.mat, v.lab];
          if (sp[0] + sp[1] > pool + 0.005) return t('sch_split_over');
          task.split = [sp[0], sp[1]];
        }
        c.A.save(); c.A.rerender();
        return null;
      }
    });
  }
  function editCuts(c, pay) {
    var t = c.t, cf = c.p.sched.cf, cuts = pay.cuts, fields = [];
    if (!cuts.length) { c.A.toast(t('sch_cutoffs_none')); return; }
    cuts.forEach(function (d, i) { fields.push({ key: 'd' + i, label: t('sch_cutoff') + ' ' + (i + 1), type: 'date', value: d, required: true }); });
    fields.push({ type: 'note', text: t('sch_cutoff_note') });
    c.A.openForm({
      title: t('sch_cutoffs'),
      fields: fields,
      onSubmit: function (v) {
        var out = [];
        cuts.forEach(function (d, i) { if (L.isDate(v['d' + i]) && out.indexOf(v['d' + i]) < 0) out.push(v['d' + i]); });
        out.sort();
        cf.cuts = out; cf.interim = out.length;
        c.A.save(); c.A.rerender();
        return null;
      }
    });
  }

  /* ---------- Gantt chart ---------- */
  function secGantt(body, p, A) {
    var c = ctx(p, A), t = c.t, sc = c.sc;
    if (noteIfEmpty(c, body)) return;
    if (sc.sd == null) { body.appendChild(c.el('p', 'empty', t('sch_not_planned'))); return; }
    var g = S.progress(p, sc, asOfDate());
    progressPanel(c, body, g);
    var bar = c.panel(null);
    bar.appendChild(c.kv(t('sch_period'), range(c)));
    var zr = c.el('div', 'btnrow');
    var sizes = [5, 9, 16, 26, 40];
    zr.appendChild(c.btn('－', '', function () { var i = sizes.indexOf(gantt.gw); gantt.gw = sizes[Math.max(0, i - 1)] || 16; A.rerender(); }));
    zr.appendChild(c.el('span', 'zoomlbl', t('sch_zoom')));
    zr.appendChild(c.btn('＋', '', function () { var i = sizes.indexOf(gantt.gw); gantt.gw = sizes[Math.min(sizes.length - 1, i + 1)] || 16; A.rerender(); }));
    zr.appendChild(c.btn(t('sch_export'), '', function () { exportExcel(c); }));
    bar.appendChild(zr);
    var lg = c.el('div', 'glegend');
    [['gb-group', t('sch_legend_group')], ['gb-line', t('sch_legend_section')], ['gb-task', t('sch_legend_task')], ['gb-plan', t('sch_legend_plan')], ['gb-done', t('sch_legend_done')], ['gb-late', t('sch_legend_late')]].forEach(function (x) {
      var s = c.el('span'); s.appendChild(c.el('i', x[0])); s.appendChild(document.createTextNode(' ' + x[1])); lg.appendChild(s);
    });
    bar.appendChild(lg);
    body.appendChild(bar);

    var gw = gantt.gw, LABEL = 150, a = sc.sd - ((S.dow(sc.sd) + 6) % 7), b = sc.fd;   // start on a Monday
    var n = b - a + 1, width = LABEL + n * gw;
    var wrap = c.el('div', 'gantt'), inner = c.el('div', 'gt-inner');
    inner.style.width = width + 'px';

    var hm = c.el('div', 'gt-head');
    hm.style.width = width + 'px';
    var lab = c.el('div', 'gt-label gt-corner', t('sch_task'));
    hm.appendChild(lab);
    var area = c.el('div', 'gt-months');
    area.style.width = (n * gw) + 'px';
    var curKey = null, seg = null, segDays = 0;
    function flush() { if (seg) { seg.style.width = segDays * gw + 'px'; seg.textContent = segDays * gw >= 34 ? c.monthLabel(curKey) : ''; area.appendChild(seg); } }
    for (var d = a; d <= b; d++) {
      var k = c.keyFn(S.fromDays(d));
      if (k !== curKey) { flush(); curKey = k; seg = c.el('div', 'gt-month'); segDays = 0; }
      segDays += 1;
    }
    flush();
    hm.appendChild(area);
    inner.appendChild(hm);
    var hd = c.el('div', 'gt-head gt-days');
    hd.style.width = width + 'px';
    hd.appendChild(c.el('div', 'gt-label gt-corner'));
    var dayrow = c.el('div', 'gt-dayrow');
    dayrow.style.width = (n * gw) + 'px';
    for (var d2 = a; d2 <= b; d2++) {
      var cell = c.el('div', 'gt-day' + (sc.off[S.dow(d2)] ? ' off' : ''));
      cell.style.width = gw + 'px';
      if (gw >= 16) cell.textContent = String(A.cal().parts(S.fromDays(d2)).d);
      else if (S.dow(d2) === 1 && gw >= 9) cell.textContent = String(A.cal().parts(S.fromDays(d2)).d);
      dayrow.appendChild(cell);
    }
    hd.appendChild(dayrow);
    inner.appendChild(hd);

    var rowsBox = c.el('div', 'gt-rows');
    rowsBox.style.width = width + 'px';
    // rest-day stripes and today line, drawn once behind the bars
    var stripes = c.el('div', 'gt-stripes');
    stripes.style.left = LABEL + 'px'; stripes.style.width = (n * gw) + 'px';
    for (var d3 = a; d3 <= b; d3++) if (sc.off[S.dow(d3)]) { var sx = c.el('i'); sx.style.left = (d3 - a) * gw + 'px'; sx.style.width = gw + 'px'; stripes.appendChild(sx); }
    var today = S.toDays(g.asOf);
    if (today >= a && today <= b) { var tl = c.el('b', 'gt-today'); tl.style.left = ((today - a) * gw + gw / 2) + 'px'; stripes.appendChild(tl); }
    rowsBox.appendChild(stripes);
    sc.rows.forEach(function (r) {
      var row = c.el('div', 'gt-row lv' + r.level);
      var lb = c.el('div', 'gt-label', (r.no ? r.no + ' ' : '') + r.desc);
      lb.title = r.desc;
      row.appendChild(lb);
      if (r.sd != null) {
        var bx = c.el('div', 'gt-bar ' + (r.level === 0 ? 'gb-group' : r.level === 1 ? 'gb-line' : 'gb-task'));
        bx.style.left = (LABEL + (r.sd - a) * gw) + 'px';
        bx.style.width = Math.max(gw - 2, (r.fd - r.sd + 1) * gw - 2) + 'px';
        bx.title = r.desc + '\n' + A.fmtDate(r.start) + ' → ' + A.fmtDate(r.finish) + ' · ' + days(r.dur);
        var gi = g.by[r.id];
        if (gi) {
          if (gi.planned > 0) { var pl = c.el('i', 'gb-plan'); pl.style.width = Math.min(100, Math.round(gi.planned * 100)) + '%'; bx.appendChild(pl); }
          if (gi.actual > 0) { var dn = c.el('i', 'gb-done'); dn.style.width = Math.min(100, Math.round(gi.actual * 100)) + '%'; bx.appendChild(dn); }
          if (gi.status === 'late') { bx.classList.add('late'); lb.classList.add('late'); }
          bx.title += '\n' + t('sch_planned') + ' ' + pct(gi.planned) + ' · ' + t('sch_actual') + ' ' + pct(gi.actual);
        }
        if ((r.fd - r.sd + 1) * gw >= 44) bx.appendChild(c.el('span', null, days(r.dur)));
        row.appendChild(bx);
      }
      if (r.level === 2) { row.classList.add('click'); row.addEventListener('click', function () { editTask(c, r); }); }
      rowsBox.appendChild(row);
    });
    inner.appendChild(rowsBox);
    wrap.appendChild(inner);
    body.appendChild(wrap);
    body.appendChild(c.el('p', 'muted small', t('sch_gantt_note')));
  }

  /* ---------- entry points ---------- */
  window.CBSchedUI = {
    sections: ['schedule', 'manpower', 'equipment', 'cashflow', 'gantt'],
    render: function (sec, body, p, A) {
      if (sec === 'schedule') secSchedule(body, p, A);
      else if (sec === 'manpower') usageSection(body, p, A, 'mp');
      else if (sec === 'equipment') usageSection(body, p, A, 'eq');
      else if (sec === 'cashflow') secCash(body, p, A);
      else if (sec === 'gantt') secGantt(body, p, A);
    },
    importNew: function (A) { pickImport({ A: A, t: A.t, p: { certs: [], boq: [] } }, true); }
  };
})();
