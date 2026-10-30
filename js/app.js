import * as pdfjs from '../vendor/pdfjs/pdf.min.mjs';
import { DriveStore, LocalStore, AuthError, ConflictError } from './store.js';
import { CURRICULUM, FORMATS, CHOICES } from './math.js';
import { GOOGLE_CLIENT_ID } from '../config.js';

window.__pbStarted = true;
pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
// 글꼴이 내장되지 않은 PDF(한글 CID 글꼴 등)용 데이터 — 필요할 때만 CDN에서 받음
const PDFJS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/';
const PDF_OPTS = { cMapUrl: PDFJS_CDN + 'cmaps/', cMapPacked: true, standardFontDataUrl: PDFJS_CDN + 'standard_fonts/' };
const PAGE_W = 2200;      // 페이지를 그릴 가로 픽셀 (자르기 해상도)
const MAX_PHOTO = 3000;   // 사진 원본 긴 변 최대 픽셀

// ================================================================ 공통
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stars = d => '★'.repeat(d) + '☆'.repeat(5 - d);
const nowISO = () => new Date().toISOString();
const ls = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
function toast(msg, ms = 2400) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), ms);
}
function tex(el) {
  window.renderMathInElement?.(el, {
    delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }, { left: '\\(', right: '\\)', display: false }],
    throwOnError: false,
  });
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ================================================================ 시작 / 로그인
const params = new URLSearchParams(location.search);
let store, bank;

function show(id) {
  for (const s of ['setup', 'login', 'loading']) $('#' + s).classList.toggle('hidden', s !== id);
  $('#app').classList.toggle('hidden', id !== 'app');
}

async function boot() {
  if (params.has('local')) store = new LocalStore();
  else {
    const cid = GOOGLE_CLIENT_ID || ls.get('pb_client_id');
    if (!cid) { $('#originHint').textContent = location.origin; show('setup'); return; }
    store = new DriveStore(cid);
    if (!store.signedIn) { show('login'); return; }
  }
  await start();
}

async function start() {
  show('loading');
  $('#loadingMsg').textContent = store.kind === 'drive' ? 'Google 드라이브에서 불러오는 중…' : '불러오는 중…';
  try {
    bank = await store.init();
  } catch (e) {
    $('#loginErr').textContent = e instanceof AuthError ? '' : e.message;
    show('login');
    return;
  }
  show('app');
  initApp();
}

$('#setupForm').onsubmit = e => {
  e.preventDefault();
  const v = $('#clientIdInput').value.trim();
  if (!/\.apps\.googleusercontent\.com$/.test(v)) return toast('…apps.googleusercontent.com 으로 끝나는 ID를 넣어주세요');
  ls.set('pb_client_id', v);
  boot();
};
$('#loginBtn').onclick = async () => {
  $('#loginErr').textContent = '';
  try { await store.signIn(); await start(); } catch (e) { $('#loginErr').textContent = e.message; }
};
$('#resetClient').onclick = () => { localStorage.removeItem('pb_client_id'); location.reload(); };

// ================================================================ 저장 (bank.json)
let dirty = false, saving = null;
const saveSoon = debounce(() => flush(), 700);

function setSave(msg, warn) { const s = $('#saveState'); s.textContent = msg; s.classList.toggle('err', !!warn); }

function commit() {
  dirty = true;
  setSave('저장 대기…');
  saveSoon();
  refreshMeta();
}

async function flush(force = false) {
  if (!dirty) return;
  if (saving) { saveSoon(); return; }
  dirty = false;
  setSave('저장 중…');
  saving = store.saveBank(bank, force)
    .then(() => setSave(store.kind === 'drive' ? '✓ 드라이브에 저장됨' : '✓ 저장됨'))
    .catch(e => { dirty = true; handleError(e); })
    .finally(() => { saving = null; });
  return saving;
}

async function handleError(e) {
  console.error(e);
  if (e instanceof AuthError) {
    $('#reauth').classList.remove('hidden');
    setSave('⚠ 저장 안 됨 (로그인 필요)', true);
  } else if (e instanceof ConflictError) {
    if (confirm('다른 기기나 탭에서 저장소가 바뀌었습니다.\n\n[확인] 최신 내용 불러오기 (이 화면에서 방금 바꾼 내용은 사라짐)\n[취소] 지금 화면 내용으로 덮어쓰기')) {
      dirty = false;
      bank = await store.init();
      renderAll();
      setSave('↻ 최신 내용을 불러왔습니다');
    } else {
      dirty = true;
      flush(true);
    }
  } else {
    setSave('⚠ 저장 실패', true);
    toast(e.message, 5000);
    setTimeout(() => dirty && flush(), 5000);
  }
}

$('#reauthBtn').onclick = async () => {
  try { await store.signIn(); $('#reauth').classList.add('hidden'); flush(); toast('다시 로그인되었습니다'); }
  catch (e) { toast(e.message); }
};
$('#logoutBtn').onclick = async () => {
  if (dirty || saving) await flush();
  store.signOut(); location.reload();
};
window.addEventListener('beforeunload', e => { if (dirty || saving) { e.preventDefault(); e.returnValue = ''; } });

// ================================================================ 이미지 (드라이브 → blob URL)
const urlCache = new Map();
function imgURL(fid) {
  if (!urlCache.has(fid)) {
    urlCache.set(fid, store.getBlob(fid).then(b => URL.createObjectURL(b)).catch(e => { urlCache.delete(fid); throw e; }));
  }
  return urlCache.get(fid);
}
const io = new IntersectionObserver(entries => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    io.unobserve(en.target);
    loadImg(en.target);
  }
}, { rootMargin: '400px' });
function loadImg(img) {
  return imgURL(img.dataset.fid).then(u => {
    img.src = u;
    return img.decode().catch(() => {});
  }).catch(e => { img.alt = '이미지를 불러오지 못함'; img.classList.add('broken'); if (e instanceof AuthError) handleError(e); });
}
// 화면에 보일 때 불러오기
function hydrate(root) { $$('img[data-fid]:not([src])', root).forEach(i => io.observe(i)); }
const imgTag = (fid, cls = '', style = '') => fid ? `<img data-fid="${esc(fid)}" class="${cls}" style="${style}" alt="">` : '';
// 시험지: 원본 A4 폭(210mm) 기준 실제 크기로, 칸보다 크면 칸에 맞춤
const printImg = (fid, frac) => imgTag(fid, '', frac ? `width:${(frac * 210).toFixed(1)}mm` : 'width:100%');

// ================================================================ 메타 / 자동완성
const count = (arr) => arr.reduce((m, v) => (v && m.set(v, (m.get(v) || 0) + 1), m), new Map());
const sortKo = (a, b) => String(a).localeCompare(String(b), 'ko', { numeric: true });

function refreshMeta() {
  $('#totalCount').textContent = bank.problems.length || '';
  const P = bank.problems;
  const subjects = [...new Set([...Object.keys(CURRICULUM), ...P.map(p => p.subject).filter(Boolean)])];
  $('#dl-subject').innerHTML = subjects.map(s => `<option value="${esc(s)}">`).join('');
  $('#dl-qtype').innerHTML = [...count(P.map(p => p.qtype)).keys()].sort(sortKo).map(s => `<option value="${esc(s)}">`).join('');
  $('#dl-source').innerHTML = [...count(P.map(p => p.source)).keys()].sort(sortKo).map(s => `<option value="${esc(s)}">`).join('');
  $('#dl-unit-all').innerHTML = [...new Set([...Object.values(CURRICULUM).flat(), ...P.map(p => p.unit).filter(Boolean)])].map(s => `<option value="${esc(s)}">`).join('');
  updateUnitList();
}
function unitsFor(subject) {
  const used = bank.problems.filter(p => !subject || p.subject === subject).map(p => p.unit).filter(Boolean);
  return [...new Set([...(CURRICULUM[subject] || []), ...used])];
}
function updateUnitList() {
  $('#dl-unit').innerHTML = unitsFor($('#metaForm').elements.subject.value.trim()).map(s => `<option value="${esc(s)}">`).join('');
}

// ================================================================ 탭
function initTabs() {
  $$('.tab').forEach(b => b.onclick = () => showTab(b.dataset.tab));
}
function showTab(name) {
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tabpane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'bank') renderBank();
  if (name === 'sheet') renderCart();
  if (name === 'input') renderRecent();
}

// ================================================================ ① 입력: 업로드
async function normalizePhoto(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error(`${file.name}: 이 사진 형식은 브라우저에서 열 수 없습니다 (HEIC라면 JPG로 바꿔서 올려주세요)`); }
  const k = Math.min(1, MAX_PHOTO / Math.max(bmp.width, bmp.height));
  const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
}

function setFiles(files) {
  pendingFiles = [...files];
  $('#dropText').innerHTML = pendingFiles.length
    ? `<b>${pendingFiles.length}개 선택됨</b><br><small>${esc(pendingFiles.map(f => f.name).join(', '))}</small>`
    : 'PDF·사진을 끌어다 놓거나 클릭<br><small>여러 장 한꺼번에 가능</small>';
  if (pendingFiles.length && !$('#docName').value) $('#docName').value = pendingFiles[0].name.replace(/\.[^.]+$/, '');
}
let pendingFiles = [];

function initUpload() {
  const drop = $('#drop');
  $('#fileInput').onchange = e => setFiles(e.target.files);
  $('#cameraInput').onchange = e => { setFiles([...pendingFiles, ...e.target.files]); e.target.value = ''; };
  ['dragover', 'dragenter'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, () => drop.classList.remove('over')));
  drop.addEventListener('drop', e => { e.preventDefault(); setFiles(e.dataTransfer.files); });

  $('#uploadForm').onsubmit = async e => {
    e.preventDefault();
    if (!pendingFiles.length) return toast('파일을 선택하세요');
    const btn = $('#uploadBtn'), prog = $('#uploadProg');
    btn.disabled = true;
    const doc = { id: 'd' + Date.now().toString(36), name: $('#docName').value.trim() || pendingFiles[0].name, kind: $('#docKind').value, files: [], createdAt: nowISO() };
    try {
      for (const [i, f] of pendingFiles.entries()) {
        prog.textContent = `(${i + 1}/${pendingFiles.length}) ${f.name} 올리는 중…`;
        if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
          const data = await f.arrayBuffer();
          const pdf = await pdfjs.getDocument({ data: data.slice(0), ...PDF_OPTS }).promise;
          const fid = await store.putFile(new Blob([data], { type: 'application/pdf' }), f.name, 'src');
          pdfCache.set(fid, Promise.resolve(pdf));
          doc.files.push({ fid, type: 'pdf', pages: pdf.numPages, name: f.name });
        } else {
          const blob = await normalizePhoto(f);
          const fid = await store.putFile(blob, f.name.replace(/\.[^.]+$/, '') + '.jpg', 'src');
          doc.files.push({ fid, type: 'image', pages: 1, name: f.name });
        }
      }
      bank.docs.push(doc);
      commit();
      setFiles([]); $('#fileInput').value = ''; $('#docName').value = '';
      prog.textContent = '';
      renderDocs(); openDoc(doc.id);
      toast(`${docPages(doc).length}페이지 올림`);
    } catch (err) {
      prog.textContent = '';
      if (doc.files.length) { bank.docs.push(doc); commit(); renderDocs(); }
      err instanceof AuthError ? handleError(err) : toast(err.message, 5000);
    }
    btn.disabled = false;
  };
}

function docPages(doc) {
  return doc.files.flatMap(f => Array.from({ length: f.pages }, (_, i) => ({ fid: f.fid, type: f.type, p: i + 1 })));
}

const KIND = { problem: '문제', solution: '해설', both: '문제+해설' };
function renderDocs() {
  const docs = [...bank.docs].reverse();
  $('#docList').innerHTML = docs.map(d => {
    const n = bank.problems.filter(p => p.docId === d.id).length;
    return `<li data-id="${d.id}" class="${DOC?.id === d.id ? 'active' : ''}">
      <span class="kind ${d.kind}">${KIND[d.kind]}</span>
      <span class="name" title="${esc(d.name)}">${esc(d.name)}</span>
      <span class="muted small">${docPages(d).length}p·${n}문</span>
      <button class="del" title="문서 삭제">✕</button></li>`;
  }).join('') || '<li class="muted small">아직 올린 문서가 없습니다</li>';
  $$('#docList li[data-id]').forEach(li => {
    li.onclick = () => openDoc(li.dataset.id);
    li.querySelector('.del').onclick = ev => {
      ev.stopPropagation();
      const d = bank.docs.find(x => x.id === li.dataset.id);
      if (!confirm(`'${d.name}' 원본을 삭제할까요?\n이미 잘라서 저장한 문제는 그대로 남습니다.`)) return;
      d.files.forEach(f => store.deleteFile(f.fid));
      bank.docs = bank.docs.filter(x => x !== d);
      if (DOC === d) { DOC = null; renderPage(); }
      commit(); renderDocs();
    };
  });
}

// ================================================================ ① 입력: 페이지 보기 & 영역
let DOC = null, PAGES = [], pageIdx = 0, regions = [], mode = 'problem', renderSeq = 0;
const pdfCache = new Map();     // fid → Promise<PDFDocument>
const canvasCache = new Map();  // "fid:p" → Promise<canvas>

function getPdf(fid) {
  if (!pdfCache.has(fid)) {
    pdfCache.set(fid, store.getBlob(fid).then(b => b.arrayBuffer()).then(data => pdfjs.getDocument({ data, ...PDF_OPTS }).promise)
      .catch(e => { pdfCache.delete(fid); throw e; }));
  }
  return pdfCache.get(fid);
}

function pageCanvas(pg) {
  const key = pg.fid + ':' + pg.p;
  if (canvasCache.has(key)) {
    const v = canvasCache.get(key); canvasCache.delete(key); canvasCache.set(key, v); // LRU
    return v;
  }
  const job = (async () => {
    const c = document.createElement('canvas');
    if (pg.type === 'pdf') {
      const page = await (await getPdf(pg.fid)).getPage(pg.p);
      const vp = page.getViewport({ scale: Math.min(4, PAGE_W / page.getViewport({ scale: 1 }).width) });
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    } else {
      const bmp = await createImageBitmap(await store.getBlob(pg.fid));
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
    }
    return c;
  })().catch(e => { canvasCache.delete(key); throw e; });
  canvasCache.set(key, job);
  while (canvasCache.size > 8) canvasCache.delete(canvasCache.keys().next().value);
  return job;
}

function openDoc(id) {
  DOC = bank.docs.find(d => d.id === id);
  PAGES = docPages(DOC); pageIdx = 0; regions = [];
  $$('#docList li').forEach(li => li.classList.toggle('active', li.dataset.id === id));
  setMode(DOC.kind === 'solution' ? 'solution' : 'problem');
  renderPage();
}

async function renderPage() {
  const cv = $('#pageCanvas');
  if (!DOC) {
    $('#docTitle').textContent = '왼쪽에서 문서를 선택하세요'; $('#pageInfo').textContent = '-';
    cv.width = cv.height = 0; $('#overlay').innerHTML = ''; return;
  }
  $('#docTitle').textContent = DOC.name;
  $('#pageInfo').textContent = `${pageIdx + 1} / ${PAGES.length}`;
  const seq = ++renderSeq;
  $('#pageLoading').classList.remove('hidden');
  try {
    const src = await pageCanvas(PAGES[pageIdx]);
    if (seq !== renderSeq) return;
    cv.width = src.width; cv.height = src.height;
    cv.getContext('2d').drawImage(src, 0, 0);
    drawRects();
    if (PAGES[pageIdx + 1]) pageCanvas(PAGES[pageIdx + 1]).catch(() => {}); // 다음 페이지 미리 그리기
  } catch (e) {
    if (seq === renderSeq) e instanceof AuthError ? handleError(e) : toast('페이지를 열지 못했습니다: ' + e.message, 5000);
  } finally {
    if (seq === renderSeq) $('#pageLoading').classList.add('hidden');
  }
}

function savedRectsOnPage() {
  const out = [];
  for (const p of bank.problems) {
    if (p.docId === DOC.id) (p.regions || []).filter(r => r.pg === pageIdx).forEach(r => out.push({ ...r, label: `#${p.id}` }));
    if (p.solDocId === DOC.id) (p.solRegions || []).filter(r => r.pg === pageIdx).forEach(r => out.push({ ...r, label: `#${p.id} 해설` }));
  }
  return out;
}

function drawRects(temp) {
  if (!DOC) return;
  const pct = v => (v * 100).toFixed(3) + '%';
  const box = r => `left:${pct(r.x)};top:${pct(r.y)};width:${pct(r.w)};height:${pct(r.h)}`;
  let html = savedRectsOnPage().map(r => `<div class="rect saved" style="${box(r)}"><span class="lbl">${esc(r.label)}</span></div>`).join('');
  const n = { problem: 0, solution: 0 };
  regions.forEach((r, i) => {
    n[r.kind]++;
    if (r.pg !== pageIdx) return;
    html += `<div class="rect ${r.kind}" style="${box(r)}"><span class="lbl">${r.kind === 'problem' ? '문제' : '해설'} ${n[r.kind]}</span><button class="x" data-i="${i}" title="지우기">✕</button></div>`;
  });
  if (temp) html += `<div class="rect ${mode}" style="${box(temp)}"></div>`;
  $('#overlay').innerHTML = html;
  $$('#overlay .x').forEach(b => {
    b.onpointerdown = e => e.stopPropagation();
    b.onclick = e => { e.stopPropagation(); regions.splice(+b.dataset.i, 1); drawRects(); };
  });
  const p = regions.filter(r => r.kind === 'problem').length, s = regions.filter(r => r.kind === 'solution').length;
  $('#regionSummary').textContent = p || s ? `지정한 영역: 문제 ${p} · 해설 ${s}` : '페이지 위를 드래그하세요';
}

function initViewer() {
  const wrap = $('#pageWrap');
  let start = null;
  const rel = e => {
    const b = wrap.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)) };
  };
  const rectOf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  wrap.addEventListener('pointerdown', e => {
    if (!DOC || e.button !== 0 || !$('#pageCanvas').width) return;
    start = rel(e); wrap.setPointerCapture(e.pointerId);
  });
  wrap.addEventListener('pointermove', e => { if (start) drawRects(rectOf(start, rel(e))); });
  const end = e => {
    if (!start) return;
    const r = rectOf(start, rel(e)); start = null;
    if (r.w > 0.01 && r.h > 0.005) regions.push({ ...r, pg: pageIdx, kind: mode });
    drawRects();
    if (mode === 'solution') $('#attachBox').classList.remove('hidden');
  };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', () => { start = null; drawRects(); });

  const go = d => {
    if (!DOC) return;
    const n = pageIdx + d;
    if (n < 0 || n >= PAGES.length) return;
    pageIdx = n; renderPage(); $('#pageScroll').scrollTop = 0;
  };
  $('#prevPage').onclick = () => go(-1);
  $('#nextPage').onclick = () => go(1);
  $('#zoom').oninput = e => { wrap.style.maxWidth = (9 * e.target.value) + 'px'; ls.set('pb_zoom', e.target.value); };
  $('#zoom').value = ls.get('pb_zoom', 100); $('#zoom').oninput({ target: $('#zoom') });
  $('#clearRegions').onclick = () => { regions = []; drawRects(); };

  document.addEventListener('keydown', e => {
    if (!$('#tab-input').classList.contains('active') || $('#editDlg').open) return;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveProblem(); return; }
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    // e.code 사용: 한글 입력 상태에서도 동작
    if (e.code === 'ArrowLeft') go(-1);
    else if (e.code === 'ArrowRight') go(1);
    else if (e.code === 'KeyQ') setMode('problem');
    else if (e.code === 'KeyW') setMode('solution');
    else if (e.code === 'KeyZ' && regions.length) { regions.pop(); drawRects(); }
  });

  $$('.mode').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  $('#attachSearch').oninput = debounce(renderAttach, 200);
}

function setMode(m) {
  mode = m;
  $$('.mode').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  $('#attachBox').classList.toggle('hidden', m !== 'solution' && !regions.some(r => r.kind === 'solution'));
  if (m === 'solution') renderAttach();
}

// 해설을 붙일 문제 고르기
let attachTarget = null;
function renderAttach() {
  const q = $('#attachSearch').value.trim();
  let list = [...bank.problems].reverse();
  if (q) list = list.filter(p => [p.source, p.number, p.unit, p.qtype, '#' + p.id].join(' ').includes(q));
  list = list.slice(0, 60);
  $('#attachList').innerHTML = list.map(p => `
    <div class="attach-item ${attachTarget === p.id ? 'sel' : ''}" data-id="${p.id}">
      ${imgTag(p.image, 'thumb')}
      <div>#${p.id} ${esc(p.source)} ${esc(p.number)}${p.number ? '번' : ''}<br><span class="muted">${esc(p.unit)} ${p.solImage ? '· 해설 있음' : ''}</span></div>
    </div>`).join('') || '<div class="muted small">문제가 없습니다</div>';
  $$('#attachList .attach-item').forEach(el => el.onclick = () => {
    const id = +el.dataset.id;
    attachTarget = attachTarget === id ? null : id;
    $$('#attachList .attach-item').forEach(x => x.classList.toggle('sel', +x.dataset.id === attachTarget));
  });
  hydrate($('#attachList'));
}

// ================================================================ ① 입력: 저장
const STICKY = ['subject', 'format', 'unit', 'qtype', 'source', 'difficulty', 'tags'];

function readForm(form) {
  const o = {};
  for (const el of form.elements) if (el.name) o[el.name] = el.value.trim();
  return {
    subject: o.subject || '', format: o.format || '', unit: o.unit || '', qtype: o.qtype || '',
    source: o.source || '', number: o.number || '', answer: o.answer || '', solutionText: o.solutionText || '',
    memo: o.memo || '', difficulty: Math.min(5, Math.max(1, +o.difficulty || 3)),
    tags: [...new Set((o.tags || '').split(/[,#]/).map(t => t.trim()).filter(Boolean))],
  };
}

async function cropRegions(rs) {
  const parts = [];
  for (const r of rs) {
    const c = await pageCanvas(PAGES[r.pg]);
    const sx = Math.round(r.x * c.width), sy = Math.round(r.y * c.height);
    const sw = Math.max(1, Math.round(r.w * c.width)), sh = Math.max(1, Math.round(r.h * c.height));
    parts.push({ c, sx, sy, sw, sh });
  }
  const gap = 16;
  const W = Math.max(...parts.map(p => p.sw));
  const H = parts.reduce((s, p) => s + p.sh, 0) + gap * (parts.length - 1);
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  let y = 0;
  for (const p of parts) { ctx.drawImage(p.c, p.sx, p.sy, p.sw, p.sh, 0, y, p.sw, p.sh); y += p.sh + gap; }
  return new Promise(res => out.toBlob(res, 'image/webp', 0.95));
}

// 원본 페이지 대비 가로 비율 → 시험지에서 원래 글씨 크기로 출력하는 데 사용
const widthFrac = rs => rs.length ? +Math.max(...rs.map(r => r.w)).toFixed(4) : null;

async function cropAndUpload(rs, label) {
  const blob = await cropRegions(rs);
  const ext = blob.type === 'image/webp' ? 'webp' : 'png';
  return store.putFile(blob, `${label}.${ext}`, 'img');
}

let busy = false;
async function saveProblem() {
  if (busy) return;
  if (!DOC) return toast('먼저 문서를 열고 영역을 지정하세요');
  const meta = readForm($('#metaForm'));
  const strip = ({ pg, x, y, w, h }) => ({ pg, x: +x.toFixed(4), y: +y.toFixed(4), w: +w.toFixed(4), h: +h.toFixed(4) });
  const probR = regions.filter(r => r.kind === 'problem').map(strip);
  const solR = regions.filter(r => r.kind === 'solution').map(strip);
  if (!probR.length && !solR.length) return toast('페이지에서 영역을 드래그하세요');

  let target = null;
  if (!probR.length) {
    target = bank.problems.find(p => p.id === attachTarget);
    if (!target) { setMode('solution'); return toast('해설을 붙일 문제를 오른쪽 목록에서 고르세요'); }
  }
  busy = true; $('#saveBtn').disabled = true; setSave('이미지 올리는 중…');
  try {
    const t = nowISO();
    if (probR.length) {
      const id = bank.nextId;
      const label = `${meta.source || '문제'} ${meta.number || ''} #${id}`.replace(/\s+/g, ' ');
      const [image, solImage] = await Promise.all([
        cropAndUpload(probR, label),
        solR.length ? cropAndUpload(solR, label + ' 해설') : null,
      ]);
      bank.nextId = Math.max(bank.nextId, id + 1);
      bank.problems.push({ id, ...meta, image, solImage, docId: DOC.id, regions: probR, wFrac: widthFrac(probR),
        solDocId: solR.length ? DOC.id : null, solRegions: solR, solWFrac: widthFrac(solR), createdAt: t, updatedAt: t });
      toast(`#${id} 저장됨`);
    } else {
      const solImage = await cropAndUpload(solR, `${target.source || '문제'} ${target.number || ''} #${target.id} 해설`);
      store.deleteFile(target.solImage);
      Object.assign(target, { solImage, solDocId: DOC.id, solRegions: solR, solWFrac: widthFrac(solR), updatedAt: t });
      if (meta.answer) target.answer = meta.answer;
      if (meta.solutionText) target.solutionText = meta.solutionText;
      toast(`#${target.id}에 해설을 붙였습니다`);
      // 다음 문제 자동 선택
      const next = bank.problems.find(p => p.id > target.id && p.source === target.source && !p.solImage);
      attachTarget = next ? next.id : null;
    }
    commit();
    regions = [];
    const f = $('#metaForm').elements;
    ls.set('pb_sticky', Object.fromEntries(STICKY.map(k => [k, f[k].value])));
    if (probR.length) f.number.value = /^\d+$/.test(meta.number) ? +meta.number + 1 : '';
    f.answer.value = ''; f.solutionText.value = ''; updateTexPreview();
    drawRects(); setMode(mode); renderDocs(); renderRecent();
  } catch (e) {
    e instanceof AuthError ? handleError(e) : toast('저장 실패: ' + e.message, 5000);
    setSave('⚠ 저장 실패', true);
  }
  busy = false; $('#saveBtn').disabled = false;
}

function initForm() {
  const form = $('#metaForm'), f = form.elements;
  const sticky = ls.get('pb_sticky', { subject: '대수', difficulty: '3' });
  STICKY.forEach(k => { if (sticky[k] != null) f[k].value = sticky[k]; });
  form.onsubmit = e => { e.preventDefault(); saveProblem(); };
  f.subject.addEventListener('input', updateUnitList);

  $('.choices').innerHTML = CHOICES.map(c => `<button type="button" data-a="${c}">${c}</button>`).join('');
  $$('.choices button').forEach(b => b.onclick = () => { f.answer.value = b.dataset.a; if (!f.format.value) f.format.value = '객관식'; });

  const pick = $('#diffPick');
  pick.innerHTML = [1, 2, 3, 4, 5].map(n => `<button type="button" data-d="${n}" title="난이도 ${n}">★</button>`).join('');
  const paint = () => $$('button', pick).forEach(b => b.classList.toggle('on', +b.dataset.d <= +f.difficulty.value));
  $$('button', pick).forEach(b => b.onclick = () => { f.difficulty.value = b.dataset.d; paint(); });
  paint();

  $$('.tex-preview').forEach(pv => {
    const ta = pv.parentElement.querySelector(`[name="${pv.dataset.for}"]`);
    ta.addEventListener('input', debounce(() => updateTexPreview(pv, ta), 250));
  });
}
function updateTexPreview(pv = $('#metaForm .tex-preview'), ta) {
  ta ||= pv.parentElement.querySelector(`[name="${pv.dataset.for}"]`);
  const v = ta.value;
  pv.textContent = v;
  pv.classList.toggle('hidden', !/\$|\\\(/.test(v));
  tex(pv);
}

function renderRecent() {
  const list = [...bank.problems].reverse().slice(0, 6);
  $('#recent').innerHTML = list.length ? '<h4>최근 저장</h4>' + list.map(p => `
    <div class="recent-item">${imgTag(p.image, 'thumb')}
      <div class="grow">#${p.id} ${esc(p.unit)}<br><span class="muted">${esc(p.source)} ${esc(p.number)} · 정답 <span class="ans-inline">${esc(p.answer || '없음')}</span>${p.solImage || p.solutionText ? ' · 해설✓' : ''}</span></div>
      <button class="link small" data-edit="${p.id}">수정</button></div>`).join('') : '';
  $$('#recent [data-edit]').forEach(b => b.onclick = () => openEdit(+b.dataset.edit));
  hydrate($('#recent')); tex($('#recent'));
}

// ================================================================ ② 문제 은행
const FILTERS = ['subject', 'unit', 'qtype', 'format', 'source', 'tag'];
let cart = ls.get('pb_cart', []);
let shown = 0, BANKVIEW = [];
function saveCart() { ls.set('pb_cart', cart); $('#cartCount').textContent = cart.length || ''; }

function filterVals() {
  const o = {};
  for (const el of $$('#filters [name]')) o[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  return o;
}
function applyFilters(P = bank.problems) {
  const f = filterVals();
  return P.filter(p =>
    (!f.subject || p.subject === f.subject) && (!f.unit || p.unit === f.unit) && (!f.qtype || p.qtype === f.qtype) &&
    (!f.format || p.format === f.format) && (!f.source || p.source === f.source) && (!f.tag || p.tags?.includes(f.tag)) &&
    (!f.dmin || p.difficulty >= +f.dmin) && (!f.dmax || p.difficulty <= +f.dmax) &&
    (!f.missing || !p.answer || (!p.solImage && !p.solutionText)) &&
    (!f.q || [p.subject, p.unit, p.qtype, p.source, p.number, p.memo, p.solutionText, p.answer, ...(p.tags || []), '#' + p.id].join(' ').toLowerCase().includes(f.q.toLowerCase())));
}
function fillFilterSelects() {
  const f = filterVals();
  // 과목을 고르면 단원 목록이 그 과목 것만
  const base = bank.problems.filter(p => !f.subject || p.subject === f.subject);
  const src = { subject: bank.problems, unit: base, qtype: base, format: base, source: bank.problems, tag: base };
  for (const sel of $$('#filters select[data-ph]')) {
    const vals = sel.name === 'tag' ? src.tag.flatMap(p => p.tags || []) : src[sel.name].map(p => p[sel.name]);
    const m = count(vals);
    let keys = [...m.keys()];
    if (sel.name === 'unit' && CURRICULUM[f.subject]) {
      const order = CURRICULUM[f.subject];
      keys.sort((a, b) => ((order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999)) || sortKo(a, b));
    } else keys.sort(sortKo);
    if (f[sel.name] && !m.has(f[sel.name])) keys.unshift(f[sel.name]);
    sel.innerHTML = `<option value="">${sel.dataset.ph} 전체</option>` + keys.map(k => `<option value="${esc(k)}">${esc(k)} (${m.get(k) || 0})</option>`).join('');
    sel.value = f[sel.name];
  }
}

function initBank() {
  $$('#filters [name]').forEach(el => el.addEventListener(el.type === 'search' ? 'input' : 'change', debounce(renderBank, 120)));
  $('#resetFilters').onclick = () => { $$('#filters [name]').forEach(el => el.type === 'checkbox' ? el.checked = false : el.value = ''); renderBank(); };
  $('#showAns').onchange = e => $('#grid').classList.toggle('show-ans', e.target.checked);
  $('#selectAll').onclick = () => {
    BANKVIEW.forEach(p => { if (!cart.includes(p.id)) cart.push(p.id); });
    saveCart(); renderGrid(); toast(`총 ${cart.length}문제 담김`);
  };
  $('#randBtn').onclick = () => {
    const pool = BANKVIEW.filter(p => !cart.includes(p.id));
    const n = Math.min(+$('#randN').value || 10, pool.length);
    if (!n) return toast('조건에 맞는 (아직 안 담은) 문제가 없습니다');
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    pool.slice(0, n).forEach(p => cart.push(p.id));
    saveCart(); renderGrid();
    toast(`${n}문제를 무작위로 담았습니다 (총 ${cart.length})`);
  };
}

function renderBank() {
  fillFilterSelects();
  BANKVIEW = applyFilters().sort((a, b) => sortKo(a.subject, b.subject) || sortKo(a.unit, b.unit) || a.id - b.id);
  $('#resultInfo').textContent = `${BANKVIEW.length}문제`;
  shown = 0;
  $('#grid').innerHTML = '';
  renderGrid(true);
}

function cardHTML(p) {
  const inCart = cart.includes(p.id);
  return `<div class="card ${inCart ? 'in' : ''}" data-id="${p.id}">
    <div class="img">${imgTag(p.image)}</div>
    <div class="body">
      <div class="chips">
        <span class="chip">#${p.id}</span>
        ${p.subject ? `<span class="chip">${esc(p.subject)}</span>` : ''}
        ${p.unit ? `<span class="chip u">${esc(p.unit)}</span>` : ''}
        ${p.qtype ? `<span class="chip t">${esc(p.qtype)}</span>` : ''}
        ${p.format ? `<span class="chip">${esc(p.format)}</span>` : ''}
        <span class="stars" title="난이도 ${p.difficulty}">${stars(p.difficulty)}</span>
      </div>
      <div class="muted small">${esc(p.source)} ${esc(p.number)}${p.number ? '번' : ''} ${(p.tags || []).map(t => '#' + esc(t)).join(' ')}</div>
      ${!p.answer || (!p.solImage && !p.solutionText) ? `<div class="chips">${!p.answer ? '<span class="chip warn">정답 없음</span>' : ''}${!p.solImage && !p.solutionText ? '<span class="chip warn">해설 없음</span>' : ''}</div>` : ''}
      <div class="ans">
        <b>정답</b> <span>${esc(p.answer || '-')}</span>
        ${p.solutionText ? `<div class="txt">${esc(p.solutionText)}</div>` : ''}
        ${imgTag(p.solImage)}
      </div>
      <div class="actions">
        <button class="add ${inCart ? '' : 'primary'}">${inCart ? '✓ 담김' : '+ 담기'}</button>
        <button class="edit">수정</button>
      </div>
    </div></div>`;
}

function renderGrid(append) {
  const grid = $('#grid');
  if (!append) { // 담기 상태만 갱신
    $$('.card', grid).forEach(c => {
      const inCart = cart.includes(+c.dataset.id);
      c.classList.toggle('in', inCart);
      const b = $('.add', c); b.textContent = inCart ? '✓ 담김' : '+ 담기'; b.classList.toggle('primary', !inCart);
    });
    return;
  }
  $('#moreBtn')?.remove();
  const next = BANKVIEW.slice(shown, shown + 120);
  shown += next.length;
  grid.insertAdjacentHTML('beforeend', next.map(cardHTML).join('') || (shown ? '' : '<p class="muted">조건에 맞는 문제가 없습니다.</p>'));
  if (shown < BANKVIEW.length) grid.insertAdjacentHTML('beforeend', `<button id="moreBtn" class="more">더 보기 (${BANKVIEW.length - shown})</button>`);
  $('#moreBtn')?.addEventListener('click', () => renderGrid(true));
  for (const c of $$('.card:not([data-bound])', grid)) {
    c.dataset.bound = 1;
    const id = +c.dataset.id;
    $('.add', c).onclick = () => { cart = cart.includes(id) ? cart.filter(x => x !== id) : [...cart, id]; saveCart(); renderGrid(); };
    $('.edit', c).onclick = () => openEdit(id);
    $('.img', c).onclick = e => e.currentTarget.classList.toggle('open');
    tex($('.ans', c));
  }
  hydrate(grid);
}

// ================================================================ 편집
let editing = null;
function openEdit(id) {
  const p = bank.problems.find(x => x.id === id);
  if (!p) return;
  editing = p;
  const form = $('#editForm'), f = form.elements;
  $('#editId').textContent = p.id;
  for (const el of f) if (el.name) el.value = el.name === 'tags' ? (p.tags || []).join(', ') : (p[el.name] ?? '');
  for (const [sel, fid] of [['#editImg', p.image], ['#editSolImg', p.solImage]]) {
    const img = $(sel); img.removeAttribute('src'); img.classList.toggle('hidden', !fid);
    if (fid) { img.dataset.fid = fid; loadImg(img); }
  }
  $('#delSolImg').classList.toggle('hidden', !p.solImage);
  updateTexPreview($('#editForm .tex-preview'));
  $('#editDlg').showModal();
}
function initEdit() {
  $('#saveEdit').onclick = () => {
    Object.assign(editing, readForm($('#editForm')), { updatedAt: nowISO() });
    commit(); $('#editDlg').close(); toast('저장됨'); rerenderCurrent();
  };
  $('#delProblem').onclick = () => {
    if (!confirm(`문제 #${editing.id}를 삭제할까요?`)) return;
    store.deleteFile(editing.image); store.deleteFile(editing.solImage);
    bank.problems = bank.problems.filter(p => p !== editing);
    cart = cart.filter(x => x !== editing.id); saveCart();
    commit(); $('#editDlg').close(); toast('삭제됨'); rerenderCurrent();
  };
  $('#delSolImg').onclick = () => {
    if (!confirm('해설 이미지를 삭제할까요?')) return;
    store.deleteFile(editing.solImage);
    Object.assign(editing, { solImage: null, solDocId: null, solRegions: [], updatedAt: nowISO() });
    $('#editSolImg').classList.add('hidden'); $('#delSolImg').classList.add('hidden');
    commit(); rerenderCurrent();
  };
}
function rerenderCurrent() {
  const tab = $('.tab.active').dataset.tab;
  if (tab === 'bank') renderBank();
  if (tab === 'sheet') renderCart();
  if (tab === 'input') { renderRecent(); drawRects(); renderDocs(); }
}

// ================================================================ ③ 시험지
function cartProblems() {
  const byId = new Map(bank.problems.map(p => [p.id, p]));
  cart = cart.filter(id => byId.has(id)); saveCart();
  return cart.map(id => byId.get(id));
}
function renderCart() {
  const list = cartProblems();
  $('#cartInfo').textContent = `${list.length}문제`;
  $('#cartList').innerHTML = list.map((p, i) => `
    <li data-i="${i}">${imgTag(p.image, 'thumb')}
      <div class="info"><b>${esc(p.unit)}</b> ${esc(p.qtype)}<br><span class="muted">${esc(p.source)} ${esc(p.number)} · ${stars(p.difficulty)} · 정답 ${esc(p.answer || '-')}</span></div>
      <button data-a="up" title="위로">▲</button><button data-a="down" title="아래로">▼</button><button data-a="rm" class="danger" title="빼기">✕</button></li>`).join('')
    || '<p class="muted">② 문제 은행에서 문제를 담아주세요.</p>';
  $$('#cartList li').forEach(li => li.onclick = e => {
    const a = e.target.dataset.a, i = +li.dataset.i;
    if (!a) return;
    if (a === 'rm') cart.splice(i, 1);
    if (a === 'up' && i > 0) [cart[i - 1], cart[i]] = [cart[i], cart[i - 1]];
    if (a === 'down' && i < cart.length - 1) [cart[i + 1], cart[i]] = [cart[i], cart[i + 1]];
    saveCart(); renderCart();
  });
  hydrate($('#cartList'));
}

function initSheet() {
  const opts = ls.get('pb_sheet', {});
  for (const [id, v] of Object.entries(opts)) { const el = $('#' + id); if (el) el.type === 'checkbox' ? el.checked = v : el.value = v; }
  const keep = () => ls.set('pb_sheet', Object.fromEntries(['sTitle', 'sCols', 'sSpace', 'sMeta', 'sSol'].map(id => [id, $('#' + id).type === 'checkbox' ? $('#' + id).checked : $('#' + id).value])));
  $$('.sheet-opts input, .sheet-opts select').forEach(el => el.addEventListener('change', keep));

  $('#shuffle').onclick = () => { for (let i = cart.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cart[i], cart[j]] = [cart[j], cart[i]]; } saveCart(); renderCart(); };
  $('#sortUnit').onclick = () => {
    const by = new Map(bank.problems.map(p => [p.id, p]));
    const order = u => { for (const units of Object.values(CURRICULUM)) { const i = units.indexOf(u); if (i >= 0) return i; } return 999; };
    cart.sort((x, y) => { const a = by.get(x), b = by.get(y); return sortKo(a.subject, b.subject) || order(a.unit) - order(b.unit) || sortKo(a.unit, b.unit) || a.difficulty - b.difficulty; });
    saveCart(); renderCart();
  };
  $('#clearCart').onclick = () => { if (confirm('담은 문제를 모두 비울까요?')) { cart = []; saveCart(); renderCart(); } };
  $$('[data-print]').forEach(b => b.onclick = () => openPrint(b.dataset.print));
  $('#closePrint').onclick = () => { $('#printView').classList.add('hidden'); document.body.classList.remove('printing'); };
  $('#doPrint').onclick = () => window.print();
}

async function openPrint(modeP) {
  const list = cartProblems();
  if (!list.length) return toast('담은 문제가 없습니다');
  const o = { title: $('#sTitle').value, sub: $('#sSub').value, cols: +$('#sCols').value, space: +$('#sSpace').value || 0, meta: $('#sMeta').checked, sol: $('#sSol').checked };
  const showP = modeP !== 'answers', showA = modeP !== 'problems';
  const head = t => `<header class="ph"><h1>${esc(t)}</h1><div>${esc(o.sub)}${showP && t === o.title ? ' &nbsp; 이름 ____________' : ''}</div></header>`;
  let html = '';
  if (showP) {
    html += `<section class="psheet">${head(o.title)}<div class="pcols c${o.cols}">` + list.map((p, i) => `
      <div class="pq"><div class="pno">${i + 1}${o.meta ? `<small>${esc([p.unit, p.qtype, [p.source, p.number].filter(Boolean).join(' ')].filter(Boolean).join(' · '))}</small>` : ''}</div>
      ${printImg(p.image, p.wFrac)}${o.space ? `<div style="height:${o.space}mm"></div>` : ''}</div>`).join('') + '</div></section>';
  }
  if (showA) {
    const rows = [];
    for (let i = 0; i < list.length; i += 10) rows.push(list.slice(i, i + 10).map((p, j) => [i + j + 1, p.answer]));
    html += `<section class="psheet ${showP ? 'break' : ''}">${head(o.title + ' · 정답 및 해설')}
      <table class="pans">${rows.map(r => `<tr>${r.map(([n]) => `<th>${n}</th>`).join('')}</tr><tr>${r.map(([, a]) => `<td>${esc(a || '-')}</td>`).join('')}</tr>`).join('')}</table>`;
    if (o.sol) {
      html += `<div class="pcols c${o.cols}">` + list.map((p, i) => (p.solImage || p.solutionText) ? `
        <div class="psol"><div class="pno">${i + 1}<span class="pa">정답 ${esc(p.answer || '-')}</span></div>
        ${p.solutionText ? `<div class="txt">${esc(p.solutionText)}</div>` : ''}${printImg(p.solImage, p.solWFrac)}</div>` : '').join('') + '</div>';
    }
    html += '</section>';
  }
  const paper = $('#paper');
  paper.innerHTML = html;
  tex(paper);
  $('#printView').classList.remove('hidden');
  document.body.classList.add('printing');
  setSave('시험지 이미지 불러오는 중…');
  await Promise.all($$('img[data-fid]', paper).map(loadImg));
  setSave(dirty ? '저장 대기…' : '');
}

// ================================================================ 앱 시작
function renderAll() {
  refreshMeta(); renderDocs(); renderRecent();
  if (DOC && !bank.docs.find(d => d.id === DOC.id)) DOC = null;
  renderPage();
  rerenderCurrent();
}

let inited = false;
function initApp() {
  if (store.folderUrl) $('#driveLink').href = store.folderUrl; else $('#driveLink').classList.add('hidden');
  if (store.kind === 'local') { $('#logoutBtn').classList.add('hidden'); setSave('테스트 모드: 이 브라우저에만 저장'); }
  if (!inited) { initTabs(); initUpload(); initViewer(); initForm(); initBank(); initEdit(); initSheet(); inited = true; }
  saveCart();
  renderAll();
}

boot();
