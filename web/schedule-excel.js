/* Excel (.xlsx) export of the construction schedule, laid out like the contractor's schedule workbook:
   Schedule, Man Power (per task), Man Power Schedule (per month), Equipment, Equipment Schedule,
   Cash Flow, Cash Flow Summary and a weekly Gantt sheet. Pure functions, no DOM access. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./logic.js'), require('./schedule.js'));
  else root.CBSchedExcel = factory(root.CBLogic, root.CBSched);
})(this, function (L, S) {
  'use strict';

  var F = 'Calibri';
  var MONEY = '#,##0.00', QTY = '#,##0.00#';
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function st(o, base) { var r = {}; Object.keys(base || {}).forEach(function (k) { r[k] = base[k]; }); Object.keys(o || {}).forEach(function (k) { r[k] = o[k]; }); return r; }
  function d2(iso) { // Tue 01/12/26
    if (!iso) return '';
    var n = S.toDays(iso), dt = new Date(n * 86400000);
    return DOW[S.dow(n)] + ' ' + iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(2, 4);
  }
  function dur(n) { return n ? (n === 1 ? '1 day' : n + ' days') : ''; }

  var HEAD = { b: true, sz: 11, font: F, h: 'center', border: 'thin', fill: 'D9D9D9', wrap: true };
  var CELL = { sz: 11, font: F, border: 'thin', v: 'top' };
  var NUM = st({ fmt: MONEY, h: 'right' }, CELL), QT = st({ fmt: QTY, h: 'right' }, CELL), TXT = st({ wrap: true }, CELL), CEN = st({ h: 'center' }, CELL);
  var GROUP = st({ b: true, fill: '1F3864', color: 'FFFFFF' }, CELL), LINE = st({ b: true, fill: 'D9E1F2' }, CELL), PLAIN = st({ b: true }, CELL);
  var TOTAL = st({ b: true, fill: 'F2F2F2' }, CELL);

  function sheet(name, wb, cols) {
    var sh = { name: name, cols: cols || [], rows: [], merges: [], landscape: true };
    wb.sheets.push(sh);
    sh.put = function (r, c, v) { while (sh.rows.length < r) sh.rows.push(null); if (!sh.rows[r - 1]) sh.rows[r - 1] = []; sh.rows[r - 1][c] = v; };
    return sh;
  }
  function titleBlock(sh, p, title, ncols) {
    var b = { b: true, sz: 12, font: F };
    sh.put(1, 0, { v: p.contractor || '', s: st({ sz: 13 }, b) });
    sh.put(1, 3, { v: title, s: b });
    sh.put(2, 0, { v: 'Project :- ' + p.name, s: b });
    sh.put(3, 0, { v: 'Client :- ' + p.client, s: b });
    sh.put(4, 0, { v: 'Location :- ' + p.location, s: b });
    return 6;
  }
  function labelCell(row, lvl) { return lvl === 0 ? GROUP : lvl === 1 ? LINE : (row.kind === 'plain' ? PLAIN : TXT); }

  /* the common left part of the schedule, manpower, equipment and cash flow sheets */
  function taskColumns(sh, r, sc, withDates) {
    var hs = HEAD;
    ['No', 'Task Name', 'Unit', 'QTY', 'Rate', 'Amount'].concat(withDates ? ['Duration', 'Start', 'Finish'] : []).forEach(function (h, i) { sh.put(r, i, { v: h, s: hs }); });
  }
  function taskRow(sh, r, row, withDates) {
    var base = labelCell(row, row.level), isItem = row.level === 2 && row.kind !== 'plain';
    sh.put(r, 0, { v: row.no, s: row.level === 2 ? CEN : base });
    sh.put(r, 1, { v: row.desc, s: base });
    sh.put(r, 2, { v: row.unit, s: row.level === 2 ? CEN : base });
    sh.put(r, 3, isItem ? { v: row.qty, s: QT } : { v: '', s: base });
    sh.put(r, 4, isItem ? { v: row.rate, s: st({ fmt: '#,##0.00####' }, NUM) } : { v: '', s: base });
    sh.put(r, 5, isItem ? { v: row.amount, f: 'D' + r + '*E' + r, s: NUM } : { v: '', s: base });
    if (withDates) {
      sh.put(r, 6, { v: dur(row.dur), s: row.level === 2 ? CEN : base });
      sh.put(r, 7, { v: d2(row.start), s: row.level === 2 ? CEN : base });
      sh.put(r, 8, { v: d2(row.finish), s: row.level === 2 ? CEN : base });
    }
  }
  function sumRows(sh, r, first, last, cols, label) {
    sh.put(r, 1, { v: label, s: TOTAL });
    for (var c = 0; c < 9; c++) if (c !== 1 && c < 6) sh.put(r, c, { v: '', s: TOTAL });
    cols.forEach(function (c) {
      var col = require_col(c);
      sh.put(r, c, { v: 0, f: 'SUM(' + col + first + ':' + col + last + ')', s: st({ fmt: MONEY, h: 'right' }, TOTAL) });
    });
  }
  function require_col(i) { var s = '', n = i + 1; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

  function scheduleSheet(wb, p, sc) {
    var sh = sheet('Schedule', wb, [6, 60, 8, 11, 12, 16, 11, 15, 15, 9]);
    var r = titleBlock(sh, p, 'Construction Schedule');
    sh.put(r, 0, { v: 'Project Time Span', s: { b: true, font: F } }); sh.put(r, 2, { v: d2(sc.start) + ' - ' + d2(sc.finish), s: { b: true, font: F } });
    r += 2;
    taskColumns(sh, r, sc, true); sh.put(r, 9, { v: '% done', s: HEAD });
    var first = r + 1;
    sc.rows.forEach(function (row) {
      r += 1; taskRow(sh, r, row, true);
      sh.put(r, 9, { v: row.level === 2 && row.amount > 0 ? Math.round(row.pct * 10) / 10 : '', s: row.level === 2 ? CEN : labelCell(row, row.level) });
    });
    var last = r;
    r += 1; sumRows(sh, r, first, last, [5], 'Total');
    var vat = L.round2(sc.total * p.vat / 100);
    sh.put(r + 1, 1, { v: 'VAT (' + p.vat + '%)', s: TOTAL }); sh.put(r + 1, 5, { v: vat, f: 'F' + r + '*' + (p.vat / 100), s: st({ fmt: MONEY, h: 'right' }, TOTAL) });
    sh.put(r + 2, 1, { v: 'Total with VAT', s: TOTAL }); sh.put(r + 2, 5, { v: L.round2(sc.total + vat), f: 'F' + r + '+F' + (r + 1), s: st({ fmt: MONEY, h: 'right' }, TOTAL) });
    return sh;
  }

  function matrixSheet(wb, p, sc, name, title, list, field) {
    var cols = [6, 60, 8, 11, 12, 16, 11, 15, 15].concat(list.map(function () { return 9; }));
    var sh = sheet(name, wb, cols);
    var r = titleBlock(sh, p, title);
    sh.put(r - 1, 0, { v: 'Project Time Span', s: { b: true, font: F } }); sh.put(r - 1, 2, { v: d2(sc.start) + ' - ' + d2(sc.finish), s: { b: true, font: F } });
    r += 1;
    taskColumns(sh, r, sc, true);
    list.forEach(function (x, i) { sh.put(r, 9 + i, { v: x.name, s: st({ sz: 9 }, HEAD) }); });
    sh.heights = {}; sh.heights[r] = 48;
    var first = r + 1;
    sc.rows.forEach(function (row) {
      r += 1; taskRow(sh, r, row, true);
      list.forEach(function (x, i) {
        var n = row.level === 2 && row.task && row.task[field] ? row.task[field][String(x.id)] : 0;
        sh.put(r, 9 + i, { v: n > 0 ? n : '', s: row.level === 2 ? CEN : labelCell(row, row.level) });
      });
    });
    return sh;
  }

  function monthGrid(wb, p, name, title, usage, keyLabel, headers, first) {
    var cols = [6, 34, 20, 14, 10].concat(usage.months.map(function () { return 8; })).concat([10]);
    var sh = sheet(name, wb, cols);
    var r = titleBlock(sh, p, title);
    var h = ['S/N', headers[0], headers[1], headers[2], 'Required No.'];
    h.forEach(function (x, i) { sh.put(r, i, { v: x, s: HEAD }); });
    usage.months.forEach(function (m, i) { sh.put(r, 5 + i, { v: keyLabel(m), s: HEAD }); });
    sh.put(r, 5 + usage.months.length, { v: 'Total days', s: HEAD });
    usage.rows.forEach(function (u, k) {
      r += 1;
      sh.put(r, 0, { v: k + 1, s: CEN }); sh.put(r, 1, { v: u.item.name, s: TXT });
      sh.put(r, 2, { v: first(u), s: TXT }); sh.put(r, 3, { v: u.item.type ? (u.item.type === 'permanent' ? 'Permanent' : 'Temporary') : u.item.source, s: CEN });
      sh.put(r, 4, { v: u.peak || '', s: CEN });
      usage.months.forEach(function (m, i) { sh.put(r, 5 + i, { v: u.months[m] ? Math.round(u.months[m] * 10) / 10 : '', s: CEN }); });
      sh.put(r, 5 + usage.months.length, { v: u.days || '', s: CEN });
    });
    return sh;
  }

  function cashSheet(wb, p, sc, cfw) {
    var sh = sheet('Cash Flow', wb, [6, 56, 8, 10, 11, 15, 15, 15, 15, 15, 15, 15, 15, 15]);
    var r = titleBlock(sh, p, 'Cash Flow');
    r += 1;
    ['No', 'Task Name', 'Unit', 'QTY', 'Rate', 'Amount', 'Material Cost', 'Labor Cost', 'Equipment and tools Cost', 'Miscellaneous Expenses', 'Over head cost', 'Profit', 'Withholding Tax', 'VAT']
      .forEach(function (x, i) { sh.put(r, i, { v: x, s: HEAD }); });
    sh.put(r - 1, 6, { v: 'Direct Cost', s: HEAD }); sh.put(r - 1, 9, { v: 'Indirect Cost', s: HEAD });
    sh.merges.push('G' + (r - 1) + ':I' + (r - 1), 'J' + (r - 1) + ':M' + (r - 1));
    var first = r + 1, byId = {};
    cfw.rows.forEach(function (x) { byId[x.id] = x; });
    sc.rows.forEach(function (row) {
      var x = byId[row.id];
      r += 1;
      if (!x) { sh.put(r, 1, { v: row.desc, s: labelCell(row, row.level) }); for (var c = 0; c < 14; c++) if (c !== 1) sh.put(r, c, { v: '', s: labelCell(row, row.level) }); return; }
      sh.put(r, 0, { v: x.no, s: CEN }); sh.put(r, 1, { v: x.desc, s: TXT }); sh.put(r, 2, { v: x.unit, s: CEN });
      sh.put(r, 3, { v: x.qty, s: QT }); sh.put(r, 4, { v: x.rate, s: st({ fmt: '#,##0.00####' }, NUM) });
      sh.put(r, 5, { v: x.amount, f: 'D' + r + '*E' + r, s: NUM });
      var pc = [x.split.mat, x.split.lab, x.split.eq, p.sched.cf.misc, p.sched.cf.overhead, p.sched.cf.profit, p.sched.cf.wht, p.vat];
      var vals = [x.mat, x.lab, x.eq, x.misc, x.oh, x.profit, x.wht, x.vat];
      for (var k = 0; k < 8; k++) sh.put(r, 6 + k, { v: vals[k], f: 'F' + r + '*' + pc[k] / 100, s: NUM });
    });
    var last = r;
    r += 1;
    sh.put(r, 1, { v: 'Total', s: TOTAL });
    for (var c2 = 5; c2 < 14; c2++) { var col = require_col(c2); sh.put(r, c2, { v: 0, f: 'SUM(' + col + first + ':' + col + last + ')', s: st({ fmt: MONEY, h: 'right' }, TOTAL) }); }
    sh.put(r + 1, 1, { v: 'VAT', s: TOTAL }); sh.put(r + 1, 5, { v: cfw.totals.vat, f: 'N' + r, s: st({ fmt: MONEY, h: 'right' }, TOTAL) });
    sh.put(r + 2, 1, { v: 'Total With VAT', s: TOTAL }); sh.put(r + 2, 5, { v: cfw.withVat, f: 'F' + r + '+F' + (r + 1), s: st({ fmt: MONEY, h: 'right' }, TOTAL) });
    return sh;
  }

  function paymentSheet(wb, p, pay) {
    var sh = sheet('Cash Flow Summary', wb, [6, 22, 15, 15, 16, 16, 16, 16, 16, 16, 16, 16, 16]);
    var r = titleBlock(sh, p, 'Payment schedule');
    ['No', 'Payments', 'Date', 'Amount', 'Material Cost', 'Labor Cost', 'Equipment and tools Cost', 'Miscellaneous Expenses', 'Over head cost', 'Profit', 'Withholding Tax', 'VAT', 'Total with VAT']
      .forEach(function (x, i) { sh.put(r, i, { v: x, s: st({ sz: 10 }, HEAD) }); });
    var first = r + 1;
    pay.list.forEach(function (x, i) {
      r += 1;
      var v = [x.amount, x.mat, x.lab, x.eq, x.misc, x.oh, x.profit, x.wht, x.vat];
      sh.put(r, 0, { v: i + 1, s: CEN }); sh.put(r, 1, { v: x.name, s: TXT }); sh.put(r, 2, { v: d2(x.date), s: CEN });
      v.forEach(function (n, k) { sh.put(r, 3 + k, { v: n, s: NUM }); });
      sh.put(r, 12, { v: x.total, f: 'D' + r + '+L' + r, s: NUM });
    });
    var last = r;
    r += 1;
    sh.put(r, 1, { v: 'Total', s: TOTAL }); sh.put(r, 2, { v: '', s: TOTAL });
    for (var c = 3; c < 13; c++) { var col = require_col(c); sh.put(r, c, { v: 0, f: 'SUM(' + col + first + ':' + col + last + ')', s: st({ fmt: MONEY, h: 'right' }, TOTAL) }); }
    r += 2;
    sh.put(r, 1, { v: 'Cost shares', s: { b: true, font: F } });
    [['Material', pay.shares.mat], ['Labor', pay.shares.lab], ['Equipment and tools', pay.shares.eq], ['Miscellaneous', pay.shares.misc], ['Over head', pay.shares.oh], ['Profit', pay.shares.profit], ['Withholding Tax', pay.shares.wht]]
      .forEach(function (x, i) { sh.put(r + 1 + i, 1, { v: x[0], s: CELL }); sh.put(r + 1 + i, 2, { v: x[1], s: st({ fmt: '0.00%', h: 'right' }, CELL) }); });
    return sh;
  }

  function ganttSheet(wb, p, sc) {
    var weeks = [];
    if (sc.sd != null) {
      var d = sc.sd - ((S.dow(sc.sd) + 6) % 7); // back to Monday
      for (; d <= sc.fd; d += 7) weeks.push(d);
    }
    var sh = sheet('Gantt', wb, [6, 56, 14, 14, 8].concat(weeks.map(function () { return 4.5; })));
    var r = titleBlock(sh, p, 'Gantt chart (weeks start on Monday)');
    ['No', 'Task Name', 'Start', 'Finish', 'Days'].forEach(function (x, i) { sh.put(r, i, { v: x, s: HEAD }); });
    weeks.forEach(function (w, i) { var iso = S.fromDays(w); sh.put(r, 5 + i, { v: iso.slice(8, 10) + '/' + iso.slice(5, 7), s: st({ sz: 8 }, HEAD) }); });
    sh.heights = {}; sh.heights[r] = 30;
    var bar = { fill: '2F75B5', border: 'thin' }, grp = { fill: '1F3864', border: 'thin' }, lin = { fill: '8EA9DB', border: 'thin' }, blank = { border: 'thin' };
    sc.rows.forEach(function (row) {
      r += 1;
      var base = labelCell(row, row.level);
      sh.put(r, 0, { v: row.no, s: row.level === 2 ? CEN : base }); sh.put(r, 1, { v: row.desc, s: base });
      sh.put(r, 2, { v: d2(row.start), s: row.level === 2 ? CEN : base }); sh.put(r, 3, { v: d2(row.finish), s: row.level === 2 ? CEN : base });
      sh.put(r, 4, { v: row.dur || '', s: row.level === 2 ? CEN : base });
      weeks.forEach(function (w, i) {
        var on = row.sd != null && row.sd <= w + 6 && row.fd >= w;
        sh.put(r, 5 + i, { v: '', s: on ? (row.level === 0 ? grp : row.level === 1 ? lin : bar) : blank });
      });
    });
    return sh;
  }

  function workbook(p, opts) {
    opts = opts || {};
    var keyFn = opts.keyFn, label = opts.monthLabel || function (k) { return k; };
    var sc = S.compute(p), cfw = S.cashflow(p), pay = S.payments(p, sc);
    var mp = S.manpower(p, sc, keyFn), eq = S.equipment(p, sc, keyFn);
    var wb = { sheets: [] };
    scheduleSheet(wb, p, sc);
    matrixSheet(wb, p, sc, 'Man Power', 'Man Power Schedule', p.sched.roles, 'mp');
    monthGrid(wb, p, 'Man Power Schedule', 'Man power schedule and acquisition', mp, label, ['Man Power Type', 'Assigned Person', 'Type of Employment'], function (u) { return u.item.person; });
    matrixSheet(wb, p, sc, 'Equipment', 'Equipment Schedule', p.sched.equip, 'eq');
    monthGrid(wb, p, 'Equipment Schedule', 'Equipment schedule and acquisition', eq, label, ['Type of Machinery / Equipment', '', 'Source of Equipment'], function () { return ''; });
    cashSheet(wb, p, sc, cfw);
    paymentSheet(wb, p, pay);
    ganttSheet(wb, p, sc);
    return wb;
  }

  return { workbook: workbook };
});
