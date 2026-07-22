let allTransactions = [];
let currentView = 'dashboard';
// Filtros INDEPENDIENTES por vista (antes estaban vinculados).
// year: 'all' = Total (todo el tiempo). month: 'all' = todo el año, o '01'..'12'.
let dashFilters = { year: 'all', month: 'all' };
let txFilters = { year: 'all', month: 'all', category: 'all', search: '' };
let showHidden = false;
// Ids de movimientos que son compra+devolución emparejadas (no cuentan en totales).
let refundedIds = new Set();

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

            const sourceLabel = sourceGuess === 'sabadell' ? 'Sabadell' :
                                sourceGuess === 'myinvestor' ? 'MyInvestor' : 'Auto-detectar';
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

async function refreshBalancesFromFiles(files) {
    // Para cada tipo de cuenta, gana el saldo del extracto con la FECHA DE
    // MOVIMIENTO más reciente (no la fecha del archivo). Así, añadir extractos
    // históricos (p. ej. de 2025) no pisa el saldo actual.
    const best = {
        sabadell: { date: '', bal: null, acct: '' },
        savings: { date: '', bal: null },
        myinvestor: { date: '', bal: null },
    };

    for (const f of files) {
        try {
            const buf = await (await fetch(`/api/extracto/${encodeURIComponent(f.name)}`)).arrayBuffer();
            const info = extractBalancesOnly(buf);
            const d = info.latestDate || '';
            if (info.sabadellBalance !== null && d >= best.sabadell.date) {
                best.sabadell = { date: d, bal: info.sabadellBalance, acct: info.accountNumber || best.sabadell.acct };
            }
            if (info.savingsBalance !== null && d >= best.savings.date) {
                best.savings = { date: d, bal: info.savingsBalance };
            }
            if (info.myinvestorBalance !== null && d >= best.myinvestor.date) {
                best.myinvestor = { date: d, bal: info.myinvestorBalance };
            }
        } catch (err) {
            console.error(`Error refreshing balance from ${f.name}:`, err);
        }
    }

    if (best.sabadell.bal !== null) {
        if (best.sabadell.acct) await saveSetting('sabadell_account', best.sabadell.acct);
        await saveSetting('sabadell_balance', best.sabadell.bal);
    }
    if (best.savings.bal !== null) await saveSetting('savings_balance', best.savings.bal);
    if (best.myinvestor.bal !== null) await saveSetting('myinvestor_balance', best.myinvestor.bal);
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
    let sabadellDate = '';
    let savingsDate = '';
    const newFileNames = [];

    for (const f of files) {
        if (importedSet.has(f.name)) continue;
        newFileNames.push(f.name);

        statusEl.innerHTML = `<span class="status-info">Importando ${escapeHtml(f.name)}...</span>`;

        try {
            const resp = await fetch(`/api/extracto/${encodeURIComponent(f.name)}`);
            const buf = await resp.arrayBuffer();
            const result = parseArrayBuffer(buf);
            const d = result.latestDate || '';

            allParsed.push(...result.transactions);
            if (result.funds) allFunds.push(...result.funds);
            if (result.accountBalance) myinvestorBalance = result.accountBalance;
            // Entre extractos del mismo tipo, gana el de fecha de movimiento más reciente.
            if (result.isSavings) {
                if (result.savingsBalance != null && d >= savingsDate) { savingsBalance = result.savingsBalance; savingsDate = d; }
            } else {
                if (result.sabadellBalance != null && d >= sabadellDate) { sabadellBalance = result.sabadellBalance; sabadellDate = d; if (result.accountNumber) accountNum = result.accountNumber; }
            }
        } catch (err) {
            console.error(`Error parsing ${f.name}:`, err);
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
    let sabadellDate = '';
    let savingsDate = '';

    for (const file of files) {
        try {
            const result = await parseFile(file);
            const d = result.latestDate || '';
            allParsed.push(...result.transactions);
            if (result.funds) allFunds.push(...result.funds);
            if (result.accountBalance) myinvestorBalance = result.accountBalance;
            if (result.isSavings) {
                if (result.savingsBalance != null && d >= savingsDate) { savingsBalance = result.savingsBalance; savingsDate = d; }
            } else {
                if (result.sabadellBalance != null && d >= sabadellDate) { sabadellBalance = result.sabadellBalance; sabadellDate = d; if (result.accountNumber) accountNum = result.accountNumber; }
            }
        } catch (err) {
            console.error('Error parsing file:', err);
            alert(`Error al leer ${file.name}: ${err.message}`);
        }
    }

    if (allParsed.length === 0 && allFunds.length === 0 && savingsBalance === null) {
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

    pendingImport = { transactions: newTx, duplicates, funds: allFunds, accountNumber: accountNum, myinvestorBalance, sabadellBalance, savingsBalance };
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
        }).join('') + (data.transactions.length > 30 ? `<div style="text-align:center;padding:12px;color:#8888aa">... y ${data.transactions.length - 30} movimientos más</div>` : '');
    } else {
        txPreview.innerHTML = '<div style="text-align:center;padding:20px;color:#8888aa">Todos los movimientos ya estaban importados.</div>';
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
}

// ==================== DASHBOARD ====================

// Resumen de MyInvestor: efectivo parado, invertido, valor actual y total.
async function getMyInvestorTotal() {
    let cash = await getSetting('myinvestor_cash');
    if (cash === null || cash === undefined) cash = await getSetting('myinvestor_balance') || 0;
    const funds = await getAllFunds();
    const fundsValue = funds.reduce((s, f) => s + (f.currentValue != null ? f.currentValue : (f.totalInvested || 0)), 0);
    const invested = funds.reduce((s, f) => s + (f.totalInvested || 0), 0);
    return { cash, fundsValue, invested, total: cash + fundsValue };
}

// Patrimonio total = cuenta corriente + ahorro + Trade Republic + MyInvestor.
async function getNetWorth() {
    const checking = await getSetting('sabadell_balance') || 0;
    const savings = await getSetting('savings_balance') || 0;
    const tr = await getSetting('traderepublic_balance') || 0;
    const mi = (await getMyInvestorTotal()).total;
    // "Ahorro/inversión" agrupa todo lo que no es la cuenta corriente del día a día.
    const savingsTotal = savings + tr + mi;
    return { checking, savings, tr, mi, savingsTotal, total: checking + savingsTotal };
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
        container.innerHTML = hiddenBar + '<div style="text-align:center;padding:40px;color:#8888aa">No hay movimientos. Ve a la pestaña "Extractos" para importar datos.</div>';
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
                ${refunded ? '<span class="tx-badge-cancel">cancelado</span>' : `<span class="tx-category ${catInfo.cssClass}" onclick="showRecategorize(${t.id})">${catInfo.label}</span>`}
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

    const tr = await getSetting('traderepublic_balance') || 0;
    document.getElementById('traderepublic-balance').textContent = formatCurrency(tr);

    const mi = await getMyInvestorTotal();
    const funds = await getAllFunds();
    accountsFunds = funds;

    // Banner de patrimonio total
    const nw = await getNetWorth();
    document.getElementById('networth-total').textContent = formatCurrency(nw.total);
    document.getElementById('networth-breakdown').innerHTML = `
        <div class="nw-item"><span>Cuenta corriente</span><strong>${formatCurrency(nw.checking)}</strong></div>
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
        fundsList.innerHTML = '<p style="color:#8888aa;font-size:0.85rem">Aún no hay fondos. Añade uno abajo o importa un extracto de MyInvestor.</p>';
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
        <p style="color:#8888aa;margin-bottom:16px">Total: ${formatCurrency(-txs.reduce((s, t) => s + t.amount, 0))} en ${txs.length} movimientos</p>
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
        <p style="color:#8888aa;margin-bottom:16px;font-size:0.85rem">${escapeHtml(tx.concept)}</p>
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
    // Trade Republic: 3.000 € ya invertidos (valor inicial, editable en Cuentas).
    const tr = await getSetting('traderepublic_balance');
    if (tr === null || tr === undefined) {
        await saveSetting('traderepublic_balance', 3000);
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

    // Activar la auto-publicación SOLO en el PC (fuente de la verdad).
    if (hasServer) {
        onDataChanged = scheduleAutoPublish;
    }
})();
