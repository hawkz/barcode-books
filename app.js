/* ============================================================
   ISBN Scanner — app.js  (vanilla JS, no framework)
   Features: multi-library profiles, camera scanning via ZXing CDN,
   book lookup (Google Books + Open Library), Google Sheets sync,
   bookshelf view with Amazon UK links, PWA service worker registration.
   ============================================================ */

'use strict';

// ── Storage ──────────────────────────────────────────────────────────────────

const PROFILES_KEY = 'isbn_profiles';
const ACTIVE_KEY   = 'isbn_active';
const booksKey = id => `isbn_books_${id}`;

function loadProfiles() {
  try { return JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]'); }
  catch { return []; }
}
function saveProfiles(p) { localStorage.setItem(PROFILES_KEY, JSON.stringify(p)); }
function getActiveId()   { return localStorage.getItem(ACTIVE_KEY) || ''; }
function setActiveId(id) { localStorage.setItem(ACTIVE_KEY, id); }

function getActiveProfile() {
  const all = loadProfiles();
  if (!all.length) return null;
  return all.find(p => p.id === getActiveId()) || all[0];
}

function createProfile(name, settings) {
  const p = { id: `p_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, name, settings, createdAt: Date.now() };
  const all = loadProfiles(); all.push(p); saveProfiles(all);
  setActiveId(p.id);
  return p;
}

function updateProfile(id, name, settings) {
  saveProfiles(loadProfiles().map(p => p.id === id ? { ...p, name, settings } : p));
}

function deleteProfile(id) {
  const all = loadProfiles().filter(p => p.id !== id);
  saveProfiles(all);
  localStorage.removeItem(booksKey(id));
  if (getActiveId() === id) setActiveId(all[0]?.id || '');
}

function loadBooks(id) {
  try { return JSON.parse(localStorage.getItem(booksKey(id)) || '[]'); }
  catch { return []; }
}
function saveBook(book, id) {
  const books = loadBooks(id);
  if (!books.some(b => b.isbn === book.isbn)) {
    books.unshift(book);
    localStorage.setItem(booksKey(id), JSON.stringify(books));
  }
}
function removeBook(isbn, id) {
  localStorage.setItem(booksKey(id), JSON.stringify(loadBooks(id).filter(b => b.isbn !== isbn)));
}
function clearBooks(id) { localStorage.removeItem(booksKey(id)); }
function isScanned(isbn, id) { return loadBooks(id).some(b => b.isbn === isbn); }

// Migrate legacy single-profile data
function migrateLegacy() {
  if (loadProfiles().length) return;
  const raw = localStorage.getItem('isbn_scanner_settings');
  if (!raw) return;
  try {
    const s = JSON.parse(raw);
    const p = createProfile(s.sheetName || 'My Library', s);
    const books = localStorage.getItem('isbn_scanner_books');
    if (books) localStorage.setItem(booksKey(p.id), books);
    localStorage.removeItem('isbn_scanner_settings');
    localStorage.removeItem('isbn_scanner_books');
  } catch {}
}

// ── Book Lookup ───────────────────────────────────────────────────────────────

async function lookupISBN(isbn) {
  // Try Google Books first
  try {
    const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
    const d = await r.json();
    if (d.totalItems > 0) {
      const info = d.items[0].volumeInfo;
      return {
        isbn,
        title:         info.title || '',
        authors:       (info.authors || []).join(', '),
        publisher:     info.publisher || '',
        publishedDate: info.publishedDate || '',
        pageCount:     info.pageCount || '',
        categories:    (info.categories || []).join(', '),
        description:   info.description || '',
        coverUrl:      info.imageLinks?.thumbnail?.replace('http:', 'https:') || '',
        scannedAt:     new Date().toISOString(),
      };
    }
  } catch {}
  // Fallback: Open Library
  try {
    const r = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
    const d = await r.json();
    const key = `ISBN:${isbn}`;
    if (d[key]) {
      const b = d[key];
      return {
        isbn,
        title:         b.title || '',
        authors:       (b.authors || []).map(a => a.name).join(', '),
        publisher:     (b.publishers || []).map(p => p.name).join(', '),
        publishedDate: b.publish_date || '',
        pageCount:     b.number_of_pages || '',
        categories:    (b.subjects || []).slice(0,3).map(s => s.name).join(', '),
        description:   '',
        coverUrl:      b.cover?.medium || '',
        scannedAt:     new Date().toISOString(),
      };
    }
  } catch {}
  return { isbn, title: '', authors: '', publisher: '', publishedDate: '', pageCount: '', categories: '', description: '', coverUrl: '', scannedAt: new Date().toISOString() };
}

// ── Google Sheets Sync ────────────────────────────────────────────────────────

async function syncToSheet(scriptUrl, sheetName, book) {
  try {
    const url = `${scriptUrl}?sheetName=${encodeURIComponent(sheetName)}&isbn=${encodeURIComponent(book.isbn)}&title=${encodeURIComponent(book.title)}&authors=${encodeURIComponent(book.authors)}&publisher=${encodeURIComponent(book.publisher)}&publishedDate=${encodeURIComponent(book.publishedDate)}&pageCount=${encodeURIComponent(book.pageCount)}&categories=${encodeURIComponent(book.categories)}&scannedAt=${encodeURIComponent(book.scannedAt)}`;
    const r = await fetch(url, { method: 'GET', mode: 'no-cors' });
    return true;
  } catch { return false; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function spineColour(title) {
  const cols = ['#2D6A4F','#1B4332','#40916C','#6B4226','#8B5E3C','#1A3A5C','#2C5F8A','#4A1942','#6B2D5E','#7A3B1E','#5C3317','#1D4E89','#0D3B66','#4B0082','#7B2D8B'];
  let h = 0; for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) | 0;
  return cols[Math.abs(h) % cols.length];
}

function amazonURL(book) {
  const q = [book.title, book.authors].filter(Boolean).join(' ');
  return `https://www.amazon.co.uk/s?k=${encodeURIComponent(q)}&i=stripbooks`;
}

function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast-msg';
  el.style.cssText = `position:fixed;bottom:72px;left:50%;transform:translateX(-50%);z-index:9999;padding:.6rem 1.1rem;border-radius:8px;font-size:.875rem;font-weight:600;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.2);transition:opacity .4s;background:${type==='ok'?'#2D6A4F':type==='warn'?'#92400E':'#DC2626'};color:#fff;`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 2800);
}

// ── State ─────────────────────────────────────────────────────────────────────

let activeProfile = null;
let books = [];
let scannerRunning = false;
let codeReader = null;
let activeView = 'scan'; // 'scan' | 'shelf'
let deleteConfirmId = null;
let syncStatuses = {}; // isbn -> 'pending'|'synced'|'error'
let processing = false;
let shelfQuery = '';
let tooltip = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

// ── Render helpers ────────────────────────────────────────────────────────────

function renderHeader() {
  const name = activeProfile?.name || 'No library';
  $('lib-name').textContent = name;

  const settings = activeProfile?.settings;
  const sheetLink = $('sheet-link');
  if (settings?.spreadsheetUrl) {
    sheetLink.href = settings.spreadsheetUrl;
    sheetLink.classList.remove('hidden');
  } else {
    sheetLink.classList.add('hidden');
  }

  const dot = $('settings-dot');
  if (!settings?.scriptUrl) dot.classList.remove('hidden');
  else dot.classList.add('hidden');
}

function renderBanners() {
  const settings = activeProfile?.settings;
  $('banner-no-profile').classList.toggle('hidden', !!activeProfile);
  $('banner-no-sheet').classList.toggle('hidden', !activeProfile || !!settings?.scriptUrl);
  $('banner-connected').classList.toggle('hidden', !settings?.scriptUrl);
  if (settings?.sheetName) $('banner-sheet-name').textContent = settings.sheetName;
}

function renderTabBar() {
  $('tab-scan').classList.toggle('active', activeView === 'scan');
  $('tab-shelf').classList.toggle('active', activeView === 'shelf');
  const badge = $('shelf-badge');
  if (books.length > 0 && activeView !== 'shelf') {
    badge.textContent = books.length > 99 ? '99+' : books.length;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function renderViews() {
  $('view-scan').classList.toggle('hidden', activeView !== 'scan');
  $('view-shelf').classList.toggle('hidden', activeView !== 'shelf');
}

function renderBookList() {
  const list = $('book-list');
  const empty = $('book-list-empty');
  const badge = $('book-count-badge');
  const clearBtn = $('clear-all-btn');

  badge.textContent = books.length;
  badge.classList.toggle('hidden', books.length === 0);
  clearBtn.classList.toggle('hidden', books.length === 0);

  if (books.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  list.innerHTML = books.map(book => {
    const sync = syncStatuses[book.isbn];
    const syncDot = sync ? `<span class="sync-dot ${sync}" title="${sync}"></span>` : '';
    const cover = book.coverUrl
      ? `<img class="book-cover" src="${book.coverUrl}" alt="Cover of ${esc(book.title)}" loading="lazy">`
      : `<div class="book-cover-placeholder">${svgBook(24)}</div>`;
    const meta = [
      book.publishedDate ? `<span class="book-meta-item">${book.publishedDate.slice(0,4)}</span>` : '',
      book.pageCount ? `<span class="book-meta-item">${book.pageCount}pp</span>` : '',
      book.categories ? `<span class="book-meta-item">${esc(book.categories.split(',')[0].trim())}</span>` : '',
    ].join('');
    return `
    <div class="book-card" data-isbn="${esc(book.isbn)}">
      <div class="book-card-main" role="button" tabindex="0" aria-expanded="false" onclick="toggleCard(this)" onkeydown="if(event.key==='Enter')toggleCard(this)">
        ${cover}
        <div class="book-info">
          <div class="book-title">${esc(book.title || 'Unknown Title')}</div>
          ${book.authors ? `<div class="book-author">${esc(book.authors)}</div>` : ''}
          <div class="book-meta">${meta}</div>
        </div>
        <div class="book-card-actions">
          ${syncDot}
          <button class="icon-btn" onclick="event.stopPropagation();removeBookUI('${esc(book.isbn)}')" aria-label="Remove book" title="Remove">
            ${svgTrash(16)}
          </button>
        </div>
      </div>
      <div class="book-card-detail">
        ${book.description ? `<p>${esc(book.description)}</p>` : '<p class="text-muted">No description available.</p>'}
        <div class="book-isbn">ISBN: ${esc(book.isbn)}</div>
        ${book.publisher ? `<div class="book-isbn">Publisher: ${esc(book.publisher)}</div>` : ''}
        <div style="margin-top:.75rem">
          <a href="${amazonURL(book)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline" style="font-size:.8rem;padding:.35rem .75rem">
            ${svgCart(14)} Search Amazon UK
          </a>
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderShelf() {
  const container = $('shelf-rows');
  const footer = $('shelf-footer');
  const filtered = shelfQuery
    ? books.filter(b =>
        b.title?.toLowerCase().includes(shelfQuery) ||
        b.authors?.toLowerCase().includes(shelfQuery) ||
        b.isbn.includes(shelfQuery))
    : books;

  $('shelf-heading-name').textContent = activeProfile?.name || 'My Bookshelf';
  $('shelf-count-badge').textContent = books.length;
  $('shelf-count-badge').classList.toggle('hidden', books.length === 0);

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state">${svgBook(48)}<p>${books.length === 0 ? 'No books scanned yet.' : 'No books match your search.'}</p></div>`;
    footer.textContent = '';
    return;
  }

  const PER_SHELF = 8;
  let html = '';
  for (let i = 0; i < filtered.length; i += PER_SHELF) {
    const row = filtered.slice(i, i + PER_SHELF);
    html += `<div class="shelf-row"><div class="shelf-books">`;
    row.forEach(book => {
      const col = spineColour(book.title || book.isbn);
      const inner = book.coverUrl
        ? `<img src="${book.coverUrl}" alt="${esc(book.title)}" loading="lazy">`
        : `<div class="book-spine-text"><span>${esc(book.title || book.isbn)}</span></div>`;
      html += `
        <a class="book-spine" href="${amazonURL(book)}" target="_blank" rel="noopener noreferrer"
           style="background:${col}"
           data-title="${esc(book.title||'Unknown')}"
           data-author="${esc(book.authors||'')}"
           data-year="${esc((book.publishedDate||'').slice(0,4))}"
           aria-label="Search Amazon UK for ${esc(book.title||book.isbn)}"
           onmouseenter="showTooltip(event,this)" onmouseleave="hideTooltip()"
           onfocus="showTooltip(event,this)" onblur="hideTooltip()">
          ${inner}
          <div class="book-spine-isbn">${esc(book.isbn.slice(-4))}</div>
          <div class="book-spine-hover">${svgCart(20)}</div>
        </a>`;
    });
    html += `</div><div class="shelf-plank"></div><div class="shelf-shadow"></div></div>`;
  }
  container.innerHTML = html;
  footer.innerHTML = `${filtered.length} ${filtered.length===1?'book':'books'}${shelfQuery?` matching "${esc(shelfQuery)}"`:''} &middot; Click any book to search Amazon UK`;
}

function renderDropdown() {
  const profiles = loadProfiles();
  const list = $('lib-dropdown-list');
  list.innerHTML = profiles.length === 0
    ? `<div class="dropdown-label" style="padding:.75rem">No libraries yet.</div>`
    : profiles.map(p => {
        const isActive = p.id === activeProfile?.id;
        const count = loadBooks(p.id).length;
        const isConfirm = deleteConfirmId === p.id;
        return `
        <div class="dropdown-item${isActive?' active':''}" onclick="switchProfile('${p.id}')">
          <span style="flex-shrink:0;width:14px">${isActive ? svgCheck(14) : ''}</span>
          <span class="item-name">${esc(p.name)}</span>
          <span class="item-count">${count}</span>
          <span class="item-actions" onclick="event.stopPropagation()">
            <button class="item-action-btn" onclick="openEditProfile('${p.id}')" aria-label="Edit ${esc(p.name)}">${svgPencil(12)}</button>
            <button class="item-action-btn delete${isConfirm?' confirm':''}" onclick="confirmDelete('${p.id}')" title="${isConfirm?'Click again to confirm':''}" aria-label="Delete ${esc(p.name)}">${svgTrash(12)}</button>
          </span>
        </div>`;
      }).join('');
}

function renderAll() {
  renderHeader();
  renderBanners();
  renderTabBar();
  renderViews();
  renderBookList();
  renderShelf();
  renderDropdown();
}

// ── UI Actions ────────────────────────────────────────────────────────────────

window.toggleCard = function(el) {
  const detail = el.closest('.book-card').querySelector('.book-card-detail');
  const open = detail.classList.toggle('open');
  el.setAttribute('aria-expanded', open);
};

window.removeBookUI = function(isbn) {
  if (!activeProfile) return;
  removeBook(isbn, activeProfile.id);
  books = loadBooks(activeProfile.id);
  delete syncStatuses[isbn];
  renderBookList();
  renderShelf();
  renderDropdown();
  renderTabBar();
  toast('Book removed', 'ok');
};

window.switchProfile = function(id) {
  setActiveId(id);
  activeProfile = getActiveProfile();
  books = loadBooks(activeProfile?.id);
  syncStatuses = {};
  stopScanner();
  closeDropdown();
  renderAll();
};

window.confirmDelete = function(id) {
  if (deleteConfirmId === id) {
    const p = loadProfiles().find(x => x.id === id);
    deleteProfile(id);
    activeProfile = getActiveProfile();
    books = loadBooks(activeProfile?.id || '');
    syncStatuses = {};
    deleteConfirmId = null;
    toast(`Deleted "${p?.name}"`, 'warn');
    renderAll();
  } else {
    deleteConfirmId = id;
    renderDropdown();
    setTimeout(() => { deleteConfirmId = null; renderDropdown(); }, 3000);
  }
};

window.openEditProfile = function(id) {
  const p = loadProfiles().find(x => x.id === id);
  if (!p) return;
  closeDropdown();
  $('profile-modal-title').textContent = 'Edit Library';
  $('profile-modal-id').value = id;
  $('profile-name').value = p.name;
  $('profile-sheet-name').value = p.settings.sheetName || '';
  $('profile-script-url').value = p.settings.scriptUrl || '';
  $('profile-spreadsheet-url').value = p.settings.spreadsheetUrl || '';
  $('profile-modal').classList.remove('hidden');
};

window.showTooltip = function(e, el) {
  if (!tooltip) return;
  tooltip.querySelector('.tt-title').textContent  = el.dataset.title;
  tooltip.querySelector('.tt-author').textContent = el.dataset.author;
  tooltip.querySelector('.tt-year').textContent   = el.dataset.year;
  tooltip.classList.add('visible');
  positionTooltip(e);
};
window.hideTooltip = function() { tooltip?.classList.remove('visible'); };

function positionTooltip(e) {
  if (!tooltip) return;
  const x = Math.min(e.clientX + 12, window.innerWidth - 200);
  const y = Math.max(e.clientY - 80, 8);
  tooltip.style.left = x + 'px';
  tooltip.style.top  = y + 'px';
}

// ── Scanner ───────────────────────────────────────────────────────────────────

let scanControls = null;

async function startScanner() {
  if (scannerRunning) return;
  const wrap = $('scanner-wrap');
  const placeholder = $('scanner-placeholder');
  const video = $('scanner-video');
  const startBtn = $('scanner-start-btn');

  try {
    const ZXing = window.ZXingBrowser;
    if (!ZXing) { toast('Scanner library not loaded', 'error'); return; }

    // listVideoInputDevices is a static method on BrowserCodeReader (base class)
    const devices = await ZXing.BrowserCodeReader.listVideoInputDevices();
    const deviceId = devices.find(d => /back|rear|environment/i.test(d.label))?.deviceId
                     || devices[0]?.deviceId
                     || undefined;

    codeReader = new ZXing.BrowserMultiFormatReader();

    placeholder.classList.add('hidden');
    wrap.classList.remove('hidden');
    scannerRunning = true;
    startBtn.innerHTML = `${svgCameraOff(16)} Stop`;
    startBtn.classList.remove('btn-primary');
    startBtn.classList.add('btn-danger');

    // decodeFromVideoDevice returns a controls object with a stop() method
    scanControls = await codeReader.decodeFromVideoDevice(deviceId, video, (result, err) => {
      if (!result) return;
      const text = result.getText();
      if (/^\d{9}[\dX]$|^\d{13}$/.test(text)) {
        handleISBN(text);
      }
    });
  } catch (err) {
    toast('Camera access denied or unavailable', 'error');
    console.error(err);
    stopScanner();
  }
}

function stopScanner() {
  if (scanControls) { try { scanControls.stop(); } catch {} scanControls = null; }
  if (codeReader) { try { codeReader.reset(); } catch {} codeReader = null; }
  scannerRunning = false;
  const startBtn = $('scanner-start-btn');
  if (startBtn) {
    startBtn.innerHTML = `${svgCamera(16)} Start Scanner`;
    startBtn.classList.add('btn-primary');
    startBtn.classList.remove('btn-danger');
  }
  $('scanner-wrap')?.classList.add('hidden');
  $('scanner-placeholder')?.classList.remove('hidden');
}

// ── ISBN Processing ───────────────────────────────────────────────────────────

async function handleISBN(isbn) {
  if (processing) return;
  if (!activeProfile) { toast('Please set up a library first', 'warn'); return; }
  if (isScanned(isbn, activeProfile.id)) { toast(`Already scanned: ${isbn}`, 'warn'); return; }

  processing = true;
  // Flash
  const flash = $('flash-overlay');
  if (flash) { flash.classList.add('active'); setTimeout(() => flash.classList.remove('active'), 700); }

  const statusEl = $('scan-status');
  if (statusEl) { statusEl.textContent = `Looking up ISBN ${isbn}…`; statusEl.classList.remove('hidden'); }

  try {
    const book = await lookupISBN(isbn);
    saveBook(book, activeProfile.id);
    books = loadBooks(activeProfile.id);

    toast(book.title ? `Found: ${book.title}` : `Scanned: ${isbn}`, 'ok');

    // Sync to sheet
    const s = activeProfile.settings;
    if (s?.scriptUrl) {
      syncStatuses[isbn] = 'pending';
      renderBookList();
      const ok = await syncToSheet(s.scriptUrl, s.sheetName, book);
      syncStatuses[isbn] = ok ? 'synced' : 'error';
    }

    renderBookList();
    renderShelf();
    renderDropdown();
    renderTabBar();
  } catch (err) {
    toast('Failed to look up ISBN', 'error');
    console.error(err);
  } finally {
    processing = false;
    if (statusEl) statusEl.classList.add('hidden');
  }
}

// ── Dropdown open/close ───────────────────────────────────────────────────────

function openDropdown() {
  renderDropdown();
  $('lib-dropdown').classList.remove('hidden');
}
function closeDropdown() { $('lib-dropdown').classList.add('hidden'); }

// ── Modal helpers ─────────────────────────────────────────────────────────────

function openAddProfile() {
  closeDropdown();
  $('profile-modal-title').textContent = 'Add Library';
  $('profile-modal-id').value = '';
  $('profile-name').value = '';
  $('profile-sheet-name').value = '';
  $('profile-script-url').value = '';
  $('profile-spreadsheet-url').value = '';
  $('profile-modal').classList.remove('hidden');
}

function saveProfileModal() {
  const id   = $('profile-modal-id').value;
  const name = $('profile-name').value.trim();
  const settings = {
    sheetName:      $('profile-sheet-name').value.trim(),
    scriptUrl:      $('profile-script-url').value.trim(),
    spreadsheetUrl: $('profile-spreadsheet-url').value.trim(),
  };
  if (!name) { toast('Please enter a library name', 'warn'); return; }
  if (id) {
    updateProfile(id, name, settings);
    if (activeProfile?.id === id) {
      activeProfile = getActiveProfile();
      books = loadBooks(activeProfile.id);
    }
    toast(`Updated "${name}"`, 'ok');
  } else {
    const p = createProfile(name, settings);
    activeProfile = p;
    books = loadBooks(p.id);
    toast(`Created "${name}"`, 'ok');
  }
  $('profile-modal').classList.add('hidden');
  renderAll();
}

// Setup dialog tabs
let setupTab = 'guide';
function switchSetupTab(tab) {
  setupTab = tab;
  ['guide','connection'].forEach(t => {
    $(`setup-tab-${t}`).classList.toggle('active', t === tab);
    $(`setup-pane-${t}`).classList.toggle('hidden', t !== tab);
  });
}

function saveSetupConnection() {
  const scriptUrl      = $('setup-script-url').value.trim();
  const sheetName      = $('setup-sheet-name').value.trim() || 'Books';
  const spreadsheetUrl = $('setup-spreadsheet-url').value.trim();
  if (!scriptUrl) { toast('Please enter the Apps Script URL', 'warn'); return; }
  if (!activeProfile) {
    const p = createProfile(sheetName, { scriptUrl, sheetName, spreadsheetUrl });
    activeProfile = p;
    books = loadBooks(p.id);
  } else {
    updateProfile(activeProfile.id, activeProfile.name, { scriptUrl, sheetName, spreadsheetUrl });
    activeProfile = getActiveProfile();
  }
  $('setup-modal').classList.add('hidden');
  toast('Settings saved', 'ok');
  renderAll();
}

function openSetupModal() {
  const s = activeProfile?.settings;
  $('setup-script-url').value      = s?.scriptUrl || '';
  $('setup-sheet-name').value      = s?.sheetName || '';
  $('setup-spreadsheet-url').value = s?.spreadsheetUrl || '';
  switchSetupTab('guide');
  $('setup-modal').classList.remove('hidden');
}

// Copy code button
window.copyCode = function() {
  const code = $('apps-script-code').textContent;
  navigator.clipboard.writeText(code).then(() => toast('Code copied!', 'ok')).catch(() => toast('Copy failed', 'error'));
};

// ── SVG icons (inline, no external deps) ─────────────────────────────────────

function svgBook(s)      { return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`; }
function svgCamera(s)    { return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`; }
function svgCameraOff(s) { return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34"/><circle cx="12" cy="13" r="4"/></svg>`; }
function svgSearch(s)    { return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`; }
function svgTrash(s)     { return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`; }
function svgSettings(s)  { return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`; }
function svgExternal(s)  { return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`; }
function svgScan(s)      { return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 7 4"/><polyline points="17 4 20 4 20 7"/><polyline points="20 17 20 20 17 20"/><polyline points="7 20 4 20 4 17"/><line x1="4" y1="12" x2="20" y2="12"/></svg>`; }
function svgLibrary(s)   { return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`; }
function svgChevron(s)   { return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`; }
function svgCheck(s)     { return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`; }
function svgPlus(s)      { return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`; }
function svgPencil(s)    { return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`; }
function svgClose(s)     { return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`; }
function svgAlert(s)     { return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`; }
function svgOk(s)        { return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`; }
function svgCart(s)      { return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>`; }
function svgCopy(s)      { return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`; }

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  migrateLegacy();
  activeProfile = getActiveProfile();
  books = loadBooks(activeProfile?.id || '');

  // Inject icon SVGs into static elements
  $('icon-book').innerHTML       = svgBook(20);
  $('icon-settings').innerHTML   = svgSettings(18);
  $('icon-chevron').innerHTML    = svgChevron(14);
  $('icon-scan-tab').innerHTML   = svgScan(20);
  $('icon-shelf-tab').innerHTML  = svgLibrary(20);
  $('icon-search').innerHTML     = svgSearch(14);
  $('icon-look-up').innerHTML    = svgSearch(14);
  $('icon-close-setup').innerHTML = svgClose(18);
  $('icon-close-profile').innerHTML = svgClose(18);
  $('icon-add-lib').innerHTML    = svgPlus(14);
  $('banner-warn-icon').innerHTML  = svgAlert(16);
  $('banner-warn2-icon').innerHTML = svgAlert(16);
  $('banner-ok-icon').innerHTML    = svgOk(16);
  $('empty-icon').innerHTML      = svgBook(48);
  $('icon-copy-code').innerHTML  = svgCopy(14);
  $('icon-external').innerHTML   = svgExternal(14);
  $('scanner-placeholder-icon').innerHTML = svgCamera(40);

  // Create tooltip element
  tooltip = document.createElement('div');
  tooltip.className = 'spine-tooltip';
  tooltip.innerHTML = `<div class="tt-title"></div><div class="tt-author"></div><div class="tt-year"></div><div class="tt-amz">${svgCart(10)} Search Amazon UK</div>`;
  document.body.appendChild(tooltip);
  document.addEventListener('mousemove', e => { if (tooltip.classList.contains('visible')) positionTooltip(e); });

  // Open setup if no profiles
  if (!activeProfile) openSetupModal();

  renderAll();

  // ── Event listeners ──

  // Library switcher dropdown
  $('lib-switcher-btn').addEventListener('click', e => {
    e.stopPropagation();
    const dd = $('lib-dropdown');
    if (dd.classList.contains('hidden')) openDropdown(); else closeDropdown();
  });
  $('lib-add-btn').addEventListener('click', openAddProfile);
  document.addEventListener('click', e => {
    if (!$('lib-dropdown-wrap').contains(e.target)) closeDropdown();
  });

  // Settings button
  $('settings-btn').addEventListener('click', openSetupModal);

  // Scanner
  $('scanner-start-btn').addEventListener('click', () => {
    if (scannerRunning) stopScanner(); else startScanner();
  });

  // Manual entry
  $('manual-input').addEventListener('keydown', e => { if (e.key === 'Enter') doManualLookup(); });
  $('manual-lookup-btn').addEventListener('click', doManualLookup);

  // Clear all
  $('clear-all-btn').addEventListener('click', () => {
    if (!activeProfile) return;
    if (!confirm('Remove all scanned books from this library? (Your Google Sheet data is not affected.)')) return;
    clearBooks(activeProfile.id);
    books = [];
    syncStatuses = {};
    renderBookList(); renderShelf(); renderDropdown(); renderTabBar();
    toast('Library cleared', 'warn');
  });

  // Tab bar
  $('tab-scan').addEventListener('click', () => { activeView = 'scan'; renderTabBar(); renderViews(); });
  $('tab-shelf').addEventListener('click', () => { activeView = 'shelf'; renderTabBar(); renderViews(); renderShelf(); });

  // Shelf search
  $('shelf-search-input').addEventListener('input', e => {
    shelfQuery = e.target.value.toLowerCase();
    renderShelf();
  });

  // Setup modal
  $('setup-tab-guide').addEventListener('click', () => switchSetupTab('guide'));
  $('setup-tab-connection').addEventListener('click', () => switchSetupTab('connection'));
  $('setup-save-btn').addEventListener('click', saveSetupConnection);
  $('icon-close-setup').parentElement.addEventListener('click', () => $('setup-modal').classList.add('hidden'));
  $('setup-modal').addEventListener('click', e => { if (e.target === $('setup-modal')) $('setup-modal').classList.add('hidden'); });

  // Profile modal
  $('profile-save-btn').addEventListener('click', saveProfileModal);
  $('profile-cancel-btn').addEventListener('click', () => $('profile-modal').classList.add('hidden'));
  $('icon-close-profile').parentElement.addEventListener('click', () => $('profile-modal').classList.add('hidden'));
  $('profile-modal').addEventListener('click', e => { if (e.target === $('profile-modal')) $('profile-modal').classList.add('hidden'); });

  // Service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
});

async function doManualLookup() {
  const isbn = $('manual-input').value.trim().replace(/[-\s]/g, '');
  if (!isbn) return;
  if (!/^\d{9}[\dX]$|^\d{13}$/.test(isbn)) { toast('Please enter a valid 10 or 13 digit ISBN', 'warn'); return; }
  $('manual-input').value = '';
  await handleISBN(isbn);
}
