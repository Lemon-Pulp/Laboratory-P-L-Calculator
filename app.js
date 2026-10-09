/**
 * Grace Laboratory - Revenue & Profit/Loss Calculation Engine & Portal
 * Standalone Client-Side Application for GitHub Pages
 * Features: Multi-Month IndexedDB Storage, Beautiful Excel Export, Fuzzy Matcher
 */

var AppState = window.AppState = {
  doctorCuts: {},
  branchExpenses: {},
  makarpuraSubUnits: [],
  expenseHeads: [],
  parsedBills: [], // All active records across all months
  months: [],      // Array of distinct loaded months e.g. ['September 2026', 'October 2026']
  selectedMonth: 'ALL',
  unmatchedDoctors: [],
  calculationResults: null,
  charts: {}
};

// ==========================================
// 1. INDEXEDDB PERSISTENCE (Multi-Month Storage)
// ==========================================

const LabStorage = {
  dbName: 'GraceLabPortalDB',
  version: 1,
  db: null,

  init() {
    return new Promise((resolve) => {
      if (!window.indexedDB) {
        console.warn('IndexedDB not supported; using memory storage.');
        return resolve(null);
      }
      const req = indexedDB.open(this.dbName, this.version);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('monthly_bills')) {
          db.createObjectStore('monthly_bills', { keyPath: 'month' });
        }
      };
      req.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };
      req.onerror = () => resolve(null);
    });
  },

  saveMonthData(monthLabel, bills) {
    return new Promise((resolve) => {
      if (!this.db) return resolve(false);
      try {
        const tx = this.db.transaction('monthly_bills', 'readwrite');
        const store = tx.objectStore('monthly_bills');
        store.put({ month: monthLabel, updated: new Date().toISOString(), bills: bills });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  },

  getAllMonthsData() {
    return new Promise((resolve) => {
      if (!this.db) return resolve([]);
      try {
        const tx = this.db.transaction('monthly_bills', 'readonly');
        const store = tx.objectStore('monthly_bills');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  },

  deleteMonth(monthLabel) {
    return new Promise((resolve) => {
      if (!this.db) return resolve(false);
      try {
        const tx = this.db.transaction('monthly_bills', 'readwrite');
        const store = tx.objectStore('monthly_bills');
        store.delete(monthLabel);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  },

  clearAllData() {
    return new Promise((resolve) => {
      if (!this.db) return resolve(false);
      try {
        const tx = this.db.transaction('monthly_bills', 'readwrite');
        const store = tx.objectStore('monthly_bills');
        store.clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }
};

// ==========================================
// 2. INITIALIZATION
// ==========================================

async function initApp() {
  const savedCuts = localStorage.getItem('grace_dr_cuts');
  AppState.doctorCuts = savedCuts ? JSON.parse(savedCuts) : { ...DEFAULT_DOCTOR_CUTS };

  const savedExpenses = localStorage.getItem('grace_branch_expenses');
  AppState.branchExpenses = savedExpenses ? JSON.parse(savedExpenses) : JSON.parse(JSON.stringify(DEFAULT_BRANCH_EXPENSES));

  AppState.makarpuraSubUnits = [...MAKARPURA_SUB_UNITS];
  AppState.expenseHeads = [...EXPENSE_HEAD_DEFINITIONS];

  setupEventListeners();
  renderDoctorMasterTable();
  renderExpenseSettingsTable();

  // Initialize IndexedDB and load stored months
  await LabStorage.init();
  const storedMonths = await LabStorage.getAllMonthsData();

  if (storedMonths && storedMonths.length > 0) {
    let combinedBills = [];
    let monthsList = [];
    storedMonths.forEach(mObj => {
      monthsList.push(mObj.month);
      combinedBills = combinedBills.concat(mObj.bills);
    });

    AppState.parsedBills = combinedBills;
    AppState.months = monthsList;
    AppState.selectedMonth = monthsList[monthsList.length - 1]; // Default to latest month
    updateMonthSelector();
    calculateAndRender();
    renderHistoryModal();
    console.log(`Loaded ${storedMonths.length} stored month(s) from database!`);
  } else if (typeof SAMPLE_BILLS_DATA !== 'undefined' && SAMPLE_BILLS_DATA.length > 0) {
    loadSampleData();
  }
}

// ==========================================
// 3. DOCTOR NAME NORMALIZATION & MATCHING
// ==========================================

function cleanDoctorName(name) {
  if (!name) return '';
  let s = String(name).trim();
  s = s.replace(/^(Dr\.|Dr\s+|DR\.|DR\s+|Doctor\s+)/i, '').trim();
  s = s.replace(/[.\s-]+$/, '').trim();
  s = s.replace(/\s+/g, ' ');
  return s;
}

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
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function matchDoctor(docName) {
  if (!docName || String(docName).trim().toUpperCase() === 'SELF') {
    return { matchedName: 'SELF', percentage: 0, matchType: 'SELF', confidence: 1.0 };
  }

  const cleaned = cleanDoctorName(docName);
  const cleanedLower = cleaned.toLowerCase();

  // 1. Exact or Cleaned Exact Match
  for (const [masterDoc, pct] of Object.entries(AppState.doctorCuts)) {
    if (masterDoc.toLowerCase() === docName.toLowerCase() || masterDoc.toLowerCase() === cleanedLower) {
      return { matchedName: masterDoc, percentage: Number(pct), matchType: 'EXACT', confidence: 1.0 };
    }
    const cleanMaster = cleanDoctorName(masterDoc).toLowerCase();
    if (cleanMaster === cleanedLower) {
      return { matchedName: masterDoc, percentage: Number(pct), matchType: 'EXACT_CLEAN', confidence: 0.98 };
    }
  }

  // 2. Strip Parentheses
  const strippedParen = cleanedLower.replace(/\(.*?\)/g, '').trim().replace(/[.\s-]+$/, '');
  if (strippedParen && strippedParen !== cleanedLower) {
    for (const [masterDoc, pct] of Object.entries(AppState.doctorCuts)) {
      if (cleanDoctorName(masterDoc).toLowerCase() === strippedParen) {
        return { matchedName: masterDoc, percentage: Number(pct), matchType: 'STRIPPED_PAREN', confidence: 0.95 };
      }
    }
  }

  // 3. Strip Middle Initials (e.g. 'Umang C Joshi' -> 'Umang Joshi')
  const strippedInitials = strippedParen.replace(/\s+[a-z]\.?\s+/g, ' ').trim();
  if (strippedInitials && strippedInitials !== strippedParen) {
    for (const [masterDoc, pct] of Object.entries(AppState.doctorCuts)) {
      if (cleanDoctorName(masterDoc).toLowerCase() === strippedInitials) {
        return { matchedName: masterDoc, percentage: Number(pct), matchType: 'STRIPPED_INITIAL', confidence: 0.95 };
      }
    }
  }

  // 4. Token Overlap without generic stopwords ('hospital', 'general', 'clinic')
  const wordsDoc = strippedInitials.split(/\s+/).filter(w => w.length >= 3 && !['hospital', 'general', 'clinic', 'maternity', 'nursing', 'home'].includes(w));
  if (wordsDoc.length > 0) {
    const docSet = new Set(wordsDoc);
    for (const [masterDoc, pct] of Object.entries(AppState.doctorCuts)) {
      const wordsMaster = cleanDoctorName(masterDoc).toLowerCase().split(/\s+/).filter(w => w.length >= 3 && !['hospital', 'general', 'clinic', 'maternity', 'nursing', 'home'].includes(w));
      if (wordsMaster.length > 0 && wordsMaster.length === docSet.size && wordsMaster.every(w => docSet.has(w))) {
        return { matchedName: masterDoc, percentage: Number(pct), matchType: 'TOKEN_OVERLAP', confidence: 0.94 };
      }
    }
  }

  // 5. Strip Punctuation
  const alphaNumericClean = cleanedLower.replace(/[^a-z0-9]/g, '');
  for (const [masterDoc, pct] of Object.entries(AppState.doctorCuts)) {
    if (cleanDoctorName(masterDoc).toLowerCase().replace(/[^a-z0-9]/g, '') === alphaNumericClean) {
      return { matchedName: masterDoc, percentage: Number(pct), matchType: 'STRIPPED_PUNCT', confidence: 0.92 };
    }
  }

  // 6. Fuzzy Match with Levenshtein Distance
  let bestMatch = null;
  let bestScore = 0;
  for (const [masterDoc, pct] of Object.entries(AppState.doctorCuts)) {
    const cleanMaster = cleanDoctorName(masterDoc).toLowerCase();
    const longer = Math.max(cleanedLower.length, cleanMaster.length);
    if (longer === 0) continue;
    const dist = levenshteinDistance(cleanedLower, cleanMaster);
    const score = (longer - dist) / parseFloat(longer);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = { masterDoc, pct, score };
    }
  }

  if (bestMatch && bestScore >= 0.75) {
    return {
      matchedName: bestMatch.masterDoc,
      percentage: Number(bestMatch.pct),
      matchType: 'FUZZY (' + Math.round(bestScore * 100) + '%)',
      confidence: bestScore
    };
  }

  return { matchedName: docName, percentage: 0, matchType: 'UNMATCHED (0% fallback)', confidence: 0.0 };
}

// ==========================================
// 4. EXCEL EXTRACTION & MULTI-MONTH MERGING
// ==========================================

function handleFileUpload(file) {
  const reader = new FileReader();
  reader.onload = async function(e) {
    const data = new Uint8Array(e.target.result);
    const workbook = XLSX.read(data, { type: 'array', cellDates: true });
    const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' });
    await processExtractedRows(rawRows, file.name);
  };
  reader.readAsArrayBuffer(file);
}

async function processExtractedRows(rawRows, fileName) {
  let headerIndex = -1;
  let colMap = { branch: -1, doctor: -1, received: -1, due: -1, date: -1 };

  for (let r = 0; r < Math.min(rawRows.length, 30); r++) {
    const row = rawRows[r];
    const rowStr = row.map(cell => String(cell || '').trim().toLowerCase());
    
    const hasBranch = rowStr.includes('branch');
    const hasDocName = rowStr.some(v => v === 'consulting doctor name' || v.includes('consulting doctor name') || v === 'doctor name');
    const hasReceived = rowStr.some(v => v === 'received amount' || v === 'recieved amount' || v.includes('received amount'));

    if (hasBranch && (hasDocName || hasReceived)) {
      headerIndex = r;
      for (let c = 0; c < row.length; c++) {
        const v = rowStr[c];
        if (v === 'branch') {
          colMap.branch = c;
        } else if (v === 'consulting doctor name' || v.includes('consulting doctor name') || v === 'doctor name') {
          colMap.doctor = c; // Specifically targets Column Y, never Sales Person!
        } else if (colMap.doctor === -1 && (v.includes('consulting doctor') || v === 'doctor') && !v.includes('code') && !v.includes('sales') && !v.includes('id') && !v.includes('fee')) {
          colMap.doctor = c;
        } else if (v === 'received amount' || v === 'recieved amount' || (v.includes('received') && !v.includes('due'))) {
          colMap.received = c;
        } else if (v === 'due amount' || (v.includes('due') && !v.includes('show') && !v.includes('credit'))) {
          colMap.due = c;
        } else if (v === 'registration date' || (v.startsWith('registration date') && !v.includes('time'))) {
          colMap.date = c;
        }
      }
      break;
    }
  }

  if (colMap.branch === -1) colMap.branch = 0;
  if (colMap.doctor === -1) colMap.doctor = 24;
  if (colMap.received === -1) colMap.received = 37;
  if (colMap.due === -1) colMap.due = 38;
  if (colMap.date === -1) colMap.date = 4;
  if (headerIndex === -1) headerIndex = 8;

  const newParsed = [];
  const monthBuckets = {};

  for (let r = headerIndex + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    const branchVal = String(row[colMap.branch] || '').trim();
    if (!branchVal || branchVal.toLowerCase() === 'total') continue;

    const docVal = String(row[colMap.doctor] || '').trim();
    const recVal = parseFloat(row[colMap.received]) || 0;
    const dueVal = parseFloat(row[colMap.due]) || 0;
    
    let rawDate = row[colMap.date];
    let monthLabel = 'September 2026';

    if (rawDate instanceof Date) {
      const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      monthLabel = `${monthNames[rawDate.getMonth()]} ${rawDate.getFullYear()}`;
    } else if (typeof rawDate === 'string' && rawDate.trim()) {
      const match = rawDate.match(/(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/ ](\d{2,4})/);
      if (match) {
        const mPart = match[2].toLowerCase();
        let fullYear = match[3];
        if (fullYear.length === 2) fullYear = '20' + fullYear;
        const mLookup = {
          'jan': 'January', 'feb': 'February', 'mar': 'March', 'apr': 'April',
          'may': 'May', 'jun': 'June', 'jul': 'July', 'aug': 'August',
          'sep': 'September', 'oct': 'October', 'nov': 'November', 'dec': 'December'
        };
        const mFull = mLookup[mPart.substring(0, 3)] || match[2];
        monthLabel = `${mFull} ${fullYear}`;
      } else {
        monthLabel = rawDate.trim();
      }
    }

    const matchResult = matchDoctor(docVal);
    const billRecord = {
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
    };

    newParsed.push(billRecord);

    if (!monthBuckets[monthLabel]) monthBuckets[monthLabel] = [];
    monthBuckets[monthLabel].push(billRecord);
  }

  // Save into IndexedDB
  for (const [mName, bills] of Object.entries(monthBuckets)) {
    await LabStorage.saveMonthData(mName, bills);
    if (!AppState.months.includes(mName)) {
      AppState.months.push(mName);
    }
    AppState.parsedBills = AppState.parsedBills.filter(b => b.month !== mName).concat(bills);
  }

  // Strictly check matchType starts with UNMATCHED (Never flag recognized 0% doctors!)
  const unmatched = new Map();
  AppState.parsedBills.forEach(b => {
    if (b.matchType && b.matchType.startsWith('UNMATCHED') && b.doctor.toUpperCase() !== 'SELF' && b.doctor !== '') {
      if (!unmatched.has(b.doctor)) {
        unmatched.set(b.doctor, { doctorName: b.doctor, branch: b.branch, count: 1, totalReceived: b.received });
      } else {
        const item = unmatched.get(b.doctor);
        item.count++;
        item.totalReceived += b.received;
      }
    }
  });
  AppState.unmatchedDoctors = Array.from(unmatched.values());

  const uploadedMonths = Object.keys(monthBuckets);
  if (uploadedMonths.length > 0) {
    AppState.selectedMonth = uploadedMonths[0];
  }

  updateMonthSelector();
  renderUnmatchedDoctorsAlert();
  calculateAndRender();
  renderHistoryModal();

  showToast(`Successfully saved ${newParsed.length} bills for ${uploadedMonths.join(', ')} to your browser history!`);
}

function loadSampleData() {
  if (typeof SAMPLE_BILLS_DATA === 'undefined') return;

  const monthLabel = 'October 2026';
  const parsed = SAMPLE_BILLS_DATA.map((b, idx) => {
    const matchResult = matchDoctor(b.doctor);
    return {
      rowId: idx + 1,
      branch: b.branch,
      doctor: b.doctor || 'SELF',
      matchedDoctor: matchResult.matchedName,
      doctorCutPct: matchResult.percentage,
      matchType: matchResult.matchType,
      received: Number(b.received) || 0,
      due: Number(b.due) || 0,
      date: b.date,
      month: monthLabel
    };
  });

  AppState.parsedBills = parsed;
  AppState.months = [monthLabel];
  AppState.selectedMonth = monthLabel;

  updateMonthSelector();
  renderUnmatchedDoctorsAlert();
  calculateAndRender();
}

// ==========================================
// 5. CALCULATION ENGINE
// ==========================================

function runCalculations(targetMonth) {
  const bills = (targetMonth === 'ALL')
    ? AppState.parsedBills
    : AppState.parsedBills.filter(b => b.month === targetMonth);

  const branchMap = {};
  for (const [colLetter, colData] of Object.entries(AppState.branchExpenses)) {
    if (!colData.branch_name) continue;
    branchMap[colLetter] = {
      col: colLetter,
      colIndex: colData.col_index,
      branchName: colData.branch_name,
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
      stationaryRate: 0.01,
      reagentRate: (colLetter === 'AC') ? 0.15 : 0.125,
      customCutPct: (colLetter === 'AH') ? 30 : undefined,
      transactions: [],
      doctorBreakdown: {}
    };
  }

  if (!branchMap['AQ'] && AppState.branchExpenses['AQ']) {
    branchMap['AQ'] = {
      col: 'AQ', colIndex: 43, branchName: 'makarpura testing unit', subHeading: 'Central Testing Unit',
      fixedExpenses: { ...AppState.branchExpenses['AQ'].expenses }, totalFixed: AppState.branchExpenses['AQ'].total_monthly_fixed,
      received: 0, due: 0, docCutAmount: 0, balanceRevenue: 0, stationaryAmount: 0, reagentAmount: 0,
      totalExpense: AppState.branchExpenses['AQ'].total_monthly_fixed, netProfit: -AppState.branchExpenses['AQ'].total_monthly_fixed,
      profitPct: 0, stationaryRate: 0.01, reagentRate: 0.125, transactions: [], doctorBreakdown: {}
    };
  }

  bills.forEach(bill => {
    let targetCol = null;
    const bName = bill.branch.trim();
    const docName = bill.doctor.trim();

    if (bName.toLowerCase().includes('makarpura')) {
      for (const sub of AppState.makarpuraSubUnits) {
        if (sub.doctorMatch.some(dm => cleanDoctorName(dm).toLowerCase() === cleanDoctorName(docName).toLowerCase())) {
          targetCol = sub.fixedExpenseCol;
          break;
        }
      }
      if (!targetCol) targetCol = 'R';
    } else {
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

    if (!targetCol) {
      const match = Object.keys(branchMap).find(k => branchMap[k].branchName.toLowerCase() === bName.toLowerCase());
      if (match) targetCol = match;
    }

    if (!targetCol) {
      targetCol = 'DYNAMIC_' + bName.replace(/[^a-zA-Z0-9]/g, '_');
      if (!branchMap[targetCol]) {
        branchMap[targetCol] = {
          col: targetCol, colIndex: 999, branchName: bName, subHeading: 'Branch',
          fixedExpenses: {}, totalFixed: 0, received: 0, due: 0, docCutAmount: 0,
          balanceRevenue: 0, stationaryAmount: 0, reagentAmount: 0, totalExpense: 0,
          netProfit: 0, profitPct: 0, stationaryRate: 0.01, reagentRate: 0.125,
          transactions: [], doctorBreakdown: {}
        };
      }
    }

    const targetBranch = branchMap[targetCol];
    if (targetBranch) {
      targetBranch.received += bill.received;
      targetBranch.due += bill.due;
      targetBranch.transactions.push(bill);

      const mResult = matchDoctor(bill.doctor);
      let cutPct = (targetBranch.customCutPct !== undefined) ? targetBranch.customCutPct : mResult.percentage;
      const cutAmt = bill.received * (cutPct / 100);
      targetBranch.docCutAmount += cutAmt;

      const docKey = bill.doctor;
      if (!targetBranch.doctorBreakdown[docKey]) {
        targetBranch.doctorBreakdown[docKey] = {
          doctorName: docKey, matchedName: mResult.matchedName, percentage: cutPct,
          received: 0, due: 0, cutAmount: 0, count: 0
        };
      }
      targetBranch.doctorBreakdown[docKey].received += bill.received;
      targetBranch.doctorBreakdown[docKey].due += bill.due;
      targetBranch.doctorBreakdown[docKey].cutAmount += cutAmt;
      targetBranch.doctorBreakdown[docKey].count++;
    }
  });

  let grandTotalReceived = 0;
  let grandTotalDue = 0;
  let grandTotalDocCut = 0;
  let grandTotalStationary = 0;
  let grandTotalReagent = 0;
  let grandTotalFixed = 0;
  let grandTotalExpense = 0;
  let grandTotalNetProfit = 0;

  for (const [colLetter, bObj] of Object.entries(branchMap)) {
    if (colLetter === 'BF') {
      const dynamicSalary2 = bObj.received * 0.05;
      bObj.fixedExpenses['salary2_logistics'] = dynamicSalary2;
      bObj.totalFixed = Object.values(bObj.fixedExpenses).reduce((acc, v) => acc + (Number(v) || 0), 0);
    }

    bObj.balanceRevenue = bObj.received - bObj.docCutAmount;
    bObj.stationaryAmount = bObj.received * bObj.stationaryRate;
    bObj.reagentAmount = bObj.received * bObj.reagentRate;

    bObj.totalExpense = bObj.totalFixed + bObj.docCutAmount + bObj.stationaryAmount + bObj.reagentAmount;
    bObj.netProfit = bObj.received - bObj.totalExpense;
    bObj.profitPct = (bObj.received > 0) ? (bObj.netProfit / bObj.received) * 100 : (bObj.totalExpense > 0 ? -100 : 0);

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

  const allDoctors = {};
  bills.forEach(bill => {
    const docKey = bill.doctor;
    const mResult = matchDoctor(docKey);
    const cutPct = mResult.percentage;
    const cutAmt = bill.received * (cutPct / 100);

    if (!allDoctors[docKey]) {
      allDoctors[docKey] = {
        doctorName: docKey, matchedName: mResult.matchedName, cutPct: cutPct,
        branch: bill.branch, totalReceived: 0, totalDue: 0, totalCutAmount: 0, patientCount: 0
      };
    }
    allDoctors[docKey].totalReceived += bill.received;
    allDoctors[docKey].totalDue += bill.due;
    allDoctors[docKey].totalCutAmount += cutAmt;
    allDoctors[docKey].patientCount++;
  });

  const doctorList = Object.values(allDoctors).sort((a, b) => b.totalReceived - a.totalReceived);

  const consolidated = {};
  for (const [colLetter, bObj] of Object.entries(branchMap)) {
    let mainBranchName = bObj.branchName;
    if (mainBranchName.includes('Makr. Rec') || mainBranchName.includes('Makarpura')) {
      mainBranchName = '29- Makarpura Grace laboratory (Consolidated)';
    }

    if (!consolidated[mainBranchName]) {
      consolidated[mainBranchName] = {
        branchName: mainBranchName, received: 0, due: 0, docCut: 0, stationary: 0, reagent: 0, fixed: 0, totalExpense: 0, netProfit: 0
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
    month: targetMonth, branchMap, consolidatedBranches: consolidated, doctorList,
    totals: {
      received: grandTotalReceived, due: grandTotalDue, docCut: grandTotalDocCut,
      stationary: grandTotalStationary, reagent: grandTotalReagent, fixed: grandTotalFixed,
      totalExpense: grandTotalExpense, netProfit: grandTotalNetProfit, profitPct: grandProfitPct
    }
  };

  return AppState.calculationResults;
}

// ==========================================
// 6. UI RENDERING
// ==========================================

function calculateAndRender() {
  const results = runCalculations(AppState.selectedMonth);

  document.getElementById('kpi-revenue').innerText = formatCurrency(results.totals.received);
  document.getElementById('kpi-due').innerText = formatCurrency(results.totals.due);
  document.getElementById('kpi-fixed').innerText = formatCurrency(results.totals.fixed);
  document.getElementById('kpi-doc-cuts').innerText = formatCurrency(results.totals.docCut);
  document.getElementById('kpi-reagents').innerText = formatCurrency(results.totals.reagent);
  document.getElementById('kpi-total-exp').innerText = formatCurrency(results.totals.totalExpense);
  
  const netProfitEl = document.getElementById('kpi-net-profit');
  netProfitEl.innerText = formatCurrency(results.totals.netProfit);
  netProfitEl.className = results.totals.netProfit >= 0 ? 'text-3xl font-extrabold text-emerald-600' : 'text-3xl font-extrabold text-rose-600';

  const marginEl = document.getElementById('kpi-margin');
  marginEl.innerText = `${results.totals.profitPct.toFixed(1)}%`;
  marginEl.className = results.totals.profitPct >= 0 ? 'text-lg font-bold text-emerald-600' : 'text-lg font-bold text-rose-600';

  renderDashboardCharts(results);
  renderBranchTable(results.branchMap);
  renderDoctorAnalyticsTable(results.doctorList);
  renderFullPLSheet(results);
  renderMonthlyComparison();
}

function renderBranchTable(branchMap) {
  const tbody = document.getElementById('branch-table-body');
  if (!tbody) return;

  const rows = Object.values(branchMap)
    .filter(b => b.received > 0 || b.totalFixed > 0 || b.due > 0)
    .sort((a, b) => b.received - a.received);

  tbody.innerHTML = rows.map((b) => {
    const isProfitable = b.netProfit >= 0;
    const badgeColor = isProfitable ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800';
    return `
      <tr class="hover:bg-slate-50 transition border-b border-slate-200">
        <td class="px-4 py-3 text-sm font-semibold text-slate-800">${b.branchName} ${b.subHeading ? `<span class="block text-xs font-normal text-slate-500">${b.subHeading}</span>` : ''}</td>
        <td class="px-4 py-3 text-sm text-right font-medium text-slate-900">${formatCurrency(b.received)}</td>
        <td class="px-4 py-3 text-sm text-right text-amber-600 font-medium">${formatCurrency(b.due)}</td>
        <td class="px-4 py-3 text-sm text-right text-slate-700">${formatCurrency(b.docCutAmount)}</td>
        <td class="px-4 py-3 text-sm text-right text-slate-600">${formatCurrency(b.stationaryAmount)}</td>
        <td class="px-4 py-3 text-sm text-right text-slate-600">${formatCurrency(b.reagentAmount)}</td>
        <td class="px-4 py-3 text-sm text-right text-slate-700 font-medium">${formatCurrency(b.totalFixed)}</td>
        <td class="px-4 py-3 text-sm text-right font-semibold text-slate-900">${formatCurrency(b.totalExpense)}</td>
        <td class="px-4 py-3 text-sm text-right font-bold ${isProfitable ? 'text-emerald-600' : 'text-rose-600'}">${formatCurrency(b.netProfit)}</td>
        <td class="px-4 py-3 text-sm text-right font-bold ${isProfitable ? 'text-emerald-600' : 'text-rose-600'}">${b.profitPct.toFixed(1)}%</td>
        <td class="px-4 py-3 text-center"><span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${badgeColor}">${isProfitable ? 'Profit' : 'Loss'}</span></td>
      </tr>
    `;
  }).join('');
}

function renderDoctorAnalyticsTable(doctors) {
  const tbody = document.getElementById('doctor-analytics-body');
  if (!tbody) return;

  tbody.innerHTML = doctors.slice(0, 150).map((d, idx) => `
    <tr class="hover:bg-slate-50 transition border-b border-slate-200">
      <td class="px-4 py-2.5 text-xs text-slate-500">${idx + 1}</td>
      <td class="px-4 py-2.5 text-sm font-semibold text-slate-800">${d.doctorName} ${d.matchedName !== d.doctorName ? `<span class="block text-xs font-normal text-slate-400">Matched as: ${d.matchedName}</span>` : ''}</td>
      <td class="px-4 py-2.5 text-xs text-slate-600">${d.branch}</td>
      <td class="px-4 py-2.5 text-sm text-center"><span class="inline-block px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold text-xs">${d.cutPct}%</span></td>
      <td class="px-4 py-2.5 text-sm text-center text-slate-700 font-medium">${d.patientCount}</td>
      <td class="px-4 py-2.5 text-sm text-right font-semibold text-slate-900">${formatCurrency(d.totalReceived)}</td>
      <td class="px-4 py-2.5 text-sm text-right font-semibold text-indigo-600">${formatCurrency(d.totalCutAmount)}</td>
      <td class="px-4 py-2.5 text-sm text-right text-amber-600">${formatCurrency(d.totalDue)}</td>
    </tr>
  `).join('');
}

function renderFullPLSheet(results) {
  const container = document.getElementById('pl-sheet-container');
  if (!container) return;

  const cols = Object.values(results.branchMap)
    .filter(b => b.received > 0 || b.totalFixed > 0 || b.due > 0)
    .sort((a, b) => a.colIndex - b.colIndex);

  let html = `<div class="overflow-x-auto border border-slate-200 rounded-lg shadow-sm">
    <table class="min-w-full text-xs text-left border-collapse">
      <thead class="bg-slate-800 text-white sticky top-0">
        <tr>
          <th class="p-2 border border-slate-700 min-w-[180px]">Account Head / Expense</th>
          ${cols.map(c => `<th class="p-2 border border-slate-700 min-w-[140px] text-center font-bold">${c.branchName}</th>`).join('')}
          <th class="p-2 border border-slate-700 min-w-[150px] text-center bg-slate-900 font-bold">TOTAL</th>
        </tr>
      </thead>
      <tbody>`;

  AppState.expenseHeads.forEach(head => {
    let rowTotal = 0;
    html += `<tr class="hover:bg-slate-50 border-b border-slate-200"><td class="p-2 font-medium text-slate-700 border border-slate-200 bg-slate-50">${head.label}</td>`;
    cols.forEach(c => {
      const val = Number(c.fixedExpenses[head.key]) || 0;
      rowTotal += val;
      html += `<td class="p-2 text-right border border-slate-200">${val > 0 ? formatNumber(val) : '-'}</td>`;
    });
    html += `<td class="p-2 text-right font-semibold bg-slate-100 border border-slate-200">${formatNumber(rowTotal)}</td></tr>`;
  });

  html += `<tr class="bg-amber-50 font-bold border-y-2 border-amber-300"><td class="p-2 text-amber-900 border border-amber-200">monthly(expense)</td>`;
  cols.forEach(c => html += `<td class="p-2 text-right text-amber-900 border border-amber-200">${formatNumber(c.totalFixed)}</td>`);
  html += `<td class="p-2 text-right text-amber-900 bg-amber-100 border border-amber-200">${formatNumber(results.totals.fixed)}</td></tr>`;

  html += `<tr class="bg-blue-50 font-bold border-b border-blue-200"><td class="p-2 text-blue-900 border border-blue-200">Revenue</td>`;
  cols.forEach(c => html += `<td class="p-2 text-right text-blue-900 border border-blue-200">${formatNumber(c.received)}</td>`);
  html += `<td class="p-2 text-right text-blue-900 bg-blue-100 border border-blue-200">${formatNumber(results.totals.received)}</td></tr>`;

  html += `<tr class="hover:bg-slate-50 border-b border-slate-200"><td class="p-2 font-medium text-slate-700 border border-slate-200">Doc. Referral Cut</td>`;
  cols.forEach(c => html += `<td class="p-2 text-right text-indigo-600 border border-slate-200">${c.docCutAmount > 0 ? formatNumber(c.docCutAmount) : '-'}</td>`);
  html += `<td class="p-2 text-right font-semibold text-indigo-700 bg-slate-100 border border-slate-200">${formatNumber(results.totals.docCut)}</td></tr>`;

  html += `<tr class="bg-rose-50 font-bold border-y border-rose-200"><td class="p-2 text-rose-900 border border-rose-200">Total Expense</td>`;
  cols.forEach(c => html += `<td class="p-2 text-right text-rose-900 border border-rose-200">${formatNumber(c.totalExpense)}</td>`);
  html += `<td class="p-2 text-right text-rose-900 bg-rose-100 border border-rose-200">${formatNumber(results.totals.totalExpense)}</td></tr>`;

  html += `<tr class="bg-slate-900 text-white font-extrabold text-sm border-y-2 border-slate-950"><td class="p-2 border border-slate-800">Net Profit / Loss</td>`;
  cols.forEach(c => html += `<td class="p-2 text-right border border-slate-800 ${c.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${formatNumber(c.netProfit)}</td>`);
  html += `<td class="p-2 text-right bg-slate-950 border border-slate-800 ${results.totals.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${formatNumber(results.totals.netProfit)}</td></tr>`;

  html += `<tr class="bg-slate-100 font-bold border-b border-slate-300"><td class="p-2 text-slate-800 border border-slate-300">Profit / Loss (%)</td>`;
  cols.forEach(c => html += `<td class="p-2 text-right border border-slate-300 ${c.profitPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}">${c.profitPct.toFixed(1)}%</td>`);
  html += `<td class="p-2 text-right bg-slate-200 border border-slate-300 font-bold">${results.totals.profitPct.toFixed(1)}%</td></tr>`;

  html += `</tbody></table></div>`;
  container.innerHTML = html;
}

function renderDashboardCharts(results) {
  if (AppState.charts.branchBar) AppState.charts.branchBar.destroy();
  if (AppState.charts.expenseDonut) AppState.charts.expenseDonut.destroy();
  if (AppState.charts.topDocsBar) AppState.charts.topDocsBar.destroy();

  const activeBranches = Object.values(results.branchMap).filter(b => b.received > 0);
  const ctxBranch = document.getElementById('branchComparisonChart')?.getContext('2d');
  if (ctxBranch) {
    AppState.charts.branchBar = new Chart(ctxBranch, {
      type: 'bar',
      data: {
        labels: activeBranches.map(b => b.branchName.replace('Grace Laboratory', 'GL')),
        datasets: [
          { label: 'Revenue (₹)', data: activeBranches.map(b => b.received), backgroundColor: '#3b82f6' },
          { label: 'Total Expenses (₹)', data: activeBranches.map(b => b.totalExpense), backgroundColor: '#ef4444' }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
  }

  const ctxExpense = document.getElementById('expenseBreakdownChart')?.getContext('2d');
  if (ctxExpense) {
    AppState.charts.expenseDonut = new Chart(ctxExpense, {
      type: 'doughnut',
      data: {
        labels: ['Fixed Overheads', 'Doctor Cuts', 'Reagents', 'Stationary'],
        datasets: [{
          data: [results.totals.fixed, results.totals.docCut, results.totals.reagent, results.totals.stationary],
          backgroundColor: ['#6366f1', '#f59e0b', '#06b6d4', '#64748b']
        }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
  }

  const ctxTopDocs = document.getElementById('topDoctorsChart')?.getContext('2d');
  if (ctxTopDocs) {
    const top8 = results.doctorList.slice(0, 8);
    AppState.charts.topDocsBar = new Chart(ctxTopDocs, {
      type: 'bar',
      data: {
        labels: top8.map(d => d.doctorName.length > 20 ? d.doctorName.substring(0, 20) + '...' : d.doctorName),
        datasets: [{ label: 'Revenue Generated', data: top8.map(d => d.totalReceived), backgroundColor: '#14b8a6' }]
      },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false }
    });
  }
}

function renderMonthlyComparison() {
  const container = document.getElementById('monthly-comparison-container');
  if (!container) return;

  if (AppState.months.length <= 1) {
    container.innerHTML = `<div class="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-300">Single Month Loaded (${AppState.months[0] || 'September 2026'}). Upload registers spanning multiple dates or months to unlock month-over-month trend analytics.</div>`;
    return;
  }

  const monthlySummaries = AppState.months.map(m => {
    const res = runCalculations(m);
    return { month: m, revenue: res.totals.received, totalExpense: res.totals.totalExpense, netProfit: res.totals.netProfit, margin: res.totals.profitPct };
  });

  container.innerHTML = `<div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
    ${monthlySummaries.map(m => `
      <div class="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h4 class="text-xl font-bold text-slate-900 mb-3">${m.month}</h4>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between"><span>Revenue:</span><span class="font-semibold">${formatCurrency(m.revenue)}</span></div>
          <div class="flex justify-between"><span>Expenses:</span><span class="font-semibold text-rose-600">${formatCurrency(m.totalExpense)}</span></div>
          <div class="flex justify-between pt-2 border-t"><span>Net Profit:</span><span class="font-bold ${m.netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}">${formatCurrency(m.netProfit)}</span></div>
        </div>
      </div>
    `).join('')}
  </div>`;
}

// ==========================================
// 7. STORED MONTHS & HISTORY MANAGER
// ==========================================

function renderHistoryModal() {
  const container = document.getElementById('history-list-container');
  if (!container) return;

  if (AppState.months.length === 0) {
    container.innerHTML = '<p class="text-slate-400 text-xs italic">No months currently stored in your browser database.</p>';
    return;
  }

  let html = `<div class="divide-y divide-slate-100">`;
  AppState.months.forEach(m => {
    const mBills = AppState.parsedBills.filter(b => b.month === m);
    const mRev = mBills.reduce((acc, b) => acc + b.received, 0);

    html += `
      <div class="py-3 flex items-center justify-between text-xs">
        <div>
          <span class="font-bold text-slate-800 text-sm">${m}</span>
          <span class="text-slate-500 ml-2">(${mBills.length.toLocaleString()} bills • ${formatCurrency(mRev)} revenue)</span>
        </div>
        <div class="flex items-center space-x-2">
          <button onclick="selectSpecificMonth('${m}')" class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-medium transition">
            View Month
          </button>
          <button onclick="deleteStoredMonth('${m}')" class="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded font-medium transition">
            Delete
          </button>
        </div>
      </div>
    `;
  });
  html += `</div>`;
  container.innerHTML = html;
}

function selectSpecificMonth(monthName) {
  AppState.selectedMonth = monthName;
  updateMonthSelector();
  calculateAndRender();
  closeHistoryModal();
  showToast(`Switched view to ${monthName}!`);
}

async function deleteStoredMonth(monthName) {
  if (confirm(`Delete stored records for ${monthName}?`)) {
    await LabStorage.deleteMonth(monthName);
    AppState.months = AppState.months.filter(m => m !== monthName);
    AppState.parsedBills = AppState.parsedBills.filter(b => b.month !== monthName);
    AppState.selectedMonth = AppState.months.length > 0 ? AppState.months[0] : 'ALL';
    updateMonthSelector();
    calculateAndRender();
    renderHistoryModal();
    showToast(`Removed ${monthName} from browser history.`);
  }
}

async function clearAllHistoricalData() {
  if (confirm('Are you sure you want to clear ALL stored months from your browser database?')) {
    await LabStorage.clearAllData();
    AppState.months = [];
    AppState.parsedBills = [];
    AppState.selectedMonth = 'ALL';
    updateMonthSelector();
    calculateAndRender();
    renderHistoryModal();
    showToast('Cleared all browser history.');
  }
}

function openHistoryModal() {
  renderHistoryModal();
  document.getElementById('history-modal')?.classList.remove('hidden');
}

function closeHistoryModal() {
  document.getElementById('history-modal')?.classList.add('hidden');
}

// ==========================================
// 8. BEAUTIFUL EXCEL EXPORT (Multiple Styled Sheets)
// ==========================================

function exportToExcel() {
  if (!AppState.calculationResults) return;
  const res = AppState.calculationResults;
  const wb = XLSX.utils.book_new();

  // --- SHEET 1: EXECUTIVE P&L MATRIX ---
  const wsData = [];
  const r1 = ['Account Head / Branch'];
  const r17 = ['Revenue (' + (res.month || 'Total') + ')'];
  const r18 = ['Doc. Referral Cut'];
  const r19 = ['Balance Revenue'];
  const r20 = ['Stationary Cost (1%)'];
  const r21 = ['Reagents & Consumables'];
  const r22 = ['Total Operating Expense'];
  const r23 = ['Net Profit / Loss'];
  const r24 = ['Profit Margin (%)'];
  const r25 = ['Pending Due Amount'];

  const cols = Object.values(res.branchMap)
    .filter(b => b.received > 0 || b.totalFixed > 0 || b.due > 0)
    .sort((a, b) => a.colIndex - b.colIndex);

  cols.forEach(c => {
    r1.push(c.branchName);
    r17.push(c.received);
    r18.push(c.docCutAmount);
    r19.push(c.balanceRevenue);
    r20.push(c.stationaryAmount);
    r21.push(c.reagentAmount);
    r22.push(c.totalExpense);
    r23.push(c.netProfit);
    r24.push(Number(c.profitPct.toFixed(2)) + '%');
    r25.push(c.due);
  });

  r1.push('TOTAL');
  r17.push(res.totals.received);
  r18.push(res.totals.docCut);
  r19.push(res.totals.received - res.totals.docCut);
  r20.push(res.totals.stationary);
  r21.push(res.totals.reagent);
  r22.push(res.totals.totalExpense);
  r23.push(res.totals.netProfit);
  r24.push(Number(res.totals.profitPct.toFixed(2)) + '%');
  r25.push(res.totals.due);

  wsData.push(r1);

  // Expense rows
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

  const r15 = ['Monthly Fixed Overheads'];
  let sumFixed = 0;
  cols.forEach(c => {
    sumFixed += c.totalFixed;
    r15.push(c.totalFixed);
  });
  r15.push(sumFixed);
  wsData.push(r15);

  wsData.push(r17);
  wsData.push(r18);
  wsData.push(r19);
  wsData.push(r20);
  wsData.push(r21);
  wsData.push(r22);
  wsData.push(r23);
  wsData.push(r24);
  wsData.push(r25);

  const wsPL = XLSX.utils.aoa_to_sheet(wsData);

  // Auto-fit Column Widths so numbers never show as ###
  const colWidths = [{ wch: 28 }];
  cols.forEach(c => {
    colWidths.push({ wch: Math.max(c.branchName.length + 2, 16) });
  });
  colWidths.push({ wch: 18 });
  wsPL['!cols'] = colWidths;

  XLSX.utils.book_append_sheet(wb, wsPL, 'P&L Statement');

  // --- SHEET 2: DOCTOR PERFORMANCE STATEMENT ---
  const docRows = [
    ['Rank', 'Consulting Doctor Name', 'Matched Master Name', 'Branch Location', 'Referral Cut %', 'Patient Count', 'Gross Revenue (₹)', 'Doctor Referral Cut (₹)', 'Due Amount (₹)']
  ];
  res.doctorList.forEach((d, i) => {
    docRows.push([i + 1, d.doctorName, d.matchedName, d.branch, d.cutPct, d.patientCount, d.totalReceived, d.totalCutAmount, d.totalDue]);
  });
  const wsDoc = XLSX.utils.aoa_to_sheet(docRows);
  wsDoc['!cols'] = [
    { wch: 8 }, { wch: 32 }, { wch: 30 }, { wch: 30 }, { wch: 16 }, { wch: 14 }, { wch: 20 }, { wch: 22 }, { wch: 16 }
  ];
  XLSX.utils.book_append_sheet(wb, wsDoc, 'Doctor Referral Report');

  // --- SHEET 3: BRANCH EXECUTIVE SUMMARY ---
  const branchRows = [
    ['Branch Name', 'Revenue (₹)', 'Due (₹)', 'Doctor Cuts (₹)', 'Reagents (₹)', 'Fixed Costs (₹)', 'Total Expense (₹)', 'Net Profit / Loss (₹)', 'Profit Margin (%)', 'Status']
  ];
  cols.forEach(b => {
    branchRows.push([
      b.branchName, b.received, b.due, b.docCutAmount, b.reagentAmount, b.totalFixed, b.totalExpense, b.netProfit, b.profitPct.toFixed(1) + '%', b.netProfit >= 0 ? 'PROFIT' : 'LOSS'
    ]);
  });
  const wsBranch = XLSX.utils.aoa_to_sheet(branchRows);
  wsBranch['!cols'] = [
    { wch: 35 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 20 }, { wch: 18 }, { wch: 12 }
  ];
  XLSX.utils.book_append_sheet(wb, wsBranch, 'Branch Margins Summary');

  const filename = `Grace_Lab_Executive_Report_${(res.month || 'Total').replace(/\s+/g, '_')}.xlsx`;
  XLSX.writeFile(wb, filename);
  showToast(`Exported ${filename} with professional formatting!`);
}

// ==========================================
// 9. SETTINGS & UTILITIES
// ==========================================

function formatCurrency(val) {
  return '₹' + (Number(val) || 0).toLocaleString('en-IN', { maximumFractionDigits: 1, minimumFractionDigits: 0 });
}

function formatNumber(val) {
  return (Number(val) || 0).toLocaleString('en-IN', { maximumFractionDigits: 1, minimumFractionDigits: 0 });
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
  sel.innerHTML = `<option value="ALL">All Dates / Total</option>` + AppState.months.map(m => `<option value="${m}" ${m === AppState.selectedMonth ? 'selected' : ''}>${m}</option>`).join('');
}

function renderExpenseSettingsTable() {
  const container = document.getElementById('expense-settings-container');
  if (!container) return;

  const branchList = Object.values(AppState.branchExpenses).sort((a, b) => a.col_index - b.col_index);
  let html = `<div class="overflow-x-auto border border-slate-200 rounded-lg">
    <table class="min-w-full text-xs text-left">
      <thead class="bg-slate-100 font-semibold border-b">
        <tr>
          <th class="p-3">Branch / Unit</th>
          <th class="p-3">Salary 1</th>
          <th class="p-3">Salary 2</th>
          <th class="p-3">Rent</th>
          <th class="p-3">Electricity</th>
          <th class="p-3">Petrol</th>
          <th class="p-3 text-right">Total Monthly Fixed</th>
          <th class="p-3 text-center">Action</th>
        </tr>
      </thead>
      <tbody class="divide-y">
        ${branchList.map(b => {
          const colKey = openpyxlColLetter(b.col_index);
          const exp = b.expenses || {};
          return `<tr>
            <td class="p-3 font-semibold">${b.branch_name}</td>
            <td class="p-2"><input type="number" class="w-24 px-2 py-1 border rounded text-right" id="sal1-${colKey}" value="${exp.salary1_phelebo || 0}"></td>
            <td class="p-2"><input type="number" class="w-24 px-2 py-1 border rounded text-right" id="sal2-${colKey}" value="${exp.salary2_logistics || 0}"></td>
            <td class="p-2"><input type="number" class="w-20 px-2 py-1 border rounded text-right" id="rent-${colKey}" value="${exp.rent || 0}"></td>
            <td class="p-2"><input type="number" class="w-20 px-2 py-1 border rounded text-right" id="elec-${colKey}" value="${exp.electricity_bill || 0}"></td>
            <td class="p-2"><input type="number" class="w-20 px-2 py-1 border rounded text-right" id="petrol-${colKey}" value="${exp.petrol_rapido || 0}"></td>
            <td class="p-3 text-right font-bold text-amber-700">${formatCurrency(b.total_monthly_fixed)}</td>
            <td class="p-2 text-center"><button onclick="saveSingleBranchExpense('${colKey}')" class="px-2 py-1 bg-teal-600 text-white rounded text-xs">Save</button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>`;
  container.innerHTML = html;
}

function saveSingleBranchExpense(colKey) {
  if (AppState.branchExpenses[colKey]) {
    const s1 = parseFloat(document.getElementById(`sal1-${colKey}`)?.value) || 0;
    const s2 = parseFloat(document.getElementById(`sal2-${colKey}`)?.value) || 0;
    const r = parseFloat(document.getElementById(`rent-${colKey}`)?.value) || 0;
    const e = parseFloat(document.getElementById(`elec-${colKey}`)?.value) || 0;
    const p = parseFloat(document.getElementById(`petrol-${colKey}`)?.value) || 0;

    AppState.branchExpenses[colKey].expenses.salary1_phelebo = s1;
    AppState.branchExpenses[colKey].expenses.salary2_logistics = s2;
    AppState.branchExpenses[colKey].expenses.rent = r;
    AppState.branchExpenses[colKey].expenses.electricity_bill = e;
    AppState.branchExpenses[colKey].expenses.petrol_rapido = p;

    AppState.branchExpenses[colKey].total_monthly_fixed = Object.values(AppState.branchExpenses[colKey].expenses).reduce((a, b) => a + (Number(b) || 0), 0);
    localStorage.setItem('grace_branch_expenses', JSON.stringify(AppState.branchExpenses));
    calculateAndRender();
    renderExpenseSettingsTable();
    showToast(`Updated fixed expenses for ${AppState.branchExpenses[colKey].branch_name}!`);
  }
}

function resetExpensesToDefault() {
  if (confirm('Reset all branch expenses to template defaults?')) {
    localStorage.removeItem('grace_branch_expenses');
    AppState.branchExpenses = JSON.parse(JSON.stringify(DEFAULT_BRANCH_EXPENSES));
    renderExpenseSettingsTable();
    calculateAndRender();
    showToast('Reset all branch expenses to default.');
  }
}

function renderDoctorMasterTable(searchQuery = '') {
  const tbody = document.getElementById('doctor-master-body');
  if (!tbody) return;

  let entries = Object.entries(AppState.doctorCuts);
  if (searchQuery.trim()) {
    entries = entries.filter(([name]) => name.toLowerCase().includes(searchQuery.toLowerCase()));
  }

  entries.sort((a, b) => a[0].localeCompare(b[0]));
  document.getElementById('total-doctors-count').innerText = `${entries.length} Doctors`;

  tbody.innerHTML = entries.slice(0, 150).map(([docName, pct], idx) => `
    <tr class="hover:bg-slate-50 transition border-b border-slate-200">
      <td class="px-4 py-2.5 text-xs text-slate-500">${idx + 1}</td>
      <td class="px-4 py-2.5 text-sm font-semibold text-slate-800">${docName}</td>
      <td class="px-4 py-2.5 text-sm text-center">
        <input type="number" step="1" min="0" max="100" class="w-20 px-2 py-1 text-center font-bold border rounded" value="${pct}" onchange="updateDoctorCut('${docName.replace(/'/g, "\\'")}', this.value)"> %
      </td>
      <td class="px-4 py-2.5 text-center"><button onclick="deleteDoctor('${docName.replace(/'/g, "\\'")}')" class="text-xs text-rose-500 font-medium">Remove</button></td>
    </tr>
  `).join('');
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
  calculateAndRender();
}

function deleteDoctor(docName) {
  if (confirm(`Remove doctor "${docName}" from master database?`)) {
    delete AppState.doctorCuts[docName];
    localStorage.setItem('grace_dr_cuts', JSON.stringify(AppState.doctorCuts));
    renderDoctorMasterTable();
    calculateAndRender();
  }
}

function resetDoctorsToDefault() {
  if (confirm('Reset doctor list back to original 529 entries?')) {
    localStorage.removeItem('grace_dr_cuts');
    AppState.doctorCuts = { ...DEFAULT_DOCTOR_CUTS };
    renderDoctorMasterTable();
    calculateAndRender();
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

  tbody.innerHTML = AppState.unmatchedDoctors.map(u => `
    <tr class="hover:bg-amber-50/50 border-b border-amber-200">
      <td class="px-4 py-2 font-semibold text-amber-900">${u.doctorName}</td>
      <td class="px-4 py-2 text-xs text-amber-800">${u.branch}</td>
      <td class="px-4 py-2 text-center text-xs font-bold text-amber-800">${u.count}</td>
      <td class="px-4 py-2 text-right font-medium text-amber-900">${formatCurrency(u.totalReceived)}</td>
      <td class="px-4 py-2 text-center">
        <button onclick="resolveUnmatchedDoctor('${u.doctorName.replace(/'/g, "\\'")}')" class="px-2.5 py-1 bg-amber-600 text-white rounded text-xs font-medium">Assign %</button>
      </td>
    </tr>
  `).join('');
}

function resolveUnmatchedDoctor(docName) {
  const pct = parseFloat(prompt(`Set Doctor referral cut % for "${docName}":`, '40')) || 0;
  AppState.doctorCuts[docName] = pct;
  localStorage.setItem('grace_dr_cuts', JSON.stringify(AppState.doctorCuts));

  AppState.parsedBills.forEach(b => {
    if (b.doctor === docName) {
      b.doctorCutPct = pct;
      b.matchedDoctor = docName;
      b.matchType = 'MANUAL_OVERRIDE';
    }
  });

  AppState.unmatchedDoctors = AppState.unmatchedDoctors.filter(u => u.doctorName !== docName);
  renderUnmatchedDoctorsAlert();
  renderDoctorMasterTable();
  calculateAndRender();
  showToast(`Assigned ${pct}% to ${docName}. Calculations updated!`);
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

function setupEventListeners() {
  document.getElementById('base-excel-input')?.addEventListener('change', function(e) {
    if (e.target.files && e.target.files[0]) handleFileUpload(e.target.files[0]);
  });

  document.getElementById('month-selector')?.addEventListener('change', function() {
    AppState.selectedMonth = this.value;
    calculateAndRender();
  });

  document.getElementById('doctor-search-input')?.addEventListener('input', function() {
    renderDoctorMasterTable(this.value);
  });

  document.querySelectorAll('[data-tab-target]').forEach(btn => {
    btn.addEventListener('click', function() {
      const target = this.dataset.tabTarget;
      document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
      document.querySelectorAll('[data-tab-target]').forEach(b => {
        b.classList.remove('border-teal-500', 'text-teal-400', 'font-bold');
        b.classList.add('border-transparent', 'text-slate-400');
      });
      document.getElementById(`tab-${target}`)?.classList.remove('hidden');
      this.classList.add('border-teal-500', 'text-teal-400', 'font-bold');
      this.classList.remove('border-transparent', 'text-slate-400');
      if (target === 'dashboard') Object.values(AppState.charts).forEach(c => c && c.resize());
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});
