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
    '.gantt td, .gantt th { padding: 0 1pt; }';

  /* wb: the workbook from CBSchedExcel.workbook(); returns a full HTML document */
  function html(wb, title, lang) {
    var body = wb.sheets.map(function (sh, i) { return sheetHtml(sh, i === 0); }).join('');
    return '<!doctype html><html lang="' + esc(lang || 'en') + '"><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' + CSS + '</style></head><body>' + body + '</body></html>';
  }

  return { html: html, fmtNum: fmtNum };
});
