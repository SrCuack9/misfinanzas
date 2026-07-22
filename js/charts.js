Chart.defaults.color = '#66708a';
Chart.defaults.borderColor = '#e4e8f1';
Chart.defaults.font.family = "'Segoe UI Variable Text', 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif";

// Tooltip claro coherente con el tema
const LIGHT_TOOLTIP = {
    backgroundColor: '#ffffff',
    titleColor: '#1b2437',
    bodyColor: '#3d4966',
    footerColor: '#66708a',
    borderColor: '#e4e8f1',
    borderWidth: 1,
    padding: 12,
    cornerRadius: 10,
    boxPadding: 4,
    titleFont: { weight: 'bold' },
};

let donutChart = null;
let horizontalChart = null;
let monthlyChart = null;
let comparisonChart = null;
let statsChart = null;

// Categorías ocultadas manualmente en el gráfico de barras (clic para ocultar).
let hiddenBarCats = new Set();

function formatCurrency(val) {
    const abs = Math.abs(val);
    const formatted = abs.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (val < 0 ? '-' : '') + formatted + ' €';
}

function destroyCharts() {
    if (donutChart) { donutChart.destroy(); donutChart = null; }
    if (horizontalChart) { horizontalChart.destroy(); horizontalChart = null; }
    if (monthlyChart) { monthlyChart.destroy(); monthlyChart = null; }
}

// Evolución mensual de una categoría (o del total) con línea de promedio.
function renderStatsChart(canvasId, labels, values, color, seriesLabel, avg) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (statsChart) { statsChart.destroy(); statsChart = null; }

    statsChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    type: 'bar',
                    label: seriesLabel,
                    data: values,
                    backgroundColor: color + 'B3', // ~70% opacidad
                    borderRadius: 6,
                    order: 2,
                },
                {
                    type: 'line',
                    label: 'Promedio',
                    data: labels.map(() => avg),
                    borderColor: '#4f46e5',
                    borderWidth: 2,
                    borderDash: [6, 4],
                    pointRadius: 0,
                    fill: false,
                    order: 1,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { usePointStyle: true, pointStyle: 'circle' } },
                tooltip: { ...LIGHT_TOOLTIP, callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}` } }
            },
            scales: {
                y: { ticks: { callback: (v) => formatCurrency(v) }, grid: { color: '#eceff5' } },
                x: { grid: { display: false } }
            }
        }
    });
}

// Gráfico de barras agrupadas para comparar dos periodos por categoría.
function renderComparisonChart(canvasId, labels, seriesA, seriesB, nameA, nameB) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (comparisonChart) { comparisonChart.destroy(); comparisonChart = null; }

    comparisonChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: nameA, data: seriesA, backgroundColor: 'rgba(79,70,229,0.8)', borderRadius: 6 },
                { label: nameB, data: seriesB, backgroundColor: 'rgba(14,165,233,0.8)', borderRadius: 6 },
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { usePointStyle: true, pointStyle: 'circle' } },
                tooltip: { ...LIGHT_TOOLTIP, callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}` } }
            },
            scales: {
                y: { ticks: { callback: (v) => formatCurrency(v) }, grid: { color: '#eceff5' } },
                x: { grid: { display: false } }
            }
        }
    });
}

function renderDonutChart(transactions, onClickCategory) {
    const canvas = document.getElementById('chart-donut');
    if (donutChart) donutChart.destroy();

    const expenses = transactions.filter(t => t.amount < 0 && !isIncomeCategory(t.category) && !isNeutralCategory(t.category));
    const byCategory = {};
    expenses.forEach(t => {
        if (!byCategory[t.category]) byCategory[t.category] = 0;
        byCategory[t.category] += Math.abs(t.amount);
    });

    const sorted = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
    const labels = sorted.map(([id]) => getCategoryInfo(id).label);
    const data = sorted.map(([, v]) => v);
    const colors = sorted.map(([id]) => getCategoryInfo(id).color);
    const categoryIds = sorted.map(([id]) => id);

    donutChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors,
                borderColor: '#ffffff',
                borderWidth: 2,
                hoverOffset: 22,
                hoverBorderColor: '#ffffff',
                hoverBorderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '58%',
            animation: { animateRotate: true, animateScale: false },
            plugins: {
                legend: { position: 'right', labels: { padding: 12, usePointStyle: true, pointStyle: 'circle' } },
                tooltip: {
                    ...LIGHT_TOOLTIP,
                    bodyFont: { size: 14 },
                    displayColors: true,
                    callbacks: {
                        label: (ctx) => {
                            const total = data.reduce((a, b) => a + b, 0);
                            const pct = ((ctx.raw / total) * 100).toFixed(1);
                            return `  ${formatCurrency(ctx.raw)}  ·  ${pct}%`;
                        }
                    }
                }
            },
            onClick: (e, elements) => {
                if (elements.length > 0 && onClickCategory) {
                    onClickCategory(categoryIds[elements[0].index]);
                }
            }
        }
    });
}

let lastBarsTransactions = [];

function renderHorizontalBars(transactions) {
    lastBarsTransactions = transactions;
    const canvas = document.getElementById('chart-horizontal-bars');
    if (horizontalChart) horizontalChart.destroy();

    const expenses = transactions.filter(t => t.amount < 0 && !isIncomeCategory(t.category) && !isNeutralCategory(t.category));
    const byCategory = {};
    expenses.forEach(t => {
        if (!byCategory[t.category]) byCategory[t.category] = 0;
        byCategory[t.category] += Math.abs(t.amount);
    });

    // Quitar las categorías ocultadas manualmente para que el eje se reajuste.
    const sortedAll = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
    const sorted = sortedAll.filter(([id]) => !hiddenBarCats.has(id)).slice(0, 12);
    const labels = sorted.map(([id]) => getCategoryInfo(id).label);
    const data = sorted.map(([, v]) => v);
    const colors = sorted.map(([id]) => getCategoryInfo(id).color);
    const ids = sorted.map(([id]) => id);

    horizontalChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{ data, backgroundColor: colors, borderRadius: 6, barThickness: 22 }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...LIGHT_TOOLTIP,
                    footerFont: { size: 10, weight: 'normal' },
                    callbacks: {
                        label: (ctx) => formatCurrency(ctx.raw),
                        footer: () => 'Clic para ocultar',
                    }
                }
            },
            onClick: (e, elements) => {
                if (elements.length > 0) {
                    hiddenBarCats.add(ids[elements[0].index]);
                    renderHorizontalBars(lastBarsTransactions);
                }
            },
            scales: {
                x: {
                    ticks: { callback: (v) => formatCurrency(v) },
                    grid: { color: '#eceff5' }
                },
                y: { grid: { display: false } }
            }
        }
    });

    renderHiddenBarChips(sortedAll);
}

function renderHiddenBarChips(sortedAll) {
    const container = document.getElementById('bars-hidden-chips');
    if (!container) return;
    const hidden = sortedAll.filter(([id]) => hiddenBarCats.has(id));
    if (hidden.length === 0) { container.innerHTML = ''; return; }
    container.innerHTML = '<span class="chips-label">Ocultas (clic para mostrar):</span>' +
        hidden.map(([id]) => {
            const info = getCategoryInfo(id);
            return `<button class="bar-chip" onclick="restoreBarCategory('${id}')">
                        <span class="cat-dot" style="background:${info.color}"></span>${info.label} ✕
                    </button>`;
        }).join('') +
        `<button class="bar-chip bar-chip-reset" onclick="restoreBarCategory('__all__')">Mostrar todas</button>`;
}

window.restoreBarCategory = function(id) {
    if (id === '__all__') hiddenBarCats.clear();
    else hiddenBarCats.delete(id);
    renderHorizontalBars(lastBarsTransactions);
};

function renderMonthlyComparison(transactions) {
    const canvas = document.getElementById('chart-monthly');
    if (monthlyChart) monthlyChart.destroy();

    const months = {};
    transactions.forEach(t => {
        if (isNeutralCategory(t.category)) return;
        if (!months[t.month]) months[t.month] = { income: 0, expense: 0 };
        if (t.amount > 0 && isIncomeCategory(t.category)) {
            months[t.month].income += t.amount;
        } else if (t.amount < 0 && !isIncomeCategory(t.category)) {
            months[t.month].expense += Math.abs(t.amount);
        }
    });

    const sortedMonths = Object.keys(months).sort();
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const labels = sortedMonths.map(m => {
        const [, mm] = m.split('-');
        return monthNames[parseInt(mm) - 1];
    });
    const incomeData = sortedMonths.map(m => months[m].income);
    const expenseData = sortedMonths.map(m => months[m].expense);

    monthlyChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Ingresos',
                    data: incomeData,
                    backgroundColor: 'rgba(14,159,110,0.85)',
                    borderRadius: 6,
                },
                {
                    label: 'Gastos',
                    data: expenseData,
                    backgroundColor: 'rgba(224,45,81,0.8)',
                    borderRadius: 6,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { usePointStyle: true, pointStyle: 'circle' } },
                tooltip: { ...LIGHT_TOOLTIP, callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}` } }
            },
            scales: {
                y: {
                    ticks: { callback: (v) => formatCurrency(v) },
                    grid: { color: '#eceff5' }
                },
                x: { grid: { display: false } }
            }
        }
    });
}

function renderAllCharts(transactions, onClickCategory) {
    destroyCharts();
    renderDonutChart(transactions, onClickCategory);
    renderHorizontalBars(transactions);
    renderMonthlyComparison(transactions);
}
