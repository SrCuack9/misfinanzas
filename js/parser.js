function parseAmount(val) {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    let s = val.toString().replace(/[€\s]/g, '');
    if (s.includes(',') && s.includes('.')) {
        if (s.lastIndexOf('.') > s.lastIndexOf(',')) {
            s = s.replace(/,/g, '');
        } else {
            s = s.replace(/\./g, '').replace(',', '.');
        }
    } else if (s.includes(',')) {
        const parts = s.split(',');
        if (parts.length === 2 && parts[1].length <= 2) {
            s = s.replace(',', '.');
        } else {
            s = s.replace(/,/g, '');
        }
    }
    return parseFloat(s) || 0;
}

function parseDate(val) {
    if (!val) return null;
    if (val instanceof Date) {
        const d = val;
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${yyyy}-${mm}-${dd}`;
    }
    const str = val.toString().trim();
    const match = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (match) {
        const dd = match[1].padStart(2, '0');
        const mm = match[2].padStart(2, '0');
        const yyyy = match[3];
        return `${yyyy}-${mm}-${dd}`;
    }
    return null;
}

function excelDateToJS(serial) {
    if (typeof serial !== 'number') return null;
    if (serial < 1) return null;
    const utcDays = Math.floor(serial - 25569);
    const d = new Date(utcDays * 86400000);
    return d;
}

// A Sabadell savings account ("Cuenta Ahorro") only contains auto-savings
// movements (REDONDEO / MODO PERIÓDICO) and never card purchases, Bizum,
// payroll, etc. We use that to distinguish it from the normal checking account.
function isSabadellSavings(concepts) {
    if (!concepts || concepts.length === 0) return false;
    const hasAutoSavings = concepts.some(c => /REDONDEO|MODO PERI[OÓ]DICO/i.test(c));
    const hasCheckingActivity = concepts.some(c => /COMPRA TARJ|BIZUM|RECIBO|NOMINA|TRANSFERENCIA A |PAGO /i.test(c));
    return hasAutoSavings && !hasCheckingActivity;
}

function parseSabadell(workbook) {
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });

    const transactions = [];
    const allConcepts = [];
    let dataStarted = false;
    let accountNumber = '';
    let latestBalance = null;
    let latestTxDate = null; // fecha de movimiento más reciente del extracto

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;

        const first = (row[0] || '').toString().trim();

        if (first === 'Cuenta:' || (row[0] === '' && (row[1] || '').toString().startsWith('ES'))) {
            accountNumber = (row[1] || '').toString().trim();
        }

        if (first === 'F. Operativa' || first === 'Fecha') {
            dataStarted = true;
            continue;
        }

        if (!dataStarted) continue;

        let dateRaw = row[0];
        let concept = (row[1] || '').toString().trim();
        let amountRaw = row[3];
        let balanceRaw = row[4];

        // Ojo: el saldo puede ser 0 (cuenta vaciada), que es un valor válido.
        if (latestBalance === null && balanceRaw !== '' && balanceRaw !== null && balanceRaw !== undefined) {
            latestBalance = parseAmount(balanceRaw);
        }

        if (!dateRaw || !concept) continue;

        let dateStr;
        if (typeof dateRaw === 'number') {
            const jsDate = excelDateToJS(dateRaw);
            dateStr = jsDate ? parseDate(jsDate) : null;
        } else {
            dateStr = parseDate(dateRaw);
        }

        if (!dateStr) continue;

        if (!latestTxDate || dateStr > latestTxDate) latestTxDate = dateStr;

        const amount = parseAmount(amountRaw);
        if (amount === 0) continue;

        allConcepts.push(concept);

        if (isInternalTransfer(concept)) continue;

        const { category, subcategory } = categorize(concept, amount);
        const month = dateStr.substring(0, 7);

        transactions.push({
            date: dateStr,
            concept,
            amount,
            category,
            subcategory,
            source: 'sabadell',
            month,
            hash: txHash(dateStr, concept, amount),
            manualCategory: false,
        });
    }

    // If this is the savings account, don't import its movements as
    // income/expenses (they're internal transfers from the checking account).
    // Just report its balance so the "Cuenta Ahorro" card updates automatically.
    if (isSabadellSavings(allConcepts)) {
        return { transactions: [], accountNumber, isSavings: true, savingsBalance: latestBalance, latestDate: latestTxDate };
    }

    return { transactions, accountNumber, sabadellBalance: latestBalance, latestDate: latestTxDate };
}

function parseMyInvestor(workbook) {
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });

    const transactions = [];
    const funds = {};
    let accountBalance = 0;
    let dataStarted = false;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;

        for (let c = 0; c < row.length; c++) {
            const cell = (row[c] || '').toString().trim();
            if (cell === 'Saldo:') {
                const balVal = (row[c + 1] || '').toString().replace('€', '').trim();
                accountBalance = parseAmount(balVal);
            }
        }

        const hasMovHeader = row.some(c => (c || '').toString().trim() === 'Fecha Operación');
        if (hasMovHeader) {
            dataStarted = true;
            continue;
        }

        if (!dataStarted) continue;

        let dateRaw = null;
        let concept = '';
        let amountRaw = null;

        for (let c = 0; c < Math.min(row.length, 10); c++) {
            const val = row[c];
            if (val === '' || val === null || val === undefined) continue;

            const str = val.toString().trim();

            if (!dateRaw && (parseDate(str) || (typeof val === 'number' && val > 40000))) {
                dateRaw = val;
                continue;
            }

            if (dateRaw && !concept && str && !str.match(/^\d/) && !str.match(/^-?\d.*€$/) && !str.match(/^-?\d+[\.,]\d+€?$/)) {
                concept = str;
                continue;
            }

            if (dateRaw && (str.match(/€/) || (typeof val === 'number' && Math.abs(val) > 0 && Math.abs(val) < 100000))) {
                if (amountRaw === null) {
                    amountRaw = val;
                }
            }
        }

        if (!dateRaw) continue;

        let dateStr;
        if (typeof dateRaw === 'number') {
            const jsDate = excelDateToJS(dateRaw);
            dateStr = jsDate ? parseDate(jsDate) : null;
        } else {
            dateStr = parseDate(dateRaw);
        }

        if (!dateStr) continue;

        const amount = parseAmount(amountRaw);
        if (amount === 0) continue;

        if (concept && (concept.includes('ISHARES') || concept.includes('VANGUARD') || concept.includes('AMUNDI') || concept.includes('INDEX FUND'))) {
            const fundName = concept.replace(/\s+/g, ' ').trim();
            if (!funds[fundName]) funds[fundName] = { name: fundName, purchases: [], currentValue: null };
            funds[fundName].purchases.push({
                date: dateStr,
                amount: Math.abs(amount),
                hash: txHash(dateStr, concept, amount),
            });
            continue;
        }

        if (concept === 'null' || concept === '') {
            concept = amount > 0 ? 'Ingreso MyInvestor' : 'Movimiento MyInvestor';
        }

        // Las aportaciones/retiradas entre mis cuentas no son ingresos ni gastos.
        if (isInternalTransfer(concept)) continue;

        const { category, subcategory } = categorize(concept, amount);
        const month = dateStr.substring(0, 7);

        transactions.push({
            date: dateStr,
            concept,
            amount,
            category,
            subcategory,
            source: 'myinvestor',
            month,
            hash: txHash(dateStr, concept, amount),
            manualCategory: false,
        });
    }

    return { transactions, funds: Object.values(funds), accountBalance };
}

function detectSource(workbook) {
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });

    for (let i = 0; i < Math.min(rows.length, 15); i++) {
        const rowStr = rows[i].join(' ').toLowerCase();
        if (rowStr.includes('myinvestor') || rowStr.includes('movimientos myinvestor')) {
            return 'myinvestor';
        }
        if (rowStr.includes('sabadell') || rowStr.includes('consulta de movimientos') || rowStr.includes('f. operativa')) {
            return 'sabadell';
        }
    }

    const sheetName = (workbook.SheetNames[0] || '').toLowerCase();
    if (sheetName.includes('myinvestor')) return 'myinvestor';
    if (sheetName.includes('sabadell')) return 'sabadell';

    return 'unknown';
}

// ==================== CSV (Abanca y Trade Republic) ====================

// Decodifica el buffer como texto probando UTF-8 y, si sale mal, Windows-1252.
function bufferToText(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let text = new TextDecoder('utf-8').decode(bytes);
    if (text.includes('�')) {
        try { text = new TextDecoder('windows-1252').decode(bytes); } catch (e) { /* nos quedamos con utf-8 */ }
    }
    return text;
}

// Parser CSV con soporte de comillas dobles y saltos de línea dentro de campos.
function parseCSVRows(text, delimiter) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else field += c;
            continue;
        }
        if (c === '"') { inQuotes = true; continue; }
        if (c === delimiter) { row.push(field); field = ''; continue; }
        if (c === '\r') continue;
        if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
        field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim() !== ''));
}

function detectCSVSource(text) {
    const head = text.substring(0, 500).toLowerCase();
    if (head.includes('"datetime"') && head.includes('"account_type"')) return 'traderepublic';
    if (head.includes('fecha ctble') || (head.includes('fecha valor') && head.includes('concepto ampliado'))) return 'abanca';
    return null;
}

// --- Abanca: Fecha ctble;Fecha valor;Concepto;Importe;Moneda;Saldo;Moneda;Concepto ampliado
function parseAbancaCSV(text) {
    const rows = parseCSVRows(text, ';');
    const transactions = [];
    let latestBalance = null, latestDate = null, accountNumber = '';

    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (r.length < 6) continue;
        const dateStr = parseDate(r[0]);
        if (!dateStr) continue;

        let concept = (r[2] || '').toString().trim();
        const extended = (r[7] || '').toString().trim();
        if ((!concept || concept === '.') && extended && extended !== '.') concept = extended;
        const amount = parseAmount(r[3]);
        const balance = parseAmount(r[5]);

        // El saldo del movimiento más reciente (el fichero viene de viejo a nuevo).
        if (!latestDate || dateStr >= latestDate) { latestDate = dateStr; latestBalance = balance; }

        if (amount === 0) continue;                 // aperturas y apuntes informativos
        if (isInternalTransfer(concept)) continue;   // traspasos entre cuentas propias

        let category, subcategory;
        if (!concept || concept === '.') {
            // Abanca manda los traspasos a cuentas propias sin concepto: no son
            // gasto ni ingreso (categoría neutral, editable si hiciera falta).
            concept = 'Traspaso sin concepto';
            category = 'traspaso';
            subcategory = amount < 0 ? 'Salida a otra cuenta' : 'Entrada de otra cuenta';
        } else {
            ({ category, subcategory } = categorize(concept, amount));
        }
        transactions.push({
            date: dateStr, concept, amount, category, subcategory,
            source: 'abanca', month: dateStr.substring(0, 7),
            hash: txHash(dateStr, concept, amount), manualCategory: false,
        });
    }
    return { transactions, abancaBalance: latestBalance, latestDate, accountNumber };
}

// --- Trade Republic: CSV con cabecera datetime,date,account_type,category,type,...
// El saldo en efectivo no viene dado: se calcula sumando importes + retenciones.
function parseTradeRepublicCSV(text) {
    const rows = parseCSVRows(text, ',');
    if (!rows.length) return { transactions: [], traderepublicBalance: null, latestDate: null };
    const header = rows[0].map(h => h.trim().toLowerCase());
    const idx = (name) => header.indexOf(name);
    const iDate = idx('date'), iType = idx('type'), iName = idx('name'),
          iAmount = idx('amount'), iTax = idx('tax'), iDesc = idx('description'),
          iCategory = idx('category'), iSymbol = idx('symbol');

    const transactions = [];
    const funds = {};
    let cash = 0, latestDate = null;

    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (r.length < 3) continue;
        const dateStr = parseDate(r[iDate]) || (r[iDate] || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
        if (!latestDate || dateStr > latestDate) latestDate = dateStr;

        const type = (r[iType] || '').trim();
        const amount = parseFloat(r[iAmount]) || 0;
        const tax = parseFloat(r[iTax]) || 0;
        // Todo movimiento afecta al efectivo de la cuenta (las compras de fondos salen del efectivo).
        cash += amount + tax;

        const name = (r[iName] || '').trim();
        const desc = (r[iDesc] || '').trim();

        // Compras de fondos: no son gasto, es inversión. Se registran como fondo.
        if (type === 'BUY' || (iCategory >= 0 && (r[iCategory] || '').trim() === 'TRADING')) {
            const fundName = name || (r[iSymbol] || 'Fondo Trade Republic');
            if (!funds[fundName]) funds[fundName] = { name: fundName, purchases: [], currentValue: null, broker: 'traderepublic' };
            funds[fundName].purchases.push({
                date: dateStr, amount: Math.abs(amount),
                hash: txHash(dateStr, fundName + ' BUY', amount),
            });
            continue;
        }

        let concept = name || desc || type;
        if (type === 'INTEREST_PAYMENT') concept = 'Intereses Trade Republic';
        if (type === 'BENEFITS_SAVEBACK') concept = 'Saveback Trade Republic';

        if (amount === 0) continue;
        if (isInternalTransfer(concept) || isInternalTransfer(desc)) continue;

        let category, subcategory;
        if (type === 'INTEREST_PAYMENT' || type === 'BENEFITS_SAVEBACK') {
            category = 'otros_ingresos';
            subcategory = type === 'INTEREST_PAYMENT' ? 'Intereses' : 'Saveback';
        } else if (type.startsWith('TRANSFER') && amount > 0) {
            // Dinero recibido de otra persona: equivale a un Bizum recibido.
            category = 'bizum';
            subcategory = 'Recibido (Trade Republic)';
        } else if (type.startsWith('TRANSFER') && amount < 0) {
            category = 'bizum';
            subcategory = 'Enviado (Trade Republic)';
        } else {
            ({ category, subcategory } = categorize(concept, amount));
        }

        transactions.push({
            date: dateStr, concept, amount, category, subcategory,
            source: 'traderepublic', month: dateStr.substring(0, 7),
            hash: txHash(dateStr, concept, amount), manualCategory: false,
        });
    }

    return {
        transactions,
        funds: Object.values(funds),
        traderepublicBalance: Math.round(cash * 100) / 100,
        latestDate,
    };
}

function parseCSVText(text) {
    const src = detectCSVSource(text);
    if (src === 'abanca') { const r = parseAbancaCSV(text); r.detectedSource = 'abanca'; return r; }
    if (src === 'traderepublic') { const r = parseTradeRepublicCSV(text); r.detectedSource = 'traderepublic'; return r; }
    return null;
}

// ==================== ENTRADAS GENÉRICAS ====================

function parseFile(file, source) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                resolve(parseArrayBuffer(e.target.result, source));
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
    });
}

function parseArrayBuffer(arrayBuffer, source) {
    // Primero: ¿es un CSV que conocemos (Abanca / Trade Republic)?
    const csvResult = tryParseCSVBuffer(arrayBuffer);
    if (csvResult) return csvResult;

    const data = new Uint8Array(arrayBuffer);
    const workbook = XLSX.read(data, { type: 'array', cellDates: false });
    const detectedSource = source || detectSource(workbook);

    let result;
    if (detectedSource === 'myinvestor') {
        result = parseMyInvestor(workbook);
    } else {
        result = parseSabadell(workbook);
    }
    result.detectedSource = detectedSource;
    return result;
}

function tryParseCSVBuffer(arrayBuffer) {
    try {
        const text = bufferToText(arrayBuffer);
        if (!detectCSVSource(text)) return null;
        return parseCSVText(text);
    } catch (e) {
        return null;
    }
}

function detectSourceFromBuffer(arrayBuffer) {
    try {
        const text = bufferToText(arrayBuffer);
        const csvSrc = detectCSVSource(text);
        if (csvSrc) return csvSrc;
    } catch (e) { /* seguimos con Excel */ }
    try {
        const data = new Uint8Array(arrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: false });
        return detectSource(workbook);
    } catch {
        return 'unknown';
    }
}

function extractBalancesOnly(arrayBuffer) {
    try {
        const data = new Uint8Array(arrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: false });
        const source = detectSource(workbook);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });

        // CSV conocidos (Abanca / Trade Republic): reutilizamos su parser.
        const csv = tryParseCSVBuffer(arrayBuffer);
        if (csv) {
            return {
                source: csv.detectedSource,
                accountNumber: csv.accountNumber || '',
                sabadellBalance: null,
                savingsBalance: null,
                myinvestorBalance: null,
                abancaBalance: csv.abancaBalance !== undefined ? csv.abancaBalance : null,
                traderepublicBalance: csv.traderepublicBalance !== undefined ? csv.traderepublicBalance : null,
                latestDate: csv.latestDate || null,
            };
        }

        let accountNumber = '';
        let sabadellBalance = null;
        let savingsBalance = null;
        let myinvestorBalance = null;
        let latestDate = null; // fecha del movimiento más reciente del extracto

        if (source === 'sabadell') {
            let dataStarted = false;
            let firstBalance = null;
            let firstDate = null;
            const concepts = [];
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                if (!row || row.length === 0) continue;
                const first = (row[0] || '').toString().trim();
                if (first === 'Cuenta:' || (row[0] === '' && (row[1] || '').toString().startsWith('ES'))) {
                    accountNumber = (row[1] || '').toString().trim();
                }
                if (first === 'F. Operativa' || first === 'Fecha') { dataStarted = true; continue; }
                if (dataStarted) {
                    // El saldo y la fecha del primer movimiento (el más reciente: el
                    // extracto viene ordenado de nuevo a viejo).
                    if (firstBalance === null && row[4] !== '' && row[4] != null) {
                        firstBalance = parseAmount(row[4]);
                        const dr = row[0];
                        firstDate = (typeof dr === 'number')
                            ? (excelDateToJS(dr) ? parseDate(excelDateToJS(dr)) : null)
                            : parseDate(dr);
                    }
                    const c = (row[1] || '').toString().trim();
                    if (c) concepts.push(c);
                }
            }
            latestDate = firstDate;
            if (isSabadellSavings(concepts)) {
                savingsBalance = firstBalance;
            } else {
                sabadellBalance = firstBalance;
            }
        } else if (source === 'myinvestor') {
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                if (!row) continue;
                for (let c = 0; c < row.length; c++) {
                    if ((row[c] || '').toString().trim() === 'Saldo:') {
                        myinvestorBalance = parseAmount((row[c + 1] || '').toString().replace('€', '').trim());
                        break;
                    }
                }
                if (myinvestorBalance !== null) break;
            }
        }

        return { source, accountNumber, sabadellBalance, savingsBalance, myinvestorBalance,
                 abancaBalance: null, traderepublicBalance: null, latestDate };
    } catch (err) {
        console.error('extractBalancesOnly error:', err);
        return { source: 'unknown', accountNumber: '', sabadellBalance: null, savingsBalance: null,
                 myinvestorBalance: null, abancaBalance: null, traderepublicBalance: null, latestDate: null };
    }
}
