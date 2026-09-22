const $ = (selector) => document.querySelector(selector);
const urlInput = $('#sheet-url'), loadButton = $('#load-button'), saveButton = $('#save-button');
const workspace = $('#workspace'), statusNode = $('#status'), sheetSelect = $('#sheet-select');
const table = $('#data-table'), emptyState = $('#empty-state'), selectionLabel = $('#selection-label');
const imageInput = $('#image-input'), importInput = $('#import-input'), toolsPanel = $('#tools-panel');
let rows = [], dirty = false, active = { row: 0, column: 0 };
let history = [], future = [], searchMatches = [], searchIndex = -1;

function setStatus(message, state = '') { statusNode.textContent = message; statusNode.className = `status ${state}`; }
function rectangular(data) {
  const width = Math.max(1, ...data.map((row) => row.length));
  return data.map((row) => Array.from({ length: width }, (_, i) => String(row[i] ?? '')));
}
function clone(data) { return data.map((row) => [...row]); }
let activeColumnFilters = {};

function parseNumericValue(text) {
  if (text == null) return null;
  const str = String(text).trim();
  if (!str) return null;
  if (parseImageFormula(str)) return null;

  if (/\b\d{1,4}[./-]\d{1,2}[./-]\d{1,4}\b/.test(str)) return null;

  let cleaned = str.replace(/[^\d.,-]/g, '').trim();
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === ',') return null;

  if ((cleaned.match(/-/g) || []).length > 1 || cleaned.indexOf('-') > 0) return null;

  const dots = (cleaned.match(/\./g) || []).length;
  const commas = (cleaned.match(/,/g) || []).length;

  if (dots > 0 && commas > 0) {
    if (cleaned.lastIndexOf('.') > cleaned.lastIndexOf(',')) {
      cleaned = cleaned.replace(/,/g, '');
    } else {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    }
  } else if (commas === 1 && dots === 0) {
    cleaned = cleaned.replace(',', '.');
  } else if (dots > 1) {
    cleaned = cleaned.replace(/\./g, '');
  } else if (commas > 1) {
    cleaned = cleaned.replace(/,/g, '');
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function detectColumnUnit(headerText, dataRows, colIndex) {
  if (headerText) {
    const match = headerText.match(/\(([^)]+)\)|\[([^\]]+)\]/);
    if (match) {
      const candidate = (match[1] || match[2]).trim();
      if (candidate.length <= 8 && !/^\d+$/.test(candidate)) {
        return candidate;
      }
    }
  }

  const unitCounts = new Map();
  dataRows.forEach((row) => {
    const val = row[colIndex];
    if (val != null) {
      const str = String(val).trim();
      const suffixMatch = str.match(/[\d.,]+\s*([^\d.,\s]{1,8})$/);
      if (suffixMatch) {
        const u = suffixMatch[1].trim();
        unitCounts.set(u, (unitCounts.get(u) || 0) + 1);
      } else {
        const prefixMatch = str.match(/^([^\d.,\s]{1,4})\s*[\d.,]+/);
        if (prefixMatch) {
          const u = prefixMatch[1].trim();
          unitCounts.set(u, (unitCounts.get(u) || 0) + 1);
        }
      }
    }
  });

  let bestUnit = '', maxCount = 0;
  unitCounts.forEach((count, u) => {
    if (count > maxCount && count >= 2) {
      maxCount = count;
      bestUnit = u;
    }
  });
  return bestUnit;
}

function analyzeColumnData(colIndex, dataRows, headerText) {
  let numericCount = 0;
  let nonEmptyCount = 0;
  let min = Infinity;
  let max = -Infinity;

  dataRows.forEach((row) => {
    const val = row[colIndex];
    if (val != null && String(val).trim() !== '') {
      nonEmptyCount++;
      const num = parseNumericValue(val);
      if (num !== null) {
        numericCount++;
        if (num < min) min = num;
        if (num > max) max = num;
      }
    }
  });

  const isNumeric = nonEmptyCount >= 2 && (numericCount / nonEmptyCount) >= 0.65 && min < max;
  const unit = isNumeric ? detectColumnUnit(headerText, dataRows, colIndex) : '';

  return {
    isNumeric,
    min: isNumeric ? min : 0,
    max: isNumeric ? max : 0,
    unit
  };
}

function getCellFilterKey(value) {
  if (value == null) return '';
  const str = String(value).trim();
  if (parseImageFormula(str)) return '__IMAGE__';
  return str;
}

function getCellFilterLabel(key) {
  if (key === '__IMAGE__') return '🖼 [Imagine]';
  if (key === '') return '(Gol)';
  return key;
}

function buildFilterSidebar() {
  const list = $('#filter-columns-list');
  if (!list) return;
  const currentRows = collectRows();
  if (!currentRows.length) {
    list.innerHTML = '<div style="padding:15px; color:var(--muted); font-size:12px; text-align:center;">Nicio dată disponibilă</div>';
    return;
  }

  const headers = currentRows[0] || [];
  const dataRows = currentRows.slice(1);
  list.innerHTML = '';

  headers.forEach((headerText, colIndex) => {
    const colName = headerText?.trim() || `Coloana ${colIndex + 1}`;
    const analysis = analyzeColumnData(colIndex, dataRows, colName);

    const isFiltered = Object.prototype.hasOwnProperty.call(activeColumnFilters, colIndex);
    const filterRule = activeColumnFilters[colIndex];

    const group = document.createElement('div');
    group.className = `filter-column-group${isFiltered ? ' active-filter' : ' collapsed'}`;
    group.dataset.colIndex = colIndex;
    group.dataset.colName = colName;

    const groupHeader = document.createElement('div');
    groupHeader.className = 'filter-column-header';

    const colMeta = document.createElement('div');
    colMeta.className = 'filter-col-meta';
    if (isFiltered) {
      const dot = document.createElement('span');
      dot.className = 'filter-dot';
      colMeta.appendChild(dot);
    }
    const titleSpan = document.createElement('span');
    titleSpan.textContent = colName;
    colMeta.appendChild(titleSpan);

    const arrow = document.createElement('span');
    arrow.className = 'filter-toggle-arrow';
    arrow.textContent = '▾';

    groupHeader.appendChild(colMeta);
    groupHeader.appendChild(arrow);

    groupHeader.addEventListener('click', () => {
      group.classList.toggle('collapsed');
    });

    const groupBody = document.createElement('div');
    groupBody.className = 'filter-column-body';

    const actions = document.createElement('div');
    actions.className = 'filter-column-actions';

    if (analysis.isNumeric) {
      const limitMin = analysis.min;
      const limitMax = analysis.max;
      const unit = analysis.unit;

      let curMin = limitMin;
      let curMax = limitMax;
      if (filterRule && filterRule.type === 'range') {
        curMin = Math.max(limitMin, Math.min(limitMax, filterRule.min));
        curMax = Math.min(limitMax, Math.max(limitMin, filterRule.max));
      }

      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'filter-quick-btn';
      resetBtn.textContent = 'Toate';
      actions.appendChild(resetBtn);
      groupBody.appendChild(actions);

      const rangeContainer = document.createElement('div');
      rangeContainer.className = 'range-filter-container';

      const valuesRow = document.createElement('div');
      valuesRow.className = 'range-values-row';

      const minBox = document.createElement('div');
      minBox.className = 'range-val-box';
      const minLabel = document.createElement('span');
      minLabel.className = 'range-val-label';
      minLabel.textContent = 'Min';
      const minInput = document.createElement('input');
      minInput.type = 'number';
      minInput.className = 'range-num-input';
      minInput.step = 'any';
      minInput.value = curMin;
      minBox.appendChild(minLabel);
      minBox.appendChild(minInput);
      if (unit) {
        const uSpan = document.createElement('span');
        uSpan.className = 'range-unit';
        uSpan.textContent = unit;
        minBox.appendChild(uSpan);
      }

      const sep = document.createElement('span');
      sep.className = 'range-sep';
      sep.textContent = '—';

      const maxBox = document.createElement('div');
      maxBox.className = 'range-val-box';
      const maxLabel = document.createElement('span');
      maxLabel.className = 'range-val-label';
      maxLabel.textContent = 'Max';
      const maxInput = document.createElement('input');
      maxInput.type = 'number';
      maxInput.className = 'range-num-input';
      maxInput.step = 'any';
      maxInput.value = curMax;
      maxBox.appendChild(maxLabel);
      maxBox.appendChild(maxInput);
      if (unit) {
        const uSpan = document.createElement('span');
        uSpan.className = 'range-unit';
        uSpan.textContent = unit;
        maxBox.appendChild(uSpan);
      }

      valuesRow.appendChild(minBox);
      valuesRow.appendChild(sep);
      valuesRow.appendChild(maxBox);
      rangeContainer.appendChild(valuesRow);

      const sliderWrap = document.createElement('div');
      sliderWrap.className = 'dual-range-slider';

      const trackBg = document.createElement('div');
      trackBg.className = 'range-track-bg';
      const trackFill = document.createElement('div');
      trackFill.className = 'range-track-fill';

      const rangeSpan = limitMax - limitMin;
      const step = rangeSpan > 200 ? 1 : (rangeSpan > 20 ? 0.5 : 0.01);

      const minSlider = document.createElement('input');
      minSlider.type = 'range';
      minSlider.className = 'range-slider-input min-slider';
      minSlider.min = limitMin;
      minSlider.max = limitMax;
      minSlider.step = step;
      minSlider.value = curMin;

      const maxSlider = document.createElement('input');
      maxSlider.type = 'range';
      maxSlider.className = 'range-slider-input max-slider';
      maxSlider.min = limitMin;
      maxSlider.max = limitMax;
      maxSlider.step = step;
      maxSlider.value = curMax;

      sliderWrap.appendChild(trackBg);
      sliderWrap.appendChild(trackFill);
      sliderWrap.appendChild(minSlider);
      sliderWrap.appendChild(maxSlider);
      rangeContainer.appendChild(sliderWrap);

      const limitsRow = document.createElement('div');
      limitsRow.className = 'range-limits-row';
      const minLimitSpan = document.createElement('span');
      minLimitSpan.textContent = `${limitMin}${unit ? ' ' + unit : ''}`;
      const maxLimitSpan = document.createElement('span');
      maxLimitSpan.textContent = `${limitMax}${unit ? ' ' + unit : ''}`;
      limitsRow.appendChild(minLimitSpan);
      limitsRow.appendChild(maxLimitSpan);
      rangeContainer.appendChild(limitsRow);

      groupBody.appendChild(rangeContainer);

      function updateFillAndFilter() {
        let vMin = parseFloat(minSlider.value);
        let vMax = parseFloat(maxSlider.value);
        if (vMin > vMax) {
          vMin = vMax;
          minSlider.value = vMin;
        }
        minInput.value = vMin;
        maxInput.value = vMax;

        const leftPct = ((vMin - limitMin) / (limitMax - limitMin)) * 100;
        const widthPct = ((vMax - vMin) / (limitMax - limitMin)) * 100;
        trackFill.style.left = `${Math.max(0, Math.min(100, leftPct))}%`;
        trackFill.style.width = `${Math.max(0, Math.min(100, widthPct))}%`;

        if (vMin <= limitMin && vMax >= limitMax) {
          delete activeColumnFilters[colIndex];
          group.classList.remove('active-filter');
          const dot = colMeta.querySelector('.filter-dot');
          if (dot) dot.remove();
        } else {
          activeColumnFilters[colIndex] = {
            type: 'range',
            min: vMin,
            max: vMax,
            limitMin,
            limitMax
          };
          group.classList.add('active-filter');
          if (!colMeta.querySelector('.filter-dot')) {
            const dot = document.createElement('span');
            dot.className = 'filter-dot';
            colMeta.prepend(dot);
          }
        }
        applyFilters();
      }

      minSlider.addEventListener('input', () => {
        if (parseFloat(minSlider.value) > parseFloat(maxSlider.value)) {
          minSlider.value = maxSlider.value;
        }
        updateFillAndFilter();
      });

      maxSlider.addEventListener('input', () => {
        if (parseFloat(maxSlider.value) < parseFloat(minSlider.value)) {
          maxSlider.value = minSlider.value;
        }
        updateFillAndFilter();
      });

      minInput.addEventListener('change', () => {
        let val = parseFloat(minInput.value);
        if (isNaN(val)) val = limitMin;
        val = Math.max(limitMin, Math.min(parseFloat(maxSlider.value), val));
        minSlider.value = val;
        updateFillAndFilter();
      });

      maxInput.addEventListener('change', () => {
        let val = parseFloat(maxInput.value);
        if (isNaN(val)) val = limitMax;
        val = Math.min(limitMax, Math.max(parseFloat(minSlider.value), val));
        maxSlider.value = val;
        updateFillAndFilter();
      });

      resetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        minSlider.value = limitMin;
        maxSlider.value = limitMax;
        updateFillAndFilter();
      });

      const initLeft = ((curMin - limitMin) / (limitMax - limitMin)) * 100;
      const initWidth = ((curMax - curMin) / (limitMax - limitMin)) * 100;
      trackFill.style.left = `${Math.max(0, Math.min(100, initLeft))}%`;
      trackFill.style.width = `${Math.max(0, Math.min(100, initWidth))}%`;

    } else {
      const selectAllBtn = document.createElement('button');
      selectAllBtn.type = 'button';
      selectAllBtn.className = 'filter-quick-btn';
      selectAllBtn.textContent = 'Toate';

      const deselectAllBtn = document.createElement('button');
      deselectAllBtn.type = 'button';
      deselectAllBtn.className = 'filter-quick-btn';
      deselectAllBtn.textContent = 'Niciuna';

      actions.appendChild(selectAllBtn);
      actions.appendChild(deselectAllBtn);
      groupBody.appendChild(actions);

      const valuesList = document.createElement('div');
      valuesList.className = 'filter-values-list';

      const valueCounts = new Map();
      dataRows.forEach((row) => {
        const cellVal = row[colIndex] ?? '';
        const key = getCellFilterKey(cellVal);
        valueCounts.set(key, (valueCounts.get(key) || 0) + 1);
      });

      const allowedSet = filterRule instanceof Set ? filterRule : null;

      const sortedKeys = Array.from(valueCounts.keys()).sort((a, b) => {
        if (a === '' && b !== '') return 1;
        if (a !== '' && b === '') return -1;
        if (a === '__IMAGE__' && b !== '__IMAGE__') return -1;
        if (a !== '__IMAGE__' && b === '__IMAGE__') return 1;
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
      });

      sortedKeys.forEach((key) => {
        const count = valueCounts.get(key);
        const isChecked = !isFiltered || (allowedSet && allowedSet.has(key));

        const label = document.createElement('label');
        label.className = 'filter-val-item';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'filter-val-checkbox';
        cb.dataset.valKey = key;
        cb.checked = !!isChecked;

        const txtSpan = document.createElement('span');
        txtSpan.className = 'filter-val-label';
        txtSpan.textContent = getCellFilterLabel(key);

        const countSpan = document.createElement('span');
        countSpan.className = 'filter-val-count';
        countSpan.textContent = `(${count})`;

        label.appendChild(cb);
        label.appendChild(txtSpan);
        label.appendChild(countSpan);
        valuesList.appendChild(label);

        cb.addEventListener('change', () => {
          updateColumnFilterFromCheckboxes(group, colIndex);
        });
      });

      selectAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        valuesList.querySelectorAll('.filter-val-checkbox').forEach((cb) => { cb.checked = true; });
        delete activeColumnFilters[colIndex];
        group.classList.remove('active-filter');
        const dot = colMeta.querySelector('.filter-dot');
        if (dot) dot.remove();
        applyFilters();
      });

      deselectAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        valuesList.querySelectorAll('.filter-val-checkbox').forEach((cb) => { cb.checked = false; });
        activeColumnFilters[colIndex] = new Set();
        group.classList.add('active-filter');
        if (!colMeta.querySelector('.filter-dot')) {
          const dot = document.createElement('span');
          dot.className = 'filter-dot';
          colMeta.prepend(dot);
        }
        applyFilters();
      });

      groupBody.appendChild(valuesList);
    }

    group.appendChild(groupHeader);
    group.appendChild(groupBody);
    list.appendChild(group);
  });

  filterColumnSearch();
}

function updateColumnFilterFromCheckboxes(group, colIndex) {
  const colMeta = group.querySelector('.filter-col-meta');
  const allBoxes = group.querySelectorAll('.filter-val-checkbox');
  const checkedBoxes = group.querySelectorAll('.filter-val-checkbox:checked');

  if (checkedBoxes.length === allBoxes.length) {
    delete activeColumnFilters[colIndex];
    group.classList.remove('active-filter');
    const dot = colMeta.querySelector('.filter-dot');
    if (dot) dot.remove();
  } else {
    const checkedKeys = new Set([...checkedBoxes].map((cb) => cb.dataset.valKey));
    activeColumnFilters[colIndex] = checkedKeys;
    group.classList.add('active-filter');
    if (!colMeta.querySelector('.filter-dot')) {
      const dot = document.createElement('span');
      dot.className = 'filter-dot';
      colMeta.prepend(dot);
    }
  }
  applyFilters();
}

function applyFilters() {
  const activeColIndices = Object.keys(activeColumnFilters).map(Number);
  const tbody = table.querySelector('tbody');
  if (!tbody) return;
  const trs = tbody.querySelectorAll('tr');

  trs.forEach((tr) => {
    const cells = tr.querySelectorAll('.data-cell');
    let visible = true;

    for (const colIndex of activeColIndices) {
      const filterRule = activeColumnFilters[colIndex];
      if (!filterRule) continue;
      const cell = cells[colIndex];
      const cellVal = cell ? (cell.dataset.formula && !cell.isContentEditable ? cell.dataset.formula : cell.textContent.trim()) : '';

      if (filterRule.type === 'range') {
        const num = parseNumericValue(cellVal);
        if (num === null) {
          visible = false;
          break;
        }
        if (num < filterRule.min || num > filterRule.max) {
          visible = false;
          break;
        }
      } else if (filterRule instanceof Set) {
        const key = getCellFilterKey(cellVal);
        if (!filterRule.has(key)) {
          visible = false;
          break;
        }
      }
    }

    tr.hidden = !visible;
  });

  const totalActive = activeColIndices.length;
  const badge = $('#filter-badge');
  if (badge) {
    badge.textContent = totalActive;
    badge.hidden = totalActive === 0;
  }
  const activeCountLabel = $('#filter-active-count');
  if (activeCountLabel) {
    activeCountLabel.textContent = `${totalActive} active`;
    activeCountLabel.hidden = totalActive === 0;
  }

  updateInsights();
}

function resetAllFilters() {
  activeColumnFilters = {};
  const sidebar = $('#filter-sidebar');
  if (sidebar && !sidebar.hidden) {
    buildFilterSidebar();
  }
  applyFilters();
  setStatus('Toate filtrele au fost resetate.', 'success');
}

function filterColumnSearch() {
  const query = $('#filter-column-search')?.value.trim().toLocaleLowerCase() || '';
  const groups = document.querySelectorAll('.filter-column-group');
  groups.forEach((group) => {
    const colName = group.dataset.colName?.toLocaleLowerCase() || '';
    const valItems = group.querySelectorAll('.filter-val-item');
    const hasRange = group.querySelector('.range-filter-container') !== null;
    let anyValMatch = false;

    if (valItems.length) {
      valItems.forEach((item) => {
        const text = item.textContent.toLocaleLowerCase();
        const matches = !query || text.includes(query) || colName.includes(query);
        item.hidden = !matches;
        if (matches) anyValMatch = true;
      });
    }

    const colMatches = !query || colName.includes(query) || anyValMatch || (hasRange && colName.includes(query));
    group.hidden = !colMatches;
    if (query && colMatches && group.classList.contains('collapsed')) {
      group.classList.remove('collapsed');
    }
  });
}

function toggleFilterSidebar() {
  const sidebar = $('#filter-sidebar');
  if (!sidebar) return;
  const isCurrentlyHidden = sidebar.hidden;
  sidebar.hidden = !isCurrentlyHidden;
  const filterBtn = $('#filter-toggle-button');
  if (!sidebar.hidden) {
    buildFilterSidebar();
    filterBtn?.classList.add('active');
  } else {
    filterBtn?.classList.remove('active');
  }
}

function closeFilterSidebar() {
  const sidebar = $('#filter-sidebar');
  if (sidebar) {
    sidebar.hidden = true;
    $('#filter-toggle-button')?.classList.remove('active');
  }
}

function updateInsights() {
  const data = collectRows(); const rowCount = Math.max(0, data.length - 1); const columnCount = data[0]?.length || 0;
  const activeColIndices = Object.keys(activeColumnFilters).length;
  if (activeColIndices > 0) {
    const visibleCount = [...table.querySelectorAll('tbody tr')].filter((tr) => !tr.hidden).length;
    $('#rows-count').textContent = `${visibleCount}/${rowCount}`;
  } else {
    $('#rows-count').textContent = rowCount;
  }
  $('#columns-count').textContent = columnCount; $('#cells-count').textContent = rowCount * columnCount;
  $('#save-state').textContent = dirty ? 'Modificări locale' : 'Sincronizat';
}
function updateUI() { saveButton.disabled = !dirty; $('#undo-button').disabled = history.length < 2; $('#redo-button').disabled = !future.length; updateInsights(); }
function recordHistory() { const snapshot = clone(collectRows()); const previous = history.at(-1); if (!previous || JSON.stringify(previous) !== JSON.stringify(snapshot)) { history.push(snapshot); if (history.length > 60) history.shift(); future = []; } }
function markDirty() { recordHistory(); dirty = true; updateUI(); setStatus('Ai modificări nesalvate. Apasă Salvează pentru confirmare.'); }
function parseImageFormula(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^=\s*IMAGE\(\s*["']([^"']+)["']/i);
  if (match) return match[1];
  if (/^https?:\/\/drive\.google\.com\/(?:file\/d\/|uc\?|open\?|thumbnail\?)/i.test(trimmed)) {
    return trimmed;
  }
  if (/^https?:\/\/.*\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function extractDriveFileId(url) {
  if (!url) return null;
  const match = url.match(/drive\.google\.com\/(?:uc\?.*?\bid=|file\/d\/|thumbnail\?.*?\bid=|open\?.*?\bid=)([a-zA-Z0-9_-]+)/i);
  return match ? match[1] : null;
}

function getDisplayImageUrl(rawUrl) {
  const fileId = extractDriveFileId(rawUrl);
  if (fileId) {
    return `/api/image/proxy/${fileId}`;
  }
  return rawUrl;
}

function renderCellImage(cell, rawUrl) {
  cell.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'cell-image-wrapper';
  const img = document.createElement('img');
  img.className = 'cell-image-thumb';
  img.alt = 'Imagine';
  img.loading = 'lazy';
  const displayUrl = getDisplayImageUrl(rawUrl);
  img.src = displayUrl;
  const fileId = extractDriveFileId(rawUrl);
  img.onerror = () => {
    if (fileId && !img.dataset.fallback1) {
      img.dataset.fallback1 = '1';
      img.src = `https://lh3.googleusercontent.com/d/${fileId}`;
    } else if (fileId && !img.dataset.fallback2) {
      img.dataset.fallback2 = '1';
      img.src = `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
    } else if (img.src !== rawUrl) {
      img.src = rawUrl;
    }
  };
  img.title = 'Apasă pentru a deschide și mări imaginea';
  img.addEventListener('click', (e) => {
    e.stopPropagation();
    setActive(Number(cell.dataset.row), Number(cell.dataset.column));
    openImageModal(getDisplayImageUrl(rawUrl), rawUrl);
  });
  wrapper.appendChild(img);
  cell.appendChild(wrapper);
}

const imageModal = $('#image-modal');
const modalImage = $('#modal-image');
const modalBackdrop = $('#modal-backdrop');
const modalViewport = $('#modal-viewport');
const modalZoomLevel = $('#modal-zoom-level');
const modalZoomIn = $('#modal-zoom-in');
const modalZoomOut = $('#modal-zoom-out');
const modalZoomReset = $('#modal-zoom-reset');
const modalDownload = $('#modal-download');
const modalClose = $('#modal-close');

let modalZoom = 1;
let modalTranslateX = 0;
let modalTranslateY = 0;
let modalIsDragging = false;
let modalDragStartX = 0;
let modalDragStartY = 0;
let currentModalRawUrl = '';

function applyModalTransform() {
  modalImage.style.transform = `translate(${modalTranslateX}px, ${modalTranslateY}px) scale(${modalZoom})`;
  modalZoomLevel.textContent = `${Math.round(modalZoom * 100)}%`;
}

function setModalZoom(newZoom) {
  modalZoom = Math.min(5, Math.max(0.25, Math.round(newZoom * 100) / 100));
  if (modalZoom <= 1) {
    modalTranslateX = 0;
    modalTranslateY = 0;
  }
  applyModalTransform();
}

function openImageModal(displayUrl, rawUrl) {
  currentModalRawUrl = rawUrl || displayUrl;
  modalImage.src = displayUrl;
  modalZoom = 1;
  modalTranslateX = 0;
  modalTranslateY = 0;
  applyModalTransform();
  imageModal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeImageModal() {
  imageModal.hidden = true;
  modalImage.src = '';
  document.body.style.overflow = '';
}

async function downloadModalImage() {
  if (!currentModalRawUrl && !modalImage.src) return;
  const targetUrl = modalImage.src || currentModalRawUrl;
  setStatus('Se descarcă imaginea…');
  try {
    const response = await fetch(targetUrl, { mode: 'cors' });
    if (!response.ok) throw new Error('Descărcare eșuată');
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    const ext = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
    link.download = `imagine-sheetly-${Date.now()}.${ext}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(blobUrl);
    setStatus('Imaginea a fost descărcată.', 'success');
  } catch (err) {
    const link = document.createElement('a');
    link.href = currentModalRawUrl || targetUrl;
    link.target = '_blank';
    link.download = `imagine-sheetly-${Date.now()}.png`;
    link.click();
    setStatus('Imaginea a fost deschisă pentru descărcare.', 'success');
  }
}

function startFormulaEditing(cell) {
  const formula = cell.dataset.formula || '';
  cell.contentEditable = 'true';
  cell.removeAttribute('tabindex');
  cell.classList.remove('image-cell');
  cell.textContent = formula;
  cell.focus();
  const range = document.createRange();
  range.selectNodeContents(cell);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function cellName(row, column) { let name = ''; let n = column + 1; while (n) { const r = (n - 1) % 26; name = String.fromCharCode(65 + r) + name; n = Math.floor((n - 1) / 26); } return `${name}${row + 1}`; }

function setActive(row, column) {
  active = { row, column };
  document.querySelectorAll('.selected-cell').forEach((cell) => cell.classList.remove('selected-cell'));
  const cell = table.querySelector(`[data-row="${row}"][data-column="${column}"]`);
  if (cell) cell.classList.add('selected-cell');
  const isImage = cell?.dataset?.formula;
  selectionLabel.textContent = `Selectat: ${cellName(row, column)}${isImage ? ' (Imagine)' : ''}`;
}

function editableCell(value, row, column, tag = 'td') {
  const cell = document.createElement(tag);
  cell.spellcheck = false;
  cell.className = 'data-cell';
  cell.dataset.row = row;
  cell.dataset.column = column;

  const imageUrl = parseImageFormula(value);
  if (imageUrl) {
    const formulaValue = value.trim().startsWith('=') ? value : `=IMAGE("${imageUrl}")`;
    cell.dataset.formula = formulaValue;
    cell.classList.add('image-cell');
    cell.contentEditable = 'false';
    cell.tabIndex = 0;
    renderCellImage(cell, imageUrl);
  } else {
    cell.contentEditable = 'true';
    cell.textContent = value;
  }

  cell.addEventListener('focus', () => setActive(row, column));
  cell.addEventListener('click', () => setActive(row, column));
  cell.addEventListener('input', markDirty);

  cell.addEventListener('blur', () => {
    if (cell.isContentEditable) {
      const currentText = cell.textContent.trim();
      const detectedImage = parseImageFormula(currentText);
      if (detectedImage) {
        const formulaValue = currentText.startsWith('=') ? currentText : `=IMAGE("${detectedImage}")`;
        cell.dataset.formula = formulaValue;
        cell.classList.add('image-cell');
        cell.contentEditable = 'false';
        cell.tabIndex = 0;
        renderCellImage(cell, detectedImage);
      } else {
        delete cell.dataset.formula;
        cell.classList.remove('image-cell');
      }
    }
  });

  cell.addEventListener('keydown', (event) => {
    if (cell.dataset.formula && !cell.isContentEditable) {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        delete cell.dataset.formula;
        cell.classList.remove('image-cell');
        cell.contentEditable = 'true';
        cell.removeAttribute('tabindex');
        cell.innerHTML = '';
        cell.focus();
        markDirty();
        return;
      }
      if (event.key === 'F2' || event.key === 'Enter') {
        event.preventDefault();
        startFormulaEditing(cell);
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      cell.blur();
      const next = table.querySelector(`[data-row="${row + 1}"][data-column="${column}"]`);
      if (next) next.focus();
    }
    if (event.key === 'Escape' && cell.isContentEditable && cell.dataset.formula) {
      event.preventDefault();
      cell.contentEditable = 'false';
      cell.tabIndex = 0;
      cell.classList.add('image-cell');
      renderCellImage(cell, parseImageFormula(cell.dataset.formula));
      cell.blur();
    }
  });

  return cell;
}

function renderTable(data, resetHistory = true) {
  rows = rectangular(data.length ? data : [['Coloana 1']]); table.innerHTML = '';
  const header = table.createTHead().insertRow(); const corner = document.createElement('th'); corner.className = 'corner'; corner.textContent = '#'; header.appendChild(corner);
  rows[0].forEach((value, column) => header.appendChild(editableCell(value || `Coloana ${column + 1}`, 0, column, 'th')));
  const body = table.createTBody();
  rows.slice(1).forEach((row, rowIndex) => { const tr = body.insertRow(); const number = document.createElement('th'); number.className = 'row-number'; number.textContent = rowIndex + 1; tr.appendChild(number); row.forEach((value, column) => tr.appendChild(editableCell(value, rowIndex + 1, column))); });
  emptyState.hidden = data.length > 0; setActive(Math.min(active.row, rows.length - 1), Math.min(active.column, rows[0].length - 1));
  if (resetHistory) { history = [clone(rows)]; future = []; }
  const sidebar = $('#filter-sidebar');
  if (sidebar && !sidebar.hidden) {
    buildFilterSidebar();
  }
  applyFilters();
  updateUI();
}

function collectRows() {
  return [...table.querySelectorAll('thead tr, tbody tr')].map((tr) =>
    [...tr.querySelectorAll('.data-cell')].map((cell) => {
      if (cell.dataset.formula && !cell.isContentEditable) {
        return cell.dataset.formula;
      }
      return cell.textContent.trim();
    })
  );
}
function renderSheetOptions(sheets, selected) { sheetSelect.innerHTML = ''; sheets.forEach((sheet) => { const option = new Option(sheet.title, sheet.title, false, sheet.title === selected); sheetSelect.add(option); }); }
async function requestJson(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) { if (result.error === 'AUTH_REQUIRED') window.location.assign('/login'); throw new Error(result.error || 'Operația a eșuat.'); }
  return result;
}
async function loadDocument() {
  if (!urlInput.value.trim()) return setStatus('Introdu linkul documentului.', 'error');
  if (!workspace.hidden && dirty && !confirm('Renunți la modificările locale nesalvate și deschizi alt document?')) return;
  loadButton.disabled = true; setStatus('Se deschide documentul…');
  try {
    const result = await requestJson('/api/load', { method: 'POST', body: JSON.stringify({ url: urlInput.value.trim() }) });
    activeColumnFilters = {};
    renderTable(result.data);
    renderSheetOptions(result.sheets, result.title);
    sheetSelect.dataset.current = result.title;
    workspace.hidden = false;
    dirty = false;
    updateUI();
    setStatus(`Document deschis · ${result.title}`, 'success');
  }
  catch (error) { setStatus(error.message, 'error'); } finally { loadButton.disabled = false; }
}
async function saveDocument() {
  if (!dirty) return; saveButton.disabled = true; setStatus('Se salvează…');
  try { const result = await requestJson('/api/save', { method: 'POST', body: JSON.stringify({ data: collectRows() }) }); renderTable(result.data); dirty = false; updateUI(); setStatus('Toate modificările sunt salvate.', 'success'); return true; }
  catch (error) { setStatus(error.message, 'error'); updateUI(); return false; }
}
function requireSavedForRemoteOperation() {
  if (!dirty) return true;
  setStatus('Salvează manual modificările înainte de această operație.', 'error');
  return false;
}
async function resetDocument() {
  if (dirty && !confirm('Renunți la modificările locale nesalvate și reîncarci versiunea curentă din Google Sheets?')) return;
  try {
    setStatus('Se reîncarcă datele din Google Sheets…');
    const result = await requestJson('/api/data');
    activeColumnFilters = {};
    renderTable(result.data); dirty = false; updateUI();
    setStatus('Datele au fost reîncărcate din Google Sheets.', 'success');
  } catch (error) { setStatus(error.message, 'error'); }
}
async function selectSheet() {
  const requestedTitle = sheetSelect.value;
  if (!requireSavedForRemoteOperation()) { sheetSelect.value = sheetSelect.dataset.current; return; }
  try {
    const result = await requestJson('/api/sheet', { method: 'POST', body: JSON.stringify({ title: requestedTitle }) });
    activeColumnFilters = {};
    renderTable(result.data);
    sheetSelect.dataset.current = result.title;
    dirty = false;
    setStatus(`Foaia „${result.title}” este activă.`, 'success');
  } catch (error) { sheetSelect.value = sheetSelect.dataset.current; setStatus(error.message, 'error'); }
}
async function createSheet() {
  const title = prompt('Numele noii foi:'); if (!title?.trim()) return;
  if (!requireSavedForRemoteOperation()) return;
  try {
    const result = await requestJson('/api/sheet/create', { method: 'POST', body: JSON.stringify({ title: title.trim() }) });
    activeColumnFilters = {};
    renderSheetOptions(result.sheets, result.title);
    sheetSelect.dataset.current = result.title;
    renderTable(result.data);
    dirty = false;
    showTool('table');
    setStatus(`Foaia „${result.title}” a fost creată.`, 'success');
  } catch (error) { setStatus(error.message, 'error'); }
}
async function renameSheet() {
  const current = sheetSelect.value; const title = prompt('Noul nume al foii:', current);
  if (!title?.trim() || title.trim() === current) return;
  if (!requireSavedForRemoteOperation()) return;
  try { const result = await requestJson('/api/sheet/rename', { method: 'POST', body: JSON.stringify({ title: title.trim() }) }); renderSheetOptions(result.sheets, result.title); sheetSelect.dataset.current = result.title; setStatus(`Foaia a fost redenumită în „${result.title}”.`, 'success'); } catch (error) { setStatus(error.message, 'error'); }
}
async function deleteSheet() {
  if (!confirm(`Ștergi definitiv foaia „${sheetSelect.value}”?`)) return;
  if (!requireSavedForRemoteOperation()) return;
  try {
    const result = await requestJson('/api/sheet/delete', { method: 'POST' });
    activeColumnFilters = {};
    renderSheetOptions(result.sheets, result.title);
    sheetSelect.dataset.current = result.title;
    renderTable(result.data);
    dirty = false;
    setStatus('Foaia a fost ștearsă.', 'success');
  } catch (error) { setStatus(error.message, 'error'); }
}
function addRow() { rows = collectRows(); rows.push(Array(rows[0].length).fill('')); renderTable(rows, false); setActive(rows.length - 1, 0); markDirty(); table.querySelector(`[data-row="${rows.length - 1}"][data-column="0"]`)?.focus(); }
function deleteRow() { rows = collectRows(); if (rows.length <= 1) return setStatus('Păstrează cel puțin antetul.', 'error'); rows.splice(Math.max(1, active.row), 1); renderTable(rows, false); markDirty(); }
function addColumn() { rows = collectRows(); rows.forEach((row, index) => row.push(index ? '' : `Coloana ${row.length + 1}`)); renderTable(rows, false); setActive(active.row, rows[0].length - 1); markDirty(); }
function deleteColumn() { rows = collectRows(); if (rows[0].length <= 1) return setStatus('Păstrează cel puțin o coloană.', 'error'); activeColumnFilters = {}; rows.forEach((row) => row.splice(active.column, 1)); renderTable(rows, false); markDirty(); }
function undo() { if (history.length < 2) return; future.push(history.pop()); renderTable(history.at(-1), false); dirty = true; updateUI(); setStatus('Ultima modificare a fost anulată.', 'success'); }
function redo() { if (!future.length) return; const next = future.pop(); history.push(clone(next)); renderTable(next, false); dirty = true; updateUI(); setStatus('Modificarea a fost refăcută.', 'success'); }
function showTool(name) { toolsPanel.hidden = false; $('#table-tool').hidden = name !== 'table'; $('#diagram-tool').hidden = name !== 'diagram'; }
function closeTools() { toolsPanel.hidden = true; }
async function insertTable() { const values = $('#table-input').value.trim().split(/\r?\n/).filter(Boolean).map((line) => line.split(',').map((item) => item.trim())); if (!values.length) return setStatus('Introdu datele tabelului.', 'error'); const selected = table.querySelector(`[data-row="${active.row}"][data-column="${active.column}"]`); if (selected?.textContent.trim() && !confirm(`Tabelul va fi inserat de la ${cellName(active.row, active.column)} și poate înlocui date existente. Continui?`)) return; if (!requireSavedForRemoteOperation()) return; try { const result = await requestJson('/api/table', { method: 'POST', body: JSON.stringify({ values, startRow: active.row + 1, startColumn: active.column + 1 }) }); renderTable(result.data); $('#table-input').value = ''; closeTools(); dirty = false; setStatus(`Tabel inserat în ${result.range}.`, 'success'); } catch (error) { setStatus(error.message, 'error'); } }
async function insertDiagram() { const nodes = $('#diagram-input').value.trim().split(/\r?\n/).filter(Boolean).map((line) => { const [name = '', description = '', connectsTo = ''] = line.split('|').map((item) => item.trim()); return { name, description, connectsTo }; }); if (!nodes.length) return setStatus('Introdu elementele schemei.', 'error'); if (!requireSavedForRemoteOperation()) return; try { const result = await requestJson('/api/diagram', { method: 'POST', body: JSON.stringify({ name: $('#diagram-name').value, nodes }) }); renderTable(result.data); closeTools(); dirty = false; setStatus('Schema a fost inserată.', 'success'); } catch (error) { setStatus(error.message, 'error'); } }
function uploadImage(file) { if (file.size > 8 * 1024 * 1024) return setStatus('Imaginea poate avea cel mult 8 MB.', 'error'); if (!requireSavedForRemoteOperation()) return; const reader = new FileReader(); reader.onload = async () => { try { const result = await requestJson('/api/image', { method: 'POST', body: JSON.stringify({ dataUrl: reader.result, row: active.row, column: active.column }) }); renderTable(result.data); setStatus('Imaginea a fost adăugată în celula selectată.', 'success'); } catch (error) { setStatus(error.message, 'error'); } }; reader.readAsDataURL(file); }
function csvRows(text) { return text.replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter(Boolean).map((line) => line.match(/("(?:[^"]|"")*"|[^,]*)(,|$)/g).map((part) => part.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'))); }
function importCsv(file) { const reader = new FileReader(); reader.onload = () => { const parsed = csvRows(reader.result); if (!parsed.length) return setStatus('Fișierul CSV este gol.', 'error'); renderTable(parsed, false); markDirty(); setStatus('CSV importat local. Apasă Salvează pentru confirmare.', 'success'); }; reader.readAsText(file); }
function exportCsv() { const values = collectRows().map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(',')).join('\r\n'); const url = URL.createObjectURL(new Blob([`\uFEFF${values}`], { type: 'text/csv;charset=utf-8' })); const link = Object.assign(document.createElement('a'), { href: url, download: `${sheetSelect.value || 'sheet'}.csv` }); link.click(); URL.revokeObjectURL(url); }
function findNext() { const term = $('#find-input').value.trim().toLocaleLowerCase(); document.querySelectorAll('.search-hit').forEach((cell) => cell.classList.remove('search-hit')); if (!term) return; searchMatches = [...table.querySelectorAll('.data-cell')].filter((cell) => (cell.dataset.formula || cell.textContent).toLocaleLowerCase().includes(term)); if (!searchMatches.length) return setStatus('Niciun rezultat în foaia activă.', 'error'); searchMatches.forEach((cell) => cell.classList.add('search-hit')); searchIndex = (searchIndex + 1) % searchMatches.length; const cell = searchMatches[searchIndex]; setActive(Number(cell.dataset.row), Number(cell.dataset.column)); cell.focus(); cell.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' }); setStatus(`${searchMatches.length} rezultate găsite.`, 'success'); }
function toggleTheme() { const dark = document.body.classList.toggle('dark-mode'); localStorage.setItem('sheetly-theme', dark ? 'dark' : 'light'); $('#theme-button').textContent = dark ? '☀' : '◐'; }

loadButton.addEventListener('click', loadDocument); urlInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') loadDocument(); }); saveButton.addEventListener('click', saveDocument); $('#reset-button').addEventListener('click', resetDocument); sheetSelect.addEventListener('change', selectSheet); $('#rename-sheet-button').addEventListener('click', renameSheet); $('#new-sheet-button').addEventListener('click', createSheet); $('#delete-sheet-button').addEventListener('click', deleteSheet); $('#add-row-button').addEventListener('click', addRow); $('#delete-row-button').addEventListener('click', deleteRow); $('#add-column-button').addEventListener('click', addColumn); $('#delete-column-button').addEventListener('click', deleteColumn); $('#undo-button').addEventListener('click', undo); $('#redo-button').addEventListener('click', redo); $('#table-tool-button').addEventListener('click', () => showTool('table')); $('#diagram-tool-button').addEventListener('click', () => showTool('diagram')); $('#image-button').addEventListener('click', () => imageInput.click()); document.querySelectorAll('[data-close-tools]').forEach((button) => button.addEventListener('click', closeTools)); $('#insert-table-button').addEventListener('click', insertTable); $('#insert-diagram-button').addEventListener('click', insertDiagram); imageInput.addEventListener('change', () => { if (imageInput.files[0]) uploadImage(imageInput.files[0]); imageInput.value = ''; }); $('#import-button').addEventListener('click', () => importInput.click()); importInput.addEventListener('change', () => { if (importInput.files[0]) importCsv(importInput.files[0]); importInput.value = ''; }); $('#export-button').addEventListener('click', exportCsv); $('#find-next-button').addEventListener('click', findNext); $('#find-input').addEventListener('keydown', (event) => { if (event.key === 'Enter') findNext(); }); $('#theme-button').addEventListener('click', toggleTheme);
$('#filter-toggle-button').addEventListener('click', toggleFilterSidebar);
$('#close-filter-button').addEventListener('click', closeFilterSidebar);
$('#reset-filters-button').addEventListener('click', resetAllFilters);
$('#filter-column-search').addEventListener('input', filterColumnSearch);

modalClose.addEventListener('click', closeImageModal);
modalBackdrop.addEventListener('click', closeImageModal);
modalDownload.addEventListener('click', downloadModalImage);
modalZoomIn.addEventListener('click', () => setModalZoom(modalZoom + 0.25));
modalZoomOut.addEventListener('click', () => setModalZoom(modalZoom - 0.25));
modalZoomReset.addEventListener('click', () => { modalTranslateX = 0; modalTranslateY = 0; setModalZoom(1); });
modalViewport.addEventListener('wheel', (e) => { e.preventDefault(); const delta = e.deltaY < 0 ? 0.2 : -0.2; setModalZoom(modalZoom + delta); }, { passive: false });
modalViewport.addEventListener('mousedown', (e) => { if (e.button !== 0) return; modalIsDragging = true; modalDragStartX = e.clientX - modalTranslateX; modalDragStartY = e.clientY - modalTranslateY; });
window.addEventListener('mousemove', (e) => { if (!modalIsDragging || imageModal.hidden) return; modalTranslateX = e.clientX - modalDragStartX; modalTranslateY = e.clientY - modalDragStartY; applyModalTransform(); });
window.addEventListener('mouseup', () => { modalIsDragging = false; });

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !imageModal.hidden) { event.preventDefault(); closeImageModal(); return; }
  if (!imageModal.hidden) {
    if (event.key === '+' || event.key === '=') { event.preventDefault(); setModalZoom(modalZoom + 0.25); return; }
    if (event.key === '-' || event.key === '_') { event.preventDefault(); setModalZoom(modalZoom - 0.25); return; }
    if (event.key === '0') { event.preventDefault(); modalTranslateX = 0; modalTranslateY = 0; setModalZoom(1); return; }
  }
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.key.toLowerCase() === 's') { event.preventDefault(); saveDocument(); }
  if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
  if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
  if (modifier && event.key.toLowerCase() === 'f' && !workspace.hidden) { event.preventDefault(); $('#find-input').focus(); }
  if (modifier && event.key.toLowerCase() === 'i' && !workspace.hidden) { event.preventDefault(); imageInput.click(); }
});
if (localStorage.getItem('sheetly-theme') === 'dark') toggleTheme();
