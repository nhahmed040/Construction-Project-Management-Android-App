/* A trimmed copy of the Badesa Corridor schedule workbook (same layout as the contractor's file),
   used by the tests. Rows are arrays of cells like CBXlsxRead returns. */
function tsv(s) { return s.split('\n').map(function (l) { return l.split('\t').map(function (c) { return /^-?\d+(\.\d+)?$/.test(c) ? Number(c) : c; }); }); }
var ROLES = ['Project Manager','Store Keeper','Surveyor','Forman','Accountant','Cashier','Daily Labour','Mason','Carpenter','Helper','Plasterer','Bar Bender','Tiler','Chisler','Welder','Painter','Glazer','Electrician','Plumber','Mixer Operator','Vibrator Operator','Compactor Operator','Truck Driver','BackHoe Loader Operator','Pick Up Driver'];
function mp(map) { var a = new Array(25).fill(''); Object.keys(map).forEach(function (k) { a[ROLES.indexOf(k)] = map[k]; }); return a; }
function row(cells) { return cells; }
var manpower = [
  ['', '', '', '', 'YEROO Road Works PLC', 'Karoora Humna Nama (Man Power Schedule)'],
  ['', '', '', '', 'Project :Badesa Corridor Project Plot – 6 ', '', '', '', '', '', '', '', '', 'Member (Permanent)', '', '', '', '', '', 'Temporarly Employed'],
  ['', '', '', '', 'Client :-Badesa Town Mayor Office', '', '', '', '', '', '', '', ''].concat(ROLES),
  ['', '', '', '', 'Location :-East Oromia Zone, Badesa Town'],
  ['', '', '', '', 'Project cost :-10,704,102.34'],
  [],
  ['', '', '', '', '', '', 'Project Time Span', '', 'Tue 01/12/26 -', 'Wed 03/03/27'],
  [],
  ['', 'No', '', 'Task Name', 'Task Name', 'Unit', 'QTY', 'Rate', 'Amount', 'Duration', 'Start', 'Finish'],
  ['', '', 'G', 'Badesa Corridor Project Plot – 6 ', 'Badesa Corridor Project Plot – 6', '', '', '', '', '80 days', 'Tue 01/12/26', 'Wed 03/03/27'],
  ['', '', 'T', '   Site Handover Mobilization', 'Site Handover Mobilization', '', 0, 0, '', '3 days', 'Tue 01/12/26', 'Thu 03/12/26', ''].concat(mp({ 'Project Manager': 1, 'Store Keeper': 1, 'Surveyor': 1, 'Forman': 1, 'Pick Up Driver': 1 })),
  ['', '', 'G', '   A. Corridor work', 'A. Corridor work', '', '', '', '', '46 days', 'Fri 04/12/26', 'Tue 26/01/27'],
  ['', 1, 'S', '      EXCAVATION and EARTH WORK', 'EXCAVATION and EARTH WORK', '', '', '', '', '5 days', 'Fri 04/12/26', 'Wed 09/12/26'],
  ['', 'A', 'T', '         trench excavation for curb concrete', 'trench excavation for curb', 'M³', 96, 550, 52800, '1 day', 'Fri 04/12/26', 'Fri 04/12/26', ''].concat(mp({ 'Surveyor': 1, 'Forman': 1, 'Daily Labour': 6, 'BackHoe Loader Operator': 1, 'Pick Up Driver': 1 })),
  ['', 'B', 'T', '         backfill and compact selected material', 'backfill and compact', 'M³', 82, 1370, 112340, '3 days', 'Sat 05/12/26', 'Tue 08/12/26', ''].concat(mp({ 'Forman': 1, 'Daily Labour': 12, 'Compactor Operator': 1, 'Pick Up Driver': 1 })),
  ['', 'C', 'T', '         Cartaway Removal of trench excavated soil', 'Cartaway', 'M³', 96, 346.56, 33269.76, '1 day', 'Wed 09/12/26', 'Wed 09/12/26', ''].concat(mp({ 'Forman': 1, 'Daily Labour': 6, 'Truck Driver': 1, 'Pick Up Driver': 1 })),
  ['', 2, 'S', '      TERRAZZO PAVING', 'TERRAZZO PAVING', '', '', '', '', '42 days', 'Wed 09/12/26', 'Tue 26/01/27'],
  ['', 'C', 'T', '         30*15cm terrazzo pavement for walk way', '30*15cm terrazzo', 'M²', 1073, 1596.96, 1713538.08, '25 days', 'Fri 11/12/26', 'Fri 08/01/27', ''].concat(mp({ 'Forman': 1, 'Daily Labour': 12, 'Tiler': 5, 'Helper': 5, 'Pick Up Driver': 1 })),
  ['', '', 'M', 'Total  .', 'Total .', '', '', '', 1911947.84],
  ['', '', 'M', 'VAT  .', 'VAT .', '', '', '', 286792.176]
];
var equipment = [
  ['', '', 'YEROO Road Works PLC', 'Karoora Meeshaalee Ijaarsaa (Equipment Schedule)'],
  ['', '', 'Project :Badesa Corridor Project Plot – 6 ', '', '', '', '', '', '', '', '', 'Rent', '', '', '', '', '', '', 'Owned'],
  ['', '', 'Client :-Badesa Town Mayor Office', '', '', '', '', '', '', '', '', 'Concrete Mixer', 'Vibrator', 'Plate Compactor', 'Pick Up Vehicle', 'Dump Truck', 'BackHoe Loader', 'Generator', 'Weilding Machine', 'Grinder', 'Driller', 'Water Tanker', 'Other Tools (*)'],
  [],
  ['', 'No', 'Task Name', 'Unit', 'QTY', 'Rate', 'Amount', 'Duration', 'Start', 'Finish'],
  ['', '', 'Badesa Corridor Project Plot – 6', '', '', '', '', '80 days', 'Tue 01/12/26', 'Wed 03/03/27'],
  ['', '', 'Site Handover Mobilization', '', '', '', '', '3 days', 'Tue 01/12/26', 'Thu 03/12/26'],
  ['', '', 'A. Corridor work', '', '', '', '', '46 days', 'Fri 04/12/26', 'Tue 26/01/27'],
  ['', 1, 'EXCAVATION and EARTH WORK', '', '', '', '', '5 days', 'Fri 04/12/26', 'Wed 09/12/26'],
  ['', 'A', 'trench excavation for curb', 'M³', 96, 550, 52800, '1 day', 'Fri 04/12/26', 'Fri 04/12/26', '', '', '', '', 1, '', 1, '', '', '', '', '*', '*'],
  ['', 'B', 'backfill and compact', 'M³', 82, 1370, 112340, '3 days', 'Sat 05/12/26', 'Tue 08/12/26', '', '', '', 1, 1, '', '', '', '', '', '', '*', '*'],
  ['', 'C', 'Cartaway', 'M³', 96, 346.56, 33269.76, '1 day', 'Wed 09/12/26', 'Wed 09/12/26', '', '', '', '', 1, '', 1, '', '', '', '', '*', '*'],
  ['', 2, 'TERRAZZO PAVING', '', '', '', '', '42 days', 'Wed 09/12/26', 'Tue 26/01/27'],
  ['', 'C', '30*15cm terrazzo', 'M²', 1073, 1596.96, 1713538.08, '25 days', 'Fri 11/12/26', 'Fri 08/01/27', '', '', '', '', 1, '', '', '', '', '', '', '*', '*']
];
var cash = [
  ['', '', 'Project :Badesa Corridor Project Plot – 6 '],
  ['', 'No', 'Task Name', 'Unit', 'QTY', 'Rate', 'Amount', 'Material Cost', 'Labor Cost', 'Equipment and tools Cost', 'Miscelanious Expenses', 'Over head cost ', 'Profit', 'Witholding Tax', 'VAT'],
  ['', 'A', 'trench excavation for curb', 'M³', 96, 550, 52800, 1584, 6336, 34320, 1584, 3696, 3696, 1584, 7920, 'Yes'],
  ['', 'B', 'backfill and compact', 'M³', 82, 1370, 112340, 44936, 22468, 22468, 3370.2, 7863.8, 7863.8, 3370.2, 16851, 'Yes'],
  ['', 'C', 'Cartaway', 'M³', 96, 346.56, 33269.76, 998.0928, 3992.3712, 21625.344, 998.0928, 2328.8832, 2328.8832, 998.0928, 4990.464, 'Yes'],
  ['', 'C', '30*15cm terrazzo', 'M²', 1073, 1596.96, 1713538.08, 1062393.6096, 257030.712, 51406.1424, 51406.1424, 119947.6656, 119947.6656, 51406.1424, 257030.712, 'Yes']
];
var people = [
  ['S/N', 'Man Power Type', 'Assigned Person', 'Type of Employement', 'Requiered No.'],
  [1, 'Project Manager', 'Nuh Ahmed', 'Permanent', 1],
  [2, 'Store Keeper', 'Tigist Bedilu', 'Permanent', 1],
  [3, 'Surveyour', 'Aschenki Gizaw', 'Permanent', 1],
  [4, 'Forman', 'Kalkidan Ayele', 'Permanent', 1],
  [1, 'Daily Laborer ', '', 'Temporary', 12]
];
module.exports = [
  { name: 'Mana Power ', rows: manpower }, { name: '1- Man power schedule', rows: people },
  { name: 'Equipment', rows: equipment }, { name: 'Cash Flow', rows: cash }
];
