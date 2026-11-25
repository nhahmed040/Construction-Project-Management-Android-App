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
  near(r.mat, 1584); near(r.lab, 6336); near(r.eq, 35904); near(r.misc, 1584); near(r.oh, 3696); near(r.profit, 3696); near(r.vat, 7920);
  near(r.mat + r.lab + r.eq + r.misc + r.oh + r.profit, r.amount, 0.01);   // withholding tax is not a cost share any more
  var back = cf.rows[1];
  near(back.mat, 44936); near(back.lab, 22468); near(back.eq, back.amount * 0.23, 0.01);
  var ter = cf.rows[3];
  near(ter.mat, 1062393.6096, 0.01); near(ter.eq, ter.amount * ter.split.eq / 100, 0.01); near(ter.mat + ter.lab + ter.eq + ter.misc + ter.oh + ter.profit, ter.amount, 0.01);
  near(cf.totals.amount, 1911947.84);
});

ok('payments add up to the contract and carry cost shares', function () {
  var pay = S.payments(p, sc);
  near(pay.totals.amount, pay.total, 0.01, 'sum of payments');
  near(pay.list[0].amount, pay.total * 0.2, 0.01, 'advance 20%');
  assert.strictEqual(pay.list[pay.list.length - 1].name, 'Final payment');
  pay.list.forEach(function (x) { assert.ok(x.amount >= 0); near(x.mat + x.lab + x.eq + x.misc + x.oh + x.profit, x.amount, 0.01); near(x.net, x.total - x.amount * p.wht / 100, 0.01); });
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

/* ---- dependencies, lag/lead, critical path, manual dates, delays ---- */
function net(tasks, extra) {
  var boq = Object.keys(tasks).map(function (k) { return { id: +k, desc: 't' + k, qty: 10, rate: 10, done: 0 }; });
  return L.sanitizeProject(Object.assign({ name: 'N', startDate: '2027-01-04', boq: boq, boqLines: 2, sched: { tasks: tasks } }, extra || {}), 1);
}
function at(c, id) { return c.byId[String(id)]; }   // Mon 4 Jan 2027 is day 1, Sunday is off
ok('FS, SS, FF and SF links', function () {
  var q = net({ 1: { dur: 4 }, 2: { dur: 2, pred: [{ id: 1, type: 'FS', lag: 0 }] }, 3: { dur: 2, pred: [{ id: 1, type: 'SS', lag: 1 }] },
    4: { dur: 3, pred: [{ id: 1, type: 'FF', lag: 0 }] }, 5: { dur: 2, pred: [{ id: 1, type: 'SF', lag: 0 }] } });
  var c = S.compute(q);   // 1: 4-7 Jan
  assert.strictEqual(at(c, 2).start, '2027-01-08');
  assert.strictEqual(at(c, 3).start, '2027-01-05');
  assert.strictEqual(at(c, 4).finish, '2027-01-07'); assert.strictEqual(at(c, 4).start, '2027-01-05');
  assert.strictEqual(at(c, 5).finish, '2027-01-04'); assert.strictEqual(at(c, 5).start, '2027-01-02');
});
ok('lag waits and lead overlaps (working days)', function () {
  var q = net({ 1: { dur: 4 }, 2: { dur: 2, pred: [{ id: 1, type: 'FS', lag: 2 }] }, 3: { dur: 2, pred: [{ id: 1, type: 'FS', lag: -2 }] } });
  var c = S.compute(q);   // 1 finishes Thu 7 Jan
  assert.strictEqual(at(c, 2).start, '2027-01-11');   // Fri 8 + Sat 9 are the 2 waiting days -> Mon 11 (Sunday skipped)
  assert.strictEqual(at(c, 3).start, '2027-01-06');   // starts 2 days before the predecessor finishes
});
ok('a slipping predecessor moves what depends on it', function () {
  var q = net({ 1: { dur: 2 }, 2: { dur: 2, pred: [{ id: 1, type: 'FS', lag: 0 }] }, 3: { dur: 2, pred: [{ id: 2, type: 'FS', lag: 0 }] } });
  var before = S.compute(q).finish;
  q.sched.tasks[1].dur = 5;
  var c = S.compute(q);
  assert.ok(c.fd > S.toDays(before)); assert.strictEqual(at(c, 2).start, '2027-01-09');
  q.sched.tasks[1].delay = 2;
  assert.ok(at(S.compute(q), 2).sd > at(c, 2).sd);
});
ok('critical path, total float and free float', function () {
  // 1 -> 2 -> 4 is the long path, 3 is a short side path that rejoins at 4
  var q = net({ 1: { dur: 3 }, 2: { dur: 6, pred: [{ id: 1, type: 'FS', lag: 0 }] }, 3: { dur: 2, pred: [{ id: 1, type: 'FS', lag: 0 }] },
    4: { dur: 2, pred: [{ id: 2, type: 'FS', lag: 0 }, { id: 3, type: 'FS', lag: 0 }] } });
  var c = S.compute(q);
  assert.deepStrictEqual(c.critical, [1, 2, 4]);
  assert.strictEqual(at(c, 2).tf, 0); assert.ok(at(c, 3).tf > 0 && !at(c, 3).critical);
  assert.strictEqual(at(c, 3).tf, 4); assert.strictEqual(at(c, 3).ff, 4);
  assert.strictEqual(c.finish, at(c, 4).finish);
});
ok('manual dates are kept and a clash is reported', function () {
  var q = net({ 1: { dur: 5 }, 2: { dur: 2, start: '2027-01-05', pred: [{ id: 1, type: 'FS', lag: 0 }] }, 3: { dur: 2, pred: [{ id: 2, type: 'FS', lag: 0 }] } });
  var c = S.compute(q);
  assert.strictEqual(at(c, 2).start, '2027-01-05');       // not moved
  assert.ok(at(c, 2).conflict > 0); assert.deepStrictEqual(c.conflicts, [2]);
  assert.strictEqual(at(c, 3).start, '2027-01-07');        // the task after it follows the manual dates
  q.sched.tasks[2].start = '2027-02-01';
  assert.ok(!at(S.compute(q), 2).conflict);
});
ok('a loop of links is broken, not looped forever', function () {
  var q = net({ 1: { dur: 2, pred: [{ id: 2, type: 'FS', lag: 0 }] }, 2: { dur: 2, pred: [{ id: 1, type: 'FS', lag: 0 }] } });
  var c = S.compute(q);
  assert.ok(c.cycles.length > 0); assert.ok(c.count === 2 && c.fd != null);
  assert.ok(S.wouldLoop(q, 2, 1) || S.wouldLoop(q, 1, 2));
});
ok('old schedules (no links) still run in BoQ order', function () {
  var q = net({ 1: { dur: 2 }, 2: { dur: 3, par: true }, 3: { dur: 1 } });
  var c = S.compute(q);
  assert.strictEqual(at(c, 2).start, '2027-01-04'); assert.strictEqual(at(c, 3).start, '2027-01-07');
});
ok('sanitize keeps links, delay and no-earlier-than date and drops junk', function () {
  var q = net({ 1: { dur: 1, pred: [{ id: '2', type: 'XX', lag: '3' }, { id: 'a' }, null], delay: 2.4, snet: '2027-01-20' }, 2: { dur: 1 } });
  var t = q.sched.tasks[1];
  assert.deepStrictEqual(t.pred, [{ id: '2', type: 'FS', lag: 3 }]); assert.strictEqual(t.delay, 2); assert.strictEqual(t.snet, '2027-01-20');
});
ok('reschedule pushes late work on and leaves manual dates alone', function () {
  var q = L.sanitizeProject({ name: 'Q', startDate: '2027-01-04', boq: [
    { id: 1, desc: 'a', qty: 10, rate: 10, done: 5 }, { id: 2, desc: 'b', qty: 10, rate: 10, done: 0 },
    { id: 3, desc: 'c', qty: 10, rate: 10, done: 0 }, { id: 4, desc: 'd', qty: 10, rate: 10, done: 0 }], boqLines: 2,
    sched: { tasks: { 1: { dur: 2 }, 2: { dur: 2 }, 3: { dur: 2, start: '2027-01-05', pred: [] }, 4: { dur: 2 } } } }, 1);
  var before = S.compute(q).fd;
  var dry = S.reschedule(q, '2027-01-12', false);
  assert.strictEqual(q.sched.tasks[1].dur, 2);   // nothing changed on a dry run
  var r = S.reschedule(q, '2027-01-12', true);
  assert.strictEqual(r.extended.length, 1); assert.strictEqual(r.extended[0].id, 1); assert.ok(q.sched.tasks[1].dur > 2);
  assert.ok(r.preserved.indexOf(3) >= 0); assert.strictEqual(q.sched.tasks[3].start, '2027-01-05');
  var c = S.compute(q); assert.ok(c.fd > before); assert.ok(at(c, 2).sd >= S.toDays('2027-01-12'));
  assert.strictEqual(S.reschedule(q, '2027-01-12', true).extended.length, 0);   // idempotent
  assert.ok(dry.delayed.length >= 1);
});

ok('cost split: defaults, presets that fit the pool, withholding off the payment', function () {
  var q = L.sanitizeProject({ name: 'Q', vat: 15, wht: 3, boq: [{ id: 1, desc: 'a', qty: 10, rate: 1000, done: 0 }], boqLines: 2 }, 1);
  var cf = q.sched.cf;
  assert.deepStrictEqual([cf.misc, cf.overhead, cf.profit], [2, 7.5, 7.5]); assert.deepStrictEqual(cf.defSplit, [65, 15, 3]);
  assert.strictEqual(S.poolOf(cf), 83);
  assert.deepStrictEqual(S.presetSplit(cf, 'earth_mach'), [3, 15, 65]); assert.deepStrictEqual(S.presetSplit(cf, 'earth_lab'), [3, 65, 15]);
  cf.overhead = 10.5;   // pool 80: presets scale to fit it
  var sp = S.presetSplit(cf, 'earth_mach'); near(sp[0] + sp[1] + sp[2], 80, 0.001);
  cf.overhead = 7.5;
  var c = S.cashflow(q), r = c.rows[0];
  near(r.mat + r.lab + r.eq + r.misc + r.oh + r.profit, 10000, 0.01); near(r.wht, 300, 0.01); near(c.net, 11500 - 300, 0.01);
  var pay = S.payments(q, S.compute(q));
  near(pay.totals.wht, 300, 0.01); near(pay.totals.net, 11200, 0.01); assert.strictEqual(pay.shares.wht, undefined);
});
ok('cost split: user presets are kept, junk is dropped, splits that do not fit are flagged', function () {
  var q = L.sanitizeProject({ name: 'Q', boq: [{ id: 1, desc: 'a', qty: 1, rate: 100 }], boqLines: 2,
    sched: { cf: { presets: [{ name: '  Slab  ', split: [50, 20, 13] }, { name: '', split: [1, 2, 3] }, { name: 'x', split: [1, 2] }, null] }, tasks: { 1: { dur: 1, split: [10, 10, 10] } } } }, 1);
  assert.deepStrictEqual(q.sched.cf.presets, [{ name: 'Slab', split: [50, 20, 13] }]);
  assert.deepStrictEqual(S.presetSplit(q.sched.cf, 'u0'), [50, 20, 13]);
  assert.strictEqual(S.splitOf(q, 1).over, true);
});
ok('cost split: an older project gives the freed withholding points to equipment', function () {
  var q = L.sanitizeProject({ name: 'Q', boq: [{ id: 1, desc: 'a', qty: 1, rate: 100 }], boqLines: 2,
    sched: { cf: { misc: 3, overhead: 7, profit: 7, wht: 3, defSplit: [62, 15] }, tasks: { 1: { dur: 1, split: [3, 12] } } } }, 1);
  assert.deepStrictEqual(q.sched.cf.defSplit, [62, 15, 6]); assert.strictEqual(q.sched.cf.legacy, true);
  assert.deepStrictEqual(q.sched.tasks[1].split, [3, 12, 68]); assert.strictEqual(q.sched.cf.wht, undefined);
  near(S.cashflow(q).rows[0].mat + S.cashflow(q).rows[0].lab + S.cashflow(q).rows[0].eq + 17, 100, 0.001);
});

ok('built-in presets all add up to the pool and the generator uses them', function () {
  Object.keys(S.PRESETS).forEach(function (k) { var a = S.PRESETS[k]; near(a[0] + a[1] + a[2], 83, 0.001, k); });
  var q = L.sanitizeProject({ name: 'Q', startDate: '2027-01-04', boqLines: 2, boq: [
    { id: 1, desc: 'Reinforcement bars 12mm', unit: 'KG', qty: 1000, rate: 50 }, { id: 2, desc: 'Reinforced concrete C-25 for columns', unit: 'M3', qty: 10, rate: 9000 },
    { id: 3, desc: 'Cement plaster on walls', unit: 'M2', qty: 200, rate: 150 }, { id: 4, desc: 'Excavation by machine', unit: 'M3', qty: 300, rate: 200 }] }, 1);
  S.generate(q, { only: 'all' });
  var sp = function (id) { return q.sched.tasks[id].split; };
  assert.strictEqual(S.templateOf({ desc: 'Fill around masonry foundation wall with selected excavated material from site.', unit: 'M3' }).id, 'backfill');
  assert.strictEqual(S.templateOf({ desc: 'Hardcore filling 200mm thick', unit: 'M3' }).id, 'hardcore');
  assert.deepStrictEqual(sp(1), [72, 9, 2]); assert.deepStrictEqual(sp(2), [60, 15, 8]); assert.deepStrictEqual(sp(3), [45, 35, 3]); assert.deepStrictEqual(sp(4), [3, 15, 65]);
});

ok('task IDs are row numbers and links are typed with them', function () {
  var q = net({ 1: { dur: 2 }, 2: { dur: 2 }, 3: { dur: 2 }, 4: { dur: 0 } });
  var c = S.compute(q);
  assert.deepStrictEqual(c.rows.map(function (r) { return r.n; }), [1, 2, 3, 4]);
  var r = S.parseLinks('1, 2ss+1, 3FF-2d', c, '4');
  assert.strictEqual(r.error, null);
  assert.deepStrictEqual(r.list, [{ id: '1', type: 'FS', lag: 0 }, { id: '2', type: 'SS', lag: 1 }, { id: '3', type: 'FF', lag: -2 }]);
  assert.strictEqual(S.formatLinks(r.list, c), '1, 2SS+1, 3FF-2');
  assert.strictEqual(S.parseLinks('9', c, '1').error.why, 'task');   // there is no row 9
  assert.strictEqual(S.parseLinks('4', c, '1').error.why, 'task');   // row 4 has no duration
  assert.strictEqual(S.parseLinks('1', c, '1').error.why, 'self');
  assert.strictEqual(S.parseLinks('1, 1', c, '2').error.why, 'twice');
  assert.strictEqual(S.parseLinks('x', c, '2').error.why, 'format');
  assert.strictEqual(S.parseLinks('', c, '2').list.length, 0);
});
ok('links stay on their tasks when the IDs move', function () {
  var q = net({ 1: { dur: 2 }, 2: { dur: 2, pred: [{ id: 1, type: 'FS', lag: 0 }] } });
  assert.strictEqual(S.formatLinks(q.sched.tasks[2].pred, S.compute(q)), '1');
  q.boq.unshift({ id: 9, desc: 'new first row', qty: 1, rate: 1, done: 0 });   // pushes everything down one row
  var c = S.compute(q);
  assert.strictEqual(S.formatLinks(q.sched.tasks[2].pred, c), '2');
  assert.strictEqual(at(c, 2).preds[0].id, '1');
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

/* generate the whole schedule from a BoQ that has no schedule data at all */
function boqOnly(extra) {
  var rows = [['trench excavation for curb concrete depth 30cm', 'M³', 96, 550], ['backfill and compact selected material', 'M³', 82, 1370], ['Cartaway Removal of trench excavated soil', 'M³', 96, 346.56],
    ['30*15cm terrazzo pavement for walk way', 'M²', 1073, 1596.96], ['Reinforced concrete C-25 filled into formwork and vibrated around reinforcement bars', 'M³', 80, 18523.93],
    ['dia 8mm deformed bar for curb concrete beam', 'KG', 1291.1, 342.91], ['Apply two coats of cement mortar plastering 1:3 to all internal HCB walls', 'M²', 85.6, 584.88],
    ['1/2mm metal water pipe installation with elbow', 'M', 148, 600], ['Turkish toilet seat with elbow and gate valve', 'Nº', 1, 6400], ['something unusual here', 'M²', 10, 100]];
  return L.sanitizeProject(Object.assign({ name: 'B', startDate: '2026-12-01', boqLines: 2, boq: rows.map(function (r, i) { return { id: i + 1, desc: r[0], unit: r[1], qty: r[2], rate: r[3] }; }) }, extra || {}), 1);
}
ok('generate: durations, crews, equipment and splits from the BoQ', function () {
  var q = boqOnly(), r = S.generate(q, {});
  assert.strictEqual(r.tasks, 10); assert.strictEqual(r.matched, 9); assert.strictEqual(r.general, 1);
  var d = function (id) { return q.sched.tasks[String(id)]; };
  assert.deepStrictEqual([d(1).dur, d(2).dur, d(3).dur, d(4).dur, d(5).dur, d(6).dur], [1, 3, 1, 25, 8, 5]);
  assert.strictEqual(d(5).tpl, 'concrete', 'concrete mentioning formwork stays concrete');
  assert.strictEqual(d(7).tpl, 'plaster'); assert.strictEqual(d(8).tpl, 'plumb'); assert.strictEqual(d(9).tpl, 'plumb'); assert.strictEqual(d(10).tpl, 'general');
  assert.deepStrictEqual(d(1).split, [3, 65, 15], 'hand trench uses the labour preset'); assert.deepStrictEqual(d(2).split, [40, 20, 23]); assert.deepStrictEqual(d(4).split, [62, 18, 3], 'block work uses its own preset');
  var role = function (n) { return q.sched.roles.filter(function (x) { return x.name === n; })[0]; };
  assert.strictEqual(d(1).mp[String(role('Daily Labour').id)], 6); assert.strictEqual(d(4).mp[String(role('Tiler').id)], 5);
  assert.strictEqual(role('Project Manager').type, 'permanent');
  var eq = q.sched.equip.map(function (e) { return e.name; });
  assert.ok(eq.indexOf('Backhoe Loader') >= 0 && eq.indexOf('Concrete Mixer') >= 0 && eq.indexOf('Plate Compactor') >= 0);
  var c = S.compute(q); assert.ok(c.count === 10 && c.start === '2026-12-01');
  var mp = S.manpower(q, c); assert.ok(mp.totalDays > 100 && mp.peak >= 20);
  assert.ok(Math.abs(S.cashflow(q).totals.amount - q.boq.reduce(function (s, i) { return s + i.qty * i.rate; }, 0)) < 0.01);
  q = L.sanitizeProject(q, 1); assert.strictEqual(q.sched.tasks['1'].tpl, 'excav', 'template survives save and load');
});
ok('generate: only tasks without a duration, keeping manual edits', function () {
  var q = boqOnly({ sched: { tasks: { 4: { dur: 10, mp: {}, eq: {} } } } }), r = S.generate(q, { only: 'empty' });
  assert.strictEqual(r.tasks, 9); assert.strictEqual(q.sched.tasks['4'].dur, 10);
  assert.strictEqual(S.generate(q, { only: 'empty' }).tasks, 0);
  assert.strictEqual(S.generate(q, { only: 'all' }).tasks, 10); assert.strictEqual(q.sched.tasks['4'].dur, 25);
});
ok('generate: bigger crews when a finish date is given', function () {
  var q = boqOnly(), base = S.generate(q, {}), len = S.compute(q).workDays;
  var f = S.generate(boqOnly(), { end: '2027-01-10' });
  var q2 = boqOnly(); var f2 = S.generate(q2, { end: '2027-01-12' });
  assert.ok(len > 40); assert.ok(f2.mult > 1, 'mult ' + f2.mult); assert.strictEqual(f2.fits, true);
  assert.ok(f2.finish <= '2027-01-12', f2.finish);
  var role = q2.sched.roles.filter(function (x) { return x.name === 'Daily Labour'; })[0];
  assert.strictEqual(q2.sched.tasks['1'].mp[String(role.id)], 6 * f2.mult);
  var perm = q2.sched.roles.filter(function (x) { return x.name === 'Project Manager'; })[0];
  assert.ok(q2.sched.tasks['1'].mp[String(perm.id)] === undefined || q2.sched.tasks['1'].mp[String(perm.id)] === 1);
  assert.strictEqual(S.generate(boqOnly(), { end: '2026-12-02' }).fits, false);
});

/* Excel export: build the workbook and read it back with the app's own reader */
var X = require('../web/xlsx.js'), XR = require('../web/xlsxread.js'), SE = require('../web/schedule-excel.js');
var pending = 0;

ok('excel: equal row heights, long text wrapped and kept whole, header rows repeat', function () {
  var q = L.sanitizeProject({ name: 'Q', startDate: '2027-01-04', boqLines: 2, boq: [
    { id: 1, desc: 'Bulk excavation in ordinary soil to a depth not exceeding 1000mm starting from Natural Ground Level for only expansive soil. Only site clearing to depth 20cm will be computed and there is no bulk excavation for non-expansive soil.', unit: 'M3', qty: 10, rate: 100 },
    { id: 2, desc: 'Short item', unit: 'M3', qty: 10, rate: 100 }] }, 1);
  q.sched.tasks[1] = { dur: 2 }; q.sched.tasks[2] = { dur: 1 };
  var wb = SE.workbook(q);
  wb.sheets.forEach(function (sh) {
    var hs = Object.keys(sh.heights || {}).map(function (k) { return sh.heights[k]; });
    assert.ok(hs.length && hs.every(function (h) { return h === hs[0]; }), sh.name + ' has equal row heights');
    assert.ok(sh.printTitles && sh.printTitles[0] <= sh.printTitles[1], sh.name + ' repeats its header');
  });
  var g = wb.sheets[0], cells = [];
  g.rows.forEach(function (r) { (r || []).forEach(function (c) { if (c && typeof c.v === 'string') cells.push(c); }); });
  var long = cells.filter(function (c) { return /^Bulk excavation/.test(c.v); })[0];
  assert.ok(long && /non-expansive soil\.$/.test(long.v) && long.s.wrap && long.s.v === 'top', 'full text kept, wrapped');
  assert.ok(cells.some(function (c) { return c.v === 'Short item'; }));
});
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
      assert.ok(/52800/.test(flat) && /1584/.test(flat) && /35904/.test(flat));
    });
    ok('excel gantt marks the weeks', function () { assert.ok(sheets[7].rows.length > 10); });
    console.log('done');
  }).catch(function (e) { console.log('FAIL excel read ' + e.message); process.exitCode = 1; });
})();

/* ---- smarter generation: trade logic, productivity, preview ---- */
(function () {
  var S2 = require('../web/schedule.js'), L2 = require('../web/logic.js');
  function mk() {
    var p = L2.sanitizeProject({ name: 'T', boqLines: 2 }, 1);
    p.boq = [
      { id: 1, kind: 'item', no: '1', desc: 'Excavation for foundation', unit: 'M³', qty: 96, rate: 100 },
      { id: 2, kind: 'item', no: '2', desc: 'Hollow block wall 20cm', unit: 'M²', qty: 400, rate: 100 },
      { id: 3, kind: 'item', no: '3', desc: 'Plastering to walls', unit: 'M²', qty: 900, rate: 100 }
    ].map(function (i) { return L2.sanitizeProject({ boq: [i] }, 1).boq[0] || i; });
    p.sched.start = '2026-12-01';
    return p;
  }
  var p = mk();
  if (!p.boq.length || !S2.generate) { console.log('skip new tests'); return; }
  var pv = S2.preview(p, { strategy: 'trade' });
  if (Object.keys(p.sched.tasks).length) throw new Error('preview changed the project');
  S2.generate(p, { strategy: 'trade' });
  var plast = p.sched.tasks[String(p.boq[2].id)];
  if (!plast.pred || !plast.pred.length) throw new Error('trade logic made no links');
  var p2 = mk(); p2.sched.prod = L2.sanitizeProd({ hours: 10, factor: 1, types: {} });
  S2.generate(p2, { strategy: 'boq' }); S2.generate(p, { strategy: 'boq' });
  if (!(p2.sched.tasks[String(p2.boq[0].id)].dur <= p.sched.tasks[String(p.boq[0].id)].dur)) throw new Error('hours/day did not speed up');
  console.log('new generation tests ok');
})();

(function () {
  var S3 = require('../web/schedule.js'), L3 = require('../web/logic.js');
  var s = L3.sanitizeSched({ start: '2026-12-01', hol: [{ from: '2026-12-02', to: '2026-12-03', name: 'x' }, { from: 'bad' }] });
  if (s.hol.length !== 1) throw new Error('holiday sanitize');
  var off = S3.offMap(s), a = S3.toDays('2026-12-01');   // Tuesday
  if (!S3.isOff(off, a + 1) || !S3.isOff(off, a + 2) || S3.isOff(off, a)) throw new Error('isOff');
  if (S3.fromDays(S3.finishOf(a, 2, off)) !== '2026-12-04') throw new Error('finish skips holidays: ' + S3.fromDays(S3.finishOf(a, 2, off)));
  var h = S3.holidaysEthiopia(2026); if (h[6].from !== '2026-09-11' || S3.holidaysEthiopia(2027)[6].from !== '2027-09-12') throw new Error('eth dates');
  console.log('holiday tests ok');
})();
