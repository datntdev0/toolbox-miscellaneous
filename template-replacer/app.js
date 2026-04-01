'use strict';

// ── State ──────────────────────────────────────────────────────────────────────
let originalText = '';
let modifiedText = '';
let customRowId = 0;

// ── Predefined placeholders ────────────────────────────────────────────────────
const PREDEFINED = [
  '{{fabricWarehouseName}}',
  '{{fabricWarehouseConnection}}',
  '{{fabricWarehouseId}}',
  '{{fabricWorkspaceId}}',
  '{{azFunctionConnectionId}}',
];

// ── DOM refs ───────────────────────────────────────────────────────────────────
const fileInput       = document.getElementById('fileInput');
const originalPreview = document.getElementById('originalPreview');
const outputPreview   = document.getElementById('outputPreview');
const placeholderBody = document.getElementById('placeholderBody');
const addRowBtn       = document.getElementById('addRowBtn');
const applyBtn        = document.getElementById('applyBtn');
const copyBtn         = document.getElementById('copyBtn');
const exportBtn       = document.getElementById('exportBtn');
const diffContainer   = document.getElementById('diffContainer');
const toastEl         = document.getElementById('toast');
const toastMsg        = document.getElementById('toastMsg');
const checkAll        = document.getElementById('checkAll');

const bsToast = new bootstrap.Toast(toastEl, { delay: 2500 });

// ── Check all handler ──────────────────────────────────────────────────────────
checkAll.addEventListener('change', (e) => {
  const checkboxes = placeholderBody.querySelectorAll('.row-check');
  checkboxes.forEach(cb => cb.checked = e.target.checked);
});

// ── Init predefined rows ───────────────────────────────────────────────────────
function initPredefinedRows() {
  PREDEFINED.forEach((token) => {
    const tr = document.createElement('tr');
    tr.draggable = true;
    tr.className = 'draggable-row';
    tr.innerHTML = `
      <td class="text-center align-middle drag-handle" style="cursor: move;">
        <i class="bi bi-grip-vertical text-muted"></i>
      </td>
      <td class="text-center align-middle">
        <input type="checkbox" class="form-check-input row-check" checked/>
      </td>
      <td>
        <input type="text" class="form-control form-control-sm row-value" placeholder="Enter actual value"/>
      </td>
      <td class="align-middle">
        <code class="placeholder-key-input">${escapeHtml(token)}</code>
        <input type="hidden" class="row-key" value="${escapeHtml(token)}"/>
      </td>
      <td></td>
    `;
    placeholderBody.appendChild(tr);
  });
}

// ── Add custom row ─────────────────────────────────────────────────────────────
addRowBtn.addEventListener('click', () => {
  const id = ++customRowId;
  const tr = document.createElement('tr');
  tr.id = `custom-row-${id}`;
  tr.draggable = true;
  tr.className = 'draggable-row';
  tr.innerHTML = `
    <td class="text-center align-middle drag-handle" style="cursor: move;">
      <i class="bi bi-grip-vertical text-muted"></i>
    </td>
    <td class="text-center align-middle">
      <input type="checkbox" class="form-check-input row-check" checked/>
    </td>
    <td>
      <input type="text" class="form-control form-control-sm row-value" placeholder="Actual value"/>
    </td>
    <td>
      <input type="text" class="form-control form-control-sm row-key placeholder-key-input" placeholder="{{myToken}}"/>
    </td>
    <td class="text-center align-middle">
      <button class="btn btn-sm btn-outline-danger remove-row-btn" data-id="${id}">
        <i class="bi bi-trash"></i>
      </button>
    </td>
  `;
  placeholderBody.appendChild(tr);
});

// ── Remove custom row (delegated) ──────────────────────────────────────────────
placeholderBody.addEventListener('click', (e) => {
  const btn = e.target.closest('.remove-row-btn');
  if (btn) {
    const id = btn.dataset.id;
    document.getElementById(`custom-row-${id}`)?.remove();
  }
});

// ── File import ────────────────────────────────────────────────────────────────
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (evt) => {
    const raw = evt.target.result;
    try {
      const parsed = JSON.parse(raw);
      originalText = JSON.stringify(parsed, null, 2);
    } catch {
      originalText = raw;
    }
    originalPreview.textContent = originalText;
    originalPreview.classList.remove('text-muted', 'fst-italic');

    modifiedText = '';
    outputPreview.textContent = 'Apply replacements to see output.';
    outputPreview.classList.add('text-muted', 'fst-italic');
    copyBtn.disabled = true;
    exportBtn.disabled = true;
    diffContainer.innerHTML = '<div class="text-muted fst-italic p-3 small">Diff will appear here after applying replacements.</div>';
  };
  reader.readAsText(file);
});

// ── Apply replacements ─────────────────────────────────────────────────────────
applyBtn.addEventListener('click', () => {
  if (!originalText) {
    showToastMessage('Please import a JSON file first.', 'warning');
    return;
  }

  let result = originalText;
  const rows = placeholderBody.querySelectorAll('tr');

  rows.forEach((tr) => {
    const checkbox = tr.querySelector('.row-check');
    if (!checkbox || !checkbox.checked) return;

    const keyEl  = tr.querySelector('.row-key');
    const valEl  = tr.querySelector('.row-value');
    if (!keyEl || !valEl) return;

    const key = keyEl.value.trim();
    const val = valEl.value;
    if (!key || !val) return;

    // Reverse: replace the input value with the placeholder
    result = replaceAll(result, val, key);
  });

  modifiedText = result;
  outputPreview.textContent = modifiedText;
  outputPreview.classList.remove('text-muted', 'fst-italic');

  copyBtn.disabled = false;
  exportBtn.disabled = false;

  renderDiff(originalText, modifiedText);
});

// ── Copy to clipboard ──────────────────────────────────────────────────────────
copyBtn.addEventListener('click', () => {
  if (!modifiedText) return;
  navigator.clipboard.writeText(modifiedText).then(() => {
    showToastMessage('Copied to clipboard!', 'success');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = modifiedText;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToastMessage('Copied to clipboard!', 'success');
  });
});

// ── Export to file ─────────────────────────────────────────────────────────────
exportBtn.addEventListener('click', () => {
  if (!modifiedText) return;
  const blob = new Blob([modifiedText], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'output.json';
  a.click();
  URL.revokeObjectURL(url);
  showToastMessage('File exported as output.json', 'success');
});

// ── Diff renderer ──────────────────────────────────────────────────────────────
function renderDiff(original, modified) {
  const oldLines = original.split('\n');
  const newLines = modified.split('\n');
  const diff     = computeDiff(oldLines, newLines);

  diffContainer.innerHTML = '';

  if (diff.every(d => d.type === 'unchanged')) {
    diffContainer.innerHTML = '<div class="text-muted fst-italic p-3 small">No changes detected.</div>';
    return;
  }

  let oldLineNum = 0;
  let newLineNum = 0;

  diff.forEach((entry) => {
    const div = document.createElement('div');
    div.className = 'diff-line';

    let lineNum = '';
    let sign    = ' ';

    if (entry.type === 'removed') {
      oldLineNum++;
      lineNum = oldLineNum;
      sign    = '-';
      div.classList.add('diff-removed');
    } else if (entry.type === 'added') {
      newLineNum++;
      lineNum = newLineNum;
      sign    = '+';
      div.classList.add('diff-added');
    } else {
      oldLineNum++;
      newLineNum++;
      lineNum = newLineNum;
      div.classList.add('diff-unchanged');
    }

    div.innerHTML = `
      <span class="diff-line-num">${lineNum}</span>
      <span class="diff-sign">${sign}</span>
      <span class="diff-line-content">${escapeHtml(entry.line)}</span>
    `;
    diffContainer.appendChild(div);
  });
}

// ── LCS-based diff ─────────────────────────────────────────────────────────────
function computeDiff(oldLines, newLines) {
  const m = oldLines.length;
  const n = newLines.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const result = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ type: 'unchanged', line: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: 'added', line: newLines[j - 1] });
      j--;
    } else {
      result.push({ type: 'removed', line: oldLines[i - 1] });
      i--;
    }
  }

  return result.reverse();
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function replaceAll(str, search, replacement) {
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return str.replace(new RegExp(escaped, 'g'), replacement);
}

function showToastMessage(msg, type = 'success') {
  toastEl.className = `toast align-items-center border-0 text-bg-${type}`;
  toastMsg.textContent = msg;
  bsToast.show();
}

// ── Init ───────────────────────────────────────────────────────────────────────
initPredefinedRows();

// ── Drag and Drop ──────────────────────────────────────────────────────────────
let draggedRow = null;

placeholderBody.addEventListener('dragstart', (e) => {
  if (e.target.classList.contains('draggable-row')) {
    draggedRow = e.target;
    e.target.style.opacity = '0.5';
  }
});

placeholderBody.addEventListener('dragend', (e) => {
  if (e.target.classList.contains('draggable-row')) {
    e.target.style.opacity = '';
    draggedRow = null;
  }
});

placeholderBody.addEventListener('dragover', (e) => {
  e.preventDefault();
  const afterElement = getDragAfterElement(placeholderBody, e.clientY);
  const currentRow = e.target.closest('.draggable-row');
  
  if (draggedRow && currentRow && draggedRow !== currentRow) {
    if (afterElement == null) {
      placeholderBody.appendChild(draggedRow);
    } else {
      placeholderBody.insertBefore(draggedRow, afterElement);
    }
  }
});

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.draggable-row:not([style*="opacity"])')];
  
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}