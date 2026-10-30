import * as pdfjs from '../vendor/pdfjs/pdf.min.mjs';
import { DriveStore, LocalStore, AuthError, ConflictError } from './store.js';
import { GRADES, isHigh, DEFAULT_TAXONOMY, DEFAULT_SUBJECT, CHOICES } from './math.js';
import { readProblem, readSolution, getApiKey, setApiKey, testKey, OcrError } from './ocr.js';
import { GOOGLE_CLIENT_ID } from '../config.js';

window.__pbStarted = true;
pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
// 글꼴이 내장되지 않은 PDF(한글 CID 글꼴 등)용 데이터 — 필요할 때만 CDN에서 받음
const PDFJS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/';
const PDF_OPTS = { cMapUrl: PDFJS_CDN + 'cmaps/', cMapPacked: true, standardFontDataUrl: PDFJS_CDN + 'standard_fonts/' };
const PAGE_W = 2200;      // 페이지를 그릴 가로 픽셀 (자르기 해상도)
const MAX_PHOTO = 3000;   // 사진 원본 긴 변 최대 픽셀
const OCR_PARALLEL = 2;   // 동시에 돌리는 글자 인식 수

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
const options = (vals, cur, ph) => (ph != null ? `<option value="">${esc(ph)}</option>` : '') +
  vals.map(v => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');

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
    bank = migrate(await store.init());
  } catch (e) {
    $('#loginErr').textContent = e instanceof AuthError ? '' : e.message;
    show('login');
    return;
  }
  show('app');
  initApp();
}

// 예전 형식 데이터 맞추기
function migrate(b) {
  b.taxonomy ||= structuredClone(DEFAULT_TAXONOMY);
  for (const p of b.problems) {
    if (p.solutionText != null && p.solution == null) { p.solution = p.solutionText; delete p.solutionText; }
    p.figures ||= [];
    p.choices ||= [];
    p.tags ||= [];
  }
  return b;
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
      bank = migrate(await store.init());
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
window.addEventListener('beforeunload', e => { if (dirty || saving || ocrBusy()) { e.preventDefault(); e.returnValue = ''; } });

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
// 원본 A4 폭(210mm) 기준 실제 크기로, 칸보다 크면 칸에 맞춤
const sizedImg = (fid, frac, cls = '') => imgTag(fid, cls, frac ? `width:${(frac * 210).toFixed(1)}mm` : 'width:100%');

// ================================================================ 문제 표시 (텍스트 + 수식 + 그림)
// 본문 텍스트: 줄바꿈 유지, [그림n] 은 그림으로, $수식$ 은 나중에 KaTeX 가 그림
function richHTML(text, figures = [], figW = []) {
  const used = new Set();
  let html = esc(text).replace(/\[그림\s*(\d*)\]/g, (m, n) => {
    const k = (parseInt(n, 10) || 1) - 1;
    if (!figures[k]) return m;
    used.add(k);
    return `<span class="fig">${sizedImg(figures[k], figW[k])}</span>`;
  }).replace(/\n/g, '<br>');
  const rest = figures.map((f, k) => used.has(k) ? '' : `<span class="fig">${sizedImg(f, figW[k])}</span>`).join('');
  return html + rest;
}
function choicesHTML(choices) {
  if (!choices?.length) return '';
  const long = choices.some(c => c.replace(/\$[^$]*\$/g, 'xxxx').length > 14);
  return `<ol class="choices ${long ? 'long' : ''}">${choices.map((c, i) => `<li><span class="cn">${CHOICES[i] || i + 1}</span> ${esc(c)}</li>`).join('')}</ol>`;
}
// 인식된 글이 있으면 글로, 없으면 원본 이미지로
function problemHTML(p, { fit = false } = {}) {
  if (p.body) return `<div class="ptext">${richHTML(p.body, p.figures, p.figWFrac || [])}</div>${choicesHTML(p.choices)}`;
  return fit ? imgTag(p.image, 'orig') : sizedImg(p.image, p.wFrac, 'orig');
}
function solutionHTML(p, { fit = false } = {}) {
  if (p.solution && p.solMode !== 'image') return `<div class="ptext">${richHTML(p.solution)}</div>`;
  if (p.solImage) return fit ? imgTag(p.solImage, 'orig') : sizedImg(p.solImage, p.solWFrac, 'orig');
  return '';
}
const ocrLabel = s => ({ wait: '인식 대기', run: '인식 중…', fail: '인식 실패' }[s] || '');

// ================================================================ 분류 (학년 → 과목 → 단원)
const tax = () => bank.taxonomy;
function unitsOf(grade, subject) {
  if (!grade) return [];
  if (isHigh(grade)) return tax().high.find(s => s.name === subject)?.units || [];
  return tax().middle.find(g => g.name === grade)?.units || [];
}
const subjects = () => tax().high.map(s => s.name);
function addUnit(grade, subject, name) {
  const list = isHigh(grade) ? tax().high.find(s => s.name === subject)?.units : tax().middle.find(g => g.name === grade)?.units;
  if (!list) return false;
  if (!list.includes(name)) list.push(name);
  return true;
}
// 학년·과목·단원 select 세 개를 묶어 동작시킴 (입력·편집에서 공통)
function bindClassify(form, { onChange } = {}) {
  const f = form.elements;
  const fill = (keepUnit) => {
    const g = f.grade.value;
    const high = isHigh(g);
    f.subject.closest('label').classList.toggle('hidden', !high);
    if (high) {
      const cur = f.subject.value || DEFAULT_SUBJECT[g] || subjects()[0];
      f.subject.innerHTML = options(subjects(), cur);
      f.subject.value = subjects().includes(cur) ? cur : subjects()[0];
    }
    const units = unitsOf(g, high ? f.subject.value : '');
    const cur = keepUnit ?? f.unit.value;
    const list = cur && !units.includes(cur) ? [...units, cur] : units;
    f.unit.innerHTML = options(list, cur, g ? '단원 선택' : '학년을 먼저 고르세요') + (g ? '<option value="__new">＋ 새 단원 추가…</option>' : '');
    f.unit.value = cur || '';
  };
  f.grade.innerHTML = options(GRADES, f.grade.value, '학년');
  f.grade.onchange = () => { f.subject.value = ''; fill(''); onChange?.(); };
  f.subject.onchange = () => { fill(''); onChange?.(); };
  f.unit.onchange = () => {
    if (f.unit.value !== '__new') return onChange?.();
    const name = prompt(`${f.grade.value}${isHigh(f.grade.value) ? ' ' + f.subject.value : ''} 에 추가할 단원 이름`)?.trim();
    if (name && addUnit(f.grade.value, f.subject.value, name)) { commit(); fill(name); toast(`단원 '${name}' 추가됨`); }
    else fill('');
    onChange?.();
  };
  return {
    set(p) { f.grade.value = p.grade || ''; f.subject.innerHTML = options(subjects(), p.subject); f.subject.value = p.subject || ''; fill(p.unit || ''); },
    refresh: () => fill(),
  };
}

// ================================================================ 메타 / 자동완성
const count = (arr) => arr.reduce((m, v) => (v && m.set(v, (m.get(v) || 0) + 1), m), new Map());
const sortKo = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'ko', { numeric: true });

function refreshMeta() {
  $('#totalCount').textContent = bank.problems.length || '';
  const P = bank.problems;
  $('#dl-qtype').innerHTML = [...count(P.map(p => p.qtype)).keys()].sort(sortKo).map(s => `<option value="${esc(s)}">`).join('');
  $('#dl-source').innerHTML = [...count(P.map(p => p.source)).keys()].sort(sortKo).map(s => `<option value="${esc(s)}">`).join('');
  const review = P.filter(p => p.body && !p.reviewed).length;
  $('#reviewCount').textContent = review || '';
  renderOcrStatus();
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
  if (name === 'input') { renderRecent(); inputClassify.refresh(); }
  if (name === 'tax') renderTax();
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

let pendingFiles = [];
function setFiles(files) {
  pendingFiles = [...files];
  $('#dropText').innerHTML = pendingFiles.length
    ? `<b>${pendingFiles.length}개 선택됨</b><br><small>${esc(pendingFiles.map(f => f.name).join(', '))}</small>`
    : 'PDF·사진을 끌어다 놓거나 클릭<br><small>여러 장 한꺼번에 가능</small>';
  if (pendingFiles.length && !$('#docName').value) $('#docName').value = pendingFiles[0].name.replace(/\.[^.]+$/, '');
}

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
const MODE_LABEL = { problem: '문제', figure: '그림', solution: '해설' };

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
    if (p.docId === DOC.id) {
      (p.regions || []).filter(r => r.pg === pageIdx).forEach(r => out.push({ ...r, label: `#${p.id}` }));
      (p.figRegions || []).filter(r => r.pg === pageIdx).forEach(r => out.push({ ...r, label: `#${p.id} 그림` }));
    }
    if (p.solDocId === DOC.id) (p.solRegions || []).filter(r => r.pg === pageIdx).forEach(r => out.push({ ...r, label: `#${p.id} 해설` }));
  }
  return out;
}

function drawRects(temp) {
  if (!DOC) return;
  const pct = v => (v * 100).toFixed(3) + '%';
  const box = r => `left:${pct(r.x)};top:${pct(r.y)};width:${pct(r.w)};height:${pct(r.h)}`;
  let html = savedRectsOnPage().map(r => `<div class="rect saved" style="${box(r)}"><span class="lbl">${esc(r.label)}</span></div>`).join('');
  const n = { problem: 0, figure: 0, solution: 0 };
  regions.forEach((r, i) => {
    n[r.kind]++;
    if (r.pg !== pageIdx) return;
    html += `<div class="rect ${r.kind}" style="${box(r)}"><span class="lbl">${MODE_LABEL[r.kind]} ${n[r.kind]}</span><button class="x" data-i="${i}" title="지우기">✕</button></div>`;
  });
  if (temp) html += `<div class="rect ${mode}" style="${box(temp)}"></div>`;
  $('#overlay').innerHTML = html;
  $$('#overlay .x').forEach(b => {
    b.onpointerdown = e => e.stopPropagation();
    b.onclick = e => { e.stopPropagation(); regions.splice(+b.dataset.i, 1); drawRects(); };
  });
  const c = k => regions.filter(r => r.kind === k).length;
  $('#regionSummary').textContent = regions.length ? `지정한 영역: 문제 ${c('problem')} · 그림 ${c('figure')} · 해설 ${c('solution')}` : '페이지 위를 드래그하세요';
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
    if (!$('#tab-input').classList.contains('active') || $('dialog[open]')) return;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveProblem(); return; }
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    // e.code 사용: 한글 입력 상태에서도 동작
    if (e.code === 'ArrowLeft') go(-1);
    else if (e.code === 'ArrowRight') go(1);
    else if (e.code === 'KeyQ') setMode('problem');
    else if (e.code === 'KeyE') setMode('figure');
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
const STICKY = ['grade', 'subject', 'unit', 'qtype', 'format', 'source', 'difficulty', 'tags'];

function readMeta(form) {
  const o = {};
  for (const el of form.elements) if (el.name) o[el.name] = el.value.trim();
  const high = isHigh(o.grade);
  return {
    grade: o.grade || '', subject: high ? (o.subject || '') : '', unit: o.unit === '__new' ? '' : (o.unit || ''),
    qtype: o.qtype || '', format: o.format || '', source: o.source || '', number: o.number || '',
    difficulty: Math.min(5, Math.max(1, +o.difficulty || 3)),
    tags: [...new Set((o.tags || '').split(/[,#]/).map(t => t.trim()).filter(Boolean))],
    answer: o.answer || '',
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
  const form = $('#metaForm');
  const meta = readMeta(form);
  const strip = ({ pg, x, y, w, h }) => ({ pg, x: +x.toFixed(4), y: +y.toFixed(4), w: +w.toFixed(4), h: +h.toFixed(4) });
  const probR = regions.filter(r => r.kind === 'problem').map(strip);
  const figR = regions.filter(r => r.kind === 'figure').map(strip);
  const solR = regions.filter(r => r.kind === 'solution').map(strip);
  if (!probR.length && !solR.length) return toast(figR.length ? '그림만으로는 저장할 수 없습니다. 문제 영역도 지정하세요' : '페이지에서 영역을 드래그하세요');
  if (probR.length && !meta.grade) return toast('학년을 고르세요');

  let target = null;
  if (!probR.length) {
    target = bank.problems.find(p => p.id === attachTarget);
    if (!target) { setMode('solution'); return toast('해설을 붙일 문제를 오른쪽 목록에서 고르세요'); }
  }
  busy = true; $('#saveBtn').disabled = true; setSave('이미지 올리는 중…');
  const auto = !!getApiKey();
  try {
    const t = nowISO();
    if (probR.length) {
      const id = bank.nextId;
      const label = `${meta.source || '문제'} ${meta.number || ''} #${id}`.replace(/\s+/g, ' ');
      const [image, solImage, ...figures] = await Promise.all([
        cropAndUpload(probR, label),
        solR.length ? cropAndUpload(solR, label + ' 해설') : null,
        ...figR.map((r, k) => cropAndUpload([r], `${label} 그림${k + 1}`)),
      ]);
      bank.nextId = Math.max(bank.nextId, id + 1);
      bank.problems.push({
        id, ...meta, body: '', choices: [], solution: '', memo: '',
        image, figures, figWFrac: figR.map(r => r.w), solImage,
        docId: DOC.id, regions: probR, figRegions: figR, wFrac: widthFrac(probR),
        solDocId: solR.length ? DOC.id : null, solRegions: solR, solWFrac: widthFrac(solR),
        ocr: auto ? 'wait' : '', solOcr: auto && solR.length ? 'wait' : '', reviewed: false,
        createdAt: t, updatedAt: t,
      });
      if (auto) { enqueue(id, 'problem'); if (solR.length) enqueue(id, 'solution'); }
      toast(`#${id} 저장됨${auto ? ' · 글자 인식 중' : ''}`);
    } else {
      const solImage = await cropAndUpload(solR, `${target.source || '문제'} ${target.number || ''} #${target.id} 해설`);
      store.deleteFile(target.solImage);
      Object.assign(target, { solImage, solDocId: DOC.id, solRegions: solR, solWFrac: widthFrac(solR), solOcr: auto ? 'wait' : '', updatedAt: t });
      if (meta.answer) target.answer = meta.answer;
      if (auto) enqueue(target.id, 'solution');
      toast(`#${target.id}에 해설을 붙였습니다`);
      // 다음 문제 자동 선택
      const next = bank.problems.find(p => p.id > target.id && p.source === target.source && !p.solImage);
      attachTarget = next ? next.id : null;
    }
    commit();
    regions = [];
    const f = form.elements;
    ls.set('pb_sticky', Object.fromEntries(STICKY.map(k => [k, f[k].value])));
    if (probR.length) f.number.value = /^\d+$/.test(meta.number) ? +meta.number + 1 : '';
    f.answer.value = '';
    drawRects(); setMode(mode === 'figure' ? 'problem' : mode); renderDocs(); renderRecent();
  } catch (e) {
    e instanceof AuthError ? handleError(e) : toast('저장 실패: ' + e.message, 5000);
    setSave('⚠ 저장 실패', true);
  }
  busy = false; $('#saveBtn').disabled = false;
}

let inputClassify;
function initForm() {
  const form = $('#metaForm'), f = form.elements;
  const sticky = ls.get('pb_sticky', { difficulty: '3' });
  inputClassify = bindClassify(form);
  inputClassify.set(sticky);
  for (const k of ['qtype', 'format', 'source', 'difficulty', 'tags']) if (sticky[k] != null) f[k].value = sticky[k];
  form.onsubmit = e => { e.preventDefault(); saveProblem(); };

  $('.choices-pick').innerHTML = CHOICES.map(c => `<button type="button" data-a="${c}">${c}</button>`).join('');
  $$('.choices-pick button').forEach(b => b.onclick = () => { f.answer.value = b.dataset.a; if (!f.format.value) f.format.value = '객관식'; });

  const pick = $('#diffPick');
  pick.innerHTML = [1, 2, 3, 4, 5].map(n => `<button type="button" data-d="${n}" title="난이도 ${n}">★</button>`).join('');
  const paint = () => $$('button', pick).forEach(b => b.classList.toggle('on', +b.dataset.d <= +f.difficulty.value));
  $$('button', pick).forEach(b => b.onclick = () => { f.difficulty.value = b.dataset.d; paint(); });
  paint();
}

function renderRecent() {
  const list = [...bank.problems].reverse().slice(0, 6);
  $('#recent').innerHTML = list.length ? '<h4>최근 저장</h4>' + list.map(p => `
    <div class="recent-item">${imgTag(p.image, 'thumb')}
      <div class="grow">#${p.id} ${esc(p.grade)} ${esc(p.unit)}<br><span class="muted">${esc(p.source)} ${esc(p.number)} · 정답 <span class="ans-inline">${esc(p.answer || '없음')}</span>
      ${p.ocr || p.solOcr ? ` · <span class="ocr ${p.ocr === 'fail' || p.solOcr === 'fail' ? 'fail' : ''}">${ocrLabel(p.ocr) || ocrLabel(p.solOcr)}</span>` : p.body ? ' · 글자✓' : ''}</span></div>
      <button class="link small" data-edit="${p.id}">수정</button></div>`).join('') : '';
  $$('#recent [data-edit]').forEach(b => b.onclick = () => openEdit(+b.dataset.edit));
  hydrate($('#recent')); tex($('#recent'));
}

// ================================================================ 글자 인식 (Claude) — 저장 뒤 백그라운드로
const queue = [];
let running = 0;
const ocrBusy = () => queue.length > 0 || running > 0;
function enqueue(id, kind) {
  if (!queue.some(j => j.id === id && j.kind === kind)) queue.push({ id, kind });
  pump();
}
function pump() {
  renderOcrStatus();
  while (running < OCR_PARALLEL && queue.length) {
    const job = queue.shift();
    running++;
    runOcr(job).finally(() => { running--; pump(); });
  }
}
async function runOcr({ id, kind }) {
  const p = bank.problems.find(x => x.id === id);
  if (!p) return;
  const key = kind === 'problem' ? 'ocr' : 'solOcr';
  p[key] = 'run'; renderOcrStatus(); rerenderLight();
  try {
    if (kind === 'problem') {
      const r = await readProblem(await store.getBlob(p.image), p.figures.length);
      // 사람이 먼저 고쳐 넣은 내용은 덮어쓰지 않음
      if (!p.body) p.body = r.body.trim();
      if (!p.choices.length) p.choices = r.choices.map(c => c.trim()).filter(Boolean).slice(0, 5);
      if (!p.format) p.format = r.format;
    } else {
      const r = await readSolution(await store.getBlob(p.solImage));
      if (!p.answer) p.answer = r.answer.trim();
      if (!p.solution) p.solution = r.solution.trim();
    }
    p[key] = '';
    p.reviewed = false;
    p.updatedAt = nowISO();
  } catch (e) {
    p[key] = 'fail';
    p[key + 'Err'] = e.message;
    if (e instanceof OcrError && ['nokey', 'auth'].includes(e.code)) {
      // 키 문제면 남은 작업도 멈춤
      queue.splice(0).forEach(j => { const q = bank.problems.find(x => x.id === j.id); if (q) q[j.kind === 'problem' ? 'ocr' : 'solOcr'] = 'wait'; });
      toast(e.message, 6000);
    } else if (e instanceof AuthError) handleError(e);
  }
  commit();
  rerenderLight();
}
function renderOcrStatus() {
  const el = $('#ocrState');
  if (!el || !bank) return;
  const fail = bank.problems.filter(p => p.ocr === 'fail' || p.solOcr === 'fail').length;
  const n = queue.length + running;
  el.innerHTML = n ? `🔍 글자 인식 중 ${n}개` : fail ? `<button class="link small err" id="retryOcr">인식 실패 ${fail}개 · 다시 시도</button>` : '';
  $('#retryOcr')?.addEventListener('click', retryFailed);
}
function retryFailed() {
  if (!getApiKey()) return openSettings();
  for (const p of bank.problems) {
    for (const [key, kind] of [['ocr', 'problem'], ['solOcr', 'solution']]) {
      if (p[key] === 'fail' || p[key] === 'wait') { p[key] = 'wait'; enqueue(p.id, kind); }
    }
  }
}
// 인식 결과가 들어올 때 지금 보고 있는 화면만 가볍게 갱신
const rerenderLight = debounce(() => {
  const tab = $('.tab.active')?.dataset.tab;
  if (tab === 'input') renderRecent();
  if (tab === 'bank') renderBank(true);
  if (editing && $('#editDlg').open) fillEditOcr();
}, 300);

// ================================================================ ② 문제 은행
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
    (!f.grade || p.grade === f.grade) && (!f.subject || p.subject === f.subject) && (!f.unit || p.unit === f.unit) &&
    (!f.qtype || p.qtype === f.qtype) && (!f.format || p.format === f.format) && (!f.source || p.source === f.source) &&
    (!f.tag || p.tags?.includes(f.tag)) &&
    (!f.dmin || p.difficulty >= +f.dmin) && (!f.dmax || p.difficulty <= +f.dmax) &&
    (!f.missing || !p.answer || (!p.solImage && !p.solution)) &&
    (!f.review || (p.body && !p.reviewed) || p.ocr === 'fail' || p.solOcr === 'fail') &&
    (!f.q || [p.grade, p.subject, p.unit, p.qtype, p.source, p.number, p.memo, p.body, p.solution, p.answer, ...(p.tags || []), '#' + p.id].join(' ').toLowerCase().includes(f.q.toLowerCase())));
}
function fillFilterSelects() {
  const f = filterVals();
  const sel = n => $(`#filters [name="${n}"]`);
  const P = bank.problems;
  const cnt = (vals) => count(vals);
  const put = (name, keys, m, ph) => {
    if (f[name] && !keys.includes(f[name])) keys = [f[name], ...keys];
    sel(name).innerHTML = `<option value="">${ph} 전체</option>` + keys.map(k => `<option value="${esc(k)}">${esc(k)} (${m.get(k) || 0})</option>`).join('');
    sel(name).value = f[name];
  };
  put('grade', GRADES.filter(g => P.some(p => p.grade === g)), cnt(P.map(p => p.grade)), '학년');
  const byGrade = P.filter(p => !f.grade || p.grade === f.grade);
  const showSubj = !f.grade || isHigh(f.grade);
  sel('subject').classList.toggle('hidden', !showSubj);
  put('subject', subjects().filter(s => byGrade.some(p => p.subject === s)), cnt(byGrade.map(p => p.subject)), '과목');
  const base = byGrade.filter(p => !f.subject || p.subject === f.subject);
  // 단원은 분류 관리에 적힌 순서대로
  const order = f.grade ? unitsOf(f.grade, f.subject) : [];
  const units = [...cnt(base.map(p => p.unit)).keys()].sort((a, b) => ((order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999)) || sortKo(a, b));
  put('unit', units, cnt(base.map(p => p.unit)), '단원');
  put('qtype', [...cnt(base.map(p => p.qtype)).keys()].sort(sortKo), cnt(base.map(p => p.qtype)), '유형');
  put('format', ['객관식', '단답형', '서술형'].filter(x => base.some(p => p.format === x)), cnt(base.map(p => p.format)), '형식');
  put('source', [...cnt(P.map(p => p.source)).keys()].sort(sortKo), cnt(P.map(p => p.source)), '출처');
  put('tag', [...cnt(base.flatMap(p => p.tags || [])).keys()].sort(sortKo), cnt(base.flatMap(p => p.tags || [])), '태그');
}

function initBank() {
  $$('#filters [name]').forEach(el => el.addEventListener(el.type === 'search' ? 'input' : 'change', debounce(() => renderBank(), 120)));
  $('#resetFilters').onclick = () => { $$('#filters [name]').forEach(el => el.type === 'checkbox' ? el.checked = false : el.value = ''); renderBank(); };
  $('#showAns').onchange = e => $('#grid').classList.toggle('show-ans', e.target.checked);
  $('#selectAll').onclick = () => {
    BANKVIEW.forEach(p => { if (!cart.includes(p.id)) cart.push(p.id); });
    saveCart(); updateCards(); toast(`총 ${cart.length}문제 담김`);
  };
  $('#randBtn').onclick = () => {
    const pool = BANKVIEW.filter(p => !cart.includes(p.id));
    const n = Math.min(+$('#randN').value || 10, pool.length);
    if (!n) return toast('조건에 맞는 (아직 안 담은) 문제가 없습니다');
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    pool.slice(0, n).forEach(p => cart.push(p.id));
    saveCart(); updateCards();
    toast(`${n}문제를 무작위로 담았습니다 (총 ${cart.length})`);
  };
}

function renderBank(keepScroll) {
  const y = $('#tab-bank').scrollTop;
  fillFilterSelects();
  const gi = g => GRADES.indexOf(g) + 1 || 99;
  BANKVIEW = applyFilters().sort((a, b) => gi(a.grade) - gi(b.grade) || sortKo(a.subject, b.subject) || sortKo(a.unit, b.unit) || a.id - b.id);
  $('#resultInfo').textContent = `${BANKVIEW.length}문제`;
  const keep = keepScroll ? Math.max(shown, 60) : 0;
  shown = 0;
  $('#grid').innerHTML = '';
  appendCards(keep || 60);
  if (keepScroll) $('#tab-bank').scrollTop = y;
}

function cardHTML(p) {
  const inCart = cart.includes(p.id);
  const warn = [!p.answer && '정답 없음', !p.solImage && !p.solution && '해설 없음', ocrLabel(p.ocr), p.body && !p.reviewed && '검수 필요']
    .filter(Boolean).map(w => `<span class="chip warn">${w}</span>`).join('');
  return `<div class="card ${inCart ? 'in' : ''}" data-id="${p.id}">
    <div class="pview">${problemHTML(p, { fit: true })}</div>
    <div class="body">
      <div class="chips">
        <span class="chip">#${p.id}</span>
        ${p.grade ? `<span class="chip g">${esc(p.grade)}</span>` : ''}
        ${p.subject ? `<span class="chip">${esc(p.subject)}</span>` : ''}
        ${p.unit ? `<span class="chip u">${esc(p.unit)}</span>` : ''}
        ${p.qtype ? `<span class="chip t">${esc(p.qtype)}</span>` : ''}
        ${p.format ? `<span class="chip">${esc(p.format)}</span>` : ''}
        <span class="stars" title="난이도 ${p.difficulty}">${stars(p.difficulty)}</span>
      </div>
      <div class="muted small">${esc(p.source)} ${esc(p.number)}${p.number ? '번' : ''} ${(p.tags || []).map(t => '#' + esc(t)).join(' ')}</div>
      ${warn ? `<div class="chips">${warn}</div>` : ''}
      <div class="ans">
        <b>정답</b> <span>${esc(p.answer || '-')}</span>
        ${solutionHTML(p, { fit: true })}
      </div>
      <div class="actions">
        <button class="add ${inCart ? '' : 'primary'}">${inCart ? '✓ 담김' : '+ 담기'}</button>
        <button class="edit">수정·검수</button>
      </div>
    </div></div>`;
}

function updateCards() {
  $$('#grid .card').forEach(c => {
    const inCart = cart.includes(+c.dataset.id);
    c.classList.toggle('in', inCart);
    const b = $('.add', c); b.textContent = inCart ? '✓ 담김' : '+ 담기'; b.classList.toggle('primary', !inCart);
  });
}

function appendCards(n) {
  const grid = $('#grid');
  $('#moreBtn')?.remove();
  const next = BANKVIEW.slice(shown, shown + n);
  shown += next.length;
  grid.insertAdjacentHTML('beforeend', next.map(cardHTML).join('') || (shown ? '' : '<p class="muted">조건에 맞는 문제가 없습니다.</p>'));
  if (shown < BANKVIEW.length) grid.insertAdjacentHTML('beforeend', `<button id="moreBtn" class="more">더 보기 (${BANKVIEW.length - shown})</button>`);
  $('#moreBtn')?.addEventListener('click', () => appendCards(60));
  for (const c of $$('.card:not([data-bound])', grid)) {
    c.dataset.bound = 1;
    const id = +c.dataset.id;
    $('.add', c).onclick = () => { cart = cart.includes(id) ? cart.filter(x => x !== id) : [...cart, id]; saveCart(); updateCards(); };
    $('.edit', c).onclick = () => openEdit(id);
    tex(c);
  }
  hydrate(grid);
}

// ================================================================ 편집·검수
let editing = null, editClassify;
function openEdit(id) {
  const p = bank.problems.find(x => x.id === id);
  if (!p) return;
  editing = p;
  const form = $('#editForm'), f = form.elements;
  $('#editId').textContent = p.id;
  for (const el of form.elements) {
    if (!el.name || el.name.startsWith('c') && /^c\d$/.test(el.name)) continue;
    if (['grade', 'subject', 'unit'].includes(el.name)) continue;
    el.value = el.name === 'tags' ? (p.tags || []).join(', ') : (p[el.name] ?? '');
  }
  editClassify.set(p);
  for (let i = 0; i < 5; i++) f['c' + (i + 1)].value = p.choices?.[i] ?? '';
  f.reviewed.checked = !!p.reviewed;
  f.solMode.value = p.solMode || 'text';
  for (const [sel, fid] of [['#editImg', p.image], ['#editSolImg', p.solImage]]) {
    const img = $(sel); img.removeAttribute('src'); img.classList.toggle('hidden', !fid);
    if (fid) { img.dataset.fid = fid; loadImg(img); }
  }
  $('#editFigs').innerHTML = (p.figures || []).map((fid, k) => `<figure>${imgTag(fid)}<figcaption>[그림${k + 1}]</figcaption></figure>`).join('');
  hydrate($('#editFigs'));
  $('#delSolImg').classList.toggle('hidden', !p.solImage);
  fillEditOcr(true);
  updateEditPreview();
  $('#editDlg').showModal();
}
// 인식 상태 표시 (인식이 끝나면 비어 있는 칸을 채움)
function fillEditOcr(initial) {
  const p = editing, f = $('#editForm').elements;
  $('#ocrBodyState').textContent = ocrLabel(p.ocr) + (p.ocr === 'fail' && p.ocrErr ? `: ${p.ocrErr}` : '');
  $('#ocrSolState').textContent = ocrLabel(p.solOcr) + (p.solOcr === 'fail' && p.solOcrErr ? `: ${p.solOcrErr}` : '');
  if (initial) return;
  if (!f.body.value && p.body) { f.body.value = p.body; for (let i = 0; i < 5; i++) f['c' + (i + 1)].value = p.choices?.[i] ?? ''; }
  if (!f.solution.value && p.solution) f.solution.value = p.solution;
  if (!f.answer.value && p.answer) f.answer.value = p.answer;
  if (!f.format.value && p.format) f.format.value = p.format;
  updateEditPreview();
}
function readEdit() {
  const form = $('#editForm'), f = form.elements;
  const meta = readMeta(form);
  return {
    ...meta,
    body: f.body.value.trim(),
    choices: [1, 2, 3, 4, 5].map(i => f['c' + i].value.trim()).filter((v, i, a) => v || a.slice(i).some(Boolean)),
    solution: f.solution.value.trim(),
    solMode: f.solMode.value,
    memo: f.memo.value.trim(),
    reviewed: f.reviewed.checked,
  };
}
const updateEditPreview = debounce(() => {
  if (!editing) return;
  const d = readEdit();
  const pv = { ...editing, ...d };
  $('#editPreview').innerHTML = (d.body ? problemHTML(pv, { fit: true }) : '<p class="muted small">문제 본문이 비어 있으면 시험지에 원본 이미지가 들어갑니다.</p>') +
    (d.solution || editing.solImage ? `<hr><div class="small"><b>정답</b> ${esc(d.answer || '-')}</div>${solutionHTML(pv, { fit: true })}` : '');
  hydrate($('#editPreview')); tex($('#editPreview'));
}, 200);
function initEdit() {
  const form = $('#editForm');
  editClassify = bindClassify(form);
  form.addEventListener('input', updateEditPreview);
  $$('#editForm [data-insert]').forEach(b => b.onclick = () => {
    const ta = form.elements[b.dataset.target];
    const s = ta.selectionStart, e = ta.selectionEnd, ins = b.dataset.insert;
    ta.value = ta.value.slice(0, s) + ins + ta.value.slice(e);
    ta.focus(); ta.selectionStart = ta.selectionEnd = s + ins.length - (ins.endsWith('$') && ins.length === 2 ? 1 : 0);
    updateEditPreview();
  });
  $('#saveEdit').onclick = () => {
    const d = readEdit();
    if (!d.grade) return toast('학년을 고르세요');
    Object.assign(editing, d, { updatedAt: nowISO() });
    commit(); $('#editDlg').close(); toast('저장됨'); rerenderCurrent();
  };
  $('#saveReviewed').onclick = () => { form.elements.reviewed.checked = true; $('#saveEdit').click(); };
  $('#delProblem').onclick = () => {
    if (!confirm(`문제 #${editing.id}를 삭제할까요?`)) return;
    [editing.image, editing.solImage, ...(editing.figures || [])].forEach(f => store.deleteFile(f));
    bank.problems = bank.problems.filter(p => p !== editing);
    cart = cart.filter(x => x !== editing.id); saveCart();
    commit(); $('#editDlg').close(); toast('삭제됨'); rerenderCurrent();
  };
  $('#delSolImg').onclick = () => {
    if (!confirm('해설 이미지를 삭제할까요?')) return;
    store.deleteFile(editing.solImage);
    Object.assign(editing, { solImage: null, solDocId: null, solRegions: [], solOcr: '', updatedAt: nowISO() });
    $('#editSolImg').classList.add('hidden'); $('#delSolImg').classList.add('hidden');
    commit(); rerenderCurrent(); updateEditPreview();
  };
  $('#reOcrBody').onclick = () => reOcr('problem');
  $('#reOcrSol').onclick = () => reOcr('solution');
  $('#editDlg').addEventListener('close', () => { editing = null; });
}
function reOcr(kind) {
  if (!getApiKey()) return openSettings();
  const p = editing, f = $('#editForm').elements;
  if (kind === 'problem') {
    if (!confirm('문제 본문과 선택지를 지우고 다시 인식할까요?')) return;
    p.body = ''; p.choices = []; f.body.value = ''; for (let i = 1; i <= 5; i++) f['c' + i].value = '';
    p.ocr = 'wait';
  } else {
    if (!p.solImage) return toast('해설 이미지가 없습니다');
    if (!confirm('해설을 지우고 다시 인식할까요?')) return;
    p.solution = ''; f.solution.value = '';
    p.solOcr = 'wait';
  }
  enqueue(p.id, kind);
  fillEditOcr(true);
}
function rerenderCurrent() {
  const tab = $('.tab.active').dataset.tab;
  if (tab === 'bank') renderBank(true);
  if (tab === 'sheet') renderCart();
  if (tab === 'input') { renderRecent(); drawRects(); renderDocs(); }
  if (tab === 'tax') renderTax();
}

// ================================================================ ③ 시험지
function cartProblems() {
  const byId = new Map(bank.problems.map(p => [p.id, p]));
  cart = cart.filter(id => byId.has(id)); saveCart();
  return cart.map(id => byId.get(id));
}
function renderCart() {
  const list = cartProblems();
  const noText = list.filter(p => !p.body).length;
  $('#cartInfo').textContent = `${list.length}문제` + (noText ? ` · 글자 인식 안 된 ${noText}문제는 원본 이미지로 들어감` : '');
  $('#cartList').innerHTML = list.map((p, i) => `
    <li data-i="${i}">${imgTag(p.image, 'thumb')}
      <div class="info"><b>${esc(p.grade)} ${esc(p.unit)}</b> ${esc(p.qtype)}<br><span class="muted">${esc(p.source)} ${esc(p.number)} · ${stars(p.difficulty)} · 정답 ${esc(p.answer || '-')}${p.body ? '' : ' · <span class="err">이미지</span>'}</span></div>
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

function sheetOpts() {
  return {
    title: $('#sTitle').value, sub: $('#sSub').value, cols: +$('#sCols').value, space: +$('#sSpace').value || 0,
    meta: $('#sMeta').checked, sol: $('#sSol').checked, mode: $('#sMode').value,
  };
}

function initSheet() {
  const opts = ls.get('pb_sheet', {});
  for (const [id, v] of Object.entries(opts)) { const el = $('#' + id); if (el) el.type === 'checkbox' ? el.checked = v : el.value = v; }
  const keep = () => ls.set('pb_sheet', Object.fromEntries(['sTitle', 'sCols', 'sSpace', 'sMeta', 'sSol', 'sMode'].map(id => [id, $('#' + id).type === 'checkbox' ? $('#' + id).checked : $('#' + id).value])));
  $$('.sheet-opts input, .sheet-opts select').forEach(el => el.addEventListener('change', keep));

  $('#shuffle').onclick = () => { for (let i = cart.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cart[i], cart[j]] = [cart[j], cart[i]]; } saveCart(); renderCart(); };
  $('#sortUnit').onclick = () => {
    const by = new Map(bank.problems.map(p => [p.id, p]));
    const gi = g => GRADES.indexOf(g) + 1 || 99;
    const ui = p => unitsOf(p.grade, p.subject).indexOf(p.unit) + 1 || 999;
    cart.sort((x, y) => { const a = by.get(x), b = by.get(y); return gi(a.grade) - gi(b.grade) || sortKo(a.subject, b.subject) || ui(a) - ui(b) || sortKo(a.unit, b.unit) || a.difficulty - b.difficulty; });
    saveCart(); renderCart();
  };
  $('#clearCart').onclick = () => { if (confirm('담은 문제를 모두 비울까요?')) { cart = []; saveCart(); renderCart(); } };
  $('#makePdf').onclick = () => openPrint();
  $('#makeHwp').onclick = () => makeHwp();
  $('#closePrint').onclick = () => { $('#printView').classList.add('hidden'); document.body.classList.remove('printing'); };
  $('#doPrint').onclick = () => window.print();
}

async function makeHwp() {
  const list = cartProblems();
  if (!list.length) return toast('담은 문제가 없습니다');
  const btn = $('#makeHwp');
  btn.disabled = true; btn.textContent = '한글 파일 만드는 중…';
  try {
    const { buildHwpx } = await import('./hwpx.js');
    const o = sheetOpts();
    const { blob, failedEq } = await buildHwpx(list, o, fid => store.getBlob(fid));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(o.title || '문제지').replace(/[\\/:*?"<>|]/g, '_')}.hwpx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
    toast(failedEq ? `한글 파일을 받았습니다. 수식 ${failedEq}개는 한글 수식으로 바꾸지 못해 글자로 넣었습니다` : '한글 파일(.hwpx)을 받았습니다', 5000);
  } catch (e) {
    e instanceof AuthError ? handleError(e) : toast('한글 파일을 만들지 못했습니다: ' + e.message, 6000);
  }
  btn.disabled = false; btn.textContent = '📄 한글 파일(.hwpx)';
}

async function openPrint() {
  const list = cartProblems();
  if (!list.length) return toast('담은 문제가 없습니다');
  const o = sheetOpts();
  const showP = o.mode !== 'answers', showA = o.mode !== 'problems';
  const head = t => `<header class="ph"><h1>${esc(t)}</h1><div>${esc(o.sub)}${showP && t === o.title ? ' &nbsp; 이름 ____________' : ''}</div></header>`;
  let html = '';
  if (showP) {
    html += `<section class="psheet">${head(o.title)}<div class="pcols c${o.cols}">` + list.map((p, i) => `
      <div class="pq"><div class="pno">${i + 1}${o.meta ? `<small>${esc([p.unit, p.qtype, [p.source, p.number].filter(Boolean).join(' ')].filter(Boolean).join(' · '))}</small>` : ''}</div>
      ${problemHTML(p)}${o.space ? `<div style="height:${o.space}mm"></div>` : ''}</div>`).join('') + '</div></section>';
  }
  if (showA) {
    const rows = [];
    for (let i = 0; i < list.length; i += 10) rows.push(list.slice(i, i + 10).map((p, j) => [i + j + 1, p.answer]));
    html += `<section class="psheet ${showP ? 'break' : ''}">${head(o.title + ' · 정답 및 해설')}
      <table class="pans">${rows.map(r => `<tr>${r.map(([n]) => `<th>${n}</th>`).join('')}</tr><tr>${r.map(([, a]) => `<td>${esc(a || '-')}</td>`).join('')}</tr>`).join('')}</table>`;
    if (o.sol) {
      html += `<div class="pcols c${o.cols}">` + list.map((p, i) => (p.solImage || p.solution) ? `
        <div class="psol"><div class="pno">${i + 1}<span class="pa">정답 ${esc(p.answer || '-')}</span></div>
        ${solutionHTML(p)}</div>` : '').join('') + '</div>';
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

// ================================================================ ④ 분류 관리
function renderTax() {
  const P = bank.problems;
  const used = (grade, subject, unit) => P.filter(p => (subject ? p.subject === subject && isHigh(p.grade) : p.grade === grade) && p.unit === unit).length;
  const card = (kind, name, units, removable) => `
    <div class="tax-card" data-kind="${kind}" data-name="${esc(name)}">
      <div class="tax-head"><b>${esc(name)}</b>
        ${removable ? `<button class="link small" data-act="renameGroup">이름 바꾸기</button><button class="link small danger" data-act="delGroup">삭제</button>` : ''}</div>
      <ol>${units.map((u, i) => {
        const n = kind === 'high' ? used(null, name, u) : used(name, null, u);
        return `<li data-i="${i}"><span class="grow">${esc(u)}</span>${n ? `<span class="muted small">${n}문제</span>` : ''}
          <button data-act="up" title="위로">▲</button><button data-act="down" title="아래로">▼</button>
          <button data-act="rename" title="이름 바꾸기">✎</button><button data-act="del" class="danger" title="삭제">✕</button></li>`;
      }).join('')}</ol>
      <form class="tax-add row"><input placeholder="새 단원 이름" required><button>추가</button></form>
    </div>`;
  $('#taxMiddle').innerHTML = tax().middle.map(g => card('middle', g.name, g.units, false)).join('');
  $('#taxHigh').innerHTML = tax().high.map(s => card('high', s.name, s.units, true)).join('');
  $$('.tax-card').forEach(bindTaxCard);
}
function bindTaxCard(el) {
  const kind = el.dataset.kind, name = el.dataset.name;
  const group = tax()[kind].find(g => g.name === name);
  const matches = (p, unit) => (kind === 'high' ? isHigh(p.grade) && p.subject === name : p.grade === name) && p.unit === unit;
  el.querySelector('.tax-add').onsubmit = e => {
    e.preventDefault();
    const v = e.target.querySelector('input').value.trim();
    if (!v) return;
    if (group.units.includes(v)) return toast('이미 있는 단원입니다');
    group.units.push(v); commit(); renderTax();
  };
  el.addEventListener('click', e => {
    const act = e.target.dataset.act;
    if (!act) return;
    const i = +e.target.closest('li')?.dataset.i;
    const u = group.units[i];
    if (act === 'up' && i > 0) [group.units[i - 1], group.units[i]] = [group.units[i], group.units[i - 1]];
    else if (act === 'down' && i < group.units.length - 1) [group.units[i + 1], group.units[i]] = [group.units[i], group.units[i + 1]];
    else if (act === 'rename') {
      const v = prompt('새 단원 이름', u)?.trim();
      if (!v || v === u) return;
      group.units[i] = v;
      const n = bank.problems.filter(p => matches(p, u)).map(p => (p.unit = v)).length;
      if (n) toast(`문제 ${n}개의 단원도 '${v}'(으)로 바꿨습니다`);
    } else if (act === 'del') {
      const n = bank.problems.filter(p => matches(p, u)).length;
      if (!confirm(n ? `'${u}' 단원에 문제 ${n}개가 있습니다. 목록에서만 지우고 문제는 그대로 둘까요?` : `'${u}' 단원을 지울까요?`)) return;
      group.units.splice(i, 1);
    } else if (act === 'renameGroup') {
      const v = prompt('새 과목 이름', name)?.trim();
      if (!v || v === name) return;
      if (tax().high.some(s => s.name === v)) return toast('이미 있는 과목입니다');
      group.name = v;
      bank.problems.filter(p => isHigh(p.grade) && p.subject === name).forEach(p => (p.subject = v));
    } else if (act === 'delGroup') {
      const n = bank.problems.filter(p => isHigh(p.grade) && p.subject === name).length;
      if (!confirm(n ? `'${name}' 과목에 문제 ${n}개가 있습니다. 과목 목록에서만 지울까요? (문제는 그대로)` : `'${name}' 과목을 지울까요?`)) return;
      tax().high = tax().high.filter(s => s !== group);
    } else return;
    commit(); renderTax();
  });
}
function initTax() {
  $('#addSubject').onsubmit = e => {
    e.preventDefault();
    const v = e.target.querySelector('input').value.trim();
    if (!v) return;
    if (tax().high.some(s => s.name === v)) return toast('이미 있는 과목입니다');
    tax().high.push({ name: v, units: [] }); e.target.reset(); commit(); renderTax();
  };
  $('#resetTax').onclick = () => {
    if (!confirm('분류를 처음 기본값으로 되돌릴까요? (저장된 문제의 학년·단원 값은 그대로)')) return;
    bank.taxonomy = structuredClone(DEFAULT_TAXONOMY); commit(); renderTax();
  };
}

// ================================================================ 설정 (API 키)
function openSettings() {
  $('#apiKeyInput').value = getApiKey();
  $('#keyState').textContent = getApiKey() ? '저장된 키가 있습니다' : '';
  $('#settingsDlg').showModal();
}
function initSettings() {
  $('#settingsBtn').onclick = openSettings;
  $('#saveKey').onclick = async () => {
    const k = $('#apiKeyInput').value.trim();
    setApiKey(k);
    if (!k) { $('#keyState').textContent = '키를 지웠습니다. 글자 인식이 꺼집니다.'; return; }
    $('#keyState').textContent = '확인 중…';
    try {
      await testKey();
      $('#keyState').textContent = '✓ 키가 확인되었습니다';
      updateKeyHint();
      // 키가 없어서 멈춰 있던 인식 다시 시작
      if (bank.problems.some(p => p.ocr === 'wait' || p.solOcr === 'wait' || p.ocr === 'fail' || p.solOcr === 'fail')) retryFailed();
    } catch (e) {
      $('#keyState').textContent = '⚠ ' + e.message;
    }
  };
  updateKeyHint();
}
function updateKeyHint() {
  $('#keyHint').classList.toggle('hidden', !!getApiKey());
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
  if (!inited) { initTabs(); initUpload(); initViewer(); initForm(); initBank(); initEdit(); initSheet(); initTax(); initSettings(); inited = true; }
  saveCart();
  renderAll();
  // 지난번에 끝나지 않은 인식 이어서
  if (getApiKey()) for (const p of bank.problems) {
    if (p.ocr === 'wait' || p.ocr === 'run') enqueue(p.id, 'problem');
    if (p.solOcr === 'wait' || p.solOcr === 'run') enqueue(p.id, 'solution');
  }
}

boot();
