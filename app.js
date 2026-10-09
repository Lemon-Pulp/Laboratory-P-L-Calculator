/**
 * Grace Laboratory - Revenue & Profit/Loss Calculation Engine & Portal
 * Standalone Client-Side Application for GitHub Pages
 */

// State Management
var AppState = window.AppState = {
  doctorCuts: {},
  branchExpenses: {},
  makarpuraSubUnits: [],
  expenseHeads: [],
  rawBills: [],
  parsedBills: [],
  months: [],
  selectedMonth: 'ALL', // 'ALL' or specific month string like 'October 2026'
  unmatchedDoctors: [],
  calculationResults: null,
  charts: {}
};

// ==========================================
// 1. INITIALIZATION & LOCAL STORAGE
// ==========================================

function initApp() {
  // Load Doctor Cuts from LocalStorage or Defaults
  const savedCuts = localStorage.getItem('grace_dr_cuts');
  if (savedCuts) {
    try {
      AppState.doctorCuts = JSON.parse(savedCuts);
    } catch (e) {
      AppState.doctorCuts = { ...DEFAULT_DOCTOR_CUTS };
    }
  } else {
    AppState.doctorCuts = { ...DEFAULT_DOCTOR_CUTS };
  }

  // Load Branch Expenses from LocalStorage or Defaults
  const savedExpenses = localStorage.getItem('grace_branch_expenses');
  if (savedExpenses) {
    try {
      AppState.branchExpenses = JSON.parse(savedExpenses);
    } catch (e) {
      AppState.branchExpenses = JSON.parse(JSON.stringify(DEFAULT_BRANCH_EXPENSES));
    }
  } else {
    AppState.branchExpenses = JSON.parse(JSON.stringify(DEFAULT_BRANCH_EXPENSES));
  }

  AppState.makarpuraSubUnits = [...MAKARPURA_SUB_UNITS];
  AppState.expenseHeads = [...EXPENSE_HEAD_DEFINITIONS];

  // Setup Event Listeners
  setupEventListeners();

  // Render Doctor Master Table & Expense Settings
  renderDoctorMasterTable();
  renderExpenseSettingsTable();

  // Check if sample data is available
  if (typeof SAMPLE_BILLS_DATA !== 'undefined' && SAMPLE_BILLS_DATA.length > 0) {
    // Show sample data ready notification
    console.log('Sample data available:', SAMPLE_BILLS_DATA.length, 'records');
  }
}

// ==========================================
// 2. DOCTOR NAME NORMALIZATION & MATCHING
// ==========================================

function cleanDoctorName(name) {
  if (!name) return '';
  let s = String(name).trim();
  // Strip doctor prefixes
  s = s.replace(/^(Dr\.|Dr\s+|DR\.|DR\s+|Doctor\s+)/i, '').trim();
  // Collapse multiple spaces
  s = s.replace(/\s+/g, ' ');
  return s;
}

// Levenshtein distance for fuzzy matching
function levenshteinDistance(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1).toLowerCase() === a.charAt(j - 1).toLowerCase()) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function stringSimilarity(s1, s2) {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  if (longer.length === 0) return 1.0;
  const dist = levenshteinDistance(longer, shorter);
  return (longer.length - dist) / parseFloat(longer.length);
}

function matchDoctor(docName) {
  if (!docName || String(docName).trim().toUpperCase() === 'SELF') {
    return {
      matchedName: 'SELF',
      percentage: 0,
      matchType: 'SELF',
      confidence: 1.0
    };
  }

  const cleaned = cleanDoctorName(docName);
  const cleanedLower = cleaned.toLowerCase();

  // 1. Direct exact or case-insensitive match in dictionary
  for (const [masterDoc, pct] of Object.entries(AppState.doctorCuts)) {
    if (masterDoc.toLowerCase() === docName.toLowerCase() || masterDoc.toLowerCase() === cleanedLower) {
      return {
        matchedName: masterDoc,
        percentage: Number(pct),
        matchType: 'EXACT',
        confidence: 1.0
      };
    }
    const cleanMaster = cleanDoctorName(masterDoc).toLowerCase();
    if (cleanMaster === cleanedLower) {
      return {
        matchedName: masterDoc,
        percentage: Number(pct),
        matchType: 'EXACT_CLEAN',
        confidence: 0.98
      };
    }
  }

  // 2. Strip parentheses e.g. "Dr. MIHIR PATEL (MADHAV CLINIC)" -> "Mihir Patel"
  const strippedParen = cleaned.replace(/\(.*?\)/g, '').trim().toLowerCase();
  if (strippedParen && strippedParen !== cleanedLower) {
    for (const [masterDoc, pct] of Object.entries(AppState.doctorCuts)) {
      const cleanMaster = cleanDoctorName(masterDoc).toLowerCase();
      if (cleanMaster === strippedParen) {
        return {
          matchedName: masterDoc,
          percentage: Number(pct),
          matchType: 'STRIPPED_PAREN',
          confidence: 0.95
        };
      }
    }
  }

  // 3. Strip punctuation and spaces e.g. "C.M.CHOTALIYA" -> "cmchotaliya"
  const alphaNumericClean = cleanedLower.replace(/[^a-z0-9]/g, '');
  for (const [masterDoc, pct] of Object.entries(AppState.doctorCuts)) {
    const cleanMaster = cleanDoctorName(masterDoc).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cleanMaster === alphaNumericClean) {
      return {
        matchedName: masterDoc,
        percentage: Number(pct),
        matchType: 'STRIPPED_PUNCT',
        confidence: 0.92
      };
    }
  }

  // 4. Fuzzy Matching with Levenshtein distance
  let bestMatch = null;
  let bestScore = 0;

  for (const [masterDoc, pct] of Object.entries(AppState.doctorCuts)) {
    const cleanMaster = cleanDoctorName(masterDoc).toLowerCase();
    const score = stringSimilarity(cleanedLower, cleanMaster);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = { masterDoc, pct, score };
    }
  }

  if (bestMatch && bestScore >= 0.72) {
    return {
      matchedName: bestMatch.masterDoc,
      percentage: Number(bestMatch.pct),
      matchType: `FUZZY (${Math.round(bestScore * 100)}%)`,
      confidence: bestScore
    };
  }

  // 5. Unmatched Doctor: Fallback to Self (0%) as requested by user
  return {
    matchedName: docName,
    percentage: 0,
    matchType: 'UNMATCHED (0% fallback)',
    confidence: 0.0
  };
}

// ==========================================
// 3. EXCEL EXTRACTION (SheetJS)
// ==========================================

function handleFileUpload(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    const data = new Uint8Array(e.target.result);
    const workbook = XLSX.read(data, { type: 'array', cellDates: true });

    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    // Parse to JSON array of arrays
    const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    processExtractedRows(rawRows, file.name);
  };
  reader.readAsArrayBuffer(file);
}

function processExtractedRows(rawRows, fileName) {
  // Find Header Row: look for 'Branch' and 'Consulting Doctor Name'
  let headerIndex = -1;
  let colMap = {
    branch: -1,
    doctor: -1,
    received: -1,
    due: -1,
    date: -1
  };

  for (let r = 0; r < Math.min(rawRows.length, 25); r++) {
    const row = rawRows[r];
    for (let c = 0; c < row.length; c++) {
      const cellVal = String(row[c] || '').trim().toLowerCase();
      if (cellVal === 'branch') colMap.branch = c;
      if (cellVal.includes('consulting doctor') || cellVal === 'doctor' || cellVal.includes('doctor name')) colMap.doctor = c;
      if (cellVal.includes('received amount') || cellVal === 'recieved amount' || cellVal === 'received') colMap.received = c;
      if (cellVal.includes('due amount') || cellVal === 'due') colMap.due = c;
      if (cellVal.includes('registration date') || cellVal === 'date' || cellVal.includes('reg date')) colMap.date = c;
    }

    if (colMap.branch !== -1 && (colMap.doctor !== -1 || colMap.received !== -1)) {
      headerIndex = r;
      break;
    }
  }

  // Fallback defaults if header search was partially matched
  if (colMap.branch === -1) colMap.branch = 0; // Col A
  if (colMap.doctor === -1) colMap.doctor = 24; // Col Y
  if (colMap.received === -1) colMap.received = 37; // Col AL
  if (colMap.due === -1) colMap.due = 38; // Col AM
  if (colMap.date === -1) colMap.date = 4; // Col E

  if (headerIndex === -1) headerIndex = 8; // Row 9 (0-indexed 8) in BillRegister

  const parsed = [];
  const unmatched = new Map();
  const monthsFound = new Set();

  for (let r = headerIndex + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    const branchVal = String(row[colMap.branch] || '').trim();
    if (!branchVal || branchVal.toLowerCase() === 'total' || branchVal === '') continue;

    const docVal = String(row[colMap.doctor] || '').trim();
    const recVal = parseFloat(row[colMap.received]) || 0;
    const dueVal = parseFloat(row[colMap.due]) || 0;
    
    // Date parsing & month extraction
    let rawDate = row[colMap.date];
    let monthLabel = 'October 2026'; // fallback default

    if (rawDate instanceof Date) {
      const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      monthLabel = `${monthNames[rawDate.getMonth()]} ${rawDate.getFullYear()}`;
    } else if (typeof rawDate === 'string' && rawDate.trim()) {
      const match = rawDate.match(/(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/ ](\d{2,4})/);
      if (match) {
        monthLabel = `${match[2]} ${match[3]}`;
      } else {
        monthLabel = rawDate.trim();
      }
    }

    monthsFound.add(monthLabel);

    // Doctor matching
    const matchResult = matchDoctor(docVal);
    if (matchResult.matchType.startsWith('UNMATCHED') && docVal.toUpperCase() !== 'SELF' && docVal !== '') {
      if (!unmatched.has(docVal)) {
        unmatched.set(docVal, {
          doctorName: docVal,
          branch: branchVal,
          count: 1,
          totalReceived: recVal
        });
      } else {
        const item = unmatched.get(docVal);
        item.count++;
        item.totalReceived += recVal;
      }
    }

    parsed.push({
      rowId: r + 1,
      branch: branchVal,
      doctor: docVal || 'SELF',
      matchedDoctor: matchResult.matchedName,
      doctorCutPct: matchResult.percentage,
      matchType: matchResult.matchType,
      received: recVal,
      due: dueVal,
      date: rawDate,
      month: monthLabel
    });
  }

  AppState.parsedBills = parsed;
  AppState.months = Array.from(monthsFound);
  AppState.unmatchedDoctors = Array.from(unmatched.values());
  if (AppState.months.length > 0) {
    AppState.selectedMonth = AppState.months[0];
  }

  // Update UI Elements
  updateMonthSelector();
  renderUnmatchedDoctorsAlert();
  calculateAndRender();

  // Show Success Toast
  showToast(`Successfully imported ${parsed.length} rows from "${fileName}" across ${AppState.months.length} month(s).`);
}

function loadSampleData() {
  if (typeof SAMPLE_BILLS_DATA === 'undefined') {
    alert('Sample data file not loaded.');
    return;
  }

  const parsed = [];
  const unmatched = new Map();
  const monthsFound = new Set();

  SAMPLE_BILLS_DATA.forEach((b, idx) => {
    const branchVal = b.branch;
    const docVal = b.doctor;
    const recVal = Number(b.received) || 0;
    const dueVal = Number(b.due) || 0;
    const monthLabel = 'October 2026';
    monthsFound.add(monthLabel);

    const matchResult = matchDoctor(docVal);
    if (matchResult.matchType.startsWith('UNMATCHED') && docVal.toUpperCase() !== 'SELF' && docVal !== '') {
      if (!unmatched.has(docVal)) {
        unmatched.set(docVal, {
          doctorName: docVal,
          branch: branchVal,
          count: 1,
          totalReceived: recVal
        });
      } else {
        const item = unmatched.get(docVal);
        item.count++;
        item.totalReceived += recVal;
      }
    }

    parsed.push({
      rowId: idx + 1,
      branch: branchVal,
      doctor: docVal || 'SELF',
      matchedDoctor: matchResult.matchedName,
      doctorCutPct: matchResult.percentage,
      matchType: matchResult.matchType,
      received: recVal,
      due: dueVal,
      date: b.date,
      month: monthLabel
    });
  });

  AppState.parsedBills = parsed;
  AppState.months = Array.from(monthsFound);
  AppState.unmatchedDoctors = Array.from(unmatched.values());
  AppState.selectedMonth = AppState.months[0];

  updateMonthSelector();
  renderUnmatchedDoctorsAlert();
  calculateAndRender();

  showToast(`Loaded ${parsed.length} transactions from BillRegister_ShortTestName_09Oct2026092721.xlsx sample data!`);
}

// ==========================================
// 4. CALCULATION ENGINE
// ==========================================

function runCalculations(targetMonth) {
  // Filter bills by month if specified
  const bills = (targetMonth === 'ALL')
    ? AppState.parsedBills
    : AppState.parsedBills.filter(b => b.month === targetMonth);

  // Define All Branches & Columns from Default Template
  const branchMap = {};
  
  // Initialize standard branches from AppState.branchExpenses
  for (const [colLetter, colData] of Object.entries(AppState.branchExpenses)) {
    const bName = colData.branch_name;
    if (!bName) continue;
    
    branchMap[colLetter] = {
      col: colLetter,
      colIndex: colData.col_index,
      branchName: bName,
      subHeading: colData.sub_heading,
      fixedExpenses: { ...colData.expenses },
      totalFixed: colData.total_monthly_fixed,
      received: 0,
      due: 0,
      docCutAmount: 0,
      balanceRevenue: 0,
      stationaryAmount: 0,
      reagentAmount: 0,
      totalExpense: 0,
      netProfit: 0,
      profitPct: 0,
      stationaryRate: 0.01, // default 1%
      reagentRate: (colLetter === 'AC') ? 0.15 : 0.125, reagentRate: (colLetter === 'AC') ? 0.15 : 0.125,
      customCutPct: (colLetter === 'AH') ? 30 : undefined,
      transactions: [],
      doctorBreakdown: {}
    };
  }

  // Ensure Makarpura Testing Unit (Col AQ) has fixed expenses even if no revenue
  if (!branchMap['AQ'] && AppState.branchExpenses['AQ']) {
    branchMap['AQ'] = {
      col: 'AQ',
      colIndex: 43,
      branchName: 'makarpura testing unit',
      subHeading: 'Central Testing Unit',
      fixedExpenses: { ...AppState.branchExpenses['AQ'].expenses },
      totalFixed: AppState.branchExpenses['AQ'].total_monthly_fixed,
      received: 0,
      due: 0,
      docCutAmount: 0,
      balanceRevenue: 0,
      stationaryAmount: 0,
      reagentAmount: 0,
      totalExpense: AppState.branchExpenses['AQ'].total_monthly_fixed,
      netProfit: -AppState.branchExpenses['AQ'].total_monthly_fixed,
      profitPct: 0,
      stationaryRate: 0.01,
      reagentRate: 0.125,
      transactions: [],
      doctorBreakdown: {}
    };
  }

  // Process Bills into Branches and Sub-Units
  bills.forEach(bill => {
    let targetCol = null;
    const bName = bill.branch.trim();
    const docName = bill.doctor.trim();

    // Check if it belongs to '29- Makarpura Grace laboratory'
    if (bName.toLowerCase().includes('makarpura')) {
      // Check for High Volume Doctors / Sub-units
      let isSubUnit = false;
      for (const sub of AppState.makarpuraSubUnits) {
        if (sub.doctorMatch.some(dm => cleanDoctorName(dm).toLowerCase() === cleanDoctorName(docName).toLowerCase())) {
          targetCol = sub.fixedExpenseCol;
          isSubUnit = true;
          break;
        }
      }

      if (!isSubUnit) {
        // Fall into General 29- Makarpura pool (Col R)
        targetCol = 'R';
      }
    } else {
      // Find matching branch column by branch name
      for (const [colLetter, bObj] of Object.entries(branchMap)) {
        if (bObj.branchName && (
          bObj.branchName.toLowerCase().includes(bName.toLowerCase()) ||
          bName.toLowerCase().includes(bObj.branchName.toLowerCase())
        )) {
          targetCol = colLetter;
          break;
        }
      }
    }

    // If still no direct match, check if there's an existing branch key
    if (!targetCol) {
      // Find first column matching branch
      const match = Object.keys(branchMap).find(k => branchMap[k].branchName.toLowerCase() === bName.toLowerCase());
      if (match) targetCol = match;
    }

    // If branch doesn't exist in template, create a dynamic entry
    if (!targetCol) {
      targetCol = 'DYNAMIC_' + bName.replace(/[^a-zA-Z0-9]/g, '_');
      if (!branchMap[targetCol]) {
        branchMap[targetCol] = {
          col: targetCol,
          colIndex: 999,
          branchName: bName,
          subHeading: 'Dynamic Branch',
          fixedExpenses: {},
          totalFixed: 0,
          received: 0,
          due: 0,
          docCutAmount: 0,
          balanceRevenue: 0,
          stationaryAmount: 0,
          reagentAmount: 0,
          totalExpense: 0,
          netProfit: 0,
          profitPct: 0,
          stationaryRate: 0.01,
          reagentRate: 0.125,
          transactions: [],
          doctorBreakdown: {}
        };
      }
    }

    const targetBranch = branchMap[targetCol];
    if (targetBranch) {
      targetBranch.received += bill.received;
      targetBranch.due += bill.due;
      targetBranch.transactions.push(bill);

      // Re-evaluate doctor cut percentage using active AppState.doctorCuts
      const mResult = matchDoctor(bill.doctor);
      let cutPct = mResult.percentage;
      if (targetBranch.customCutPct !== undefined) {
        cutPct = targetBranch.customCutPct;
      }
      const cutAmt = bill.received * (cutPct / 100);
      targetBranch.docCutAmount += cutAmt;

      // Doctor breakdown
      const docKey = bill.doctor;
      if (!targetBranch.doctorBreakdown[docKey]) {
        targetBranch.doctorBreakdown[docKey] = {
          doctorName: docKey,
          matchedName: mResult.matchedName,
          percentage: cutPct,
          received: 0,
          due: 0,
          cutAmount: 0,
          count: 0
        };
      }
      targetBranch.doctorBreakdown[docKey].received += bill.received;
      targetBranch.doctorBreakdown[docKey].due += bill.due;
      targetBranch.doctorBreakdown[docKey].cutAmount += cutAmt;
      targetBranch.doctorBreakdown[docKey].count++;
    }
  });

  // Finalize Branch Calculations
  let grandTotalReceived = 0;
  let grandTotalDue = 0;
  let grandTotalDocCut = 0;
  let grandTotalStationary = 0;
  let grandTotalReagent = 0;
  let grandTotalFixed = 0;
  let grandTotalExpense = 0;
  let grandTotalNetProfit = 0;

  for (const [colLetter, bObj] of Object.entries(branchMap)) {
    // Special Rule for Dabhoi: Salary2 is 5% of Received Amount
    if (colLetter === 'BF') {
      const dynamicSalary2 = bObj.received * 0.05;
      bObj.fixedExpenses['salary2_logistics'] = dynamicSalary2;
      // Re-sum fixed expenses
      let sumFixed = 0;
      for (const [k, v] of Object.entries(bObj.fixedExpenses)) {
        sumFixed += Number(v) || 0;
      }
      bObj.totalFixed = sumFixed;
    }

    // Variable expenses
    bObj.balanceRevenue = bObj.received - bObj.docCutAmount;
    bObj.stationaryAmount = bObj.received * bObj.stationaryRate;
    bObj.reagentAmount = bObj.received * bObj.reagentRate;

    // Total expense = Fixed + DocCut + Stationary + Reagents
    // In template accounting: Net Profit = Balance Revenue - (Fixed + Stationary + Reagents)
    // which equals: Received - DocCut - Fixed - Stationary - Reagents
    bObj.totalExpense = bObj.totalFixed + bObj.docCutAmount + bObj.stationaryAmount + bObj.reagentAmount;
    bObj.netProfit = bObj.received - bObj.totalExpense;

    if (bObj.received > 0) {
      bObj.profitPct = (bObj.netProfit / bObj.received) * 100;
    } else if (bObj.totalExpense > 0) {
      bObj.profitPct = -100; // Loss if no revenue but expenses
    } else {
      bObj.profitPct = 0;
    }

    grandTotalReceived += bObj.received;
    grandTotalDue += bObj.due;
    grandTotalDocCut += bObj.docCutAmount;
    grandTotalStationary += bObj.stationaryAmount;
    grandTotalReagent += bObj.reagentAmount;
    grandTotalFixed += bObj.totalFixed;
    grandTotalExpense += bObj.totalExpense;
    grandTotalNetProfit += bObj.netProfit;
  }

  const grandProfitPct = (grandTotalReceived > 0)
    ? (grandTotalNetProfit / grandTotalReceived) * 100
    : 0;

  // Doctor Level Rollup
  const allDoctors = {};
  bills.forEach(bill => {
    const docKey = bill.doctor;
    const mResult = matchDoctor(docKey);
    const cutPct = mResult.percentage;
    const cutAmt = bill.received * (cutPct / 100);

    if (!allDoctors[docKey]) {
      allDoctors[docKey] = {
        doctorName: docKey,
        matchedName: mResult.matchedName,
        cutPct: cutPct,
        branch: bill.branch,
        totalReceived: 0,
        totalDue: 0,
        totalCutAmount: 0,
        patientCount: 0
      };
    }
    allDoctors[docKey].totalReceived += bill.received;
    allDoctors[docKey].totalDue += bill.due;
    allDoctors[docKey].totalCutAmount += cutAmt;
    allDoctors[docKey].patientCount++;
  });

  const doctorList = Object.values(allDoctors).sort((a, b) => b.totalReceived - a.totalReceived);

  // Consolidated Branches (combining Makarpura sub-units for high-level branch comparison)
  const consolidated = {};
  for (const [colLetter, bObj] of Object.entries(branchMap)) {
    let mainBranchName = bObj.branchName;
    if (mainBranchName.includes('Makr. Rec') || mainBranchName.includes('Makarpura')) {
      mainBranchName = '29- Makarpura Grace laboratory (Consolidated)';
    }

    if (!consolidated[mainBranchName]) {
      consolidated[mainBranchName] = {
        branchName: mainBranchName,
        received: 0,
        due: 0,
        docCut: 0,
        stationary: 0,
        reagent: 0,
        fixed: 0,
        totalExpense: 0,
        netProfit: 0
      };
    }

    const c = consolidated[mainBranchName];
    c.received += bObj.received;
    c.due += bObj.due;
    c.docCut += bObj.docCutAmount;
    c.stationary += bObj.stationaryAmount;
    c.reagent += bObj.reagentAmount;
    c.fixed += bObj.totalFixed;
    c.totalExpense += bObj.totalExpense;
    c.netProfit += bObj.netProfit;
  }

  for (const c of Object.values(consolidated)) {
    c.profitPct = (c.received > 0) ? (c.netProfit / c.received) * 100 : 0;
  }

  AppState.calculationResults = {
    month: targetMonth,
    branchMap: branchMap,
    consolidatedBranches: consolidated,
    doctorList: doctorList,
    totals: {
      received: grandTotalReceived,
      due: grandTotalDue,
      docCut: grandTotalDocCut,
      stationary: grandTotalStationary,
      reagent: grandTotalReagent,
      fixed: grandTotalFixed,
      totalExpense: grandTotalExpense,
      netProfit: grandTotalNetProfit,
      profitPct: grandProfitPct
    }
  };

  return AppState.calculationResults;
}

// ==========================================
// 5. RENDERING & UI UPDATES
// ==========================================

function calculateAndRender() {
  const results = runCalculations(AppState.selectedMonth);

  // 1. Render Dashboard KPI Cards
  document.getElementById('kpi-revenue').innerText = formatCurrency(results.totals.received);
  document.getElementById('kpi-due').innerText = formatCurrency(results.totals.due);
  document.getElementById('kpi-fixed').innerText = formatCurrency(results.totals.fixed);
  document.getElementById('kpi-doc-cuts').innerText = formatCurrency(results.totals.docCut);
  document.getElementById('kpi-reagents').innerText = formatCurrency(results.totals.reagent);
  document.getElementById('kpi-total-exp').innerText = formatCurrency(results.totals.totalExpense);
  
  const netProfitEl = document.getElementById('kpi-net-profit');
  netProfitEl.innerText = formatCurrency(results.totals.netProfit);
  netProfitEl.className = results.totals.netProfit >= 0 
    ? 'text-3xl font-extrabold text-emerald-600' 
    : 'text-3xl font-extrabold text-rose-600';

  const marginEl = document.getElementById('kpi-margin');
  marginEl.innerText = `${results.totals.profitPct.toFixed(1)}%`;
  marginEl.className = results.totals.profitPct >= 0 
    ? 'text-lg font-bold text-emerald-600' 
    : 'text-lg font-bold text-rose-600';

  // 2. Render Charts
  renderDashboardCharts(results);

  // 3. Render Branch Table
  renderBranchTable(results.branchMap);

  // 4. Render Doctor Analytics Table
  renderDoctorAnalyticsTable(results.doctorList);

  // 5. Render Full P&L Sheet View
  renderFullPLSheet(results);

  // 6. Render Monthly Comparison if multiple months exist
  renderMonthlyComparison();
}

function renderBranchTable(branchMap) {
  const tbody = document.getElementById('branch-table-body');
  if (!tbody) return;

  const rows = Object.values(branchMap)
    .filter(b => b.received > 0 || b.totalFixed > 0 || b.due > 0)
    .sort((a, b) => b.received - a.received);

  tbody.innerHTML = rows.map((b, idx) => {
    const isProfitable = b.netProfit >= 0;
    const badgeColor = isProfitable 
      ? 'bg-emerald-100 text-emerald-800' 
      : 'bg-rose-100 text-rose-800';
    const statusText = isProfitable ? 'Profit' : 'Loss';

    return `
      <tr class="hover:bg-slate-50 transition border-b border-slate-200">
        <td class="px-4 py-3 text-sm font-semibold text-slate-800">
          ${b.branchName}
          ${b.subHeading ? `<span class="block text-xs font-normal text-slate-500">${b.subHeading}</span>` : ''}
        </td>
        <td class="px-4 py-3 text-sm text-right font-medium text-slate-900">${formatCurrency(b.received)}</td>
        <td class="px-4 py-3 text-sm text-right text-amber-600 font-medium">${formatCurrency(b.due)}</td>
        <td class="px-4 py-3 text-sm text-right text-slate-700">${formatCurrency(b.docCutAmount)}</td>
        <td class="px-4 py-3 text-sm text-right text-slate-600">${formatCurrency(b.stationaryAmount)}</td>
        <td class="px-4 py-3 text-sm text-right text-slate-600">${formatCurrency(b.reagentAmount)}</td>
        <td class="px-4 py-3 text-sm text-right text-slate-700 font-medium">${formatCurrency(b.totalFixed)}</td>
        <td class="px-4 py-3 text-sm text-right font-semibold text-slate-900">${formatCurrency(b.totalExpense)}</td>
        <td class="px-4 py-3 text-sm text-right font-bold ${isProfitable ? 'text-emerald-600' : 'text-rose-600'}">
          ${formatCurrency(b.netProfit)}
        </td>
        <td class="px-4 py-3 text-sm text-right font-bold ${isProfitable ? 'text-emerald-600' : 'text-rose-600'}">
          ${b.profitPct.toFixed(1)}%
        </td>
        <td class="px-4 py-3 text-center">
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${badgeColor}">
            ${statusText}
          </span>
        </td>
      </tr>
    `;
  }).join('');
}

function renderDoctorAnalyticsTable(doctors) {
  const tbody = document.getElementById('doctor-analytics-body');
  if (!tbody) return;

  tbody.innerHTML = doctors.slice(0, 100).map((d, idx) => {
    return `
      <tr class="hover:bg-slate-50 transition border-b border-slate-200">
        <td class="px-4 py-2.5 text-xs text-slate-500">${idx + 1}</td>
        <td class="px-4 py-2.5 text-sm font-semibold text-slate-800">
          ${d.doctorName}
          ${d.matchedName !== d.doctorName ? `<span class="block text-xs font-normal text-slate-400">Matched as: ${d.matchedName}</span>` : ''}
        </td>
        <td class="px-4 py-2.5 text-xs text-slate-600">${d.branch}</td>
        <td class="px-4 py-2.5 text-sm text-center">
          <span class="inline-block px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold text-xs">
            ${d.cutPct}%
          </span>
        </td>
        <td class="px-4 py-2.5 text-sm text-center text-slate-700 font-medium">${d.patientCount}</td>
        <td class="px-4 py-2.5 text-sm text-right font-semibold text-slate-900">${formatCurrency(d.totalReceived)}</td>
        <td class="px-4 py-2.5 text-sm text-right font-semibold text-indigo-600">${formatCurrency(d.totalCutAmount)}</td>
        <td class="px-4 py-2.5 text-sm text-right text-amber-600">${formatCurrency(d.totalDue)}</td>
      </tr>
    `;
  }).join('');
}

function renderFullPLSheet(results) {
  const container = document.getElementById('pl-sheet-container');
  if (!container) return;

  const cols = Object.values(results.branchMap)
    .filter(b => b.received > 0 || b.totalFixed > 0 || b.due > 0)
    .sort((a, b) => a.colIndex - b.colIndex);

  let html = `
    <div class="overflow-x-auto border border-slate-200 rounded-lg shadow-sm">
      <table class="min-w-full text-xs text-left border-collapse">
        <thead class="bg-slate-800 text-white sticky top-0">
          <tr>
            <th class="p-2 border border-slate-700 min-w-[180px]">Account Head / Expense</th>
            ${cols.map(c => `
              <th class="p-2 border border-slate-700 min-w-[140px] text-center">
                <div class="font-bold">${c.branchName}</div>
                <div class="text-[10px] text-slate-300 font-normal">${c.subHeading || ''} (Col ${c.col})</div>
              </th>
            `).join('')}
            <th class="p-2 border border-slate-700 min-w-[150px] text-center bg-slate-900 font-bold">TOTAL</th>
          </tr>
        </thead>
        <tbody>
  `;

  // Rows 2-14: Fixed Expense Heads
  AppState.expenseHeads.forEach(head => {
    let rowTotal = 0;
    html += `<tr class="hover:bg-slate-50 border-b border-slate-200">
      <td class="p-2 font-medium text-slate-700 border border-slate-200 bg-slate-50">${head.label}</td>
    `;
    cols.forEach(c => {
      const val = Number(c.fixedExpenses[head.key]) || 0;
      rowTotal += val;
      html += `<td class="p-2 text-right border border-slate-200">${val > 0 ? formatNumber(val) : '-'}</td>`;
    });
    html += `<td class="p-2 text-right font-semibold bg-slate-100 border border-slate-200">${formatNumber(rowTotal)}</td></tr>`;
  });

  // Row 15: Monthly Fixed Expense Total
  let totalFixedRow = 0;
  html += `<tr class="bg-amber-50 font-bold border-y-2 border-amber-300">
    <td class="p-2 text-amber-900 border border-amber-200">monthly(expense) [Row 15]</td>
  `;
  cols.forEach(c => {
    totalFixedRow += c.totalFixed;
    html += `<td class="p-2 text-right text-amber-900 border border-amber-200">${formatNumber(c.totalFixed)}</td>`;
  });
  html += `<td class="p-2 text-right text-amber-900 bg-amber-100 border border-amber-200">${formatNumber(totalFixedRow)}</td></tr>`;

  // Row 17: Revenue (Received Amount)
  let totalRevRow = 0;
  html += `<tr class="bg-blue-50 font-bold border-b border-blue-200">
    <td class="p-2 text-blue-900 border border-blue-200">Revenue [Row 17]</td>
  `;
  cols.forEach(c => {
    totalRevRow += c.received;
    html += `<td class="p-2 text-right text-blue-900 border border-blue-200">${formatNumber(c.received)}</td>`;
  });
  html += `<td class="p-2 text-right text-blue-900 bg-blue-100 border border-blue-200">${formatNumber(totalRevRow)}</td></tr>`;

  // Row 18: Doc Referral Cut
  let totalCutRow = 0;
  html += `<tr class="hover:bg-slate-50 border-b border-slate-200">
    <td class="p-2 font-medium text-slate-700 border border-slate-200">Doc. Referral Cut [Row 18]</td>
  `;
  cols.forEach(c => {
    totalCutRow += c.docCutAmount;
    html += `<td class="p-2 text-right text-indigo-600 border border-slate-200">${c.docCutAmount > 0 ? formatNumber(c.docCutAmount) : '-'}</td>`;
  });
  html += `<td class="p-2 text-right font-semibold text-indigo-700 bg-slate-100 border border-slate-200">${formatNumber(totalCutRow)}</td></tr>`;

  // Row 19: Balance Revenue
  let totalBalRev = 0;
  html += `<tr class="hover:bg-slate-50 border-b border-slate-200 bg-slate-50">
    <td class="p-2 font-semibold text-slate-800 border border-slate-200">Balance Revenue [Row 19]</td>
  `;
  cols.forEach(c => {
    totalBalRev += c.balanceRevenue;
    html += `<td class="p-2 text-right font-medium text-slate-800 border border-slate-200">${formatNumber(c.balanceRevenue)}</td>`;
  });
  html += `<td class="p-2 text-right font-bold text-slate-900 bg-slate-200 border border-slate-200">${formatNumber(totalBalRev)}</td></tr>`;

  // Row 20: Stationary Cost (1%)
  let totalStat = 0;
  html += `<tr class="hover:bg-slate-50 border-b border-slate-200">
    <td class="p-2 text-slate-600 border border-slate-200">Stationary Cost (${cols[0]?.stationaryRate * 100 || 1}%) [Row 20]</td>
  `;
  cols.forEach(c => {
    totalStat += c.stationaryAmount;
    html += `<td class="p-2 text-right text-slate-600 border border-slate-200">${c.stationaryAmount > 0 ? formatNumber(c.stationaryAmount) : '-'}</td>`;
  });
  html += `<td class="p-2 text-right text-slate-700 bg-slate-100 border border-slate-200">${formatNumber(totalStat)}</td></tr>`;

  // Row 21: Reagent & Consumables (12.5% / 15%)
  let totalReag = 0;
  html += `<tr class="hover:bg-slate-50 border-b border-slate-200">
    <td class="p-2 text-slate-600 border border-slate-200">Reagents & Consumables [Row 21]</td>
  `;
  cols.forEach(c => {
    totalReag += c.reagentAmount;
    html += `<td class="p-2 text-right text-slate-600 border border-slate-200">${c.reagentAmount > 0 ? `${formatNumber(c.reagentAmount)} <span class="text-[9px] text-slate-400">(${c.reagentRate * 100}%)</span>` : '-'}</td>`;
  });
  html += `<td class="p-2 text-right text-slate-700 bg-slate-100 border border-slate-200">${formatNumber(totalReag)}</td></tr>`;

  // Row 22: Total Expense
  let totalExpRow = 0;
  html += `<tr class="bg-rose-50 font-bold border-y border-rose-200">
    <td class="p-2 text-rose-900 border border-rose-200">Total Expense [Row 22]</td>
  `;
  cols.forEach(c => {
    totalExpRow += c.totalExpense;
    html += `<td class="p-2 text-right text-rose-900 border border-rose-200">${formatNumber(c.totalExpense)}</td>`;
  });
  html += `<td class="p-2 text-right text-rose-900 bg-rose-100 border border-rose-200">${formatNumber(totalExpRow)}</td></tr>`;

  // Row 23: Net Balance Revenue (Net Profit / Loss)
  let totalNetRow = 0;
  html += `<tr class="bg-slate-900 text-white font-extrabold text-sm border-y-2 border-slate-950">
    <td class="p-2 border border-slate-800">Net Profit / Loss [Row 23]</td>
  `;
  cols.forEach(c => {
    totalNetRow += c.netProfit;
    const isProf = c.netProfit >= 0;
    html += `<td class="p-2 text-right border border-slate-800 ${isProf ? 'text-emerald-400' : 'text-rose-400'}">${formatNumber(c.netProfit)}</td>`;
  });
  html += `<td class="p-2 text-right bg-slate-950 border border-slate-800 ${totalNetRow >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${formatNumber(totalNetRow)}</td></tr>`;

  // Row 24: Profit / Loss (%)
  html += `<tr class="bg-slate-100 font-bold border-b border-slate-300">
    <td class="p-2 text-slate-800 border border-slate-300">Profit / Loss (%) [Row 24]</td>
  `;
  cols.forEach(c => {
    const isProf = c.profitPct >= 0;
    html += `<td class="p-2 text-right border border-slate-300 ${isProf ? 'text-emerald-600' : 'text-rose-600'}">${c.profitPct.toFixed(1)}%</td>`;
  });
  const overallPct = totalRevRow > 0 ? (totalNetRow / totalRevRow) * 100 : 0;
  html += `<td class="p-2 text-right bg-slate-200 border border-slate-300 ${overallPct >= 0 ? 'text-emerald-700' : 'text-rose-700'}">${overallPct.toFixed(1)}%</td></tr>`;

  // Row 25: Due Amount
  let totalDueRow = 0;
  html += `<tr class="bg-amber-50/50 border-b border-amber-200">
    <td class="p-2 text-amber-800 font-medium border border-amber-200">Due Amount [Row 25]</td>
  `;
  cols.forEach(c => {
    totalDueRow += c.due;
    html += `<td class="p-2 text-right text-amber-700 border border-amber-200">${c.due > 0 ? formatNumber(c.due) : '-'}</td>`;
  });
  html += `<td class="p-2 text-right font-bold text-amber-800 bg-amber-100 border border-amber-200">${formatNumber(totalDueRow)}</td></tr>`;

  html += `</tbody></table></div>`;
  container.innerHTML = html;
}

// ==========================================
// 6. DASHBOARD CHARTS (Chart.js)
// ==========================================

function renderDashboardCharts(results) {
  // Destroy existing charts to prevent canvas memory leaks
  if (AppState.charts.branchBar) AppState.charts.branchBar.destroy();
  if (AppState.charts.expenseDonut) AppState.charts.expenseDonut.destroy();
  if (AppState.charts.topDocsBar) AppState.charts.topDocsBar.destroy();

  // 1. Branch Revenue vs Expense Bar Chart
  const branchLabels = [];
  const revData = [];
  const expData = [];
  const profitData = [];

  Object.values(results.consolidatedBranches)
    .filter(b => b.received > 0 || b.totalExpense > 0)
    .sort((a, b) => b.received - a.received)
    .forEach(b => {
      branchLabels.push(b.branchName.replace('Grace Laboratory', 'GL').replace('(Consolidated)', ''));
      revData.push(b.received);
      expData.push(b.totalExpense);
      profitData.push(b.netProfit);
    });

  const ctxBranch = document.getElementById('branchComparisonChart')?.getContext('2d');
  if (ctxBranch) {
    AppState.charts.branchBar = new Chart(ctxBranch, {
      type: 'bar',
      data: {
        labels: branchLabels,
        datasets: [
          {
            label: 'Revenue (₹)',
            data: revData,
            backgroundColor: '#3b82f6',
            borderRadius: 4
          },
          {
            label: 'Total Expenses (₹)',
            data: expData,
            backgroundColor: '#ef4444',
            borderRadius: 4
          },
          {
            label: 'Net Profit/Loss (₹)',
            data: profitData,
            backgroundColor: profitData.map(v => v >= 0 ? '#10b981' : '#f97316'),
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              label: (context) => `${context.dataset.label}: ${formatCurrency(context.raw)}`
            }
          }
        },
        scales: {
          y: {
            ticks: {
              callback: (val) => '₹' + (val / 1000) + 'k'
            }
          }
        }
      }
    });
  }

  // 2. Expense Breakdown Donut Chart
  const ctxExpense = document.getElementById('expenseBreakdownChart')?.getContext('2d');
  if (ctxExpense) {
    // Break down fixed expenses: Salaries, Rent, Electricity, Rapido, Others
    let totalSalaries = 0;
    let totalRent = 0;
    let totalElectricity = 0;
    let totalPetrol = 0;
    let totalOtherFixed = 0;

    Object.values(results.branchMap).forEach(b => {
      totalSalaries += (b.fixedExpenses.salary1_phelebo || 0) + (b.fixedExpenses.salary2_logistics || 0);
      totalRent += (b.fixedExpenses.rent || 0);
      totalElectricity += (b.fixedExpenses.electricity_bill || 0);
      totalPetrol += (b.fixedExpenses.petrol_rapido || 0);
      
      const subHeads = ['mobile_recharge', 'internet_recharge', 'maintenance', 'corporation_tax', 'biomedical_waste', 'hand_hygiene', 'cartridge', 'miscellaneous'];
      subHeads.forEach(k => {
        totalOtherFixed += (b.fixedExpenses[k] || 0);
      });
    });

    const expCategories = [
      'Staff Salaries',
      'Doctor Referral Cuts',
      'Rent',
      'Electricity',
      'Reagents & Consumables',
      'Logistics & Petrol',
      'Stationary',
      'Other Fixed'
    ];

    const expValues = [
      totalSalaries,
      results.totals.docCut,
      totalRent,
      totalElectricity,
      results.totals.reagent,
      totalPetrol,
      results.totals.stationary,
      totalOtherFixed
    ];

    AppState.charts.expenseDonut = new Chart(ctxExpense, {
      type: 'doughnut',
      data: {
        labels: expCategories,
        datasets: [{
          data: expValues,
          backgroundColor: [
            '#6366f1', // Indigo - Salaries
            '#f59e0b', // Amber - Doc Cut
            '#ec4899', // Pink - Rent
            '#eab308', // Yellow - Electricity
            '#06b6d4', // Cyan - Reagents
            '#8b5cf6', // Purple - Petrol
            '#64748b', // Slate - Stationary
            '#94a3b8'  // Light Slate - Other
          ],
          borderWidth: 2,
          borderColor: '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right' },
          tooltip: {
            callbacks: {
              label: (context) => {
                const total = expValues.reduce((a, b) => a + b, 0);
                const pct = total > 0 ? ((context.raw / total) * 100).toFixed(1) : 0;
                return `${context.label}: ${formatCurrency(context.raw)} (${pct}%)`;
              }
            }
          }
        }
      }
    });
  }

  // 3. Top 8 Revenue Doctors Horizontal Bar
  const ctxTopDocs = document.getElementById('topDoctorsChart')?.getContext('2d');
  if (ctxTopDocs) {
    const top8 = results.doctorList.slice(0, 8);
    AppState.charts.topDocsBar = new Chart(ctxTopDocs, {
      type: 'bar',
      data: {
        labels: top8.map(d => d.doctorName.length > 20 ? d.doctorName.substring(0, 20) + '...' : d.doctorName),
        datasets: [
          {
            label: 'Revenue Generated',
            data: top8.map(d => d.totalReceived),
            backgroundColor: '#3b82f6',
            borderRadius: 4
          },
          {
            label: 'Doctor Referral Cut',
            data: top8.map(d => d.totalCutAmount),
            backgroundColor: '#8b5cf6',
            borderRadius: 4
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`
            }
          }
        }
      }
    });
  }
}

// ==========================================
// 7. MULTI-MONTH COMPARISON
// ==========================================

function renderMonthlyComparison() {
  const container = document.getElementById('monthly-comparison-container');
  if (!container) return;

  if (AppState.months.length <= 1) {
    container.innerHTML = `
      <div class="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-300">
        <div class="inline-flex p-3 rounded-full bg-blue-50 text-blue-600 mb-3">
          <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
        </div>
        <h3 class="text-base font-semibold text-slate-800 mb-1">Single Month Loaded (${AppState.months[0] || 'October 2026'})</h3>
        <p class="text-sm text-slate-500 max-w-md mx-auto">
          To see month-to-month comparative trends, upload base register excel sheets spanning multiple dates or months. The application will automatically segregate data and plot trend analytics.
        </p>
      </div>
    `;
    return;
  }

  // Calculate stats for each month
  const monthlySummaries = AppState.months.map(m => {
    const res = runCalculations(m);
    return {
      month: m,
      revenue: res.totals.received,
      due: res.totals.due,
      fixedExpense: res.totals.fixed,
      variableExpense: res.totals.docCut + res.totals.stationary + res.totals.reagent,
      totalExpense: res.totals.totalExpense,
      netProfit: res.totals.netProfit,
      margin: res.totals.profitPct
    };
  });

  let html = `
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      ${monthlySummaries.map((m, idx) => `
        <div class="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div class="flex items-center justify-between mb-3">
            <span class="text-xs font-bold uppercase tracking-wider text-slate-400">Month ${idx + 1}</span>
            <span class="px-2 py-0.5 rounded text-xs font-semibold ${m.netProfit >= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">
              ${m.margin.toFixed(1)}% Margin
            </span>
          </div>
          <h4 class="text-xl font-bold text-slate-900 mb-3">${m.month}</h4>
          <div class="space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-slate-500">Revenue:</span>
              <span class="font-semibold text-slate-800">${formatCurrency(m.revenue)}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500">Total Expenses:</span>
              <span class="font-semibold text-rose-600">${formatCurrency(m.totalExpense)}</span>
            </div>
            <div class="flex justify-between pt-2 border-t border-slate-100">
              <span class="font-medium text-slate-700">Net Profit / Loss:</span>
              <span class="font-bold ${m.netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}">${formatCurrency(m.netProfit)}</span>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  container.innerHTML = html;
}

// ==========================================
// 8. SETTINGS & EDITABLE EXPENSES
// ==========================================

function renderExpenseSettingsTable() {
  const container = document.getElementById('expense-settings-container');
  if (!container) return;

  const branchList = Object.values(AppState.branchExpenses).sort((a, b) => a.col_index - b.col_index);

  let html = `
    <div class="overflow-x-auto border border-slate-200 rounded-lg">
      <table class="min-w-full text-xs text-left">
        <thead class="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
          <tr>
            <th class="p-3 sticky left-0 bg-slate-100 min-w-[200px]">Branch / Expense Unit</th>
            <th class="p-3 min-w-[120px]">Salary 1 (Phlebo)</th>
            <th class="p-3 min-w-[120px]">Salary 2 (Logistics)</th>
            <th class="p-3 min-w-[100px]">Rent</th>
            <th class="p-3 min-w-[100px]">Electricity</th>
            <th class="p-3 min-w-[100px]">Petrol / Rapido</th>
            <th class="p-3 min-w-[100px]">Maintenance</th>
            <th class="p-3 min-w-[100px]">Biomedical</th>
            <th class="p-3 min-w-[100px]">Internet</th>
            <th class="p-3 min-w-[100px]">Misc</th>
            <th class="p-3 min-w-[120px] font-bold text-slate-900">Total Monthly Fixed</th>
            <th class="p-3 text-center min-w-[80px]">Action</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-200">
  `;

  branchList.forEach(b => {
    const colKey = openpyxlColLetter(b.col_index);
    const exp = b.expenses || {};
    html += `
      <tr class="hover:bg-slate-50 transition" data-col="${colKey}">
        <td class="p-3 font-semibold text-slate-800 sticky left-0 bg-white shadow-sm">
          ${b.branch_name}
          ${b.sub_heading ? `<span class="block text-[11px] font-normal text-slate-500">${b.sub_heading} (Col ${colKey})</span>` : ''}
        </td>
        <td class="p-2"><input type="number" class="w-full px-2 py-1 border border-slate-300 rounded text-right expense-input" data-col="${colKey}" data-head="salary1_phelebo" value="${exp.salary1_phelebo || 0}"></td>
        <td class="p-2"><input type="number" class="w-full px-2 py-1 border border-slate-300 rounded text-right expense-input" data-col="${colKey}" data-head="salary2_logistics" value="${exp.salary2_logistics || 0}"></td>
        <td class="p-2"><input type="number" class="w-full px-2 py-1 border border-slate-300 rounded text-right expense-input" data-col="${colKey}" data-head="rent" value="${exp.rent || 0}"></td>
        <td class="p-2"><input type="number" class="w-full px-2 py-1 border border-slate-300 rounded text-right expense-input" data-col="${colKey}" data-head="electricity_bill" value="${exp.electricity_bill || 0}"></td>
        <td class="p-2"><input type="number" class="w-full px-2 py-1 border border-slate-300 rounded text-right expense-input" data-col="${colKey}" data-head="petrol_rapido" value="${exp.petrol_rapido || 0}"></td>
        <td class="p-2"><input type="number" class="w-full px-2 py-1 border border-slate-300 rounded text-right expense-input" data-col="${colKey}" data-head="maintenance" value="${exp.maintenance || 0}"></td>
        <td class="p-2"><input type="number" class="w-full px-2 py-1 border border-slate-300 rounded text-right expense-input" data-col="${colKey}" data-head="biomedical_waste" value="${exp.biomedical_waste || 0}"></td>
        <td class="p-2"><input type="number" class="w-full px-2 py-1 border border-slate-300 rounded text-right expense-input" data-col="${colKey}" data-head="internet_recharge" value="${exp.internet_recharge || 0}"></td>
        <td class="p-2"><input type="number" class="w-full px-2 py-1 border border-slate-300 rounded text-right expense-input" data-col="${colKey}" data-head="miscellaneous" value="${exp.miscellaneous || 0}"></td>
        <td class="p-3 text-right font-bold text-amber-700 bg-amber-50/50" id="total-fixed-${colKey}">
          ${formatCurrency(b.total_monthly_fixed)}
        </td>
        <td class="p-2 text-center">
          <button onclick="saveSingleBranchExpense('${colKey}')" class="px-2 py-1 bg-teal-600 hover:bg-teal-700 text-white rounded text-xs transition">
            Save
          </button>
        </td>
      </tr>
    `;
  });

  html += `</tbody></table></div>`;
  container.innerHTML = html;

  // Add change listeners to auto-update row totals
  document.querySelectorAll('.expense-input').forEach(input => {
    input.addEventListener('input', function() {
      const colKey = this.dataset.col;
      updateRowTotal(colKey);
    });
  });
}

function updateRowTotal(colKey) {
  const inputs = document.querySelectorAll(`.expense-input[data-col="${colKey}"]`);
  let sum = 0;
  inputs.forEach(inp => {
    sum += parseFloat(inp.value) || 0;
  });
  const totalCell = document.getElementById(`total-fixed-${colKey}`);
  if (totalCell) {
    totalCell.innerText = formatCurrency(sum);
  }
}

function saveSingleBranchExpense(colKey) {
  const inputs = document.querySelectorAll(`.expense-input[data-col="${colKey}"]`);
  let sum = 0;
  inputs.forEach(inp => {
    const head = inp.dataset.head;
    const val = parseFloat(inp.value) || 0;
    if (AppState.branchExpenses[colKey]) {
      AppState.branchExpenses[colKey].expenses[head] = val;
    }
    sum += val;
  });

  if (AppState.branchExpenses[colKey]) {
    AppState.branchExpenses[colKey].total_monthly_fixed = sum;
  }

  // Save to LocalStorage
  localStorage.setItem('grace_branch_expenses', JSON.stringify(AppState.branchExpenses));
  showToast(`Updated fixed expenses for ${AppState.branchExpenses[colKey]?.branch_name || colKey}!`);

  // Recalculate
  calculateAndRender();
}

function resetExpensesToDefault() {
  if (confirm('Are you sure you want to reset all branch expenses to template defaults?')) {
    localStorage.removeItem('grace_branch_expenses');
    AppState.branchExpenses = JSON.parse(JSON.stringify(DEFAULT_BRANCH_EXPENSES));
    renderExpenseSettingsTable();
    calculateAndRender();
    showToast('Reset all branch expenses to default.');
  }
}

// ==========================================
// 9. DOCTOR MASTER MANAGER & UNMATCHED ALERTS
// ==========================================

function renderDoctorMasterTable(searchQuery = '') {
  const tbody = document.getElementById('doctor-master-body');
  if (!tbody) return;

  let entries = Object.entries(AppState.doctorCuts);
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    entries = entries.filter(([name]) => name.toLowerCase().includes(q));
  }

  // Sort alphabetically
  entries.sort((a, b) => a[0].localeCompare(b[0]));

  document.getElementById('total-doctors-count').innerText = `${entries.length} Doctors`;

  tbody.innerHTML = entries.slice(0, 150).map(([docName, pct], idx) => {
    return `
      <tr class="hover:bg-slate-50 transition border-b border-slate-200">
        <td class="px-4 py-2.5 text-xs text-slate-500">${idx + 1}</td>
        <td class="px-4 py-2.5 text-sm font-semibold text-slate-800">${docName}</td>
        <td class="px-4 py-2.5 text-sm text-center">
          <input type="number" step="1" min="0" max="100" 
            class="w-20 px-2 py-1 text-center font-bold border border-slate-300 rounded focus:ring-2 focus:ring-teal-500" 
            value="${pct}" 
            onchange="updateDoctorCut('${docName.replace(/'/g, "\\'")}', this.value)">
          <span class="text-xs text-slate-500 ml-1">%</span>
        </td>
        <td class="px-4 py-2.5 text-center">
          <button onclick="deleteDoctor('${docName.replace(/'/g, "\\'")}')" class="text-xs text-rose-500 hover:text-rose-700 font-medium">
            Remove
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function updateDoctorCut(docName, newPct) {
  const val = parseFloat(newPct) || 0;
  AppState.doctorCuts[docName] = val;
  localStorage.setItem('grace_dr_cuts', JSON.stringify(AppState.doctorCuts));
  showToast(`Updated ${docName} cut to ${val}%`);
  calculateAndRender();
}

function addNewDoctor() {
  const name = prompt('Enter Doctor Name:');
  if (!name || !name.trim()) return;
  const pctStr = prompt(`Enter Referral Cut Percentage for "${name.trim()}":`, '40');
  const pct = parseFloat(pctStr) || 0;

  AppState.doctorCuts[name.trim()] = pct;
  localStorage.setItem('grace_dr_cuts', JSON.stringify(AppState.doctorCuts));
  renderDoctorMasterTable();
  showToast(`Added Doctor "${name.trim()}" with ${pct}% cut.`);
  calculateAndRender();
}

function deleteDoctor(docName) {
  if (confirm(`Remove doctor "${docName}" from master database?`)) {
    delete AppState.doctorCuts[docName];
    localStorage.setItem('grace_dr_cuts', JSON.stringify(AppState.doctorCuts));
    renderDoctorMasterTable();
    showToast(`Removed doctor "${docName}".`);
    calculateAndRender();
  }
}

function resetDoctorsToDefault() {
  if (confirm('Reset doctor list back to original 529 entries from Dr. Cut.xlsx?')) {
    localStorage.removeItem('grace_dr_cuts');
    AppState.doctorCuts = { ...DEFAULT_DOCTOR_CUTS };
    renderDoctorMasterTable();
    calculateAndRender();
    showToast('Reset doctor cuts database to default.');
  }
}

function renderUnmatchedDoctorsAlert() {
  const banner = document.getElementById('unmatched-alert-banner');
  const tbody = document.getElementById('unmatched-table-body');
  if (!banner || !tbody) return;

  if (AppState.unmatchedDoctors.length === 0) {
    banner.classList.add('hidden');
    return;
  }

  banner.classList.remove('hidden');
  document.getElementById('unmatched-count').innerText = AppState.unmatchedDoctors.length;

  tbody.innerHTML = AppState.unmatchedDoctors.map(u => {
    return `
      <tr class="hover:bg-amber-50/50 border-b border-amber-200">
        <td class="px-4 py-2 font-semibold text-amber-900">${u.doctorName}</td>
        <td class="px-4 py-2 text-xs text-amber-800">${u.branch}</td>
        <td class="px-4 py-2 text-center text-xs font-bold text-amber-800">${u.count}</td>
        <td class="px-4 py-2 text-right font-medium text-amber-900">${formatCurrency(u.totalReceived)}</td>
        <td class="px-4 py-2 text-center">
          <button onclick="resolveUnmatchedDoctor('${u.doctorName.replace(/'/g, "\\'")}')" class="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-medium transition shadow-sm">
            Assign %
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function resolveUnmatchedDoctor(docName) {
  const pctStr = prompt(`Set Doctor referral cut % for "${docName}":`, '40');
  if (pctStr === null) return;
  const pct = parseFloat(pctStr) || 0;

  AppState.doctorCuts[docName] = pct;
  localStorage.setItem('grace_dr_cuts', JSON.stringify(AppState.doctorCuts));

  // Re-match bills
  AppState.parsedBills.forEach(b => {
    if (b.doctor === docName) {
      b.doctorCutPct = pct;
      b.matchedDoctor = docName;
      b.matchType = 'MANUAL_OVERRIDE';
    }
  });

  // Remove from unmatched
  AppState.unmatchedDoctors = AppState.unmatchedDoctors.filter(u => u.doctorName !== docName);

  renderUnmatchedDoctorsAlert();
  renderDoctorMasterTable();
  calculateAndRender();
  showToast(`Assigned ${pct}% to ${docName}. Calculations updated!`);
}

// ==========================================
// 10. EXPORT REPORT TO EXCEL (.xlsx)
// ==========================================

function exportToExcel() {
  if (!AppState.calculationResults) {
    alert('No calculation data available to export.');
    return;
  }

  const res = AppState.calculationResults;
  const wb = XLSX.utils.book_new();

  // Create P&L Sheet Matrix
  const wsData = [];

  // Row 1: Branches
  const r1 = ['account head'];
  const r16 = [''];
  const r17 = ['Revenue(' + (res.month || 'Total') + ')'];
  const r18 = ['Doc. referral Cut'];
  const r19 = ['balance revenue'];
  const r20 = ['stationary cost(1%)'];
  const r21 = ['reagent & cons'];
  const r22 = ['Total Expense'];
  const r23 = ['net balance revenue'];
  const r24 = ['Profit/Loss (%)'];
  const r25 = ['Due'];

  const cols = Object.values(res.branchMap)
    .filter(b => b.received > 0 || b.totalFixed > 0 || b.due > 0)
    .sort((a, b) => a.colIndex - b.colIndex);

  cols.forEach(c => {
    r1.push(c.branchName);
    r16.push(c.subHeading || '');
    r17.push(c.received);
    r18.push(c.docCutAmount);
    r19.push(c.balanceRevenue);
    r20.push(c.stationaryAmount);
    r21.push(c.reagentAmount);
    r22.push(c.totalExpense);
    r23.push(c.netProfit);
    r24.push(c.profitPct.toFixed(2) + '%');
    r25.push(c.due);
  });

  // Total Column
  r1.push('total');
  r16.push('');
  r17.push(res.totals.received);
  r18.push(res.totals.docCut);
  r19.push(res.totals.received - res.totals.docCut);
  r20.push(res.totals.stationary);
  r21.push(res.totals.reagent);
  r22.push(res.totals.totalExpense);
  r23.push(res.totals.netProfit);
  r24.push(res.totals.profitPct.toFixed(2) + '%');
  r25.push(res.totals.due);

  wsData.push(r1);

  // Rows 2-14: Expense Heads
  AppState.expenseHeads.forEach(head => {
    const rHead = [head.label];
    let rowSum = 0;
    cols.forEach(c => {
      const val = Number(c.fixedExpenses[head.key]) || 0;
      rowSum += val;
      rHead.push(val);
    });
    rHead.push(rowSum);
    wsData.push(rHead);
  });

  // Row 15: Monthly Fixed Expense
  const r15 = ['monthly(expense)'];
  let sumFixed = 0;
  cols.forEach(c => {
    sumFixed += c.totalFixed;
    r15.push(c.totalFixed);
  });
  r15.push(sumFixed);
  wsData.push(r15);

  wsData.push(r16);
  wsData.push(r17);
  wsData.push(r18);
  wsData.push(r19);
  wsData.push(r20);
  wsData.push(r21);
  wsData.push(r22);
  wsData.push(r23);
  wsData.push(r24);
  wsData.push(r25);

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, 'Profit & Loss Statement');

  // Also add Doctor Breakdown Sheet
  const docRows = [
    ['Rank', 'Doctor Name', 'Matched Master', 'Branch', 'Cut %', 'Patient Count', 'Received Amount (₹)', 'Doctor Cut (₹)', 'Due Amount (₹)']
  ];
  res.doctorList.forEach((d, i) => {
    docRows.push([
      i + 1, d.doctorName, d.matchedName, d.branch, d.cutPct, d.patientCount, d.totalReceived, d.totalCutAmount, d.totalDue
    ]);
  });
  const wsDoc = XLSX.utils.aoa_to_sheet(docRows);
  XLSX.utils.book_append_sheet(wb, wsDoc, 'Doctor Performance');

  // Trigger Download
  const filename = `Grace_Lab_PL_Report_${(res.month || 'AllMonths').replace(/\s+/g, '_')}.xlsx`;
  XLSX.writeFile(wb, filename);
  showToast(`Exported ${filename} successfully!`);
}

// ==========================================
// 11. HELPER UTILITIES & EVENT SETUP
// ==========================================

function formatCurrency(val) {
  const num = Number(val) || 0;
  return '₹' + num.toLocaleString('en-IN', { maximumFractionDigits: 1, minimumFractionDigits: 0 });
}

function formatNumber(val) {
  const num = Number(val) || 0;
  return num.toLocaleString('en-IN', { maximumFractionDigits: 1, minimumFractionDigits: 0 });
}

function openpyxlColLetter(colIdx) {
  let letter = '';
  while (colIdx > 0) {
    let mod = (colIdx - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    colIdx = Math.floor((colIdx - mod) / 26);
  }
  return letter;
}

function updateMonthSelector() {
  const sel = document.getElementById('month-selector');
  if (!sel) return;

  sel.innerHTML = `
    <option value="ALL">All Dates / Total</option>
    ${AppState.months.map(m => `<option value="${m}" ${m === AppState.selectedMonth ? 'selected' : ''}>${m}</option>`).join('')}
  `;
}

function setupEventListeners() {
  // File Upload Drop Zone & Input
  const fileInput = document.getElementById('base-excel-input');
  if (fileInput) {
    fileInput.addEventListener('change', function(e) {
      if (e.target.files && e.target.files[0]) {
        handleFileUpload(e.target.files[0]);
      }
    });
  }

  // Month selector change
  const monthSelector = document.getElementById('month-selector');
  if (monthSelector) {
    monthSelector.addEventListener('change', function() {
      AppState.selectedMonth = this.value;
      calculateAndRender();
    });
  }

  // Doctor search
  const docSearch = document.getElementById('doctor-search-input');
  if (docSearch) {
    docSearch.addEventListener('input', function() {
      renderDoctorMasterTable(this.value);
    });
  }

  // Tab Navigation
  document.querySelectorAll('[data-tab-target]').forEach(btn => {
    btn.addEventListener('click', function() {
      const target = this.dataset.tabTarget;
      switchTab(target);
    });
  });
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
  document.querySelectorAll('[data-tab-target]').forEach(btn => {
    btn.classList.remove('border-teal-500', 'text-teal-600', 'font-bold');
    btn.classList.add('border-transparent', 'text-slate-500');
  });

  const activeContent = document.getElementById(`tab-${tabId}`);
  const activeBtn = document.querySelector(`[data-tab-target="${tabId}"]`);

  if (activeContent) activeContent.classList.remove('hidden');
  if (activeBtn) {
    activeBtn.classList.add('border-teal-500', 'text-teal-600', 'font-bold');
    activeBtn.classList.remove('border-transparent', 'text-slate-500');
  }

  // Trigger chart resize if dashboard tab activated
  if (tabId === 'dashboard') {
    Object.values(AppState.charts).forEach(c => c && c.resize());
  }
}

function showToast(msg) {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.className = 'fixed bottom-5 right-5 z-50 px-5 py-3 rounded-lg bg-slate-900 text-white text-sm shadow-xl transition-all transform duration-300 opacity-0 pointer-events-none flex items-center space-x-2';
    document.body.appendChild(toast);
  }

  toast.innerHTML = `
    <svg class="w-5 h-5 text-teal-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
    <span>${msg}</span>
  `;
  toast.classList.remove('opacity-0', 'pointer-events-none');
  toast.classList.add('opacity-100');

  setTimeout(() => {
    toast.classList.remove('opacity-100');
    toast.classList.add('opacity-0', 'pointer-events-none');
  }, 4000);
}

// Auto-run on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  initApp();
  // Automatically load sample data so the portal starts populated and ready!
  loadSampleData();
});
