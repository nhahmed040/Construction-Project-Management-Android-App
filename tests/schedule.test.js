/* Run: node tests/schedule.test.js   (no dependencies) */
var assert = require('assert');
var L = require('../web/logic.js'), S = require('../web/schedule.js'), fx = require('./fixture-badesa.js');
var n = 0;
function ok(name, fn) { try { fn(); n++; console.log('ok   ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + e.message); process.exitCode = 1; } }
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= (tol || 0.01), (msg || '') + ' ' + a + ' vs ' + b); }

/* working days: Sunday is the rest day, results from the contractor's workbook */
function dd(iso) { return S.toDays(iso); }
var off = S.offMap({ off: [0] });
ok('finish dates match the workbook', function () {
  var cases = [['2026-12-04', 1, '2026-12-04'], ['2026-12-05', 3, '2026-12-08'], ['2026-12-11', 25, '2027-01-08'], ['2026-12-25', 8, '2027-01-02'],
    ['2027-01-09', 4, '2027-01-13'], ['2026-12-16', 5, '2026-12-21'], ['2027-02-17', 0.25, '2027-02-17'], ['2027-01-27', 0.5, '2027-01-27'], ['2027-02-18', 2, '2027-02-19']];
  cases.forEach(function (c) { assert.strictEqual(S.fromDays(S.finishOf(dd(c[0]), c[1], off)), c[2], c.join(' ')); });
});

var p = L.sanitizeProject({ name: 'T', vat: 15, boq: [], boqLines: 2 }, 1);
var parsed = S.parseWorkbook(fx);
S.applyImport(p, parsed);
p = L.sanitizeProject(p, 1);

ok('import fills BoQ, roles, equipment', function () {
  assert.strictEqual(p.boq.length, 8);
  assert.strictEqual(p.sched.roles.length, 25);
  assert.strictEqual(p.sched.equip.length, 12);
  assert.strictEqual(p.contractSum, 1911947.84);
  assert.strictEqual(p.vat, 15);
  assert.strictEqual(p.startDate, '2026-12-01');
  var own = p.sched.equip.filter(function (e) { return e.source === 'Own'; }).map(function (e) { return e.name; });
  assert.deepStrictEqual(own, ['Water Tanker', 'Other Tools']);
  var pm = p.sched.roles[0];
  assert.ok(pm.type === 'permanent' && pm.person === 'Nuh Ahmed' && pm.count === 1);
});

var sc = S.compute(p);
ok('task dates follow the workbook', function () {
  var by = {};
  sc.rows.forEach(function (r) { by[r.desc.slice(0, 12)] = r; });
  assert.strictEqual(by['Site Handove'].start, '2026-12-01');
  assert.strictEqual(by['Site Handove'].finish, '2026-12-03');
  assert.strictEqual(by['trench excav'].start, '2026-12-04');
  assert.strictEqual(by['backfill and'].start, '2026-12-05');
  assert.strictEqual(by['backfill and'].finish, '2026-12-08');
  assert.strictEqual(by['30*15cm terr'].finish, '2027-01-08');
  assert.strictEqual(by['1. EXCAVATIO'].start, '2026-12-04');
  assert.strictEqual(by['1. EXCAVATIO'].finish, '2026-12-09');
});

ok('cash flow reproduces the workbook split', function () {
  var cf = S.cashflow(p), r = cf.rows[0];
  near(r.mat, 1584); near(r.lab, 6336); near(r.eq, 34320); near(r.misc, 1584); near(r.oh, 3696); near(r.profit, 3696); near(r.wht, 1584); near(r.vat, 7920);
  var back = cf.rows[1];
  near(back.mat, 44936); near(back.lab, 22468); near(back.eq, 22468);
  var ter = cf.rows[3];
  near(ter.mat, 1062393.6096, 0.01); near(ter.eq, 51406.1424, 0.01);
  near(cf.totals.amount, 1911947.84);
});

ok('payments add up to the contract and carry cost shares', function () {
  var pay = S.payments(p, sc);
  near(pay.totals.amount, pay.total, 0.01, 'sum of payments');
  near(pay.list[0].amount, pay.total * 0.2, 0.01, 'advance 20%');
  assert.strictEqual(pay.list[pay.list.length - 1].name, 'Final payment');
  pay.list.forEach(function (x) { assert.ok(x.amount >= 0); near(x.mat + x.lab + x.eq + x.misc + x.oh + x.profit + x.wht, x.amount, 0.01); });
  near(pay.totals.vat, pay.total * 0.15, 0.01);
});

ok('manpower: permanent staff are always on site, labour follows tasks', function () {
  var mp = S.manpower(p, sc);
  var pm = mp.rows[0], dl = mp.rows.filter(function (r) { return r.item.name === 'Daily Labour'; })[0];
  assert.ok(pm.always && pm.peak === 1 && pm.days > 20);
  assert.strictEqual(dl.peak, 12);
  near(dl.days, 6 * 1 + 12 * 3 + 6 * 1 + 12 * 25, 0.01);
  assert.ok(mp.months.indexOf('2026-12') >= 0 && mp.months.indexOf('2027-01') >= 0);
});

ok('equipment: peak and equipment days', function () {
  var eq = S.equipment(p, sc), pick = eq.rows.filter(function (r) { return r.item.name === 'Pick Up Vehicle'; })[0];
  assert.strictEqual(pick.peak, 1);
  near(pick.days, 1 + 3 + 1 + 25, 0.01);
});

ok('auto durations spread the project days', function () {
  var q = L.sanitizeProject({ name: 'Q', startDate: '2027-01-04', endDate: '2027-02-27', boq: [{ id: 1, desc: 'a', qty: 10, rate: 100 }, { id: 2, desc: 'b', qty: 10, rate: 300 }], boqLines: 2 }, 1);
  assert.strictEqual(S.autoDurations(q), 2);
  var c = S.compute(q);
  assert.ok(c.workDays > 40 && c.workDays <= 52, 'workDays ' + c.workDays);
  assert.ok(c.rows[1].dur > c.rows[0].dur);
});

ok('parallel and fixed starts', function () {
  var q = L.sanitizeProject({ name: 'Q', startDate: '2027-01-04', boq: [{ id: 1, desc: 'a', qty: 1, rate: 1 }, { id: 2, desc: 'b', qty: 1, rate: 1 }, { id: 3, desc: 'c', qty: 1, rate: 1 }], boqLines: 2, sched: { tasks: { 1: { dur: 2 }, 2: { dur: 3, par: true }, 3: { dur: 1, start: '2027-02-01' } } } }, 1);
  var c = S.compute(q);
  assert.strictEqual(c.rows[0].start, '2027-01-04'); assert.strictEqual(c.rows[1].start, '2027-01-04'); assert.strictEqual(c.rows[2].start, '2027-02-01');
  assert.strictEqual(c.rows[1].finish, '2027-01-06');
});
ok('workbook finish dates win when they span more days than the duration', function () {
  var rows = [['', 'No', '', 'Task Name', 'Task Name', 'Unit', 'QTY', 'Rate', 'Amount', 'Duration', 'Start', 'Finish'],
    ['', 'A', 'T', 'roof purlin', 'roof purlin', 'ML', 62, 250, 15500, '1 day', 'Tue 16/02/27', 'Wed 17/02/27'],
    ['', 'B', 'T', 'down pipe', 'down pipe', 'ML', 12, 520, 6240, '0.25 days', 'Mon 01/03/27', 'Mon 01/03/27']];
  var q = L.sanitizeProject({ name: 'Q', boq: [], boqLines: 2 }, 1);
  S.applyImport(q, S.parseWorkbook([{ name: 'Mana Power', rows: rows }]));
  q = L.sanitizeProject(q, 1);
  var c = S.compute(q);
  assert.strictEqual(c.rows[0].finish, '2027-02-17'); assert.strictEqual(c.rows[0].dur, 2);
  assert.strictEqual(c.rows[1].finish, '2027-03-01'); assert.strictEqual(c.rows[1].dur, 0.25);
});
console.log(n + ' passed');

ok('progress vs plan: planned, actual and late tasks', function () {
  var q = L.sanitizeProject({ name: 'Q', startDate: '2027-01-04', boq: [
    { id: 1, desc: 'a', qty: 10, rate: 100, done: 10 }, { id: 2, desc: 'b', qty: 10, rate: 100, done: 2 },
    { id: 3, desc: 'c', qty: 10, rate: 100, done: 0 }, { id: 4, desc: 'd', qty: 10, rate: 200, done: 0 }],
    boqLines: 2, sched: { tasks: { 1: { dur: 2 }, 2: { dur: 4 }, 3: { dur: 2 }, 4: { dur: 2 } } } }, 1);
  var c = S.compute(q);   // a: 4-5 Jan, b: 6-9 Jan, c: 11-12 Jan, d: 13-14 Jan
  var g = S.progress(q, c, '2027-01-07');
  assert.strictEqual(g.by[1].status, 'done'); assert.strictEqual(g.by[1].planned, 1);
  near(g.by[2].planned, 0.5, 0.001); near(g.by[2].actual, 0.2, 0.001); assert.strictEqual(g.by[2].status, 'late');
  assert.strictEqual(g.by[3].status, 'upcoming'); assert.strictEqual(g.by[4].planned, 0);
  assert.strictEqual(g.lateCount, 1); assert.strictEqual(g.late[0].row.id, 2);
  near(g.plannedValue, 1000 + 500, 0.01); near(g.actualValue, 1000 + 200, 0.01); near(g.gapValue, -300, 0.01);
  near(g.plannedPct, 1500 / 5000, 0.001);
  var h = S.progress(q, c, '2027-01-15');   // everything should be finished
  assert.strictEqual(h.by[3].status, 'late'); assert.ok(h.by[3].daysLate >= 3, 'days late ' + h.by[3].daysLate);
  assert.strictEqual(h.lateCount, 3); assert.ok(h.afterEnd);
  var e = S.progress(q, c, '2026-12-01');
  assert.ok(e.beforeStart); assert.strictEqual(e.lateCount, 0); assert.strictEqual(e.by[1].status, 'done');
  q.boq[1].done = 5;   // b exactly on plan at 50%
  assert.strictEqual(S.progress(q, S.compute(q), '2027-01-07').by[2].status, 'ontrack');
  q.boq[2].done = 3;   // c started early
  assert.strictEqual(S.progress(q, S.compute(q), '2027-01-07').by[3].status, 'ahead');
});

/* Excel export: build the workbook and read it back with the app's own reader */
var X = require('../web/xlsx.js'), XR = require('../web/xlsxread.js'), SE = require('../web/schedule-excel.js');
var pending = 0;
(function () {
  var wb = SE.workbook(p);
  var bytes = X.build(wb);
  XR.read(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).then(function (sheets) {
    ok('excel export has all sheets', function () {
      assert.deepStrictEqual(sheets.map(function (s) { return s.name; }), ['Schedule', 'Man Power', 'Man Power Schedule', 'Equipment', 'Equipment Schedule', 'Cash Flow', 'Cash Flow Summary', 'Gantt']);
    });
    ok('excel schedule sheet carries dates and totals', function () {
      var rows = sheets[0].rows, flat = rows.map(function (r) { return r.join('|'); }).join('\n');
      assert.ok(/Fri 04\/12\/26/.test(flat), 'start date');
      assert.ok(/Fri 08\/01\/27/.test(flat), 'finish date');
      assert.ok(/1 day/.test(flat) && /25 days/.test(flat));
    });
    ok('excel cash flow sheet has the split', function () {
      var flat = sheets[5].rows.map(function (r) { return r.join('|'); }).join('\n');
      assert.ok(/52800/.test(flat) && /1584/.test(flat) && /34320/.test(flat));
    });
    ok('excel gantt marks the weeks', function () { assert.ok(sheets[7].rows.length > 10); });
    console.log('done');
  }).catch(function (e) { console.log('FAIL excel read ' + e.message); process.exitCode = 1; });
})();
