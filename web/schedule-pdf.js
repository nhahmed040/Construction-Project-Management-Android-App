/* PDF (print) version of the schedule workbook: every sheet of the Excel export (Schedule, Man Power, Man Power Schedule,
   Equipment, Equipment Schedule, Cash Flow, Cash Flow Summary, Gantt) as a printable HTML page, A3 landscape.
   Same cells, same fills, same equal row heights as the Excel file. Pure function, no DOM access. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CBSchedPdf = factory();
})(this, function () {
  'use strict';

  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function colIndex(a) { var n = 0; for (var i = 0; i < a.length; i++) n = n * 26 + a.charCodeAt(i) - 64; return n - 1; }

  function fmtNum(v, fmt) {
    if (typeof v !== 'number' || !isFinite(v)) return v == null ? '' : String(v);
    fmt = fmt || '';
    if (/%/.test(fmt)) { var pd = (/\.(0+)%/.exec(fmt) || [0, ''])[1].length; return (v * 100).toFixed(pd) + '%'; }
    var m = /\.([0#]+)/.exec(fmt), max = m ? m[1].length : (fmt ? 0 : 2), min = m ? (m[1].match(/0/g) || []).length : 0;
    var s = (Math.round(v * Math.pow(10, max)) / Math.pow(10, max)).toFixed(max);
    if (max > min && s.indexOf('.') >= 0) { var cut = s.length; while (cut > 0 && s.charAt(cut - 1) === '0' && s.length - cut < max - min) cut--; s = s.slice(0, cut); if (s.charAt(s.length - 1) === '.') s = s.slice(0, -1); }
    if (/,/.test(fmt) || !fmt) { var p = s.split('.'); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); s = p.join('.'); }
    return s;
  }

  function cellStyle(s, fs) {
    s = s || {};
    var css = [];
    if (s.fill) css.push('background:#' + s.fill);
    css.push('color:#' + (s.color || '000'));
    if (s.b) css.push('font-weight:700');
    if (s.i) css.push('font-style:italic');
    if (s.sz) css.push('font-size:' + (s.sz / 11 * fs).toFixed(2) + 'pt');
    css.push('text-align:' + (s.h === 'center' ? 'center' : s.h === 'right' ? 'right' : 'left'));
    css.push('vertical-align:' + (s.v === 'top' ? 'top' : s.v === 'bottom' ? 'bottom' : 'middle'));
    if (s.border) css.push('border:0.5pt solid #777');
    if (s.ind) css.push('padding-left:' + (2 + s.ind * 6) + 'pt');
    return css.join(';');
  }

  /* one sheet as one or two tables: the title block above the header, then the table with its header row(s) repeated */
  function sheetHtml(sh, first) {
    var cols = sh.cols || [], ncol = cols.length;
    sh.rows.forEach(function (r) { if (r && r.length > ncol) ncol = r.length; });
    var total = 0, widths = [];
    for (var c = 0; c < ncol; c++) { widths[c] = cols[c] || 8.43; total += widths[c]; }
    var fs = Math.max(4.2, Math.min(9, 1000 / (total * 0.62)));   // all columns across an A3 page
    var rowH = function (r) { var h = sh.heights && sh.heights[r]; return h ? (h / 11 * fs * 0.95) : 0; };
    // merged cells
    var span = {}, hidden = {};
    (sh.merges || []).forEach(function (m) {
      var q = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(m); if (!q) return;
      var c0 = colIndex(q[1]), c1 = colIndex(q[3]), r0 = +q[2], r1 = +q[4];
      span[r0 + ':' + c0] = { cs: c1 - c0 + 1, rs: r1 - r0 + 1 };
      for (var r = r0; r <= r1; r++) for (var cc = c0; cc <= c1; cc++) if (r !== r0 || cc !== c0) hidden[r + ':' + cc] = true;
    });
    var pt = sh.printTitles, head0 = pt ? pt[0] : 0, head1 = pt ? pt[1] : 0;
    var colgroup = '<colgroup>' + widths.map(function (w) { return '<col style="width:' + (w / total * 100).toFixed(3) + '%">'; }).join('') + '</colgroup>';
    function rowHtml(row, r, inHead) {
      var tag = inHead ? 'th' : 'td', h = rowH(r), out = '<tr>';
      for (var c = 0; c < ncol; c++) {
        if (hidden[r + ':' + c]) continue;
        var cell = row && row[c], sp = span[r + ':' + c], v = cell ? cell.v : '';
        if (cell && typeof cell.f === 'string') { var sm = /^SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)$/.exec(cell.f); if (sm && sm[1] === sm[3]) { v = 0; var ci = colIndex(sm[1]); for (var rr = +sm[2]; rr <= +sm[4]; rr++) { var cc2 = sh.rows[rr - 1] && sh.rows[rr - 1][ci]; if (cc2 && typeof cc2.v === 'number') v += cc2.v; } } }
        var txt = typeof v === 'number' ? fmtNum(v, cell.s && cell.s.fmt) : v;
        var s = cell && cell.s ? cell.s : (row ? {} : {});
        var attrs = (sp && sp.cs > 1 ? ' colspan="' + sp.cs + '"' : '') + (sp && sp.rs > 1 ? ' rowspan="' + sp.rs + '"' : '');
        var inner = h ? '<div class="c" style="height:' + h.toFixed(1) + 'pt">' + esc(txt) + '</div>' : esc(txt);
        out += '<' + tag + attrs + ' style="' + cellStyle(s, fs) + '">' + inner + '</' + tag + '>';
      }
      return out + '</tr>';
    }
    var top = '', head = '', body = '';
    sh.rows.forEach(function (row, i) {
      var r = i + 1;
      if (!row) { if (pt && r >= head0) body += '<tr class="gap"><td colspan="' + ncol + '"></td></tr>'; else if (!pt) top += '<tr class="gap"><td colspan="' + ncol + '"></td></tr>'; return; }
      if (pt && r < head0) top += rowHtml(row, r, false);
      else if (pt && r <= head1) head += rowHtml(row, r, true);
      else body += rowHtml(row, r, false);
    });
    var cls = 'sheet' + (first ? '' : ' pb') + (sh.name === 'Gantt' ? ' gantt' : '');
    var h = '<section class="' + cls + '" style="font-size:' + fs.toFixed(2) + 'pt">';
    if (top) h += '<table class="top">' + colgroup + '<tbody>' + top + '</tbody></table>';
    h += '<table class="grid">' + colgroup + (head ? '<thead>' + head + '</thead>' : '') + '<tbody>' + body + '</tbody></table></section>';
    return h;
  }

  var CSS = '@page { size: A3 landscape; margin: 8mm; }' +
    '* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }' +
    'body { font-family: Calibri, Arial, sans-serif; margin: 0; color: #000; }' +
    'table { width: 100%; border-collapse: collapse; table-layout: fixed; }' +
    'thead { display: table-header-group; } tr { page-break-inside: avoid; }' +
    'td, th { padding: 1pt 2pt; overflow: hidden; line-height: 1.15; font-weight: normal; }' +
    'th { font-weight: 700; } .c { overflow: hidden; word-break: break-word; }' +
    'tr.gap td { height: 6pt; } .top td { white-space: nowrap; overflow: visible; } .pb { page-break-before: always; }' +
    '.gantt td, .gantt th { padding: 0 1pt; } .gpage { page-break-inside: avoid; break-inside: avoid; }';

  /* ---------- Gantt pages: the same chart as on screen, drawn as vector graphics ----------
     g = { S, sc, prog, hidden[], asOf, title, fmtDate(iso), monthLabel(key), keyFn(iso), day(iso), labels{} } */
  function ganttHtml(g) {
    var S = g.S, sc = g.sc, lb = g.labels || {}, PW = 1146, PH = 790, RH = 13.5, HEAD = 40, FOOT = 18;
    if (sc.sd == null) return '';
    var rows = [];
    sc.rows.forEach(function (r, i) { if (!(g.hidden && g.hidden[i])) rows.push(r); });
    var cols = [{ k: 'n', w: 24, h: '#' }, { k: 'desc', w: 214, h: lb.task || 'Task' }, { k: 'days', w: 28, h: lb.days || 'Days' }, { k: 'start', w: 44, h: lb.start || 'Start' }, { k: 'finish', w: 44, h: lb.finish || 'Finish' }, { k: 'pred', w: 58, h: lb.pred || 'Pred.' }];
    var LABEL = cols.reduce(function (t, c) { return t + c.w; }, 0), a = sc.sd - ((S.dow(sc.sd) + 6) % 7), b = sc.fd, n = b - a + 1;
    var dw = Math.min(16, (PW - LABEL - 2) / n), TW = n * dw, W = LABEL + TW;
    var perPage = Math.max(8, Math.floor((PH - HEAD - FOOT) / RH)), pages = Math.max(1, Math.ceil(rows.length / perPage));
    var today = S.toDays(g.asOf || ''), by = (g.prog && g.prog.by) || {}, FS = 6.2;
    var rowIdx = {}; rows.forEach(function (r, i) { rowIdx[String(r.id)] = i; });
    function cut(txt, w, bold) { var m = Math.max(2, Math.floor(w / (FS * (bold ? 0.56 : 0.5)))); txt = String(txt == null ? '' : txt); return txt.length > m ? txt.slice(0, m - 1) + '…' : txt; }
    function X(d) { return LABEL + (d - a) * dw; }
    var out = '';
    for (var pg = 0; pg < pages; pg++) {
      var r0 = pg * perPage, part = rows.slice(r0, r0 + perPage), H = HEAD + part.length * RH + 2, s = '';
      // header: months band, then days (or weeks when they are too narrow)
      s += '<rect x="0" y="0" width="' + W + '" height="' + HEAD + '" fill="#1f3864"/>';
      s += '<text x="4" y="11" font-size="9" font-weight="700" fill="#fff">' + esc(g.title || '') + '</text>';
      s += '<text x="' + (LABEL - 4) + '" y="11" font-size="7" fill="#d9e1f2" text-anchor="end">' + esc((lb.page || 'Page') + ' ' + (pg + 1) + '/' + pages) + '</text>';
      var curK = null, segA = a;
      function month(from, to, key) { var x = X(from), w = (to - from + 1) * dw; s += '<rect x="' + x.toFixed(2) + '" y="14" width="' + w.toFixed(2) + '" height="12" fill="#d9e1f2" stroke="#fff" stroke-width=".6"/>'; if (w >= 30) s += '<text x="' + (x + 2).toFixed(2) + '" y="22.6" font-size="6.2" font-weight="700" fill="#1f3864">' + esc(g.monthLabel ? g.monthLabel(key) : key) + '</text>'; }
      for (var d = a; d <= b; d++) { var k = g.keyFn ? g.keyFn(S.fromDays(d)) : S.fromDays(d).slice(0, 7); if (k !== curK) { if (curK != null) month(segA, d - 1, curK); curK = k; segA = d; } }
      month(segA, b, curK);
      cols.forEach(function (c, i) { var x0 = cols.slice(0, i).reduce(function (t, q) { return t + q.w; }, 0); s += '<text x="' + (x0 + 2) + '" y="35" font-size="6.2" font-weight="700" fill="#fff">' + esc(c.h) + '</text>'; });
      var showDay = dw >= 7, showWk = !showDay && dw * 7 >= 15;
      for (var d2 = a; d2 <= b; d2++) {
        var off = S.isOff(sc.off, d2), x = X(d2);
        s += '<rect x="' + x.toFixed(2) + '" y="27" width="' + dw.toFixed(2) + '" height="12" fill="' + (off ? '#e7e6e6' : '#f2f2f2') + '" stroke="#fff" stroke-width=".3"/>';
        if (showDay || (showWk && S.dow(d2) === 1)) s += '<text x="' + (x + dw / 2).toFixed(2) + '" y="35.6" font-size="' + (showDay ? 5.4 : 5.6) + '" text-anchor="' + (showDay ? 'middle' : 'start') + '" fill="#333">' + esc(g.day ? g.day(S.fromDays(d2)) : S.fromDays(d2).slice(8)) + '</text>';
      }
      // rest-day stripes behind the rows, month lines, row lines
      var body = '';
      for (var d3 = a; d3 <= b; d3++) if (S.isOff(sc.off, d3)) body += '<rect x="' + X(d3).toFixed(2) + '" y="' + HEAD + '" width="' + dw.toFixed(2) + '" height="' + (part.length * RH) + '" fill="#f3f3f3"/>';
      var lastK = null;
      for (var d4 = a; d4 <= b; d4++) { var k4 = g.keyFn ? g.keyFn(S.fromDays(d4)) : S.fromDays(d4).slice(0, 7); if (k4 !== lastK) { if (lastK != null) body += '<line x1="' + X(d4).toFixed(2) + '" y1="' + HEAD + '" x2="' + X(d4).toFixed(2) + '" y2="' + (HEAD + part.length * RH) + '" stroke="#c9c9c9" stroke-width=".4"/>'; lastK = k4; } }
      part.forEach(function (r, i) {
        var y = HEAD + i * RH, bold = r.level < 2 || r.head, isT = r.level === 2 && !r.head, gi = by[r.id];
        body += '<line x1="0" y1="' + (y + RH).toFixed(1) + '" x2="' + W + '" y2="' + (y + RH).toFixed(1) + '" stroke="#e1e1e1" stroke-width=".4"/>';
        if (r.level === 0) body += '<rect x="0" y="' + y.toFixed(1) + '" width="' + LABEL + '" height="' + RH + '" fill="#e9edf5"/>';
        else if (bold) body += '<rect x="0" y="' + y.toFixed(1) + '" width="' + LABEL + '" height="' + RH + '" fill="#f4f6fa"/>';
        var cx = 0;
        cols.forEach(function (c) {
          var v = '';
          if (c.k === 'n') v = r.n; else if (c.k === 'desc') v = (r.no ? r.no + ' ' : '') + r.desc;
          else if (c.k === 'days') v = r.sd != null && r.dur != null ? S.fmtNum ? S.fmtNum(r.dur) : r.dur : '';
          else if (c.k === 'start') v = r.sd != null ? (g.fmtDate ? g.fmtDate(r.start) : r.start) : ''; else if (c.k === 'finish') v = r.sd != null ? (g.fmtDate ? g.fmtDate(r.finish) : r.finish) : '';
          else v = isT && r.sched ? S.formatLinks(r.preds, sc) : '';
          var ind = c.k === 'desc' ? (r.depth || 0) * 4 : 0;
          body += '<text x="' + (cx + 2 + ind) + '" y="' + (y + RH - 3.8).toFixed(1) + '" font-size="' + FS + '"' + (bold ? ' font-weight="700"' : '') + (gi && gi.status === 'late' && c.k === 'desc' ? ' fill="#c0392b"' : '') + '>' + esc(cut(v, c.w - 3 - ind, bold)) + '</text>';
          cx += c.w;
        });
        if (r.sd != null) {
          var x1 = X(r.sd), w = Math.max(dw - 0.6, (r.fd - r.sd + 1) * dw - 0.6), by0 = y + 3.2, bh = isT ? 7.2 : 4.2;
          var crit = isT && r.critical, col = r.level === 0 ? '#1f3864' : bold ? '#8ea9db' : crit ? '#c0392b' : '#2f75b5';
          if (isT) {
            body += '<rect x="' + x1.toFixed(2) + '" y="' + by0.toFixed(1) + '" width="' + w.toFixed(2) + '" height="' + bh + '" rx="1" fill="' + col + '"/>';
            if (gi && gi.actual > 0) body += '<rect x="' + x1.toFixed(2) + '" y="' + by0.toFixed(1) + '" width="' + (w * Math.min(1, gi.actual)).toFixed(2) + '" height="' + bh + '" rx="1" fill="#000" fill-opacity=".38"/>';
            if (gi && gi.planned > 0) body += '<rect x="' + x1.toFixed(2) + '" y="' + (by0 + bh + 0.6).toFixed(1) + '" width="' + (w * Math.min(1, gi.planned)).toFixed(2) + '" height="1.4" fill="#e0a526"/>';
            if (gi && gi.status === 'late') body += '<rect x="' + x1.toFixed(2) + '" y="' + by0.toFixed(1) + '" width="' + w.toFixed(2) + '" height="' + bh + '" rx="1" fill="none" stroke="#c0392b" stroke-width=".9"/>';
            if (w >= 24) body += '<text x="' + (x1 + 2).toFixed(2) + '" y="' + (by0 + 5.6).toFixed(1) + '" font-size="5.2" fill="#fff">' + esc(gi && gi.actual > 0 ? Math.round(gi.actual * 100) + '%' : (S.fmtNum ? S.fmtNum(r.dur) : r.dur) + (lb.d || 'd')) + '</text>';
          } else {   // section and group rows: a bracket, like a summary bar
            body += '<rect x="' + x1.toFixed(2) + '" y="' + by0.toFixed(1) + '" width="' + w.toFixed(2) + '" height="' + bh + '" fill="' + col + '"/>';
            body += '<path d="M' + x1.toFixed(2) + ' ' + (by0 + bh).toFixed(1) + 'v3l3 -3z M' + (x1 + w).toFixed(2) + ' ' + (by0 + bh).toFixed(1) + 'v3l-3 -3z" fill="' + col + '"/>';
            if (gi && gi.actual > 0 && w >= 24) body += '<text x="' + (x1 + w + 2).toFixed(2) + '" y="' + (by0 + 4.6).toFixed(1) + '" font-size="5.2" fill="#444">' + Math.round(gi.actual * 100) + '%</text>';
          }
        }
      });
      // links between tasks on this page
      var links = '';
      part.forEach(function (Q, qi) {
        if (!(Q.level === 2 && !Q.head) || !Q.sched || !Q.explicit) return;
        Q.preds.forEach(function (q) {
          var Pr = sc.byId[q.id], pi = rowIdx[String(q.id)];
          if (q.implicit || !Pr || pi == null || Pr.sd == null || Q.sd == null) return;
          pi -= r0; if (pi < 0 || pi >= part.length) return;
          var y1 = HEAD + pi * RH + RH / 2, y2 = HEAD + qi * RH + RH / 2, type = q.type, fromEnd = type === 'FS' || type === 'FF', toEnd = type === 'FF' || type === 'SF';
          var x1 = fromEnd ? X(Pr.fd + 1) - 0.6 : X(Pr.sd), x2 = toEnd ? X(Q.fd + 1) - 0.6 : X(Q.sd), sf = fromEnd ? 1 : -1, st = toEnd ? 1 : -1, ex = x1 + sf * 3, tx = x2 + st * 3, ym = y1 + (y2 >= y1 ? RH / 2 : -RH / 2), dd;
          if (sf === st) { var vx = sf > 0 ? Math.max(ex, tx) : Math.min(ex, tx); dd = 'M' + x1.toFixed(2) + ' ' + y1 + 'H' + vx.toFixed(2) + 'V' + y2 + 'H' + x2.toFixed(2); }
          else if ((sf > 0 && ex <= tx) || (sf < 0 && ex >= tx)) dd = 'M' + x1.toFixed(2) + ' ' + y1 + 'H' + tx.toFixed(2) + 'V' + y2 + 'H' + x2.toFixed(2);
          else dd = 'M' + x1.toFixed(2) + ' ' + y1 + 'H' + ex.toFixed(2) + 'V' + ym + 'H' + tx.toFixed(2) + 'V' + y2 + 'H' + x2.toFixed(2);
          var cc = Q.conflict ? '#e67e22' : Pr.critical && Q.critical ? '#c0392b' : '#555', dir = st > 0 ? -1 : 1;
          links += '<path d="' + dd + '" fill="none" stroke="' + cc + '" stroke-width=".55"/><path d="M' + x2.toFixed(2) + ' ' + y2 + 'l' + (-dir * 2.6) + ' -1.6v3.2z" fill="' + cc + '"/>';
        });
      });
      var tl = '';
      if (today >= a && today <= b) tl = '<line x1="' + (X(today) + dw / 2).toFixed(2) + '" y1="' + (HEAD - 2) + '" x2="' + (X(today) + dw / 2).toFixed(2) + '" y2="' + (HEAD + part.length * RH) + '" stroke="#e03a2f" stroke-width="1"/><text x="' + (X(today) + dw / 2 + 2).toFixed(2) + '" y="' + (HEAD - 3) + '" font-size="5.4" fill="#e03a2f">' + esc(lb.today || 'Today') + '</text>';
      // legend
      var lx = 4, ly = H + 9, leg = '';
      [['#1f3864', lb.group || 'Group'], ['#8ea9db', lb.section || 'Section'], ['#2f75b5', lb.taskL || 'Task'], ['#c0392b', lb.critical || 'Critical'], ['#e0a526', lb.plan || 'Planned'], ['#555', lb.done || 'Actual (dark part of the bar)'], ['#e03a2f', lb.today || 'Today']].forEach(function (q) {
        leg += '<rect x="' + lx + '" y="' + (ly - 5) + '" width="9" height="5" fill="' + q[0] + '"/><text x="' + (lx + 12) + '" y="' + ly + '" font-size="5.8">' + esc(q[1]) + '</text>'; lx += 24 + String(q[1]).length * 3.1;
      });
      out += '<section class="gpage pb"><svg xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:auto" viewBox="0 0 ' + W.toFixed(1) + ' ' + (H + FOOT).toFixed(1) + '" preserveAspectRatio="xMinYMin meet" font-family="Calibri, Arial, sans-serif">' + s + body + links + tl + leg + '</svg></section>';
    }
    return out;
  }

  /* wb: the workbook from CBSchedExcel.workbook(); g (optional): what ganttHtml needs, to replace the grid Gantt sheet by vector pages;
     returns a full HTML document */
  function html(wb, title, lang, g) {
    var sheets = wb.sheets.filter(function (sh) { return !(g && sh.name === 'Gantt'); });
    var body = sheets.map(function (sh, i) { return sheetHtml(sh, i === 0); }).join('') + (g ? ganttHtml(g) : '');
    return '<!doctype html><html lang="' + esc(lang || 'en') + '"><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' + CSS + '</style></head><body>' + body + '</body></html>';
  }

  return { html: html, fmtNum: fmtNum, ganttHtml: ganttHtml };
});
