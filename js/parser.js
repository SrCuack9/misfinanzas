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

    // La decisión de si esta cuenta es la de ahorro se toma fuera, consolidando
    // TODOS los extractos de un mismo número de cuenta: un extracto suelto puede
    // no tener movimientos de REDONDEO y engañar a la heurística.
    const looksLikeSavings = isSabadellSavings(allConcepts);
    return {
        transactions,
        accountNumber,
        balance: latestBalance,
        looksLikeSavings,
        latestDate: latestTxDate,
        // Compatibilidad con el flujo anterior:
        isSavings: looksLikeSavings,
        savingsBalance: looksLikeSavings ? latestBalance : null,
        sabadellBalance: looksLikeSavings ? null : latestBalance,
    };
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

// ==================== TRADE REPUBLIC ====================
// El CSV de Trade Republic no trae saldo: el efectivo se calcula sumando
// importes y retenciones de TODA la historia de la cuenta. Como cada fila tiene
// un identificador único (transaction_id), se pueden unir varios CSV con rangos
// de fechas distintos sin duplicar nada: da igual qué tramo se exporte.

// Lee las filas de un CSV de Trade Republic como objetos.
function readTradeRepublicRows(text) {
    const rows = parseCSVRows(text, ',');
    if (!rows.length) return [];
    const header = rows[0].map(h => h.trim().toLowerCase());
    const out = [];
    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (r.length < 3) continue;
        const o = {};
        header.forEach((h, k) => { o[h] = (r[k] || '').trim(); });
        // Clave única: el id de la operación; si faltara, una huella de la fila.
        o._id = o.transaction_id || [o.datetime, o.type, o.amount, o.name, o.shares].join('|');
        out.push(o);
    }
    return out;
}

// Pagos a comercios que el CSV registra como "transferencia" a tu propio
// nombre (Bizum a una tienda, domiciliaciones SEPA): el comercio de verdad
// está en la descripción, "... Debit transfer to VivaGym (NL65...)".
const TR_MERCHANT_DEBIT = /(?:BIZUM|SEPA\s+DIRECT)\s+DEBIT\s+TRANSFER\s+TO\s+(.+?)(?:\s*\(|$)/i;

// Decide qué es una fila de efectivo. Devuelve null si es un traspaso entre
// cuentas propias (no es ingreso ni gasto).
function classifyTradeRepublicRow(type, name, desc, amount) {
    // 1) Pago a un comercio. Va ANTES del filtro de traspasos: en estas filas la
    //    contraparte es tu propio nombre y se tomarían por un traspaso interno.
    const m = desc.match(TR_MERCHANT_DEBIT);
    if (m && amount < 0) {
        const merchant = m[1].trim();
        return { concept: merchant, ...categorize(merchant, amount) };
    }
    // 2) Traspaso entre cuentas propias
    if (isInternalTransfer(name) || isInternalTransfer(desc)) return null;
    // 3) Remuneración de la cuenta
    if (type === 'INTEREST_PAYMENT') return { concept: 'Intereses Trade Republic', category: 'otros_ingresos', subcategory: 'Intereses' };
    if (type === 'BENEFITS_SAVEBACK') return { concept: 'Saveback Trade Republic', category: 'otros_ingresos', subcategory: 'Saveback' };

    const concept = name || desc || type;
    // 4) Transferencia de o a una persona. Primero las reglas (alquiler, ayuda
    //    familiar, ventas...); si ninguna encaja, es un Bizum entre personas.
    //    La regla tiene que cuadrar con el sentido del dinero: un nombre que
    //    casa con una regla de ingresos no puede convertir un pago en ingreso.
    if (type.startsWith('TRANSFER')) {
        for (const text of [concept, desc]) {
            if (!text) continue;
            const c = categorize(text, amount);
            const fits = amount > 0 ? isIncomeCategory(c.category) : !isIncomeCategory(c.category);
            if (c.subcategory !== 'Sin clasificar' && fits) return { concept, ...c };
        }
        return { concept, category: 'bizum',
                 subcategory: amount > 0 ? 'Recibido (Trade Republic)' : 'Enviado (Trade Republic)' };
    }
    // 5) Tarjeta y demás
    return { concept, ...categorize(concept, amount) };
}

// Convierte las filas (de uno o varios CSV) en movimientos, operaciones con
// fondos y saldo en efectivo.
function buildTradeRepublic(rows) {
    // Sin duplicados y en orden cronológico (las posiciones lo necesitan).
    const seen = new Set();
    const uniq = rows.filter(r => !seen.has(r._id) && seen.add(r._id))
                     .sort((a, b) => (a.datetime || a.date).localeCompare(b.datetime || b.date));

    const transactions = [], trades = [];
    let cash = 0, latestDate = null, firstDate = null;

    for (const r of uniq) {
        const dateStr = parseDate(r.date) || r.date;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
        if (!latestDate || dateStr > latestDate) latestDate = dateStr;
        if (!firstDate || dateStr < firstDate) firstDate = dateStr;

        const type = r.type || '';
        const amount = parseFloat(r.amount) || 0;
        const tax = parseFloat(r.tax) || 0;
        cash += amount + tax;

        // Operaciones con fondos: inversión, no gasto.
        if (r.category === 'TRADING' || type === 'BUY' || type === 'SELL') {
            const shares = Math.abs(parseFloat(r.shares) || 0);
            if (!r.symbol || !shares) continue;
            let kind;
            if (type === 'SELL') kind = 'sell';
            else if (r.amount === '') kind = 'transfer_in';   // traspaso: llegan títulos, no sale dinero
            else kind = 'buy';
            trades.push({ date: dateStr, isin: r.symbol, name: r.name, kind, shares, amount: Math.abs(amount) });
            continue;
        }

        if (amount === 0) continue;
        const c = classifyTradeRepublicRow(type, r.name || '', r.description || '', amount);
        if (!c) continue;
        transactions.push({
            date: dateStr, concept: c.concept, amount, category: c.category, subcategory: c.subcategory,
            source: 'traderepublic', month: dateStr.substring(0, 7),
            hash: txHash(dateStr, c.concept, amount), manualCategory: false,
        });
    }
    return { transactions, trades, traderepublicBalance: Math.round(cash * 100) / 100, latestDate, firstDate };
}

function parseTradeRepublicCSV(text) {
    const rows = readTradeRepublicRows(text);
    const r = buildTradeRepublic(rows);
    r.rows = rows;   // para poder unirlo con otros CSV de la misma cuenta
    return r;
}

// Posiciones en fondos a partir de las operaciones, con coste medio:
//  - compra: suma títulos y coste
//  - venta: resta títulos y la parte proporcional del coste
//  - traspaso de entrada: suma títulos; su coste no viene en el CSV y se toma
//    de transferCost[ISIN] (una sola vez por fondo) si se conoce.
// Devuelve también los movimientos de dinero invertido, con fecha, para la
// gráfica de patrimonio (el traspaso no es dinero nuevo y no cuenta ahí).
function computeTRPositions(trades, transferCost) {
    const pos = {};
    const events = [];
    const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date));
    for (const t of sorted) {
        const p = pos[t.isin] || (pos[t.isin] = { isin: t.isin, name: t.name, shares: 0, cost: 0,
                                                    costKnown: true, transferApplied: false });
        if (t.name) p.name = t.name;
        if (t.kind === 'buy') {
            p.shares += t.shares; p.cost += t.amount;
            events.push({ date: t.date, amount: t.amount });
        } else if (t.kind === 'transfer_in') {
            p.shares += t.shares;
            const c = transferCost ? transferCost[t.isin] : undefined;
            if (c == null) p.costKnown = false;
            else if (!p.transferApplied) { p.cost += c; p.transferApplied = true; }
        } else if (t.kind === 'sell') {
            const sold = Math.min(t.shares, p.shares);
            const removed = p.shares > 0 ? p.cost * sold / p.shares : 0;
            p.shares -= sold; p.cost -= removed;
            events.push({ date: t.date, amount: -removed });
        }
    }
    const positions = Object.values(pos)
        .filter(p => p.shares > 1e-6)
        .map(p => ({ isin: p.isin, name: p.name, shares: p.shares,
                     cost: p.costKnown ? Math.round(p.cost * 100) / 100 : null,
                     hasTransfer: p.transferApplied || !p.costKnown }));
    return { positions, events };
}

// ==================== TRADE REPUBLIC — PDF de la cuenta de valores ====================
// El texto de un PDF puede salir con las columnas mezcladas según quién lo
// extraiga, así que no se lee por posición: cada fondo se empareja con el
// precio y el valor que cumplen títulos × precio ≈ valor, y el resultado se
// valida contra el total que imprime el propio PDF. Si no cuadra, se avisa en
// vez de devolver números dudosos.

function parseEsNumber(s) {
    return parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
}

function parseTRSecuritiesText(text) {
    if (!text || !/CUENTA DE VALORES/i.test(text) || !/POSICIONES/i.test(text)) return null;

    const dm = text.match(/\bal\s+(\d{2})\.(\d{2})\.(\d{4})/i) || text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    const date = dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : null;

    // Fondos: "10,676867 tít. Nombre..." y su ISIN, en el mismo orden.
    const holdings = [];
    const qtyRe = /(\d{1,3}(?:\.\d{3})*,\d+)\s*t[ií]t\.?[ \t]*([^\n]*)/gi;
    let m;
    while ((m = qtyRe.exec(text)) !== null) {
        const name = m[2].split(/\s{2,}|\s\d{1,3}(?:\.\d{3})*,\d{2}\b/)[0].trim();
        holdings.push({ shares: parseEsNumber(m[1]), name });
    }
    const isins = [...text.matchAll(/ISIN:\s*([A-Z]{2}[A-Z0-9]{9}\d)/g)].map(x => x[1]);
    if (!holdings.length || holdings.length !== isins.length) {
        return { error: `El PDF tiene ${holdings.length} posiciones y ${isins.length} ISIN; no sé emparejarlos.` };
    }
    holdings.forEach((h, i) => { h.isin = isins[i]; });

    // Total del extracto ("1.850,49 EUR").
    const totals = [...text.matchAll(/(\d{1,3}(?:\.\d{3})*,\d{2})\s*EUR\b/g)].map(x => parseEsNumber(x[1]));
    const total = totals.length ? totals[totals.length - 1] : null;

    // Importes con dos decimales (precios y valores). Las fechas usan puntos
    // y los títulos llevan más decimales, así que no se cuelan.
    const nums = [...text.matchAll(/(?<![\d,.])(\d{1,3}(?:\.\d{3})*,\d{2})(?![\d,])/g)]
        .map(x => parseEsNumber(x[1]));

    // Emparejar: para cada fondo, el par (precio, valor) con menor error.
    const cands = [];
    holdings.forEach((h, hi) => {
        const tol = h.shares * 0.005 + 0.02;   // el precio viene redondeado a 2 decimales
        nums.forEach((price, pi) => nums.forEach((value, vi) => {
            if (pi === vi || price <= 0) return;
            const err = Math.abs(h.shares * price - value);
            if (err <= tol) cands.push({ hi, pi, vi, err });
        }));
    });
    cands.sort((a, b) => a.err - b.err);
    const usedH = new Set(), usedN = new Set();
    for (const c of cands) {
        if (usedH.has(c.hi) || usedN.has(c.pi) || usedN.has(c.vi)) continue;
        holdings[c.hi].price = nums[c.pi];
        holdings[c.hi].value = nums[c.vi];
        usedH.add(c.hi); usedN.add(c.pi); usedN.add(c.vi);
    }
    const missing = holdings.filter(h => h.value == null);
    if (missing.length) return { error: `No encuentro el valor de: ${missing.map(h => h.isin).join(', ')}.` };

    const sum = holdings.reduce((s, h) => s + h.value, 0);
    if (total != null && Math.abs(sum - total) > 0.05) {
        return { error: `Los valores suman ${sum.toFixed(2)} € y el PDF dice ${total.toFixed(2)} €.` };
    }
    return { date, positions: holdings, total: total != null ? total : Math.round(sum * 100) / 100 };
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

function isPdfBuffer(arrayBuffer) {
    const b = new Uint8Array(arrayBuffer, 0, Math.min(5, arrayBuffer.byteLength));
    return String.fromCharCode(...b) === '%PDF-';
}

function parseArrayBuffer(arrayBuffer, source) {
    // Los PDF los lee el servidor del ordenador (pypdf), no el navegador.
    if (isPdfBuffer(arrayBuffer)) {
        throw new Error('Los PDF de Trade Republic se leen desde la carpeta de extractos del ordenador, no con la subida manual.');
    }
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
                trRows: csv.rows || null,   // filas de TR, para unir varios CSV
            };
        }

        let accountNumber = '';
        let sabadellBalance = null;
        let savingsBalance = null;
        let myinvestorBalance = null;
        let latestDate = null;      // fecha del movimiento más reciente del extracto
        let rawBalance = null;      // saldo sin decidir a qué cuenta pertenece
        let looksLikeSavings = false;

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
            rawBalance = firstBalance;
            looksLikeSavings = isSabadellSavings(concepts);
            // Reparto provisional; quien llama puede reasignar con el tipo real
            // de la cuenta (consolidado por número de cuenta).
            if (looksLikeSavings) savingsBalance = firstBalance;
            else sabadellBalance = firstBalance;
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
                 abancaBalance: null, traderepublicBalance: null, latestDate,
                 rawBalance, looksLikeSavings };
    } catch (err) {
        console.error('extractBalancesOnly error:', err);
        return { source: 'unknown', accountNumber: '', sabadellBalance: null, savingsBalance: null,
                 myinvestorBalance: null, abancaBalance: null, traderepublicBalance: null, latestDate: null,
                 rawBalance: null, looksLikeSavings: false };
    }
}
