let allTransactions = [];
let currentView = 'dashboard';
// Filtros INDEPENDIENTES por vista (antes estaban vinculados).
// year: 'all' = Total (todo el tiempo). month: 'all' = todo el año, o '01'..'12'.
let dashFilters = { year: 'all', month: 'all' };
let txFilters = { year: 'all', month: 'all', category: 'all', search: '' };
let showHidden = false;
// Ids de movimientos que no cuentan en totales (devoluciones emparejadas y
// traspasos entre cuentas propias). `internalIds` es un subconjunto: los traspasos.
let refundedIds = new Set();
let internalIds = new Set();

// Navigation
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const view = btn.dataset.view;
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(`view-${view}`).classList.add('active');
        currentView = view;
        if (view === 'dashboard') refreshDashboard();
        if (view === 'transactions') refreshTransactions();
        if (view === 'compare') refreshCompare();
        if (view === 'stats') refreshStats();
        if (view === 'analysis') refreshAnalysis();
        if (view === 'accounts') refreshAccounts();
        if (view === 'upload') scanFolder();
    });
});

// Cuando el año es "Total" no tiene sentido elegir mes: lo desactivamos.
function syncMonthEnabled(yearSelId, monthSelId) {
    const y = document.getElementById(yearSelId);
    const m = document.getElementById(monthSelId);
    if (!y || !m) return;
    const disabled = (y.value === 'all');
    m.disabled = disabled;
    if (disabled) m.value = 'all';
}

// Dashboard filters (independientes)
document.getElementById('filter-year').addEventListener('change', (e) => {
    dashFilters.year = e.target.value;
    syncMonthEnabled('filter-year', 'filter-month');
    dashFilters.month = document.getElementById('filter-month').value;
    refreshDashboard();
});
document.getElementById('filter-month').addEventListener('change', (e) => {
    dashFilters.month = e.target.value;
    refreshDashboard();
});

// Transactions filters (independientes)
document.getElementById('tx-filter-year').addEventListener('change', (e) => {
    txFilters.year = e.target.value;
    syncMonthEnabled('tx-filter-year', 'tx-filter-month');
    txFilters.month = document.getElementById('tx-filter-month').value;
    refreshTransactions();
});
document.getElementById('tx-filter-month').addEventListener('change', (e) => {
    txFilters.month = e.target.value;
    refreshTransactions();
});
document.getElementById('tx-filter-category').addEventListener('change', (e) => {
    txFilters.category = e.target.value;
    refreshTransactions();
});
document.getElementById('tx-search').addEventListener('input', (e) => {
    txFilters.search = e.target.value.toLowerCase();
    refreshTransactions();
});

// Compare selectors
['cmp-a-year', 'cmp-a-month', 'cmp-b-year', 'cmp-b-month'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
        syncMonthEnabled('cmp-a-year', 'cmp-a-month');
        syncMonthEnabled('cmp-b-year', 'cmp-b-month');
        refreshCompare();
    });
});

// Stats selectors
['stats-year', 'stats-category'].forEach(id => {
    document.getElementById(id).addEventListener('change', refreshStats);
});

// ==================== FOLDER SCAN ====================

document.getElementById('btn-scan-folder').addEventListener('click', scanFolder);

async function scanFolder() {
    const statusEl = document.getElementById('folder-status');
    const filesEl = document.getElementById('folder-files');
    statusEl.innerHTML = '<span class="status-info">Escaneando carpeta de extractos...</span>';
    filesEl.innerHTML = '';

    try {
        const resp = await fetch('/api/extractos');
        if (!resp.ok) throw new Error('No se pudo acceder a la carpeta de extractos');
        const files = await resp.json();

        if (files.length === 0) {
            statusEl.innerHTML = '<span class="status-empty">La carpeta de extractos está vacía. Deja tus archivos .xls/.xlsx ahí.</span>';
            return;
        }

        const importedFiles = await getSetting('imported_files') || [];
        const importedSet = new Set(importedFiles);

        let newCount = 0;
        const fileItems = [];

        for (const f of files) {
            const isImported = importedSet.has(f.name);
            if (!isImported) newCount++;

            const nameLower = f.name.toLowerCase();
            let sourceGuess = 'unknown';
            if (nameLower.includes('sabadell') || nameLower.includes('gastos')) sourceGuess = 'sabadell';
            else if (nameLower.includes('myinvestor') || nameLower.includes('investor')) sourceGuess = 'myinvestor';
            else if (nameLower.startsWith('transactions_')) sourceGuess = 'traderepublic';
            else if (/^\d{8}_\d{4}_/.test(nameLower)) sourceGuess = 'sabadell';
            else if (nameLower.endsWith('.csv')) sourceGuess = 'abanca';

            const sourceLabel = sourceGuess === 'sabadell' ? 'Sabadell' :
                                sourceGuess === 'myinvestor' ? 'MyInvestor' :
                                sourceGuess === 'traderepublic' ? 'Trade Republic' :
                                sourceGuess === 'abanca' ? 'Abanca' : 'Auto-detectar';
            const sourceClass = sourceGuess;

            const sizeKB = (f.size / 1024).toFixed(0);

            fileItems.push(`
                <div class="file-item">
                    <div class="file-info">
                        <span class="file-icon">&#128196;</span>
                        <div>
                            <div class="file-name">${escapeHtml(f.name)}</div>
                            <div class="file-size">${sizeKB} KB</div>
                        </div>
                        <span class="file-detected ${sourceClass}">${sourceLabel}</span>
                    </div>
                    <span class="file-status ${isImported ? 'imported' : 'new'}">${isImported ? 'Importado' : 'Nuevo'}</span>
                </div>
            `);
        }

        filesEl.innerHTML = fileItems.join('');

        if (newCount > 0) {
            statusEl.innerHTML = `<span class="status-info">${files.length} archivo(s) encontrado(s), <strong>${newCount} nuevo(s)</strong> por importar.</span>
                <button id="btn-import-new" class="btn-primary" style="margin-left:12px">Importar nuevos</button>`;
            document.getElementById('btn-import-new').addEventListener('click', () => importNewFiles(files, importedSet));
        } else {
            statusEl.innerHTML = `<span class="status-success">${files.length} archivo(s) encontrado(s). Todo importado, nada nuevo.</span>`;
        }

        // Always refresh balance info in background after scan completes
        refreshBalancesFromFiles(files);

    } catch (err) {
        // Sin servidor (p. ej. en el móvil desde GitHub Pages) no hay carpeta de
        // extractos: se usa la subida manual de más abajo. Lo indicamos con claridad.
        const filesEl2 = document.getElementById('folder-files');
        if (filesEl2) filesEl2.innerHTML = '';
        statusEl.innerHTML = `<span class="status-info">La carpeta automática solo está disponible en el ordenador (con MisFinanzas.bat). En el móvil, usa la <strong>subida manual</strong> de aquí abajo para añadir tus extractos.</span>`;
    }
}

// Normaliza un IBAN/número de cuenta para usarlo como clave.
function accountKey(acc) {
    return (acc || '').replace(/\s+/g, '').toUpperCase();
}

// Decide qué número de cuenta es el de AHORRO consolidando todos los extractos:
// basta con que UNO de ellos tenga movimientos de ahorro automático para
// clasificar esa cuenta entera. Así un extracto suelto sin REDONDEO (p. ej. el
// del ingreso inicial) ya no se confunde con la cuenta corriente.
// El resultado se recuerda entre sesiones en el ajuste 'account_types'.
async function resolveAccountTypes(infos) {
    const stored = await getSetting('account_types') || {};
    const types = { ...stored };
    for (const info of infos) {
        const key = accountKey(info.accountNumber);
        if (!key || info.source !== 'sabadell') continue;
        if (info.looksLikeSavings) types[key] = 'savings';
        else if (!types[key]) types[key] = 'checking';
    }
    await saveSetting('account_types', types);
    return types;
}

function isSavingsAccount(types, accountNumber) {
    return types[accountKey(accountNumber)] === 'savings';
}

async function refreshBalancesFromFiles(files) {
    // Para cada tipo de cuenta, gana el saldo del extracto con la FECHA DE
    // MOVIMIENTO más reciente (no la fecha del archivo). Así, añadir extractos
    // históricos (p. ej. de 2025) no pisa el saldo actual.
    const best = {
        sabadell: { date: '', bal: null, acct: '' },
        savings: { date: '', bal: null },
        myinvestor: { date: '', bal: null },
        abanca: { date: '', bal: null },
        traderepublic: { date: '', bal: null },
    };

    // 1ª pasada: leer todos los extractos.
    const infos = [];
    for (const f of files) {
        try {
            const buf = await (await fetch(`/api/extracto/${encodeURIComponent(f.name)}`)).arrayBuffer();
            infos.push({ name: f.name, ...extractBalancesOnly(buf) });
        } catch (err) {
            console.error(`Error leyendo ${f.name}:`, err);
        }
    }

    // 2ª pasada: con las cuentas ya clasificadas, asignar cada saldo a su cuenta.
    const types = await resolveAccountTypes(infos);
    for (const info of infos) {
        const d = info.latestDate || '';
        if (info.source === 'sabadell' && info.rawBalance !== null && info.rawBalance !== undefined) {
            if (isSavingsAccount(types, info.accountNumber)) {
                if (d >= best.savings.date) best.savings = { date: d, bal: info.rawBalance };
            } else if (d >= best.sabadell.date) {
                best.sabadell = { date: d, bal: info.rawBalance, acct: info.accountNumber || best.sabadell.acct };
            }
        }
        if (info.myinvestorBalance !== null && d >= best.myinvestor.date) {
            best.myinvestor = { date: d, bal: info.myinvestorBalance };
        }
        if (info.abancaBalance !== null && info.abancaBalance !== undefined && d >= best.abanca.date) {
            best.abanca = { date: d, bal: info.abancaBalance };
        }
        if (info.traderepublicBalance !== null && info.traderepublicBalance !== undefined && d >= best.traderepublic.date) {
            best.traderepublic = { date: d, bal: info.traderepublicBalance };
        }
    }

    if (best.sabadell.bal !== null) {
        if (best.sabadell.acct) await saveSetting('sabadell_account', best.sabadell.acct);
        await saveSetting('sabadell_balance', best.sabadell.bal);
    }
    if (best.savings.bal !== null) await saveSetting('savings_balance', best.savings.bal);
    if (best.myinvestor.bal !== null) await saveSetting('myinvestor_balance', best.myinvestor.bal);
    if (best.abanca.bal !== null) await saveSetting('abanca_balance', best.abanca.bal);
    if (best.traderepublic.bal !== null) await saveSetting('traderepublic_balance', best.traderepublic.bal);

    // Fecha del extracto del que sale cada saldo (se muestra en Cuentas).
    await saveSetting('balance_dates', {
        sabadell: best.sabadell.date, savings: best.savings.date,
        abanca: best.abanca.date, traderepublic: best.traderepublic.date,
    });
    console.log('Balances refreshed (latest by tx date):', best);
}

async function importNewFiles(files, importedSet) {
    const statusEl = document.getElementById('folder-status');
    const allParsed = [];
    const allFunds = [];
    let accountNum = '';
    let myinvestorBalance = 0;
    let sabadellBalance = null;
    let savingsBalance = null;
    let abancaBalance = null;
    let traderepublicBalance = null;
    let sabadellDate = '';
    let savingsDate = '';
    let abancaDate = '';
    let trDate = '';
    const newFileNames = [];

    // 1ª pasada: parsear todos los ficheros nuevos.
    const parsed = [];
    for (const f of files) {
        if (importedSet.has(f.name)) continue;
        newFileNames.push(f.name);
        statusEl.innerHTML = `<span class="status-info">Importando ${escapeHtml(f.name)}...</span>`;
        try {
            const resp = await fetch(`/api/extracto/${encodeURIComponent(f.name)}`);
            const buf = await resp.arrayBuffer();
            parsed.push({ name: f.name, ...parseArrayBuffer(buf) });
        } catch (err) {
            console.error(`Error parsing ${f.name}:`, err);
        }
    }

    // 2ª pasada: clasificar cuentas (corriente vs ahorro) y repartir saldos.
    const types = await resolveAccountTypes(
        parsed.map(p => ({ source: p.detectedSource, accountNumber: p.accountNumber, looksLikeSavings: p.looksLikeSavings }))
    );

    for (const result of parsed) {
        const d = result.latestDate || '';
        const isSavingsAcc = result.detectedSource === 'sabadell' && isSavingsAccount(types, result.accountNumber);

        // Los movimientos de la cuenta de ahorro no se importan: son traspasos
        // desde la corriente, ya reflejados allí.
        if (!isSavingsAcc) allParsed.push(...result.transactions);
        if (result.funds) allFunds.push(...result.funds);
        if (result.accountBalance) myinvestorBalance = result.accountBalance;

        // Entre extractos de la misma cuenta gana el de movimiento más reciente.
        if (result.abancaBalance != null && d >= abancaDate) { abancaBalance = result.abancaBalance; abancaDate = d; }
        if (result.traderepublicBalance != null && d >= trDate) { traderepublicBalance = result.traderepublicBalance; trDate = d; }
        if (result.detectedSource === 'sabadell' && result.balance != null) {
            if (isSavingsAcc) {
                if (d >= savingsDate) { savingsBalance = result.balance; savingsDate = d; }
            } else if (d >= sabadellDate) {
                sabadellBalance = result.balance; sabadellDate = d;
                if (result.accountNumber) accountNum = result.accountNumber;
            }
        }
    }

    const existingHashes = await getExistingHashes();
    const newTx = [];
    const duplicates = [];

    allParsed.forEach(t => {
        if (existingHashes.has(t.hash)) {
            duplicates.push(t);
        } else {
            newTx.push(t);
        }
    });

    pendingImport = {
        transactions: newTx,
        duplicates,
        funds: allFunds,
        accountNumber: accountNum,
        myinvestorBalance,
        sabadellBalance,
        savingsBalance,
        abancaBalance,
        traderepublicBalance,
        fileNames: newFileNames,
    };

    showImportPreview(pendingImport);
}

// ==================== MANUAL UPLOAD ====================

const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file-input');

uploadZone.addEventListener('click', (e) => {
    if (e.target.tagName !== 'SELECT' && e.target.tagName !== 'OPTION') {
        fileInput.click();
    }
});

uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
});

uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('dragover');
});

uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleFiles(fileInput.files);
});

let pendingImport = null;

async function handleFiles(files) {
    const allParsed = [];
    const allFunds = [];
    let accountNum = '';
    let myinvestorBalance = 0;
    let sabadellBalance = null;
    let savingsBalance = null;
    let abancaBalance = null;
    let traderepublicBalance = null;
    let sabadellDate = '';
    let savingsDate = '';
    let abancaDate = '';
    let trDate = '';

    const parsed = [];
    for (const file of files) {
        try {
            parsed.push(await parseFile(file));
        } catch (err) {
            console.error('Error parsing file:', err);
            alert(`Error al leer ${file.name}: ${err.message}`);
        }
    }

    const types = await resolveAccountTypes(
        parsed.map(p => ({ source: p.detectedSource, accountNumber: p.accountNumber, looksLikeSavings: p.looksLikeSavings }))
    );

    for (const result of parsed) {
        const d = result.latestDate || '';
        const isSavingsAcc = result.detectedSource === 'sabadell' && isSavingsAccount(types, result.accountNumber);
        if (!isSavingsAcc) allParsed.push(...result.transactions);
        if (result.funds) allFunds.push(...result.funds);
        if (result.accountBalance) myinvestorBalance = result.accountBalance;
        if (result.abancaBalance != null && d >= abancaDate) { abancaBalance = result.abancaBalance; abancaDate = d; }
        if (result.traderepublicBalance != null && d >= trDate) { traderepublicBalance = result.traderepublicBalance; trDate = d; }
        if (result.detectedSource === 'sabadell' && result.balance != null) {
            if (isSavingsAcc) {
                if (d >= savingsDate) { savingsBalance = result.balance; savingsDate = d; }
            } else if (d >= sabadellDate) {
                sabadellBalance = result.balance; sabadellDate = d;
                if (result.accountNumber) accountNum = result.accountNumber;
            }
        }
    }

    if (allParsed.length === 0 && allFunds.length === 0 && savingsBalance === null &&
        abancaBalance === null && traderepublicBalance === null) {
        alert('No se encontraron movimientos en el archivo.');
        return;
    }

    const existingHashes = await getExistingHashes();
    const newTx = [];
    const duplicates = [];

    allParsed.forEach(t => {
        if (existingHashes.has(t.hash)) {
            duplicates.push(t);
        } else {
            newTx.push(t);
        }
    });

    pendingImport = { transactions: newTx, duplicates, funds: allFunds, accountNumber: accountNum,
        myinvestorBalance, sabadellBalance, savingsBalance, abancaBalance, traderepublicBalance };
    showImportPreview(pendingImport);
}

// ==================== IMPORT PREVIEW ====================

function showImportPreview(data) {
    const preview = document.getElementById('upload-preview');
    preview.hidden = false;
    preview.scrollIntoView({ behavior: 'smooth' });

    document.getElementById('upload-stats').innerHTML = `
        <span class="stat-badge">Nuevos: <strong>${data.transactions.length}</strong></span>
        <span class="stat-badge">Duplicados ignorados: <strong>${data.duplicates.length}</strong></span>
        ${data.funds && data.funds.length ? `<span class="stat-badge">Fondos detectados: <strong>${data.funds.length}</strong></span>` : ''}
    `;

    const dupWarning = document.getElementById('duplicate-warning');
    if (data.duplicates.length > 0) {
        dupWarning.hidden = false;
        document.getElementById('duplicate-list').innerHTML = data.duplicates
            .slice(0, 20)
            .map(t => `<div>${t.date} — ${t.concept} — ${formatCurrency(t.amount)}</div>`)
            .join('') + (data.duplicates.length > 20 ? `<div>... y ${data.duplicates.length - 20} más</div>` : '');
    } else {
        dupWarning.hidden = true;
    }

    const txPreview = document.getElementById('import-transactions-preview');
    if (data.transactions.length > 0) {
        txPreview.innerHTML = data.transactions.slice(0, 30).map(t => {
            const catInfo = getCategoryInfo(t.category);
            const amountClass = t.amount >= 0 ? 'positive' : 'negative';
            return `<div class="tx-item">
                <span class="tx-date">${formatDateDisplay(t.date)}</span>
                <span class="tx-concept">${escapeHtml(t.concept)}</span>
                <span class="tx-category ${catInfo.cssClass}">${catInfo.label}</span>
                <span class="tx-amount ${amountClass}">${formatCurrency(t.amount)}</span>
                <span></span>
            </div>`;
        }).join('') + (data.transactions.length > 30 ? `<div class="empty-msg" style="padding:12px">... y ${data.transactions.length - 30} movimientos más</div>` : '');
    } else {
        txPreview.innerHTML = '<div class="empty-msg" style="padding:20px">Todos los movimientos ya estaban importados.</div>';
    }
}

document.getElementById('btn-confirm-import').addEventListener('click', async () => {
    if (!pendingImport) return;

    const result = await addTransactions(pendingImport.transactions);

    if (pendingImport.accountNumber) {
        await saveSetting('sabadell_account', pendingImport.accountNumber);
    }

    if (pendingImport.myinvestorBalance) {
        await saveSetting('myinvestor_balance', pendingImport.myinvestorBalance);
    }

    if (pendingImport.sabadellBalance !== null && pendingImport.sabadellBalance !== undefined) {
        await saveSetting('sabadell_balance', pendingImport.sabadellBalance);
    }

    if (pendingImport.savingsBalance !== null && pendingImport.savingsBalance !== undefined) {
        await saveSetting('savings_balance', pendingImport.savingsBalance);
    }

    if (pendingImport.abancaBalance !== null && pendingImport.abancaBalance !== undefined) {
        await saveSetting('abanca_balance', pendingImport.abancaBalance);
    }

    if (pendingImport.traderepublicBalance !== null && pendingImport.traderepublicBalance !== undefined) {
        await saveSetting('traderepublic_balance', pendingImport.traderepublicBalance);
    }

    if (pendingImport.funds) {
        for (const fund of pendingImport.funds) {
            const existing = (await getAllFunds()).find(f => f.name === fund.name);
            const existingPurchases = existing ? (existing.purchases || []) : [];
            const existingHashes = new Set(existingPurchases.map(p => p.hash));

            // Only add truly new purchases (deduplicate by hash)
            const newPurchases = (fund.purchases || []).filter(p => !existingHashes.has(p.hash));
            const allPurchases = [...existingPurchases, ...newPurchases];

            // Si el usuario ha editado el fondo a mano, respetamos su importe invertido
            // y su valor actual; solo actualizamos el registro de compras.
            if (existing && existing.manualInvested) {
                await saveFund({ ...existing, purchases: allPurchases });
            } else {
                const totalInvested = allPurchases.reduce((sum, p) => sum + p.amount, 0);
                await saveFund({
                    name: fund.name,
                    purchases: allPurchases,
                    totalInvested,
                    currentValue: (existing && existing.currentValue) || fund.currentValue || null,
                    // Conservar a qué bróker pertenece (MyInvestor o Trade Republic).
                    broker: fund.broker || (existing && existing.broker) || undefined,
                });
            }
        }
    }

    if (pendingImport.fileNames) {
        const importedFiles = await getSetting('imported_files') || [];
        const updated = [...new Set([...importedFiles, ...pendingImport.fileNames])];
        await saveSetting('imported_files', updated);
    }

    document.getElementById('upload-preview').hidden = true;
    pendingImport = null;
    fileInput.value = '';

    await loadData();

    const msg = `Importación completada: ${result.added.length} movimientos añadidos, ${result.duplicates.length} duplicados ignorados.`;
    const statusEl = document.getElementById('folder-status');
    if (statusEl) statusEl.innerHTML = `<span class="status-success">${msg}</span>`;

    scanFolder();
});

document.getElementById('btn-cancel-import').addEventListener('click', () => {
    document.getElementById('upload-preview').hidden = true;
    pendingImport = null;
    fileInput.value = '';
});

// ==================== MODAL ====================

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal')) closeModal();
});

function openModal(html) {
    document.getElementById('modal-body').innerHTML = html;
    document.getElementById('modal').hidden = false;
}

function closeModal() {
    document.getElementById('modal').hidden = true;
}

// ==================== SAVINGS ====================

document.getElementById('savings-update-btn').addEventListener('click', async () => {
    const val = parseFloat(document.getElementById('savings-input').value);
    if (!isNaN(val) && val >= 0) {
        await saveSetting('savings_balance', val);
        document.getElementById('savings-balance').textContent = formatCurrency(val);
        document.getElementById('savings-input').value = '';
        refreshDashboard();
    }
});

document.getElementById('btn-recalc-balances').addEventListener('click', async (e) => {
    const btn = e.target;
    const original = btn.textContent;
    btn.textContent = 'Recalculando...';
    btn.disabled = true;
    try {
        const resp = await fetch('/api/extractos', { cache: 'no-store' });
        if (!resp.ok) throw new Error('sin servidor');
        await refreshBalancesFromFiles(await resp.json());
        await refreshAccounts();
        refreshDashboard();
        btn.textContent = 'Saldos actualizados ✓';
    } catch (err) {
        btn.textContent = 'Solo disponible en el ordenador';
    }
    setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 2500);
});

document.getElementById('abanca-update-btn').addEventListener('click', async () => {
    const val = parseFloat(document.getElementById('abanca-input').value);
    if (isNaN(val) || val < 0) return;
    await saveSetting('abanca_balance', val);
    document.getElementById('abanca-input').value = '';
    await refreshAccounts();
    refreshDashboard();
});

document.getElementById('traderepublic-update-btn').addEventListener('click', async () => {
    const val = parseFloat(document.getElementById('traderepublic-input').value);
    if (isNaN(val) || val < 0) return;
    await saveSetting('traderepublic_balance', val);
    document.getElementById('traderepublic-input').value = '';
    await refreshAccounts();
    refreshDashboard();
});

// ==================== COPIA DE SEGURIDAD ====================

document.getElementById('btn-export-data').addEventListener('click', async () => {
    const statusEl = document.getElementById('backup-status');
    try {
        const backup = {
            app: 'MisFinanzas',
            version: 1,
            exportedAt: new Date().toISOString(),
            transactions: await getAllTransactions(),
            funds: await getAllFunds(),
            settings: await getAllSettings(),
        };
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `misfinanzas-copia-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
        statusEl.innerHTML = `<span class="status-success">Copia exportada: ${backup.transactions.length} movimientos, ${backup.funds.length} fondos.</span>`;
    } catch (err) {
        statusEl.innerHTML = `<span style="color:var(--accent-red)">Error al exportar: ${err.message}</span>`;
    }
});

document.getElementById('btn-import-data').addEventListener('click', () => {
    document.getElementById('import-data-input').click();
});

document.getElementById('import-data-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const statusEl = document.getElementById('backup-status');
    try {
        const data = JSON.parse(await file.text());
        if (!data || data.app !== 'MisFinanzas' || !Array.isArray(data.transactions)) {
            throw new Error('El archivo no es una copia válida de MisFinanzas.');
        }
        if (!confirm(`Esto REEMPLAZARÁ todos los datos actuales por los de la copia (${data.transactions.length} movimientos). ¿Continuar?`)) {
            e.target.value = '';
            return;
        }
        await restoreBackup(data);
        // Recargar reglas/categorías desde los ajustes restaurados.
        const learned = await getSetting('learned_rules');
        setLearnedRules(learned || {});
        const customCats = await getSetting('custom_categories');
        setCustomCategories(customCats || {});
        await loadData();
        statusEl.innerHTML = `<span class="status-success">Copia restaurada: ${data.transactions.length} movimientos.</span>`;
    } catch (err) {
        statusEl.innerHTML = `<span style="color:var(--accent-red)">Error al restaurar: ${err.message}</span>`;
    }
    e.target.value = '';
});

// ==================== SINCRONIZACIÓN CIFRADA ====================

async function buildBackupObject() {
    return {
        app: 'MisFinanzas',
        version: 1,
        exportedAt: new Date().toISOString(),
        transactions: await getAllTransactions(),
        funds: await getAllFunds(),
        settings: (await getAllSettings()).filter(s => !String(s.key).startsWith('sync_')),
    };
}

async function applyBackupObject(data) {
    if (!data || data.app !== 'MisFinanzas' || !Array.isArray(data.transactions)) {
        throw new Error('El contenido no es una copia válida de MisFinanzas.');
    }
    await restoreBackup(data);
    setLearnedRules(await getSetting('learned_rules') || {});
    setCustomCategories(await getSetting('custom_categories') || {});
    await loadData();
}

// Publica la copia cifrada en el servidor local, que a su vez la sube al Gist
// secreto de GitHub. Devuelve el resultado del servidor, o null si no hay
// servidor (en ese caso, SOLO si es una publicación manual, descarga el archivo).
async function publishSnapshot(pass, interactive) {
    const envelope = await encryptPayload(await buildBackupObject(), pass);
    const json = JSON.stringify(envelope);
    try {
        const r = await fetch('/api/snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json });
        if (!r.ok) throw new Error('El servidor no pudo guardar la copia.');
        const result = await r.json();
        if (result.raw_url) await saveSetting('sync_url', result.raw_url);
        return result;
    } catch (e) {
        if (interactive) {
            // Solo con el botón manual: descargar como alternativa.
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'misfinanzas-sync.json';
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(url);
        }
        return null;
    }
}

document.getElementById('btn-publish-sync').addEventListener('click', async () => {
    const statusEl = document.getElementById('sync-status');
    const pass = document.getElementById('sync-pass').value;
    if (!pass) { statusEl.innerHTML = '<span style="color:var(--accent-red)">Escribe una contraseña de cifrado.</span>'; return; }
    try {
        // Guardar contraseña si la auto-publicación está activada (la necesita).
        if (document.getElementById('sync-auto').checked) {
            await saveSetting('sync_passphrase', pass);
        }
        const result = await publishSnapshot(pass, true);
        if (result && result.gist_pushed) {
            statusEl.innerHTML = '<span class="status-success">Copia cifrada subida a tu Gist secreto de GitHub. El móvil ya puede leerla.</span>';
        } else if (result) {
            statusEl.innerHTML = `<span class="status-info">Copia guardada en el PC, pero no se pudo subir al Gist: ${escapeHtml(result.gist_error || 'configura sync_config.json')}.</span>`;
        } else {
            statusEl.innerHTML = '<span class="status-info">No se pudo hablar con el servidor local (¿MisFinanzas.bat reiniciado?). Se ha descargado la copia como alternativa.</span>';
        }
    } catch (err) {
        statusEl.innerHTML = `<span style="color:var(--accent-red)">Error al publicar: ${err.message}</span>`;
    }
});

// ---- Auto-publicación: tras cualquier cambio de datos en el PC, se publica
// sola (con retardo para agrupar cambios seguidos). Así el móvil siempre ve
// las categorías editadas, saldos, etc. sin pasos manuales.
let publishTimer = null;
function scheduleAutoPublish() {
    clearTimeout(publishTimer);
    publishTimer = setTimeout(async () => {
        try {
            const auto = await getSetting('sync_auto');
            const pass = await getSetting('sync_passphrase');
            if (!auto || !pass) return;
            const result = await publishSnapshot(pass, false);
            if (result && result.gist_pushed) console.log('Sincronización auto-publicada.');
        } catch (e) {
            console.warn('Auto-publicación falló:', e);
        }
    }, 3000);
}

document.getElementById('sync-auto').addEventListener('change', async (e) => {
    await saveSetting('sync_auto', e.target.checked);
    const pass = document.getElementById('sync-pass').value;
    if (e.target.checked && pass) await saveSetting('sync_passphrase', pass);
    if (e.target.checked) scheduleAutoPublish();
});

async function loadFromSync(url, pass, statusEl) {
    // Cache-buster: la CDN del Gist cachea ~5 min; con un parámetro único
    // siempre llega la última versión publicada.
    const bustUrl = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
    const resp = await fetch(bustUrl, { cache: 'no-store' });
    if (!resp.ok) throw new Error('No se pudo descargar la copia (revisa la URL y que sea de acceso con enlace).');
    const envelope = await resp.json();
    const data = await decryptPayload(envelope, pass);
    await applyBackupObject(data);
    if (statusEl) statusEl.innerHTML = `<span class="status-success">Datos sincronizados: ${data.transactions.length} movimientos.</span>`;
}

document.getElementById('btn-load-sync').addEventListener('click', async () => {
    const statusEl = document.getElementById('sync-status');
    const url = document.getElementById('sync-url').value.trim();
    const pass = document.getElementById('sync-pass').value;
    const remember = document.getElementById('sync-remember').checked;
    if (!url || !pass) { statusEl.innerHTML = '<span style="color:var(--accent-red)">Pon la URL y la contraseña.</span>'; return; }
    try {
        await loadFromSync(url, pass, statusEl);
        await saveSetting('sync_url', url);
        await saveSetting('sync_remember', remember);
        await saveSetting('sync_passphrase', remember ? pass : '');
    } catch (err) {
        statusEl.innerHTML = `<span style="color:var(--accent-red)">Error al sincronizar: ${err.message}</span>`;
    }
});

// ==================== MYINVESTOR (manual) ====================

document.getElementById('myinvestor-cash-btn').addEventListener('click', async () => {
    const v = parseFloat(document.getElementById('myinvestor-cash-input').value);
    if (isNaN(v) || v < 0) return;
    await saveSetting('myinvestor_cash', v);
    await refreshAccounts();
    refreshDashboard();
});

document.getElementById('fund-add-btn').addEventListener('click', async () => {
    const nameEl = document.getElementById('fund-add-name');
    const invEl = document.getElementById('fund-add-invested');
    const curEl = document.getElementById('fund-add-current');
    const name = nameEl.value.trim();
    if (!name) { nameEl.focus(); return; }

    const existing = (await getAllFunds()).find(f => f.name.toLowerCase() === name.toLowerCase());
    const fund = existing || { name, purchases: [], totalInvested: 0, currentValue: null };
    const inv = parseFloat(invEl.value);
    const cur = parseFloat(curEl.value);
    if (!isNaN(inv)) { fund.totalInvested = inv; fund.manualInvested = true; }
    if (!isNaN(cur)) fund.currentValue = cur;

    await saveFund(fund);
    nameEl.value = ''; invEl.value = ''; curEl.value = '';
    await refreshAccounts();
    refreshDashboard();
});

// ==================== DATA ====================

const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MONTH_ABBR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
let filtersInitialized = false;

async function loadData() {
    await openDB();
    await reloadTransactions();
    populateFilters();
    refreshDashboard();
}

// Recarga los movimientos y recalcula las cancelaciones emparejadas.
async function reloadTransactions() {
    allTransactions = await getAllTransactions();
    reconcileRefunds();
}

function getAvailableYears() {
    const years = [...new Set(allTransactions.map(t => t.date.substring(0, 4)))].sort();
    if (years.length === 0) years.push(String(new Date().getFullYear()));
    return years;
}

function fillYearSelect(sel, includeTotal) {
    const prev = sel.value;
    sel.innerHTML = '';
    if (includeTotal) sel.add(new Option('Total (todo)', 'all'));
    getAvailableYears().forEach(y => sel.add(new Option(y, y)));
    if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}

function fillMonthSelect(sel) {
    const prev = sel.value;
    sel.innerHTML = '';
    sel.add(new Option('Todo el año', 'all'));
    MONTH_NAMES.forEach((m, i) => sel.add(new Option(m, String(i + 1).padStart(2, '0'))));
    if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}

function populateFilters() {
    const years = getAvailableYears();
    const latest = years[years.length - 1];
    const prevYear = years.length > 1 ? years[years.length - 2] : latest;

    fillYearSelect(document.getElementById('filter-year'), true);
    fillYearSelect(document.getElementById('tx-filter-year'), true);
    fillMonthSelect(document.getElementById('filter-month'));
    fillMonthSelect(document.getElementById('tx-filter-month'));
    fillYearSelect(document.getElementById('cmp-a-year'), false);
    fillYearSelect(document.getElementById('cmp-b-year'), false);
    fillMonthSelect(document.getElementById('cmp-a-month'));
    fillMonthSelect(document.getElementById('cmp-b-month'));

    if (!filtersInitialized) {
        dashFilters.year = latest; dashFilters.month = 'all';
        txFilters.year = latest; txFilters.month = 'all';
        document.getElementById('cmp-a-year').value = latest;
        document.getElementById('cmp-b-year').value = prevYear;
        filtersInitialized = true;
    }

    // Reflejar el estado en los desplegables.
    document.getElementById('filter-year').value = dashFilters.year;
    document.getElementById('filter-month').value = dashFilters.month;
    document.getElementById('tx-filter-year').value = txFilters.year;
    document.getElementById('tx-filter-month').value = txFilters.month;
    syncMonthEnabled('filter-year', 'filter-month');
    syncMonthEnabled('tx-filter-year', 'tx-filter-month');
    syncMonthEnabled('cmp-a-year', 'cmp-a-month');
    syncMonthEnabled('cmp-b-year', 'cmp-b-month');

    const catSel = document.getElementById('tx-filter-category');
    const currentCat = catSel.value || txFilters.category;
    catSel.innerHTML = '<option value="all">Todas las categorías</option>';
    [...getAllExpenseCategories(), ...getAllIncomeCategories()].forEach(c => catSel.add(new Option(c.label, c.id)));
    catSel.value = currentCat || 'all';

    // Selectores de la pestaña Estadísticas
    fillYearSelect(document.getElementById('stats-year'), true);
    const statsCatSel = document.getElementById('stats-category');
    const currentStatsCat = statsCatSel.value;
    statsCatSel.innerHTML = '<option value="all">Todas (visión global)</option>';
    getAllExpenseCategories().filter(c => c.id !== 'cancelado').forEach(c => statsCatSel.add(new Option(c.label, c.id)));
    getAllIncomeCategories().forEach(c => statsCatSel.add(new Option('Ingreso: ' + c.label, c.id)));
    if (currentStatsCat && [...statsCatSel.options].some(o => o.value === currentStatsCat)) statsCatSel.value = currentStatsCat;
}

// f = { year, month, category?, search? }. month '01'..'12' relativo al año elegido.
function getFilteredTransactions(f) {
    let r = allTransactions;
    if (f.year && f.year !== 'all') r = r.filter(t => t.date.substring(0, 4) === f.year);
    if (f.month && f.month !== 'all' && f.year !== 'all') r = r.filter(t => t.date.substring(5, 7) === f.month);
    if (f.category && f.category !== 'all') r = r.filter(t => t.category === f.category);
    if (f.search) r = r.filter(t => t.concept.toLowerCase().includes(f.search));
    return r;
}

// ==================== CANCELACIONES / DEVOLUCIONES ====================

const TOKEN_NOISE = new Set(['COMPRA', 'TARJ', 'TARJETA', 'BIZUM', 'ANUL', 'ANULACION', 'ANULACIÓN',
    'DEVOLUCION', 'DEVOLUCIÓN', 'PAGO', 'ABONO', 'REINTEGRO', 'RECIBO', 'CONCEPTO', 'TRANSFERENCIA',
    'COMPR', 'ONLINE', 'INTERNET', 'ESPANA', 'ESPAÑA', 'MADRID', 'BARCELONA']);

function merchantTokens(concept) {
    return (concept || '').toUpperCase()
        .replace(/[^A-ZÁÉÍÓÚÑ0-9 ]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 4 && !/^\d+$/.test(w) && !TOKEN_NOISE.has(w));
}

// Empareja cada devolución (importe +) con la compra (importe -) del mismo
// importe y mismo comercio anterior en el tiempo. Ambos quedan excluidos de
// los totales y gráficas (pero se siguen viendo en la lista, marcados).
function reconcileRefunds() {
    refundedIds = new Set();
    const refunds = allTransactions.filter(t => t.amount > 0 && isRefundConcept(t.concept));
    const expenses = allTransactions.filter(t => t.amount < 0);
    const used = new Set();

    for (const r of refunds) {
        const amt = Math.round(Math.abs(r.amount) * 100);
        const rTokens = merchantTokens(r.concept);
        let best = null;
        for (const e of expenses) {
            if (used.has(e.id)) continue;
            if (Math.round(Math.abs(e.amount) * 100) !== amt) continue;
            if (e.date > r.date) continue;
            const eTokens = merchantTokens(e.concept);
            if (!rTokens.some(tok => eTokens.includes(tok))) continue; // mismo comercio
            const dayDiff = (new Date(r.date) - new Date(e.date));
            if (!best || dayDiff < best.dayDiff) best = { e, dayDiff };
        }
        if (best) {
            used.add(best.e.id);
            refundedIds.add(best.e.id);
            refundedIds.add(r.id);
        }
    }

    reconcileInternalTransfers();
}

// Traspasos entre MIS cuentas (Sabadell → Trade Republic, Abanca → TR, ...).
// Se detectan por importe idéntico en cuentas distintas con pocos días de
// diferencia: el dinero no entra ni sale, solo cambia de sitio. Esto cubre los
// casos en que el banco no da un concepto útil (Abanca los manda como ".").
function reconcileInternalTransfers() {
    internalIds = new Set();
    const candidates = allTransactions.filter(t => !refundedIds.has(t.id) && Math.abs(t.amount) >= 20);
    const outs = candidates.filter(t => t.amount < 0);
    const ins = candidates.filter(t => t.amount > 0);
    const used = new Set();

    for (const o of outs) {
        const amt = Math.round(Math.abs(o.amount) * 100);
        let best = null;
        for (const i of ins) {
            if (used.has(i.id) || i.source === o.source) continue;
            if (Math.round(i.amount * 100) !== amt) continue;
            const days = Math.abs(new Date(i.date) - new Date(o.date)) / 86400000;
            if (days > 4) continue;
            if (!best || days < best.days) best = { i, days };
        }
        if (best) {
            used.add(best.i.id);
            internalIds.add(o.id);
            internalIds.add(best.i.id);
        }
    }
    // Los traspasos tampoco cuentan como ingreso/gasto en ninguna vista.
    internalIds.forEach(id => refundedIds.add(id));
}

// ==================== DASHBOARD ====================

// Resumen de MyInvestor: efectivo parado, invertido, valor actual y total.
async function getMyInvestorTotal() {
    let cash = await getSetting('myinvestor_cash');
    if (cash === null || cash === undefined) cash = await getSetting('myinvestor_balance') || 0;
    // Solo los fondos de MyInvestor: los de Trade Republic cuentan en su propia cuenta.
    const funds = (await getAllFunds()).filter(f => f.broker !== 'traderepublic');
    const fundsValue = funds.reduce((s, f) => s + (f.currentValue != null ? f.currentValue : (f.totalInvested || 0)), 0);
    const invested = funds.reduce((s, f) => s + (f.totalInvested || 0), 0);
    return { cash, fundsValue, invested, total: cash + fundsValue };
}

// Patrimonio total = cuentas corrientes + ahorro + Trade Republic + MyInvestor.
async function getNetWorth() {
    const sabadell = await getSetting('sabadell_balance') || 0;
    const abanca = await getSetting('abanca_balance') || 0;
    const savings = await getSetting('savings_balance') || 0;
    const trCash = await getSetting('traderepublic_balance') || 0;
    const funds = await getAllFunds();
    const trFunds = funds.filter(f => f.broker === 'traderepublic')
        .reduce((s, f) => s + (f.currentValue != null ? f.currentValue : (f.totalInvested || 0)), 0);
    const tr = trCash + trFunds;
    const mi = (await getMyInvestorTotal()).total;
    const checking = sabadell + abanca;
    // "Ahorro/inversión" agrupa todo lo que no es la cuenta corriente del día a día.
    const savingsTotal = savings + tr + mi;
    return { sabadell, abanca, checking, savings, tr, trCash, trFunds, mi, savingsTotal, total: checking + savingsTotal };
}

async function refreshDashboard() {
    // Las cancelaciones (compra + devolución) no cuentan en los totales ni gráficas.
    const txs = getFilteredTransactions(dashFilters).filter(t => !refundedIds.has(t.id));

    let income = 0, expense = 0, bizumIn = 0, bizumOut = 0;
    txs.forEach(t => {
        if (t.category === 'bizum') {
            // Los Bizum se muestran aparte, en pequeño, sin engordar los totales.
            if (t.amount > 0) bizumIn += t.amount; else bizumOut += Math.abs(t.amount);
            return;
        }
        if (isNeutralCategory(t.category)) return;
        if (t.amount > 0 && isIncomeCategory(t.category)) income += t.amount;
        else if (t.amount < 0 && !isIncomeCategory(t.category)) expense += Math.abs(t.amount);
    });

    document.getElementById('total-income').textContent = formatCurrency(income);
    document.getElementById('total-expense').textContent = formatCurrency(-expense);
    document.getElementById('total-balance').textContent = formatCurrency(income - expense);

    document.getElementById('income-bizum').textContent = bizumIn > 0 ? `+ ${formatCurrency(bizumIn)} en Bizums` : '';
    document.getElementById('expense-bizum').textContent = bizumOut > 0 ? `+ ${formatCurrency(bizumOut)} en Bizums` : '';
    const balWithBizum = income - expense + bizumIn - bizumOut;
    document.getElementById('balance-bizum').textContent = (bizumIn > 0 || bizumOut > 0) ? `con Bizums: ${formatCurrency(balWithBizum)}` : '';

    const nw = await getNetWorth();
    document.getElementById('total-savings').textContent = formatCurrency(nw.savingsTotal);

    renderAllCharts(txs, showCategoryDrilldown);
}

// ==================== TRANSACTIONS ====================

function refreshTransactions() {
    const all = getFilteredTransactions(txFilters).sort((a, b) => b.date.localeCompare(a.date));
    // Los movimientos "ocultos" siguen contando en el balance (dashboard/gráficas),
    // solo se omiten de esta lista a menos que se active "Mostrar ocultos".
    const hiddenCount = all.filter(t => t.hidden).length;
    const txs = showHidden ? all : all.filter(t => !t.hidden);
    const container = document.getElementById('transactions-list');

    const hiddenBar = hiddenCount > 0
        ? `<div class="hidden-toggle-bar">
               <button class="btn-secondary btn-small" onclick="toggleShowHidden()">
                   ${showHidden ? 'Ocultar los ' + hiddenCount + ' movimientos ocultos' : 'Mostrar ' + hiddenCount + ' movimiento(s) oculto(s)'}
               </button>
           </div>`
        : '';

    if (txs.length === 0) {
        container.innerHTML = hiddenBar + '<div class="empty-msg">No hay movimientos. Ve a la pestaña "Extractos" para importar datos.</div>';
        return;
    }

    container.innerHTML = hiddenBar + txs.map(t => {
        const catInfo = getCategoryInfo(t.category);
        const amountClass = t.amount >= 0 ? 'positive' : 'negative';
        const refunded = refundedIds.has(t.id);
        return `<div class="tx-item${t.hidden ? ' tx-hidden' : ''}${refunded ? ' tx-refunded' : ''}" data-id="${t.id}">
            <div class="tx-top-row">
                <span class="tx-date">${formatDateDisplay(t.date)}</span>
                <span class="tx-subcategory">${escapeHtml(t.subcategory || catInfo.label)}</span>
                <span class="tx-amount ${amountClass}">${formatCurrency(t.amount)}</span>
                <button class="tx-edit-btn" onclick="showRecategorize(${t.id})" title="Cambiar categoría">&#9998;</button>
            </div>
            <div class="tx-bottom-row">
                <span class="tx-concept" title="${escapeHtml(t.concept)}">${escapeHtml(t.concept)}</span>
                ${refunded
                    ? `<span class="tx-badge-cancel">${internalIds.has(t.id) ? 'traspaso entre cuentas' : 'cancelado'}</span>`
                    : `<span class="tx-category ${catInfo.cssClass}" onclick="showRecategorize(${t.id})">${catInfo.label}</span>`}
            </div>
        </div>`;
    }).join('');
}

// ==================== COMPARATIVA ====================

function periodLabel(f) {
    if (f.month === 'all') return f.year;
    return `${MONTH_ABBR[parseInt(f.month) - 1]} ${f.year}`;
}

function periodSummary(txs) {
    let income = 0, expense = 0;
    txs.forEach(t => {
        if (isNeutralCategory(t.category)) return;
        if (t.amount > 0 && isIncomeCategory(t.category)) income += t.amount;
        else if (t.amount < 0 && !isIncomeCategory(t.category)) expense += Math.abs(t.amount);
    });
    return { income, expense, balance: income - expense };
}

function expenseByCat(txs) {
    const by = {};
    txs.filter(t => t.amount < 0 && !isIncomeCategory(t.category) && !isNeutralCategory(t.category)).forEach(t => {
        by[t.category] = (by[t.category] || 0) + Math.abs(t.amount);
    });
    return by;
}

function refreshCompare() {
    const fA = { year: document.getElementById('cmp-a-year').value, month: document.getElementById('cmp-a-month').value };
    const fB = { year: document.getElementById('cmp-b-year').value, month: document.getElementById('cmp-b-month').value };

    const txA = getFilteredTransactions(fA).filter(t => !refundedIds.has(t.id));
    const txB = getFilteredTransactions(fB).filter(t => !refundedIds.has(t.id));
    const sA = periodSummary(txA);
    const sB = periodSummary(txB);
    const labelA = periodLabel(fA);
    const labelB = periodLabel(fB);

    const diff = (a, b) => {
        const d = a - b;
        const sign = d > 0 ? '+' : '';
        const cls = d > 0 ? 'negative' : (d < 0 ? 'positive' : '');
        return `<span class="cmp-diff ${cls}">${sign}${formatCurrency(d)}</span>`;
    };
    const diffInv = (a, b) => { // para ingresos/balance, subir es bueno
        const d = a - b;
        const sign = d > 0 ? '+' : '';
        const cls = d > 0 ? 'positive' : (d < 0 ? 'negative' : '');
        return `<span class="cmp-diff ${cls}">${sign}${formatCurrency(d)}</span>`;
    };

    document.getElementById('compare-summary').innerHTML = `
        <div class="cmp-table">
            <div class="cmp-row cmp-head"><span></span><span>${escapeHtml(labelA)}</span><span>${escapeHtml(labelB)}</span><span>Δ (A−B)</span></div>
            <div class="cmp-row"><span>Ingresos</span><span class="positive">${formatCurrency(sA.income)}</span><span class="positive">${formatCurrency(sB.income)}</span>${diffInv(sA.income, sB.income)}</div>
            <div class="cmp-row"><span>Gastos</span><span class="negative">${formatCurrency(sA.expense)}</span><span class="negative">${formatCurrency(sB.expense)}</span>${diff(sA.expense, sB.expense)}</div>
            <div class="cmp-row"><span>Balance</span><span>${formatCurrency(sA.balance)}</span><span>${formatCurrency(sB.balance)}</span>${diffInv(sA.balance, sB.balance)}</div>
        </div>`;

    const catsA = expenseByCat(txA);
    const catsB = expenseByCat(txB);
    const allCatIds = [...new Set([...Object.keys(catsA), ...Object.keys(catsB)])]
        .sort((x, y) => ((catsB[y] || 0) + (catsA[y] || 0)) - ((catsB[x] || 0) + (catsA[x] || 0)));
    const labels = allCatIds.map(id => getCategoryInfo(id).label);
    const seriesA = allCatIds.map(id => catsA[id] || 0);
    const seriesB = allCatIds.map(id => catsB[id] || 0);
    renderComparisonChart('chart-comparison', labels, seriesA, seriesB, labelA, labelB);
}

// ==================== ESTADÍSTICAS ====================

function monthLabelOf(m) { // 'YYYY-MM' → 'Ene 2026'
    const [y, mm] = m.split('-');
    return `${MONTH_ABBR[parseInt(mm) - 1]} ${y}`;
}

window.selectStatsCategory = function(catId) {
    document.getElementById('stats-category').value = catId;
    refreshStats();
};

function refreshStats() {
    const year = document.getElementById('stats-year').value;
    const catId = document.getElementById('stats-category').value;
    // Cancelaciones fuera; los ocultos SÍ cuentan (igual que en el dashboard).
    const scoped = getFilteredTransactions({ year, month: 'all' }).filter(t => !refundedIds.has(t.id));
    const summaryEl = document.getElementById('stats-summary');
    const chartTitle = document.getElementById('stats-chart-title');

    // Meses con actividad en el periodo (de cualquier categoría): así los meses
    // sin gasto en la categoría cuentan como 0 en el promedio.
    const months = [...new Set(scoped.map(t => t.month))].sort();
    if (months.length === 0) {
        summaryEl.innerHTML = '<div class="stats-empty">No hay datos en este periodo.</div>';
        if (statsChart) { statsChart.destroy(); statsChart = null; }
        chartTitle.textContent = 'Evolución mensual';
        return;
    }
    const n = months.length;

    if (catId === 'all') {
        // ---- Visión global: capacidad de ahorro + promedio por categoría ----
        const perMonth = months.map(m => {
            let inc = 0, exp = 0;
            scoped.forEach(t => {
                if (t.month !== m || isNeutralCategory(t.category)) return;
                if (t.amount > 0 && isIncomeCategory(t.category)) inc += t.amount;
                else if (t.amount < 0 && !isIncomeCategory(t.category)) exp += Math.abs(t.amount);
            });
            return { inc, exp };
        });
        const avgInc = perMonth.reduce((s, x) => s + x.inc, 0) / n;
        const avgExp = perMonth.reduce((s, x) => s + x.exp, 0) / n;
        const avgBal = avgInc - avgExp;
        const pct = avgInc > 0 ? (avgBal / avgInc * 100) : 0;

        const byCat = {};
        scoped.filter(t => t.amount < 0 && !isIncomeCategory(t.category) && !isNeutralCategory(t.category)).forEach(t => {
            byCat[t.category] = (byCat[t.category] || 0) + Math.abs(t.amount);
        });
        const rows = Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([id, total]) => {
            const info = getCategoryInfo(id);
            return `<div class="stats-row" onclick="selectStatsCategory('${id}')">
                <span class="stats-cat"><span class="cat-dot" style="background:${info.color}"></span>${escapeHtml(info.label)}</span>
                <span>${formatCurrency(total / n)}</span>
                <span>${formatCurrency(total)}</span>
            </div>`;
        }).join('');

        // Tabla equivalente para los ingresos
        const byIncCat = {};
        scoped.filter(t => t.amount > 0 && isIncomeCategory(t.category) && !isNeutralCategory(t.category)).forEach(t => {
            byIncCat[t.category] = (byIncCat[t.category] || 0) + t.amount;
        });
        const incRows = Object.entries(byIncCat).sort((a, b) => b[1] - a[1]).map(([id, total]) => {
            const info = getCategoryInfo(id);
            return `<div class="stats-row" onclick="selectStatsCategory('${id}')">
                <span class="stats-cat"><span class="cat-dot" style="background:${info.color}"></span>${escapeHtml(info.label)}</span>
                <span class="positive">${formatCurrency(total / n)}</span>
                <span class="positive">${formatCurrency(total)}</span>
            </div>`;
        }).join('');

        summaryEl.innerHTML = `
            <h3 class="stats-section-title">Capacidad de ahorro <span class="stats-hint">(media de ${n} meses)</span></h3>
            <div class="stats-cards">
                <div class="stat-card"><span>Ingresos medios/mes</span><strong class="positive">${formatCurrency(avgInc)}</strong></div>
                <div class="stat-card"><span>Gastos medios/mes</span><strong class="negative">${formatCurrency(avgExp)}</strong></div>
                <div class="stat-card stat-card-hl"><span>Ahorro medio/mes</span><strong class="${avgBal >= 0 ? 'positive' : 'negative'}">${formatCurrency(avgBal)}</strong></div>
                <div class="stat-card"><span>% de ingresos ahorrado</span><strong>${pct.toFixed(1)}%</strong></div>
            </div>
            <h3 class="stats-section-title">Gastos: promedio mensual por categoría <span class="stats-hint">(clic en una para ver su detalle)</span></h3>
            <div class="stats-table">
                <div class="stats-row stats-row-head"><span>Categoría</span><span>Promedio/mes</span><span>Total periodo</span></div>
                ${rows}
            </div>
            <h3 class="stats-section-title">Ingresos: promedio mensual por categoría <span class="stats-hint">(clic en una para ver su detalle)</span></h3>
            <div class="stats-table">
                <div class="stats-row stats-row-head"><span>Categoría</span><span>Promedio/mes</span><span>Total periodo</span></div>
                ${incRows || '<div class="stats-row stats-row-head"><span>Sin ingresos en este periodo</span><span></span><span></span></div>'}
            </div>`;

        chartTitle.textContent = 'Gastos totales por mes';
        renderStatsChart('chart-stats', months.map(monthLabelOf), perMonth.map(x => x.exp), '#f87171', 'Gastos', avgExp);
        return;
    }

    // ---- Bizum: tiene dos direcciones, se muestra enviado/recibido/neto ----
    if (catId === 'bizum') {
        const info = getCategoryInfo('bizum');
        const catTx = scoped.filter(t => t.category === 'bizum');
        const perMonth = months.map(m => catTx.filter(t => t.month === m).reduce((s, t) => s + t.amount, 0));
        const sent = catTx.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
        const received = catTx.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
        const net = received - sent;
        summaryEl.innerHTML = `
            <h3 class="stats-section-title"><span class="cat-dot" style="background:${info.color}"></span> Bizum</h3>
            <div class="stats-cards">
                <div class="stat-card"><span>Enviado</span><strong class="negative">${formatCurrency(sent)}</strong></div>
                <div class="stat-card"><span>Recibido</span><strong class="positive">${formatCurrency(received)}</strong></div>
                <div class="stat-card stat-card-hl"><span>Neto</span><strong class="${net >= 0 ? 'positive' : 'negative'}">${formatCurrency(net)}</strong></div>
                <div class="stat-card"><span>Neto medio/mes</span><strong>${formatCurrency(net / n)}</strong></div>
                <div class="stat-card"><span>Movimientos</span><strong>${catTx.length}</strong></div>
            </div>`;
        chartTitle.textContent = 'Bizum — neto por mes (recibido − enviado)';
        renderStatsChart('chart-stats', months.map(monthLabelOf), perMonth, info.color, 'Neto Bizum', net / n);
        return;
    }

    // ---- Categoría concreta ----
    const info = getCategoryInfo(catId);
    const isInc = isIncomeCategory(catId);
    const catTx = scoped.filter(t => t.category === catId && (isInc ? t.amount > 0 : t.amount < 0));
    const perMonth = months.map(m => catTx.filter(t => t.month === m).reduce((s, t) => s + Math.abs(t.amount), 0));
    const total = perMonth.reduce((a, b) => a + b, 0);
    const avg = total / n;
    let maxI = 0, minI = 0;
    perMonth.forEach((v, i) => { if (v > perMonth[maxI]) maxI = i; if (v < perMonth[minI]) minI = i; });
    const avgPerTx = catTx.length ? total / catTx.length : 0;

    summaryEl.innerHTML = `
        <h3 class="stats-section-title"><span class="cat-dot" style="background:${info.color}"></span> ${escapeHtml(info.label)}</h3>
        <div class="stats-cards">
            <div class="stat-card"><span>Promedio mensual</span><strong>${formatCurrency(avg)}</strong></div>
            <div class="stat-card"><span>Mes más alto</span><strong>${formatCurrency(perMonth[maxI])}</strong><em>${monthLabelOf(months[maxI])}</em></div>
            <div class="stat-card"><span>Mes más bajo</span><strong>${formatCurrency(perMonth[minI])}</strong><em>${monthLabelOf(months[minI])}</em></div>
            <div class="stat-card"><span>Total del periodo</span><strong>${formatCurrency(total)}</strong><em>${n} meses</em></div>
            <div class="stat-card"><span>Movimientos</span><strong>${catTx.length}</strong><em>${formatCurrency(avgPerTx)} de media cada uno</em></div>
        </div>`;

    chartTitle.textContent = `Evolución mensual — ${info.label}`;
    renderStatsChart('chart-stats', months.map(monthLabelOf), perMonth, info.color, isInc ? 'Ingresos' : 'Gastos', avg);
}

// ==================== ANÁLISIS ====================

// Meses COMPLETOS (excluye el mes en curso, que está a medias y desviaría medias).
function getCompleteMonths() {
    const current = new Date().toISOString().substring(0, 7);
    return [...new Set(allTransactions.map(t => t.month))].filter(m => m < current).sort();
}

// Universo de gastos "reales": fuera cancelaciones y categorías neutrales.
function realExpenses() {
    return allTransactions.filter(t =>
        t.amount < 0 && !refundedIds.has(t.id) &&
        !isIncomeCategory(t.category) && !isNeutralCategory(t.category));
}

function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// --- 1) Recurrentes: mismo comercio, importe similar, cadencia regular ---
function detectRecurring() {
    const groups = {};
    realExpenses().forEach(t => {
        const key = conceptKey(t.concept);
        if (!key) return;
        (groups[key] = groups[key] || []).push(t);
    });

    const found = [];
    const today = new Date();
    for (const [key, txs] of Object.entries(groups)) {
        if (txs.length < 3) continue;
        txs.sort((a, b) => a.date.localeCompare(b.date));
        const intervals = [];
        for (let i = 1; i < txs.length; i++) {
            intervals.push((new Date(txs[i].date) - new Date(txs[i - 1].date)) / 86400000);
        }
        const med = median(intervals);
        const amounts = txs.map(t => Math.abs(t.amount));
        const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
        // Importe consistente: el mayor no llega al doble del menor.
        const consistent = Math.max(...amounts) / Math.min(...amounts) <= 1.8;
        if (!consistent) continue;

        let cadence = null, monthly = 0;
        if (med >= 5 && med <= 9) { cadence = 'semanal'; monthly = avgAmount * 4.33; }
        else if (med >= 25 && med <= 37) { cadence = 'mensual'; monthly = avgAmount; }
        if (!cadence) continue;

        const last = txs[txs.length - 1];
        const daysSince = (today - new Date(last.date)) / 86400000;
        const active = daysSince <= med * 1.8;

        found.push({
            label: (last.subcategory && last.subcategory !== 'Sin clasificar') ? last.subcategory : key.substring(0, 32),
            category: last.category,
            cadence, monthly, avgAmount,
            count: txs.length,
            lastDate: last.date,
            active,
        });
    }
    // Un mismo servicio puede aparecer con varios formatos de concepto (el banco
    // cambia el texto). Nos quedamos con el más reciente de cada etiqueta.
    const byLabel = {};
    for (const r of found) {
        const prev = byLabel[r.label];
        if (!prev || r.lastDate > prev.lastDate) byLabel[r.label] = r;
    }
    return Object.values(byLabel).sort((a, b) => (b.active - a.active) || (b.monthly - a.monthly));
}

// --- 2) Tendencias por categoría (últimos 6 meses completos) ---
function computeTrends() {
    const months = getCompleteMonths().slice(-6);
    if (months.length < 4) return { rising: [], falling: [], months };

    const perCat = {};
    realExpenses().forEach(t => {
        if (!months.includes(t.month)) return;
        (perCat[t.category] = perCat[t.category] || {})[t.month] =
            (perCat[t.category]?.[t.month] || 0) + Math.abs(t.amount);
    });

    const half = Math.floor(months.length / 2);
    const older = months.slice(0, months.length - half);
    const recent = months.slice(-half);

    const rising = [], falling = [];
    for (const [cat, byMonth] of Object.entries(perCat)) {
        const avgOld = older.reduce((s, m) => s + (byMonth[m] || 0), 0) / older.length;
        const avgNew = recent.reduce((s, m) => s + (byMonth[m] || 0), 0) / recent.length;
        if (avgNew < 15 && avgOld < 15) continue; // ruido
        if (avgOld < 1) { if (avgNew > 30) rising.push({ cat, avgOld, avgNew, pct: null }); continue; }
        const pct = (avgNew - avgOld) / avgOld * 100;
        if (pct >= 20 && avgNew - avgOld >= 10) rising.push({ cat, avgOld, avgNew, pct });
        else if (pct <= -20 && avgOld - avgNew >= 10) falling.push({ cat, avgOld, avgNew, pct });
    }
    rising.sort((a, b) => (b.avgNew - b.avgOld) - (a.avgNew - a.avgOld));
    falling.sort((a, b) => (a.avgNew - a.avgOld) - (b.avgNew - b.avgOld));
    return { rising, falling, months, older, recent };
}

// --- 3) Gastos inusuales (últimos 60 días, muy por encima del patrón) ---
function findUnusual() {
    const cutoff = new Date(Date.now() - 60 * 86400000).toISOString().substring(0, 10);
    const byCat = {};
    realExpenses().forEach(t => {
        (byCat[t.category] = byCat[t.category] || []).push(Math.abs(t.amount));
    });
    const results = [];
    realExpenses().forEach(t => {
        if (t.date < cutoff) return;
        const amts = byCat[t.category];
        if (!amts || amts.length < 5) return;
        const med = median(amts);
        const amount = Math.abs(t.amount);
        if (amount >= Math.max(3 * med, 40) && amount >= 40) {
            results.push({ tx: t, ratio: amount / med, med });
        }
    });
    return results.sort((a, b) => b.ratio - a.ratio).slice(0, 6);
}

// --- 4) Fijos vs reducibles ---
const DEFAULT_FIXED = ['alquiler', 'telefonia', 'seguros'];
let fixedCategories = null;

async function getFixedCategories() {
    if (fixedCategories === null) {
        fixedCategories = await getSetting('fixed_categories') || DEFAULT_FIXED;
    }
    return fixedCategories;
}

window.toggleFixedCategory = async function(catId) {
    const fixed = await getFixedCategories();
    const idx = fixed.indexOf(catId);
    if (idx >= 0) fixed.splice(idx, 1); else fixed.push(catId);
    fixedCategories = fixed;
    await saveSetting('fixed_categories', fixed);
    refreshAnalysis();
};

// Medias mensuales por categoría sobre los últimos N meses completos.
function monthlyAverages(monthsWindow) {
    const months = getCompleteMonths().slice(-monthsWindow);
    const n = months.length || 1;
    const byCat = {};
    realExpenses().forEach(t => {
        if (!months.includes(t.month)) return;
        byCat[t.category] = (byCat[t.category] || 0) + Math.abs(t.amount);
    });
    for (const k of Object.keys(byCat)) byCat[k] /= n;

    let income = 0;
    allTransactions.forEach(t => {
        if (!months.includes(t.month)) return;
        if (refundedIds.has(t.id) || isNeutralCategory(t.category)) return;
        if (t.amount > 0 && isIncomeCategory(t.category)) income += t.amount;
    });
    return { byCat, avgIncome: income / n, months };
}

// --- Render principal ---
async function refreshAnalysis() {
    const container = document.getElementById('analysis-content');
    const months = getCompleteMonths();
    if (months.length === 0) {
        container.innerHTML = '<div class="empty-msg">Aún no hay meses completos de datos. Importa extractos primero.</div>';
        document.getElementById('goal-result').innerHTML = '';
        return;
    }

    const fixed = await getFixedCategories();
    const { byCat, avgIncome, months: windowMonths } = monthlyAverages(6);
    document.getElementById('analysis-period-hint').textContent =
        `Basado en tus últimos ${windowMonths.length} meses completos (${monthLabelOf(windowMonths[0])} – ${monthLabelOf(windowMonths[windowMonths.length - 1])}).`;

    let html = '';

    // ---- Recurrentes ----
    const recurring = detectRecurring();
    const activeRec = recurring.filter(r => r.active);
    const totalRec = activeRec.reduce((s, r) => s + r.monthly, 0);
    html += `<div class="analysis-section">
        <h3>🔁 Gastos recurrentes detectados</h3>
        <p class="analysis-sub">${activeRec.length
            ? `Pagas <strong>${formatCurrency(totalRec)}/mes</strong> en ${activeRec.length} gastos que se repiten solos.`
            : 'No se han detectado gastos recurrentes todavía.'}</p>`;
    if (recurring.length) {
        html += '<div class="analysis-list">' + recurring.map(r => {
            const info = getCategoryInfo(r.category);
            return `<div class="analysis-item">
                <span class="ai-title">
                    <span class="cat-dot" style="background:${info.color}"></span>${escapeHtml(r.label)}
                    <span class="badge ${r.cadence === 'mensual' ? 'badge-monthly' : 'badge-weekly'}">${r.cadence}</span>
                    ${r.active ? '' : '<span class="badge badge-off">sin cargos recientes</span>'}
                </span>
                <span class="ai-detail">${r.count} cargos · último el ${formatDateDisplay(r.lastDate)} · ${escapeHtml(info.label)}</span>
                <span class="ai-amount">${formatCurrency(r.monthly)}<small>/mes</small></span>
            </div>`;
        }).join('') + '</div>';
    }
    html += '</div>';

    // ---- Tendencias ----
    const trends = computeTrends();
    html += `<div class="analysis-section">
        <h3>📈 Tendencias</h3>
        <p class="analysis-sub">Comparando la media reciente con la de los meses anteriores.</p>`;
    if (trends.rising.length === 0 && trends.falling.length === 0) {
        html += `<div class="analysis-highlight">${trends.months.length < 4
            ? 'Necesito al menos 4 meses completos para detectar tendencias con fiabilidad.'
            : 'Sin cambios bruscos: tus gastos se mantienen estables. 👌'}</div>`;
    } else {
        html += '<div class="analysis-list">';
        trends.rising.forEach(r => {
            const info = getCategoryInfo(r.cat);
            html += `<div class="analysis-item">
                <span class="ai-title"><span class="cat-dot" style="background:${info.color}"></span>${escapeHtml(info.label)}
                    <span class="badge badge-up">▲ ${r.pct === null ? 'nuevo' : '+' + r.pct.toFixed(0) + '%'}</span></span>
                <span class="ai-detail">antes ${formatCurrency(r.avgOld)}/mes → ahora ${formatCurrency(r.avgNew)}/mes</span>
                <span class="ai-amount negative">+${formatCurrency(r.avgNew - r.avgOld)}<small>/mes</small></span>
            </div>`;
        });
        trends.falling.forEach(r => {
            const info = getCategoryInfo(r.cat);
            html += `<div class="analysis-item">
                <span class="ai-title"><span class="cat-dot" style="background:${info.color}"></span>${escapeHtml(info.label)}
                    <span class="badge badge-down">▼ ${r.pct.toFixed(0)}%</span></span>
                <span class="ai-detail">antes ${formatCurrency(r.avgOld)}/mes → ahora ${formatCurrency(r.avgNew)}/mes</span>
                <span class="ai-amount positive">−${formatCurrency(r.avgOld - r.avgNew)}<small>/mes</small></span>
            </div>`;
        });
        html += '</div>';
    }
    html += '</div>';

    // ---- Inusuales ----
    const unusual = findUnusual();
    html += `<div class="analysis-section">
        <h3>⚠️ Gastos fuera de lo normal <span class="stats-hint">(últimos 60 días)</span></h3>
        <p class="analysis-sub">Movimientos muy por encima de tu patrón habitual en su categoría.</p>`;
    if (unusual.length === 0) {
        html += '<div class="analysis-highlight">Nada raro últimamente. Todo dentro de tu patrón habitual. ✅</div>';
    } else {
        html += '<div class="analysis-list">' + unusual.map(u => {
            const info = getCategoryInfo(u.tx.category);
            return `<div class="analysis-item">
                <span class="ai-title"><span class="cat-dot" style="background:${info.color}"></span>${escapeHtml(u.tx.subcategory || info.label)}
                    <span class="badge badge-warn">×${u.ratio.toFixed(1)} de lo normal</span></span>
                <span class="ai-detail">${formatDateDisplay(u.tx.date)} · lo típico en ${escapeHtml(info.label)} son ${formatCurrency(u.med)}</span>
                <span class="ai-amount negative">${formatCurrency(u.tx.amount)}</span>
            </div>`;
        }).join('') + '</div>';
    }
    html += '</div>';

    // ---- Fijos vs reducibles ----
    const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const fixedTotal = cats.filter(([c]) => fixed.includes(c)).reduce((s, [, v]) => s + v, 0);
    const redTotal = cats.filter(([c]) => !fixed.includes(c)).reduce((s, [, v]) => s + v, 0);
    html += `<div class="analysis-section">
        <h3>🔒 Gastos fijos vs. reducibles</h3>
        <p class="analysis-sub">Toca una categoría para marcarla como fija (no se puede recortar) o reducible. Se usa en el simulador de abajo.</p>
        <div class="fixed-chips">` +
        cats.map(([c, v]) => {
            const info = getCategoryInfo(c);
            const isFixed = fixed.includes(c);
            return `<button class="fixed-chip ${isFixed ? 'is-fixed' : ''}" onclick="toggleFixedCategory('${c}')">
                <span class="chip-lock">${isFixed ? '🔒' : '✂️'}</span>${escapeHtml(info.label)} · ${formatCurrency(v)}/mes
            </button>`;
        }).join('') +
        `</div>
        <div class="stats-cards">
            <div class="stat-card"><span>Ingresos medios</span><strong class="positive">${formatCurrency(avgIncome)}</strong><em>/mes</em></div>
            <div class="stat-card"><span>Gastos fijos 🔒</span><strong>${formatCurrency(fixedTotal)}</strong><em>/mes</em></div>
            <div class="stat-card"><span>Gastos reducibles ✂️</span><strong>${formatCurrency(redTotal)}</strong><em>/mes</em></div>
            <div class="stat-card stat-card-hl"><span>Ahorro actual</span><strong class="${avgIncome - fixedTotal - redTotal >= 0 ? 'positive' : 'negative'}">${formatCurrency(avgIncome - fixedTotal - redTotal)}</strong><em>/mes</em></div>
        </div>
    </div>`;

    container.innerHTML = html;

    // Recalcular el simulador si ya había un objetivo puesto.
    const savedGoal = await getSetting('savings_goal');
    if (savedGoal && !document.getElementById('goal-input').value) {
        document.getElementById('goal-input').value = savedGoal;
    }
    if (document.getElementById('goal-input').value) runGoalSimulator();
}

// --- 5) Simulador de objetivo ---
async function runGoalSimulator() {
    const goal = parseFloat(document.getElementById('goal-input').value);
    const resultEl = document.getElementById('goal-result');
    if (isNaN(goal) || goal < 0) { resultEl.innerHTML = ''; return; }
    await saveSetting('savings_goal', goal);

    const fixed = await getFixedCategories();
    const { byCat, avgIncome } = monthlyAverages(6);
    const fixedTotal = Object.entries(byCat).filter(([c]) => fixed.includes(c)).reduce((s, [, v]) => s + v, 0);
    const reducibles = Object.entries(byCat).filter(([c]) => !fixed.includes(c)).sort((a, b) => b[1] - a[1]);
    const redTotal = reducibles.reduce((s, [, v]) => s + v, 0);
    const currentSavings = avgIncome - fixedTotal - redTotal;

    if (goal <= currentSavings) {
        resultEl.innerHTML = `<p class="goal-verdict">✅ <strong>Ya lo consigues.</strong> Con tus números actuales ahorras de media
            <strong>${formatCurrency(currentSavings)}/mes</strong> — ${formatCurrency(currentSavings - goal)} por encima de tu objetivo.</p>`;
        return;
    }

    const needed = goal - currentSavings;
    const maxPossible = avgIncome - fixedTotal; // recortándolo TODO

    if (needed > redTotal) {
        resultEl.innerHTML = `<p class="goal-verdict">❌ <strong>No alcanzable sin tocar los fijos.</strong>
            Te faltan ${formatCurrency(needed)}/mes, pero solo tienes ${formatCurrency(redTotal)}/mes en gastos reducibles.
            Eliminándolos TODOS llegarías a ahorrar como máximo <strong>${formatCurrency(maxPossible)}/mes</strong>.
            Para este objetivo necesitas subir ingresos o revisar los fijos.</p>`;
        return;
    }

    const factor = needed / redTotal;
    const rows = reducibles.filter(([, v]) => v >= 1).map(([c, v]) => {
        const info = getCategoryInfo(c);
        return `<div class="goal-row">
            <span><span class="cat-dot" style="background:${info.color}"></span> ${escapeHtml(info.label)}</span>
            <span>${formatCurrency(v)}</span>
            <span class="goal-cut">−${formatCurrency(v * factor)}</span>
            <span><strong>${formatCurrency(v * (1 - factor))}</strong></span>
        </div>`;
    }).join('');

    resultEl.innerHTML = `
        <p class="goal-verdict">🟡 <strong>Alcanzable.</strong> Ahorras ${formatCurrency(currentSavings)}/mes; te faltan
        <strong>${formatCurrency(needed)}/mes</strong>. Recortando un <strong>${(factor * 100).toFixed(0)}%</strong> de cada gasto reducible, lo consigues:</p>
        <div class="goal-table">
            <div class="goal-row goal-row-head"><span>Categoría</span><span>Gasto medio</span><span>Recorte</span><span>Objetivo</span></div>
            ${rows}
        </div>`;
}

document.getElementById('goal-btn').addEventListener('click', runGoalSimulator);
document.getElementById('goal-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') runGoalSimulator(); });

// ==================== ACCOUNTS ====================

async function refreshAccounts() {
    const sabAccount = await getSetting('sabadell_account');
    if (sabAccount) {
        document.getElementById('sabadell-account').textContent = sabAccount;
    }

    const sabBalance = await getSetting('sabadell_balance');
    if (sabBalance !== null && sabBalance !== undefined) {
        document.getElementById('sabadell-balance').textContent = formatCurrency(sabBalance);
    }

    const savings = await getSetting('savings_balance') || 3501.81;
    document.getElementById('savings-balance').textContent = formatCurrency(savings);

    const abanca = await getSetting('abanca_balance') || 0;
    document.getElementById('abanca-balance').textContent = formatCurrency(abanca);

    // Fecha del extracto del que sale cada saldo (transparencia: así se ve
    // enseguida si un saldo se quedó anticuado).
    const bd = await getSetting('balance_dates') || {};
    const dateLabel = (d) => d ? `Saldo a ${formatDateDisplay(d)}` : '';
    document.getElementById('sabadell-date').textContent = dateLabel(bd.sabadell);
    document.getElementById('savings-date').textContent = dateLabel(bd.savings);
    document.getElementById('abanca-date').textContent = dateLabel(bd.abanca);

    const nw = await getNetWorth();
    document.getElementById('traderepublic-balance').textContent = formatCurrency(nw.tr);
    document.getElementById('traderepublic-detail').textContent = nw.trFunds > 0
        ? `${formatCurrency(nw.trCash)} efectivo · ${formatCurrency(nw.trFunds)} en fondos`
        : '';

    const mi = await getMyInvestorTotal();
    // En Cuentas solo se editan los fondos de MyInvestor (los de TR van solos).
    const funds = (await getAllFunds()).filter(f => f.broker !== 'traderepublic');
    accountsFunds = funds;

    // Banner de patrimonio total
    document.getElementById('networth-total').textContent = formatCurrency(nw.total);
    document.getElementById('networth-breakdown').innerHTML = `
        <div class="nw-item"><span>Sabadell</span><strong>${formatCurrency(nw.sabadell)}</strong></div>
        <div class="nw-item"><span>Abanca</span><strong>${formatCurrency(nw.abanca)}</strong></div>
        <div class="nw-item"><span>Ahorro</span><strong>${formatCurrency(nw.savings)}</strong></div>
        <div class="nw-item"><span>Trade Republic</span><strong>${formatCurrency(nw.tr)}</strong></div>
        <div class="nw-item"><span>MyInvestor</span><strong>${formatCurrency(nw.mi)}</strong></div>`;

    document.getElementById('myinvestor-balance').textContent = formatCurrency(mi.total);
    document.getElementById('myinvestor-breakdown').textContent =
        `${formatCurrency(mi.cash)} efectivo · ${formatCurrency(mi.fundsValue)} en fondos`;

    const gain = mi.fundsValue - mi.invested;
    document.getElementById('myinvestor-summary').innerHTML = `
        <div class="mi-stat"><span>Efectivo parado</span><strong>${formatCurrency(mi.cash)}</strong></div>
        <div class="mi-stat"><span>Invertido en fondos</span><strong>${formatCurrency(mi.invested)}</strong></div>
        <div class="mi-stat"><span>Valor actual fondos</span><strong>${formatCurrency(mi.fundsValue)}</strong></div>
        <div class="mi-stat"><span>Ganancia / pérdida</span><strong class="${gain >= 0 ? 'positive' : 'negative'}">${gain >= 0 ? '+' : ''}${formatCurrency(gain)}</strong></div>
        <div class="mi-stat mi-stat-total"><span>Total MyInvestor</span><strong>${formatCurrency(mi.total)}</strong></div>`;

    const cashInput = document.getElementById('myinvestor-cash-input');
    cashInput.value = '';
    cashInput.placeholder = formatCurrency(mi.cash);

    const fundsList = document.getElementById('funds-list');
    if (funds.length > 0) {
        fundsList.innerHTML = funds.map((f, i) => {
            const cur = (f.currentValue != null) ? f.currentValue : null;
            const g = (cur != null) ? cur - (f.totalInvested || 0) : null;
            return `<div class="fund-item-row">
                <div class="fund-line">
                    <span class="fund-name">${escapeHtml(f.name)}</span>
                    <button class="cat-action-btn cat-action-del" title="Eliminar fondo" onclick="removeFund(${i})">&times;</button>
                </div>
                <div class="fund-figs">
                    <span class="fund-invested">${formatCurrency(f.totalInvested || 0)} invertido</span>
                    <span class="fund-current">${cur != null ? formatCurrency(cur) + ' actual' : 'valor sin definir'}</span>
                    ${g != null ? `<span class="fund-gain ${g >= 0 ? 'positive' : 'negative'}">${g >= 0 ? '+' : ''}${formatCurrency(g)}</span>` : ''}
                </div>
                <div class="fund-edit-row">
                    <input type="number" step="0.01" placeholder="Invertido €" class="fund-inv-input" data-idx="${i}">
                    <input type="number" step="0.01" placeholder="Valor actual €" class="fund-cur-input" data-idx="${i}">
                    <button class="btn-secondary btn-small" onclick="saveFundEdit(${i})">Actualizar</button>
                </div>
            </div>`;
        }).join('');
    } else {
        fundsList.innerHTML = '<p class="empty-msg" style="padding:8px 0;text-align:left;font-size:0.85rem">Aún no hay fondos. Añade uno abajo o importa un extracto de MyInvestor.</p>';
    }
}

let accountsFunds = [];

window.saveFundEdit = async function(i) {
    const f = accountsFunds[i];
    if (!f) return;
    const invEl = document.querySelector(`.fund-inv-input[data-idx="${i}"]`);
    const curEl = document.querySelector(`.fund-cur-input[data-idx="${i}"]`);
    const inv = parseFloat(invEl.value);
    const cur = parseFloat(curEl.value);
    if (!isNaN(inv)) { f.totalInvested = inv; f.manualInvested = true; }
    if (!isNaN(cur)) f.currentValue = cur;
    await saveFund(f);
    await refreshAccounts();
};

window.removeFund = async function(i) {
    const f = accountsFunds[i];
    if (!f) return;
    if (!confirm(`¿Eliminar el fondo "${f.name}"?`)) return;
    await deleteFund(f.name);
    await refreshAccounts();
};

// ==================== DRILLDOWN & RECATEGORIZE ====================

function showCategoryDrilldown(categoryId) {
    const txs = getFilteredTransactions(dashFilters).filter(t => t.category === categoryId && t.amount < 0 && !refundedIds.has(t.id));
    const catInfo = getCategoryInfo(categoryId);

    const bySub = {};
    txs.forEach(t => {
        if (!bySub[t.subcategory]) bySub[t.subcategory] = { total: 0, count: 0, transactions: [] };
        bySub[t.subcategory].total += Math.abs(t.amount);
        bySub[t.subcategory].count++;
        bySub[t.subcategory].transactions.push(t);
    });

    const sorted = Object.entries(bySub).sort((a, b) => b[1].total - a[1].total);

    let html = `<h3>${catInfo.label}</h3>
        <p class="modal-sub">Total: ${formatCurrency(-txs.reduce((s, t) => s + t.amount, 0))} en ${txs.length} movimientos</p>
        <div class="subcategory-list">
            ${sorted.map(([name, data]) => `
                <div class="subcat-item" onclick="showSubcategoryTransactions('${categoryId}', '${escapeHtml(name)}')">
                    <span class="subcat-name">${escapeHtml(name)}<span class="subcat-count">(${data.count})</span></span>
                    <span class="subcat-total">${formatCurrency(data.total)}</span>
                </div>
            `).join('')}
        </div>`;

    openModal(html);
}

window.showSubcategoryTransactions = function(categoryId, subcategory) {
    const txs = getFilteredTransactions(dashFilters)
        .filter(t => t.category === categoryId && t.subcategory === subcategory && !refundedIds.has(t.id))
        .sort((a, b) => b.date.localeCompare(a.date));

    const catInfo = getCategoryInfo(categoryId);

    let html = `<h3>${catInfo.label} — ${escapeHtml(subcategory)}</h3>
        <div style="margin-top:12px">
            ${txs.map(t => `
                <div class="tx-item" style="margin-bottom:4px">
                    <span class="tx-date">${formatDateDisplay(t.date)}</span>
                    <span class="tx-concept" title="${escapeHtml(t.concept)}">${escapeHtml(t.concept)}</span>
                    <span class="tx-category ${catInfo.cssClass}">${catInfo.label}</span>
                    <span class="tx-amount negative">${formatCurrency(t.amount)}</span>
                    <span></span>
                </div>
            `).join('')}
        </div>`;

    openModal(html);
};

window.showRecategorize = function(txId) {
    const tx = allTransactions.find(t => t.id === txId);
    if (!tx) return;

    const isIncome = tx.amount > 0;
    // Los ingresos también pueden marcarse como Bizum (recibido).
    const categories = isIncome
        ? [...getAllIncomeCategories(), { id: 'bizum', ...CATEGORIES.expense.bizum }]
        : getAllExpenseCategories();

    let html = `<h3>Recategorizar</h3>
        <p class="modal-sub">${escapeHtml(tx.concept)}</p>
        <div>
            ${categories.map(c => `
                <div class="category-option ${c.id === tx.category ? 'selected' : ''}">
                    <span class="cat-main" onclick="applyCategory(${txId}, '${c.id}')">
                        <span class="cat-dot" style="background:${c.color}"></span>
                        <span>${escapeHtml(c.label)}</span>
                    </span>
                    ${isCustomCategory(c.id) ? `
                        <span class="cat-actions">
                            <button class="cat-action-btn" title="Renombrar" onclick="event.stopPropagation();renameCustomCat('${c.id}')">&#9998;</button>
                            <button class="cat-action-btn cat-action-del" title="Eliminar categoría" onclick="event.stopPropagation();deleteCustomCat('${c.id}')">&times;</button>
                        </span>` : ''}
                </div>
            `).join('')}
        </div>
        <div class="modal-add-category">
            <input type="text" id="new-category-input" placeholder="Nueva categoría (ej. Peluquero)"
                   onkeydown="if(event.key==='Enter')createAndApplyCategory(${txId})">
            <button class="btn-primary" onclick="createAndApplyCategory(${txId})">Crear y aplicar</button>
        </div>
        <div class="modal-hide-action">
            ${tx.hidden
                ? `<button class="btn-secondary" onclick="setTransactionHidden(${txId}, false)">Mostrar de nuevo en la lista</button>`
                : `<button class="btn-danger" onclick="setTransactionHidden(${txId}, true)">Eliminar de la lista</button>
                   <p class="hide-note">Seguirá contando en el balance y las gráficas. Solo deja de aparecer en la lista.</p>`}
        </div>`;

    openModal(html);
};

window.setTransactionHidden = async function(txId, hidden) {
    await updateTransaction(txId, { hidden });
    await reloadTransactions();
    closeModal();
    if (currentView === 'transactions') refreshTransactions();
};

window.toggleShowHidden = function() {
    showHidden = !showHidden;
    refreshTransactions();
};

window.createAndApplyCategory = async function(txId) {
    const input = document.getElementById('new-category-input');
    if (!input) return;
    const label = input.value.trim();
    if (!label) { input.focus(); return; }

    const tx = allTransactions.find(t => t.id === txId);
    const type = (tx && tx.amount > 0) ? 'income' : 'expense';
    const newId = addCustomCategory(label, type);
    if (!newId) { input.focus(); return; }

    // Persistir la categoría propia para que sobreviva recargas.
    await saveSetting('custom_categories', getCustomCategories());
    // Aplicarla (esto también la "aprende" por concepto y refresca la vista).
    await applyCategory(txId, newId);
};

window.renameCustomCat = async function(catId) {
    const current = getCategoryInfo(catId).label;
    const newLabel = prompt('Nuevo nombre para la categoría:', current);
    if (newLabel === null) return; // cancelado
    const trimmed = newLabel.trim();
    if (!trimmed || !renameCustomCategory(catId, trimmed)) return;

    await saveSetting('custom_categories', getCustomCategories());
    // Actualizar la subcategoría mostrada en los movimientos que la usan.
    const affected = allTransactions.filter(t => t.category === catId);
    for (const t of affected) {
        await updateTransaction(t.id, { subcategory: trimmed });
    }
    await reloadTransactions();
    closeModal();
    if (currentView === 'dashboard') refreshDashboard();
    if (currentView === 'transactions') refreshTransactions();
};

window.deleteCustomCat = async function(catId) {
    if (!confirm('¿Eliminar esta categoría? Los movimientos que la usaban se reclasificarán automáticamente.')) return;

    const affected = allTransactions.filter(t => t.category === catId);
    deleteCustomCategory(catId);
    await saveSetting('custom_categories', getCustomCategories());
    await saveSetting('learned_rules', getLearnedRules());

    // Reclasificar los movimientos afectados (vuelven a las reglas automáticas).
    for (const t of affected) {
        const { category, subcategory } = categorize(t.concept, t.amount);
        await updateTransaction(t.id, { category, subcategory, manualCategory: false });
    }
    await reloadTransactions();
    closeModal();
    if (currentView === 'dashboard') refreshDashboard();
    if (currentView === 'transactions') refreshTransactions();
};

window.applyCategory = async function(txId, newCategory) {
    const tx = allTransactions.find(t => t.id === txId);
    const catInfo = getCategoryInfo(newCategory);

    if (tx) {
        // Aprender la regla por concepto (afecta a futuras importaciones).
        learnCategory(tx.concept, newCategory);
        await saveSetting('learned_rules', getLearnedRules());

        // Aplicar también de forma retroactiva a TODOS los movimientos del
        // mismo sitio (mismo concepto normalizado), no solo al editado.
        const key = conceptKey(tx.concept);
        const sameSite = allTransactions.filter(t => conceptKey(t.concept) === key);
        for (const t of sameSite) {
            await updateTransaction(t.id, { category: newCategory, subcategory: catInfo.label, manualCategory: true });
        }
    } else {
        await updateTransaction(txId, { category: newCategory, subcategory: catInfo.label, manualCategory: true });
    }

    await reloadTransactions();
    closeModal();
    if (currentView === 'dashboard') refreshDashboard();
    if (currentView === 'transactions') refreshTransactions();
};

// ==================== HELPERS ====================

function formatDateDisplay(dateStr) {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ==================== INIT ====================

(async function init() {
    await openDB();
    const learned = await getSetting('learned_rules');
    if (learned) setLearnedRules(learned);

    const customCats = await getSetting('custom_categories');
    if (customCats) setCustomCategories(customCats);

    // ¿Hay servidor local (= estamos en el PC)? En el móvil no lo hay.
    let hasServer = false;
    try { const r = await fetch('/api/extractos', { cache: 'no-store' }); hasServer = r.ok; } catch (e) { /* móvil */ }

    // Migración/limpieza al arrancar — SOLO en el PC y con las reglas privadas
    // cargadas. En el móvil los datos llegan ya limpios por sincronización, y
    // recategorizar sin las reglas privadas los estropearía.
    if (hasServer && window.PRIVATE_RULES_LOADED) {
        try {
            const txs = await getAllTransactions();
            let deleted = 0, updated = 0;
            for (const t of txs) {
                if (isInternalTransfer(t.concept)) {
                    await deleteTransaction(t.id);
                    deleted++;
                    continue;
                }
                if (t.manualCategory) continue;
                const { category, subcategory } = categorize(t.concept, t.amount);
                if (category !== t.category || subcategory !== t.subcategory) {
                    await updateTransaction(t.id, { category, subcategory });
                    updated++;
                }
            }
            if (deleted || updated) console.log(`Migración: ${deleted} internos eliminados, ${updated} recategorizados`);
        } catch (err) {
            console.error('Migration error:', err);
        }
    }

    // Migrate old fund format: if funds exist without purchases array, recalculate from extractos
    const existingFunds = await getAllFunds();
    const needsMigration = hasServer && existingFunds.some(f => !f.purchases);
    if (needsMigration) {
        try {
            const resp = await fetch('/api/extractos');
            if (resp.ok) {
                const files = await resp.json();
                for (const f of files) {
                    const fResp = await fetch(`/api/extracto/${encodeURIComponent(f.name)}`);
                    const buf = await fResp.arrayBuffer();
                    const source = detectSourceFromBuffer(buf);
                    if (source === 'myinvestor') {
                        const result = parseArrayBuffer(buf);
                        if (result.funds) {
                            for (const fund of result.funds) {
                                const old = existingFunds.find(ef => ef.name === fund.name);
                                await saveFund({
                                    name: fund.name,
                                    purchases: fund.purchases || [],
                                    totalInvested: (fund.purchases || []).reduce((s, p) => s + p.amount, 0),
                                    currentValue: (old && old.currentValue) || null,
                                });
                            }
                        }
                    }
                }
                console.log('Funds migrated to new format');
            }
        } catch (err) {
            console.error('Fund migration error:', err);
        }
    }

    await loadData();
    const savings = await getSetting('savings_balance');
    if (savings === null) {
        await saveSetting('savings_balance', 3501.81);
    }
    // Trade Republic: el saldo se calcula del CSV; solo ponemos un valor inicial
    // la primera vez para que la tarjeta no salga a cero.
    const tr = await getSetting('traderepublic_balance');
    if (tr === null || tr === undefined) {
        await saveSetting('traderepublic_balance', 0);
    }

    // Puesta al día de MyInvestor (agosto 2026): efectivo y fondos declarados a mano,
    // porque su web no da un extracto con el valor actual. Se aplica una sola vez.
    if (!(await getSetting('mi_update_2026_08'))) {
        try {
            await saveSetting('myinvestor_cash', 1353.82);
            const declared = [
                { match: /ISHARES US/i,    name: 'ISHARES US INDEX FUND IE S EUR',   invested: 780.25, value: 885.20 },
                { match: /ISHARES EMERG/i, name: 'ISHARES EMERGING MARKETS INDEX',   invested: 420.00, value: 421.90 },
                { match: /VANGUARD/i,      name: 'VANGUARD EUROPEAN STOCK EUR IN',   invested: 388.90, value: 417.63 },
            ];
            const existing = await getAllFunds();
            for (const d of declared) {
                const prev = existing.find(f => f.broker !== 'traderepublic' && d.match.test(f.name));
                await saveFund({
                    name: prev ? prev.name : d.name,
                    purchases: prev ? (prev.purchases || []) : [],
                    totalInvested: d.invested,
                    currentValue: d.value,
                    manualInvested: true,
                });
            }
            await saveSetting('mi_update_2026_08', true);
            console.log('MyInvestor actualizado con los datos declarados.');
        } catch (err) {
            console.error('MyInvestor update error:', err);
        }
    }

    // Prellenar los campos de sincronización con lo guardado.
    const syncUrl = await getSetting('sync_url');
    const syncRemember = await getSetting('sync_remember');
    const syncPass = await getSetting('sync_passphrase');
    const syncAuto = await getSetting('sync_auto');
    if (syncUrl) document.getElementById('sync-url').value = syncUrl;
    if (syncRemember) document.getElementById('sync-remember').checked = true;
    if ((syncRemember || syncAuto) && syncPass) document.getElementById('sync-pass').value = syncPass;
    if (syncAuto) document.getElementById('sync-auto').checked = true;

    // En el móvil (sin servidor), cargar los datos de la sincronización solos.
    if (!hasServer && syncUrl && syncRemember && syncPass) {
        try {
            await loadFromSync(syncUrl, syncPass, null);
            console.log('Datos cargados por sincronización (modo móvil).');
        } catch (e) {
            console.error('Auto-sincronización falló:', e);
        }
    }

    // Al abrir la app en el PC, recalcular los saldos desde los extractos de la
    // carpeta. Así un saldo mal guardado por una versión anterior se corrige solo,
    // sin tener que entrar en la pestaña Extractos.
    if (hasServer) {
        try {
            const resp = await fetch('/api/extractos', { cache: 'no-store' });
            if (resp.ok) {
                await refreshBalancesFromFiles(await resp.json());
                if (currentView === 'accounts') await refreshAccounts();
                refreshDashboard();
            }
        } catch (err) {
            console.error('No se pudieron recalcular los saldos al arrancar:', err);
        }
    }

    // Activar la auto-publicación SOLO en el PC (fuente de la verdad).
    if (hasServer) {
        onDataChanged = scheduleAutoPublish;
    }
})();
