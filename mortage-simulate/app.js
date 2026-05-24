/* ============================================================
   Mô Phỏng Đáo Hạn Vay
   ============================================================ */

let chartInstance = null;

// ── Helpers ──────────────────────────────────────────────────

/**
 * Format a raw VND amount into a human-readable string (triệu / tỷ).
 * @param {number} amount  raw VND value
 * @param {number} decimals decimal places (default 0)
 */
function fmt(amount, decimals = 0) {
  if (amount === 0) return '0';
  const m = amount / 1e6; // convert to triệu
  return m.toLocaleString('vi-VN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }) + ' tr';
}

/** Format triệu value compactly for chart labels. */
function fmtShort(amount) {
  const m = amount / 1e6;
  if (m >= 1000) return (m / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tỷ';
  return m.toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + ' tr';
}

/** Convert triệu input to raw VND. */
function trieu(val) { return val * 1e6; }

// ── Live preview ──────────────────────────────────────────────

document.getElementById('totalLoan').addEventListener('input', updatePreview);
document.querySelectorAll('#numLoans, #loanTerm, #monthlyRate, #maturityRate, #simMonths')
  .forEach(el => el.addEventListener('input', updateQuickSummary));

function updatePreview() {
  const val = parseFloat(document.getElementById('totalLoan').value) || 0;
  const raw = trieu(val);
  let text = '';
  if (raw >= 1e9) text = '= ' + (raw / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 3 }) + ' tỷ đồng';
  else if (raw >= 1e6) text = '= ' + (raw / 1e6).toLocaleString('vi-VN') + ' triệu đồng';
  document.getElementById('totalLoanPreview').textContent = text;
}

function updateQuickSummary() {
  const totalLoan = parseFloat(document.getElementById('totalLoan').value) || 0;
  const numLoans  = parseInt(document.getElementById('numLoans').value) || 1;
  const summary = document.getElementById('quickSummary');
  const perLoan = trieu(totalLoan) / numLoans;
  summary.textContent = `Mỗi khoản: ${fmt(perLoan)}`;
}

// Run on page load
updatePreview();
updateQuickSummary();

// ── Core simulation ───────────────────────────────────────────

/**
 * Run the loan rollover simulation.
 * @param {object} p  parameters
 */
function runSimulation(p) {
  const { totalLoan, numLoans, loanTerm, monthlyRate, maturityRate, monthlyRepayment, simMonths } = p;
  const loanAmount = totalLoan / numLoans;

  let activeLoans = []; // { id, amount, startMonth, maturityMonth }
  let loanCounter = 0;
  let repaymentPool = 0; // accumulated principal not yet applied
  const results = [];

  for (let month = 1; month <= simMonths; month++) {
    // ① Starting balance (before any changes this month)
    const startingBalance = activeLoans.reduce((s, l) => s + l.amount, 0);

    // ② Monthly interest on starting balance
    const monthlyInterest = startingBalance * monthlyRate;

    // ③ Accumulate monthly principal repayment into pool
    repaymentPool += monthlyRepayment;

    // ④ New loan during initial phase (one per month for numLoans months)
    let newInitialLoan = null;
    if (month <= numLoans) {
      loanCounter++;
      newInitialLoan = {
        id: loanCounter,
        amount: loanAmount,
        startMonth: month,
        maturityMonth: month + loanTerm,
        isReborrow: false,
      };
      activeLoans.push(newInitialLoan);
    }

    // ⑤ Handle maturities (loans that expire this month)
    const maturities = [];
    const reborrowedLoans = [];
    let reductionApplied = 0;
    const maturingLoans = activeLoans.filter(l => l.maturityMonth === month);

    for (const loan of maturingLoans) {
      // Maturity interest is always on the full outstanding loan amount
      const maturityInterest = loan.amount * maturityRate;

      // Apply repayment pool to reduce the reborrow amount
      const reduction = Math.min(repaymentPool, loan.amount);
      repaymentPool -= reduction;
      reductionApplied += reduction;

      maturities.push({ loan: { ...loan }, maturityInterest, reduction });

      // Remove matured loan
      activeLoans = activeLoans.filter(l => l.id !== loan.id);

      // Re-borrow only the reduced amount (0 = fully paid off)
      const reborrowAmount = loan.amount - reduction;
      if (reborrowAmount > 0) {
        loanCounter++;
        const reborrow = {
          id: loanCounter,
          amount: reborrowAmount,
          startMonth: month,
          maturityMonth: month + loanTerm,
          isReborrow: true,
          reborrowOf: loan.id,
        };
        activeLoans.push(reborrow);
        reborrowedLoans.push(reborrow);
      }
    }

    // ⑥ Ending balance
    const endingBalance = activeLoans.reduce((s, l) => s + l.amount, 0);
    const totalMaturityInterest = maturities.reduce((s, m) => s + m.maturityInterest, 0);
    const totalPayment = monthlyInterest + totalMaturityInterest;

    results.push({
      month,
      startingBalance,
      monthlyInterest,
      maturities,
      newInitialLoan,
      reborrowedLoans,
      reductionApplied,
      repaymentPool,  // snapshot after this month
      endingBalance,
      totalPayment,
    });
  }

  return results;
}

// ── UI Rendering ──────────────────────────────────────────────

function simulate() {
  const totalLoan         = trieu(parseFloat(document.getElementById('totalLoan').value));
  const numLoans          = parseInt(document.getElementById('numLoans').value);
  const loanTerm          = parseInt(document.getElementById('loanTerm').value);
  const monthlyRate       = parseFloat(document.getElementById('monthlyRate').value) / 100;
  const maturityRate      = parseFloat(document.getElementById('maturityRate').value) / 100;
  const monthlyRepayment  = trieu(parseFloat(document.getElementById('monthlyRepayment').value) || 0);
  const simMonths         = parseInt(document.getElementById('simMonths').value);

  // Validate
  if (!totalLoan || !numLoans || !loanTerm || simMonths < 1) {
    alert('Vui lòng nhập đầy đủ và hợp lệ các thông số.');
    return;
  }

  const results = runSimulation({ totalLoan, numLoans, loanTerm, monthlyRate, maturityRate, monthlyRepayment, simMonths });

  renderSummary(results);
  renderChart(results);
  renderTable(results);

  document.getElementById('results').classList.remove('d-none');
  document.getElementById('results').scrollIntoView({ behavior: 'smooth' });
}

// ── Summary Cards ─────────────────────────────────────────────

function renderSummary(results) {
  const totalMonthly    = results.reduce((s, r) => s + r.monthlyInterest, 0);
  const totalMaturity   = results.reduce((s, r) => s + r.maturities.reduce((a, m) => a + m.maturityInterest, 0), 0);
  const totalPaid       = totalMonthly + totalMaturity;
  const avgMonthly      = totalPaid / results.length;
  const peakPayment     = Math.max(...results.map(r => r.totalPayment));
  const stableMonths    = results.filter(r => r.maturities.length > 0).length;
  const totalReduction  = results.reduce((s, r) => s + r.reductionApplied, 0);
  const endingBalance   = results.length > 0 ? results[results.length - 1].endingBalance : 0;

  const cards = [
    {
      icon: 'bi-calendar-month',
      color: 'primary',
      label: 'Tổng lãi hàng tháng',
      value: fmt(totalMonthly),
      sub: `${results.length} tháng mô phỏng`,
    },
    {
      icon: 'bi-arrow-repeat',
      color: 'danger',
      label: 'Tổng lãi tất toán',
      value: fmt(totalMaturity),
      sub: `${stableMonths} lần đáo hạn`,
    },
    {
      icon: 'bi-cash-coin',
      color: 'warning',
      label: 'Tổng chi phí lãi',
      value: fmt(totalPaid),
      sub: `Trung bình ${fmt(avgMonthly, 1)}/tháng • cao nhất ${fmt(peakPayment)}`,
    },
    {
      icon: 'bi-arrow-down-circle',
      color: 'success',
      label: 'Tổng giảm dư nợ gốc',
      value: fmt(totalReduction),
      sub: `Dư nợ cuối mô phỏng: ${fmt(endingBalance)}`,
    },
  ];

  document.getElementById('summaryCards').innerHTML = cards.map(c => `
    <div class="col-sm-6 col-xl-3">
      <div class="card shadow-sm border-${c.color} border-top border-4 h-100">
        <div class="card-body">
          <div class="d-flex align-items-center gap-2 mb-2">
            <i class="bi ${c.icon} text-${c.color} fs-4"></i>
            <span class="text-muted small">${c.label}</span>
          </div>
          <div class="fs-4 fw-bold text-${c.color}">${c.value}</div>
          <div class="text-muted small mt-1">${c.sub}</div>
        </div>
      </div>
    </div>
  `).join('');
}

// ── Chart ─────────────────────────────────────────────────────

function renderChart(results) {
  const labels    = results.map(r => `T${r.month}`);
  const monthly   = results.map(r => r.monthlyInterest / 1e6);
  const maturity  = results.map(r => r.maturities.reduce((s, m) => s + m.maturityInterest, 0) / 1e6);
  const balance   = results.map(r => r.endingBalance / 1e6);

  const ctx = document.getElementById('paymentChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Lãi hàng tháng (tr)',
          data: monthly,
          backgroundColor: 'rgba(13, 110, 253, 0.75)',
          stack: 'payment',
          borderRadius: 3,
          yAxisID: 'yLeft',
        },
        {
          label: 'Lãi tất toán (tr)',
          data: maturity,
          backgroundColor: 'rgba(220, 53, 69, 0.75)',
          stack: 'payment',
          borderRadius: 3,
          yAxisID: 'yLeft',
        },
        {
          type: 'line',
          label: 'Dư nợ cuối kỳ (tr)',
          data: balance,
          borderColor: 'rgba(25, 135, 84, 0.9)',
          backgroundColor: 'rgba(25, 135, 84, 0.1)',
          borderWidth: 2,
          pointRadius: 2,
          tension: 0.3,
          fill: false,
          yAxisID: 'yRight',
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: 'index' },
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            footer(items) {
              const interestTotal = items
                .filter(i => i.dataset.yAxisID === 'yLeft')
                .reduce((s, i) => s + i.parsed.y, 0);
              return 'Tổng lãi: ' + interestTotal.toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tr';
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { maxTicksLimit: 24, maxRotation: 0 },
        },
        yLeft: {
          type: 'linear',
          position: 'left',
          stacked: true,
          beginAtZero: true,
          title: { display: true, text: 'Lãi (triệu đ)' },
          ticks: { callback: v => v.toLocaleString('vi-VN') + ' tr' },
        },
        yRight: {
          type: 'linear',
          position: 'right',
          beginAtZero: false,
          title: { display: true, text: 'Dư nợ (triệu đ)' },
          ticks: { callback: v => v.toLocaleString('vi-VN') + ' tr' },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });
}

// ── Detail Table ──────────────────────────────────────────────

function loanBadge(loan, type) {
  if (type === 'settled') {
    return `<span class="badge loan-badge bg-danger-subtle text-danger border border-danger-subtle" title="Khoản #${loan.id}">L${loan.id}</span>`;
  }
  if (loan.isReborrow) {
    return `<span class="badge loan-badge bg-warning-subtle text-warning border border-warning-subtle" title="Đáo hạn từ khoản #${loan.reborrowOf}">L${loan.id}</span>`;
  }
  return `<span class="badge loan-badge bg-success-subtle text-success border border-success-subtle" title="Khoản vay mới">L${loan.id}</span>`;
}

function renderTable(results) {
  const tbody = document.getElementById('tableBody');
  const tfoot = document.getElementById('tableFoot');

  let totalMonthlyInterest  = 0;
  let totalMaturityInterest = 0;
  let totalAllPayments      = 0;
  let totalReduction        = 0;

  const rows = results.map(r => {
    const maturityInterestSum = r.maturities.reduce((s, m) => s + m.maturityInterest, 0);
    totalMonthlyInterest  += r.monthlyInterest;
    totalMaturityInterest += maturityInterestSum;
    totalAllPayments      += r.totalPayment;
    totalReduction        += r.reductionApplied;

    // Build "khoản tất toán" cell
    const settledCell = r.maturities.length === 0
      ? '<span class="text-muted">—</span>'
      : r.maturities.map(m =>
          `${loanBadge(m.loan, 'settled')} <span class="text-muted small">${fmt(m.loan.amount)}</span>`
        ).join('<br/>');

    // Build "khoản vay mới" cell
    const newLoans = [];
    if (r.newInitialLoan) newLoans.push(loanBadge(r.newInitialLoan, 'new') + ` <span class="text-muted small">${fmt(r.newInitialLoan.amount)}</span>`);
    r.reborrowedLoans.forEach(l => {
      newLoans.push(loanBadge(l, 'reborrow') + ` <span class="text-muted small">${fmt(l.amount)}</span>`);
    });
    const newLoansCell = newLoans.length === 0 ? '<span class="text-muted">—</span>' : newLoans.join('<br/>');

    // Build "giảm dư nợ" cell
    const reductionCell = r.reductionApplied > 0
      ? `<span class="fw-semibold text-success">↓ ${fmt(r.reductionApplied)}</span>`
      : (r.repaymentPool > 0
          ? `<span class="text-muted small" title="Tích lũy chưa áp dụng">(+${fmt(r.repaymentPool)})</span>`
          : '<span class="text-muted">—</span>');

    const isStablePhase = r.maturities.length > 0;
    const rowClass = isStablePhase ? '' : 'table-light';

    return `
      <tr class="${rowClass}">
        <td class="text-center fw-semibold">T${r.month}</td>
        <td class="text-end font-monospace">${r.startingBalance > 0 ? fmt(r.startingBalance) : '<span class="text-muted">—</span>'}</td>
        <td class="text-end font-monospace text-primary">${r.monthlyInterest > 0 ? fmt(r.monthlyInterest) : '<span class="text-muted">0</span>'}</td>
        <td>${settledCell}</td>
        <td class="text-end font-monospace text-danger">${maturityInterestSum > 0 ? fmt(maturityInterestSum) : '<span class="text-muted">—</span>'}</td>
        <td>${newLoansCell}</td>
        <td class="text-end font-monospace text-success">${reductionCell}</td>
        <td class="text-end font-monospace">${fmt(r.endingBalance)}</td>
        <td class="text-end font-monospace fw-bold bg-warning-subtle">${r.totalPayment > 0 ? fmt(r.totalPayment) : '<span class="text-muted">0</span>'}</td>
      </tr>`;
  });

  tbody.innerHTML = rows.join('');

  tfoot.innerHTML = `
    <tr>
      <td class="text-center">Cộng</td>
      <td></td>
      <td class="text-end font-monospace text-primary">${fmt(totalMonthlyInterest)}</td>
      <td></td>
      <td class="text-end font-monospace text-danger">${fmt(totalMaturityInterest)}</td>
      <td></td>
      <td class="text-end font-monospace text-success">${totalReduction > 0 ? `↓ ${fmt(totalReduction)}` : '—'}</td>
      <td></td>
      <td class="text-end font-monospace bg-warning-subtle">${fmt(totalAllPayments)}</td>
    </tr>`;
}
