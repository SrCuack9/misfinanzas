// Cifrado extremo a extremo para las copias/sincronización.
// AES-GCM 256 con clave derivada de tu contraseña (PBKDF2). Todo en el navegador:
// ni el servidor, ni Google Drive, ni nadie sin tu contraseña puede leer los datos.

const CRYPTO_ITERATIONS = 150000;

function _b64(buf) {
    // Por bloques: con datos grandes, esparcir todo el array como argumentos
    // (String.fromCharCode(...bytes)) desborda la pila de llamadas.
    const bytes = new Uint8Array(buf);
    const CHUNK = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}
function _unb64(str) {
    return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

async function _deriveKey(passphrase, salt) {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: CRYPTO_ITERATIONS, hash: 'SHA-256' },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

// Devuelve un objeto JSON auto-descriptivo con el contenido cifrado.
async function encryptPayload(obj, passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await _deriveKey(passphrase, salt);
    const data = new TextEncoder().encode(JSON.stringify(obj));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    return {
        app: 'MisFinanzas',
        encrypted: true,
        v: 1,
        salt: _b64(salt),
        iv: _b64(iv),
        data: _b64(ct),
    };
}

async function decryptPayload(envelope, passphrase) {
    if (!envelope || !envelope.encrypted) throw new Error('El archivo no está cifrado.');
    const salt = _unb64(envelope.salt);
    const iv = _unb64(envelope.iv);
    const key = await _deriveKey(passphrase, salt);
    let plain;
    try {
        plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, _unb64(envelope.data));
    } catch (e) {
        throw new Error('Contraseña incorrecta o archivo dañado.');
    }
    return JSON.parse(new TextDecoder().decode(plain));
}
