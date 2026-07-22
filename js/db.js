const DB_NAME = 'MiFinanzasDB';
const DB_VERSION = 1;

let db = null;

// Callback que app.js registra para auto-publicar la sincronización tras
// cualquier cambio de datos (movimientos, fondos, ajustes no-sync).
let onDataChanged = null;
function _notifyChange() {
    if (typeof onDataChanged === 'function') onDataChanged();
}

function openDB() {
    return new Promise((resolve, reject) => {
        if (db) return resolve(db);
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (e) => {
            const d = e.target.result;

            if (!d.objectStoreNames.contains('transactions')) {
                const txStore = d.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
                txStore.createIndex('date', 'date');
                txStore.createIndex('category', 'category');
                txStore.createIndex('hash', 'hash', { unique: true });
                txStore.createIndex('source', 'source');
                txStore.createIndex('month', 'month');
            }

            if (!d.objectStoreNames.contains('accounts')) {
                d.createObjectStore('accounts', { keyPath: 'id' });
            }

            if (!d.objectStoreNames.contains('funds')) {
                d.createObjectStore('funds', { keyPath: 'name' });
            }

            if (!d.objectStoreNames.contains('settings')) {
                d.createObjectStore('settings', { keyPath: 'key' });
            }
        };

        req.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
        };
        req.onerror = (e) => reject(e.target.error);
    });
}

function txHash(date, concept, amount) {
    const str = `${date}|${concept.trim()}|${amount}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + c;
        hash |= 0;
    }
    return hash.toString(36) + '_' + str.length;
}

async function addTransactions(transactions) {
    const d = await openDB();
    const tx = d.transaction('transactions', 'readwrite');
    const store = tx.objectStore('transactions');
    const added = [];
    const duplicates = [];

    for (const t of transactions) {
        try {
            await new Promise((resolve, reject) => {
                const req = store.add(t);
                req.onsuccess = () => { added.push(t); resolve(); };
                req.onerror = (e) => {
                    if (e.target.error.name === 'ConstraintError') {
                        duplicates.push(t);
                        e.preventDefault();
                        resolve();
                    } else {
                        reject(e.target.error);
                    }
                };
            });
        } catch (err) {
            duplicates.push(t);
        }
    }

    if (added.length > 0) _notifyChange();
    return { added, duplicates };
}

async function getAllTransactions() {
    const d = await openDB();
    return new Promise((resolve, reject) => {
        const tx = d.transaction('transactions', 'readonly');
        const store = tx.objectStore('transactions');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

async function updateTransaction(id, updates) {
    const d = await openDB();
    return new Promise((resolve, reject) => {
        const tx = d.transaction('transactions', 'readwrite');
        const store = tx.objectStore('transactions');
        const getReq = store.get(id);
        getReq.onsuccess = () => {
            const record = getReq.result;
            if (!record) return reject(new Error('Not found'));
            Object.assign(record, updates);
            const putReq = store.put(record);
            putReq.onsuccess = () => { _notifyChange(); resolve(record); };
            putReq.onerror = (e) => reject(e.target.error);
        };
    });
}

async function deleteTransaction(id) {
    const d = await openDB();
    return new Promise((resolve, reject) => {
        const tx = d.transaction('transactions', 'readwrite');
        tx.objectStore('transactions').delete(id);
        tx.oncomplete = () => { _notifyChange(); resolve(); };
        tx.onerror = (e) => reject(e.target.error);
    });
}

async function getExistingHashes() {
    const d = await openDB();
    return new Promise((resolve, reject) => {
        const tx = d.transaction('transactions', 'readonly');
        const store = tx.objectStore('transactions');
        const index = store.index('hash');
        const hashes = new Set();
        const req = index.openKeyCursor();
        req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                hashes.add(cursor.key);
                cursor.continue();
            } else {
                resolve(hashes);
            }
        };
        req.onerror = (e) => reject(e.target.error);
    });
}

async function saveSetting(key, value) {
    const d = await openDB();
    return new Promise((resolve, reject) => {
        const tx = d.transaction('settings', 'readwrite');
        const store = tx.objectStore('settings');
        store.put({ key, value });
        tx.oncomplete = () => {
            // Los ajustes sync_* son de configuración del propio dispositivo:
            // no cuentan como "datos cambiados" (evita bucles de publicación).
            if (!String(key).startsWith('sync_')) _notifyChange();
            resolve();
        };
        tx.onerror = (e) => reject(e.target.error);
    });
}

async function getSetting(key) {
    const d = await openDB();
    return new Promise((resolve, reject) => {
        const tx = d.transaction('settings', 'readonly');
        const store = tx.objectStore('settings');
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : null);
        req.onerror = (e) => reject(e.target.error);
    });
}

async function saveFund(fund) {
    const d = await openDB();
    return new Promise((resolve, reject) => {
        const tx = d.transaction('funds', 'readwrite');
        tx.objectStore('funds').put(fund);
        tx.oncomplete = () => { _notifyChange(); resolve(); };
        tx.onerror = (e) => reject(e.target.error);
    });
}

async function getAllFunds() {
    const d = await openDB();
    return new Promise((resolve, reject) => {
        const tx = d.transaction('funds', 'readonly');
        const req = tx.objectStore('funds').getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

async function getAllSettings() {
    const d = await openDB();
    return new Promise((resolve, reject) => {
        const tx = d.transaction('settings', 'readonly');
        const req = tx.objectStore('settings').getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

async function clearStore(name) {
    const d = await openDB();
    return new Promise((resolve, reject) => {
        const tx = d.transaction(name, 'readwrite');
        tx.objectStore(name).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}

// Restaura una copia completa: limpia y reescribe transacciones, fondos y ajustes.
// La configuración de sincronización (sync_*) es propia de CADA dispositivo y
// se conserva — si no, el móvil olvidaría su URL/contraseña tras cada sync.
async function restoreBackup(data) {
    const d = await openDB();
    const deviceSettings = (await getAllSettings()).filter(s => String(s.key).startsWith('sync_'));
    await clearStore('transactions');
    await clearStore('funds');
    await clearStore('settings');
    return new Promise((resolve, reject) => {
        const tx = d.transaction(['transactions', 'funds', 'settings'], 'readwrite');
        (data.transactions || []).forEach(t => tx.objectStore('transactions').put(t));
        (data.funds || []).forEach(f => tx.objectStore('funds').put(f));
        (data.settings || []).forEach(s => {
            if (!String(s.key).startsWith('sync_')) tx.objectStore('settings').put(s);
        });
        deviceSettings.forEach(s => tx.objectStore('settings').put(s));
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}

async function deleteFund(name) {
    const d = await openDB();
    return new Promise((resolve, reject) => {
        const tx = d.transaction('funds', 'readwrite');
        tx.objectStore('funds').delete(name);
        tx.oncomplete = () => { _notifyChange(); resolve(); };
        tx.onerror = (e) => reject(e.target.error);
    });
}
