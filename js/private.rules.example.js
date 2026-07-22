// ============================================================================
// PLANTILLA de reglas personales. Copia este archivo como js/private.rules.js
// y añade tus propios patrones (nombres, cuentas...). js/private.rules.js está
// en .gitignore y nunca se sube al repositorio.
// ============================================================================

// Transferencias internas entre tus propias cuentas (ni ingreso ni gasto):
// INTERNAL_PATTERNS.push(
//     /TRANSFERENCIA.*TU NOMBRE/i,
//     /TRASPASO\s+1234/i
// );

// Reglas de categorización personales (prioridad sobre las genéricas):
// CATEGORY_RULES.unshift(
//     { pattern: /NOMBRE DE TU CASERO/i, category: 'alquiler', subcategory: 'Alquiler piso' },
//     { pattern: /NOMINA.*TU EMPRESA/i, category: 'nomina', subcategory: 'Nómina' }
// );

window.PRIVATE_RULES_LOADED = true;
