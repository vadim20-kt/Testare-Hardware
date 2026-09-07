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
function updateInsights() {
  const data = collectRows(); const rowCount = Math.max(0, data.length - 1); const columnCount = data[0]?.length || 0;
  $('#rows-count').textContent = rowCount; $('#columns-count').textContent = columnCount; $('#cells-count').textContent = rowCount * columnCount;
  $('#save-state').textContent = dirty ? 'Modificări locale' : 'Sincronizat';
}
function updateUI() { saveButton.disabled = !dirty; $('#undo-button').disabled = history.length < 2; $('#redo-button').disabled = !future.length; updateInsights(); }
function recordHistory() { const snapshot = clone(collectRows()); const previous = history.at(-1); if (!previous || JSON.stringify(previous) !== JSON.stringify(snapshot)) { history.push(snapshot); if (history.length > 60) history.shift(); future = []; } }
function markDirty() { recordHistory(); dirty = true; updateUI(); setStatus('Ai modificări nesalvate. Apasă Salvează pentru confirmare.'); }
function cellName(row, column) { let name = ''; let n = column + 1; while (n) { const r = (n - 1) % 26; name = String.fromCharCode(65 + r) + name; n = Math.floor((n - 1) / 26); } return `${name}${row + 1}`; }

function setActive(row, column) {
  active = { row, column };
  document.querySelectorAll('.selected-cell').forEach((cell) => cell.classList.remove('selected-cell'));
  const cell = table.querySelector(`[data-row="${row}"][data-column="${column}"]`);
  if (cell) cell.classList.add('selected-cell');
  selectionLabel.textContent = `Selectat: ${cellName(row, column)}`;
}
function editableCell(value, row, column, tag = 'td') {
  const cell = document.createElement(tag); cell.contentEditable = 'true'; cell.spellcheck = false;
  cell.className = 'data-cell'; cell.textContent = value; cell.dataset.row = row; cell.dataset.column = column;
  cell.addEventListener('focus', () => setActive(row, column));
  cell.addEventListener('click', () => setActive(row, column));
  cell.addEventListener('input', markDirty);
  cell.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); const next = table.querySelector(`[data-row="${row + 1}"][data-column="${column}"]`); if (next) next.focus(); }
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
  if (resetHistory) { history = [clone(rows)]; future = []; } updateUI();
}
function collectRows() {
  return [...table.querySelectorAll('thead tr, tbody tr')].map((tr) => [...tr.querySelectorAll('.data-cell')].map((cell) => cell.textContent.trim()));
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
  try { const result = await requestJson('/api/load', { method: 'POST', body: JSON.stringify({ url: urlInput.value.trim() }) }); renderTable(result.data); renderSheetOptions(result.sheets, result.title); sheetSelect.dataset.current = result.title; workspace.hidden = false; dirty = false; updateUI(); setStatus(`Document deschis · ${result.title}`, 'success'); }
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
    renderTable(result.data); dirty = false; updateUI();
    setStatus('Datele au fost reîncărcate din Google Sheets.', 'success');
  } catch (error) { setStatus(error.message, 'error'); }
}
async function selectSheet() {
  const requestedTitle = sheetSelect.value;
  if (!requireSavedForRemoteOperation()) { sheetSelect.value = sheetSelect.dataset.current; return; }
  try { const result = await requestJson('/api/sheet', { method: 'POST', body: JSON.stringify({ title: requestedTitle }) }); renderTable(result.data); sheetSelect.dataset.current = result.title; dirty = false; setStatus(`Foaia „${result.title}” este activă.`, 'success'); } catch (error) { sheetSelect.value = sheetSelect.dataset.current; setStatus(error.message, 'error'); }
}
async function createSheet() {
  const title = prompt('Numele noii foi:'); if (!title?.trim()) return;
  if (!requireSavedForRemoteOperation()) return;
  try { const result = await requestJson('/api/sheet/create', { method: 'POST', body: JSON.stringify({ title: title.trim() }) }); renderSheetOptions(result.sheets, result.title); sheetSelect.dataset.current = result.title; renderTable(result.data); dirty = false; showTool('table'); setStatus(`Foaia „${result.title}” a fost creată.`, 'success'); } catch (error) { setStatus(error.message, 'error'); }
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
  try { const result = await requestJson('/api/sheet/delete', { method: 'POST' }); renderSheetOptions(result.sheets, result.title); sheetSelect.dataset.current = result.title; renderTable(result.data); dirty = false; setStatus('Foaia a fost ștearsă.', 'success'); } catch (error) { setStatus(error.message, 'error'); }
}
function addRow() { rows = collectRows(); rows.push(Array(rows[0].length).fill('')); renderTable(rows, false); setActive(rows.length - 1, 0); markDirty(); table.querySelector(`[data-row="${rows.length - 1}"][data-column="0"]`)?.focus(); }
function deleteRow() { rows = collectRows(); if (rows.length <= 1) return setStatus('Păstrează cel puțin antetul.', 'error'); rows.splice(Math.max(1, active.row), 1); renderTable(rows, false); markDirty(); }
function addColumn() { rows = collectRows(); rows.forEach((row, index) => row.push(index ? '' : `Coloana ${row.length + 1}`)); renderTable(rows, false); setActive(active.row, rows[0].length - 1); markDirty(); }
function deleteColumn() { rows = collectRows(); if (rows[0].length <= 1) return setStatus('Păstrează cel puțin o coloană.', 'error'); rows.forEach((row) => row.splice(active.column, 1)); renderTable(rows, false); markDirty(); }
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
function findNext() { const term = $('#find-input').value.trim().toLocaleLowerCase(); document.querySelectorAll('.search-hit').forEach((cell) => cell.classList.remove('search-hit')); if (!term) return; searchMatches = [...table.querySelectorAll('.data-cell')].filter((cell) => cell.textContent.toLocaleLowerCase().includes(term)); if (!searchMatches.length) return setStatus('Niciun rezultat în foaia activă.', 'error'); searchMatches.forEach((cell) => cell.classList.add('search-hit')); searchIndex = (searchIndex + 1) % searchMatches.length; const cell = searchMatches[searchIndex]; setActive(Number(cell.dataset.row), Number(cell.dataset.column)); cell.focus(); cell.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' }); setStatus(`${searchMatches.length} rezultate găsite.`, 'success'); }
function toggleTheme() { const dark = document.body.classList.toggle('dark-mode'); localStorage.setItem('sheetly-theme', dark ? 'dark' : 'light'); $('#theme-button').textContent = dark ? '☀' : '◐'; }

loadButton.addEventListener('click', loadDocument); urlInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') loadDocument(); }); saveButton.addEventListener('click', saveDocument); $('#reset-button').addEventListener('click', resetDocument); sheetSelect.addEventListener('change', selectSheet); $('#rename-sheet-button').addEventListener('click', renameSheet); $('#new-sheet-button').addEventListener('click', createSheet); $('#delete-sheet-button').addEventListener('click', deleteSheet); $('#add-row-button').addEventListener('click', addRow); $('#delete-row-button').addEventListener('click', deleteRow); $('#add-column-button').addEventListener('click', addColumn); $('#delete-column-button').addEventListener('click', deleteColumn); $('#undo-button').addEventListener('click', undo); $('#redo-button').addEventListener('click', redo); $('#table-tool-button').addEventListener('click', () => showTool('table')); $('#diagram-tool-button').addEventListener('click', () => showTool('diagram')); $('#image-button').addEventListener('click', () => imageInput.click()); document.querySelectorAll('[data-close-tools]').forEach((button) => button.addEventListener('click', closeTools)); $('#insert-table-button').addEventListener('click', insertTable); $('#insert-diagram-button').addEventListener('click', insertDiagram); imageInput.addEventListener('change', () => { if (imageInput.files[0]) uploadImage(imageInput.files[0]); imageInput.value = ''; }); $('#import-button').addEventListener('click', () => importInput.click()); importInput.addEventListener('change', () => { if (importInput.files[0]) importCsv(importInput.files[0]); importInput.value = ''; }); $('#export-button').addEventListener('click', exportCsv); $('#find-next-button').addEventListener('click', findNext); $('#find-input').addEventListener('keydown', (event) => { if (event.key === 'Enter') findNext(); }); $('#theme-button').addEventListener('click', toggleTheme);
document.addEventListener('keydown', (event) => { const modifier = event.ctrlKey || event.metaKey; if (modifier && event.key.toLowerCase() === 's') { event.preventDefault(); saveDocument(); } if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); } if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); } if (modifier && event.key.toLowerCase() === 'f' && !workspace.hidden) { event.preventDefault(); $('#find-input').focus(); } if (modifier && event.key.toLowerCase() === 'i' && !workspace.hidden) { event.preventDefault(); imageInput.click(); } });
if (localStorage.getItem('sheetly-theme') === 'dark') toggleTheme();
