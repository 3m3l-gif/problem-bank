// 시험지를 한글(HWPX) 파일로 만듭니다.
// 뼈대 문서와 개체 구조는 python-hwpx (Apache-2.0) 의 Skeleton.hwpx·출력 형식을 따릅니다.
// 수식은 한글 수식 개체(편집 가능), 그림은 문서에 포함된 그림 개체로 들어갑니다.
import { latexToEqedit } from './eqedit.js';
import { measureEquation } from './eqmeasure.js';
import { CHOICES } from './math.js';

const MM = 7200 / 25.4;               // 1mm = 283.46 HWPUNIT
const PAGE_W = 59528;                  // A4 폭
const MARGIN = 4252;                   // 좌우 여백 15mm
const COL_GAP = 2268;                  // 단 사이 8mm
const BASE = 1000;                     // 본문·수식 10pt
const CP = { normal: 0, bold: 7, title: 8, small: 9 }; // 글자 모양 id (뼈대 문서의 개수 뒤에 이어서 추가)

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  // XML 에 넣을 수 없는 제어 문자 제거
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
let seq = 1000;
const uid = () => String(1_000_000_000 + (seq += 7919) % 1_000_000_000);

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error(src + ' 를 불러오지 못했습니다'));
    document.head.appendChild(s);
  });
}
let zipLibP;
const JSZipLib = () => (zipLibP ||= window.JSZip ? Promise.resolve() : loadScript(new URL('../vendor/jszip/jszip.min.js', import.meta.url).href))
  .then(() => window.JSZip);

// LaTeX 를 한글 수식 스크립트로. 바꿀 수 없으면 null
function toScript(latex) {
  const cleaned = latex
    .replace(/\\(displaystyle|textstyle|limits|nolimits)\b/g, '')
    .replace(/\\(qquad|quad)\b/g, '~')
    .replace(/\\[,;:]/g, '~').replace(/\\!/g, '')
    .replace(/\\varnothing\b/g, '\\emptyset')
    .replace(/\\dots\b/g, '\\cdots')
    .replace(/\\left\s*\./g, '').replace(/\\right\s*\./g, '');
  try { return latexToEqedit(cleaned); } catch { return null; }
}

// ---------------------------------------------------------------- 문단 만들기
class Doc {
  constructor(colWidth) {
    this.paras = [];
    this.images = [];       // {name, data(Uint8Array)}
    this.colWidth = colWidth;
    this.failedEq = 0;
    this.plain = [];
  }
  p(runs, { pageBreak = false, columnBreak = false } = {}) {
    const body = runs.join('') || '<hp:run charPrIDRef="0"><hp:t/></hp:run>';
    this.paras.push(`<hp:p id="${uid()}" paraPrIDRef="0" styleIDRef="0" pageBreak="${pageBreak ? 1 : 0}" columnBreak="${columnBreak ? 1 : 0}" merged="0">${body}</hp:p>`);
  }
  text(s, cp = CP.normal) {
    if (!s) return '';
    this.plain.push(s);
    return `<hp:run charPrIDRef="${cp}"><hp:t>${esc(s)}</hp:t></hp:run>`;
  }
  eq(latex) {
    const script = toScript(latex);
    if (!script) { this.failedEq++; return this.text(latex); }
    const { width, height, baseLine } = measureEquation(script, BASE);
    const id = uid();
    return `<hp:run charPrIDRef="0"><hp:equation id="${id}" zOrder="0" numberingType="EQUATION" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" version="Equation Version 60" baseLine="${baseLine}" textColor="#000000" baseUnit="${BASE}" lineMode="CHAR" font="HYhwpEQ"><hp:sz width="${width}" widthRelTo="ABSOLUTE" height="${height}" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="56" right="56" top="0" bottom="0"/><hp:shapeComment>수식입니다.</hp:shapeComment><hp:script>${esc(script)}</hp:script></hp:equation></hp:run>`;
  }
  // 글과 $수식$ 이 섞인 한 줄 → run 목록
  inline(line, cp = CP.normal) {
    const out = [];
    const re = /\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g;
    let last = 0, m;
    while ((m = re.exec(line))) {
      out.push(this.text(line.slice(last, m.index), cp));
      out.push(this.eq(m[1] ?? m[2]));
      last = re.lastIndex;
    }
    out.push(this.text(line.slice(last), cp));
    return out.filter(Boolean);
  }
  async image(blob, widthMm) {
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0);
    const png = await c.convertToBlob({ type: 'image/png' });
    const n = this.images.length + 1;
    const name = `BIN${String(n).padStart(4, '0')}`;
    this.images.push({ name, data: new Uint8Array(await png.arrayBuffer()) });
    const W = Math.round(Math.min(widthMm * MM, this.colWidth));
    const H = Math.round(W * bmp.height / bmp.width);
    const id = uid();
    return `<hp:run charPrIDRef="0"><hp:pic textWrap="SQUARE" textFlow="BOTH_SIDES" reverse="0" id="${id}" zOrder="${n}" numberingType="PICTURE" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${id}"><hp:offset x="0" y="0"/><hp:orgSz width="${W}" height="${H}"/><hp:curSz width="${W}" height="${H}"/><hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="0" centerX="${W >> 1}" centerY="${H >> 1}" rotateimage="1"/><hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo><hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${W}" y="0"/><hc:pt2 x="${W}" y="${H}"/><hc:pt3 x="0" y="${H}"/></hp:imgRect><hp:imgClip left="0" right="${W}" top="0" bottom="${H}"/><hp:inMargin left="0" right="0" top="0" bottom="0"/><hp:imgDim dimwidth="${W}" dimheight="${H}"/><hc:img binaryItemIDRef="${name}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/><hp:effects/><hp:sz width="${W}" height="${H}" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:shapeComment/></hp:pic></hp:run>`;
  }
}

// 본문(줄바꿈·$$·[그림n] 포함) → 문단들. 첫 문단 앞에 prefix run 을 붙임
async function addRich(doc, text, { prefix = [], figures = [], getBlob, figWidth = [] } = {}) {
  const used = new Set();
  let first = true;
  const lines = String(text || '').split('\n');
  for (const raw of lines) {
    // [그림n] 은 그 자리에 그림 문단으로
    const parts = raw.split(/\[그림\s*(\d*)\]/);
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        const k = (parseInt(parts[i], 10) || 1) - 1;
        if (figures[k]) {
          used.add(k);
          doc.p([...(first ? prefix : []), await doc.image(await getBlob(figures[k]), figWidth[k] || 60)]);
          first = false;
        }
        continue;
      }
      const seg = parts[i];
      if (!seg.trim() && parts.length > 1) continue;
      // 한 줄짜리 $$..$$ 는 따로 한 문단
      doc.p([...(first ? prefix : []), ...doc.inline(seg)]);
      first = false;
    }
  }
  if (first) doc.p(prefix);
  // 본문에서 자리를 못 찾은 그림은 끝에
  for (const [k, fid] of figures.entries()) {
    if (!used.has(k)) doc.p([await doc.image(await getBlob(fid), figWidth[k] || 60)]);
  }
}

function choiceLines(choices) {
  const items = choices.map((c, i) => `${CHOICES[i] || `(${i + 1})`} ${c}`);
  const len = items.reduce((s, x) => s + x.replace(/\$[^$]*\$/g, m => 'x'.repeat(Math.ceil(m.length / 3))).length, 0);
  // 짧으면 한 줄, 아니면 두세 줄로
  if (len <= 34) return [items.join('    ')];
  if (len <= 70) return [items.slice(0, 3).join('    '), items.slice(3).join('    ')].filter(Boolean);
  return items;
}

/**
 * problems: 문제 객체 배열 (화면 순서), opts: {title, sub, cols, space, meta, sol, mode}
 * getBlob(fid): 드라이브 이미지 Blob
 * 반환: { blob, failedEq }
 */
export async function buildHwpx(problems, opts, getBlob) {
  const JSZip = await JSZipLib();
  const sk = await JSZip.loadAsync(await (await fetch(new URL('../vendor/hwpx/Skeleton.hwpx', import.meta.url))).arrayBuffer());
  let header = await sk.file('Contents/header.xml').async('string');
  const charCount = +header.match(/<hh:charProperties itemCnt="(\d+)">/)[1];
  Object.assign(CP, { bold: charCount, title: charCount + 1, small: charCount + 2 });
  const textWidth = PAGE_W - 2 * MARGIN;
  const cols = Math.max(1, Math.min(2, opts.cols || 1));
  const colWidth = cols === 2 ? (textWidth - COL_GAP) / 2 : textWidth;
  const doc = new Doc(colWidth);
  const showP = opts.mode !== 'answers', showA = opts.mode !== 'problems';
  const blankLines = Math.round((opts.space || 0) / 6);

  const heading = (title) => {
    doc.p(doc.inline(title, CP.title));
    if (opts.sub || showP) doc.p([doc.text([opts.sub, showP && title === opts.title ? '이름: ____________' : ''].filter(Boolean).join('     '), CP.small)]);
    doc.p([]);
  };

  if (showP) {
    heading(opts.title || '문제지');
    for (const [i, p] of problems.entries()) {
      const prefix = [doc.text(`${i + 1}. `, CP.bold)];
      if (opts.meta) {
        const m = [p.unit, p.qtype, [p.source, p.number].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
        if (m) prefix.push(doc.text(`[${m}] `, CP.small));
      }
      if (p.body) {
        await addRich(doc, p.body, { prefix, figures: p.figures || [], figWidth: p.figWFrac?.map(f => f * 210), getBlob });
        for (const line of choiceLines(p.choices || [])) doc.p(doc.inline(line));
      } else if (p.image) {
        // 아직 글자 인식이 안 된 문제는 원본 이미지로
        doc.p(prefix);
        doc.p([await doc.image(await getBlob(p.image), (p.wFrac || 0.45) * 210)]);
      }
      for (let k = 0; k < blankLines; k++) doc.p([]);
      doc.p([]);
    }
  }

  if (showA) {
    doc.p(doc.inline(`${opts.title || '문제지'} · 정답 및 해설`, CP.title), { pageBreak: showP });
    doc.p([]);
    // 빠른 정답: 다섯 개씩 한 줄
    for (let i = 0; i < problems.length; i += 5) {
      const runs = [];
      problems.slice(i, i + 5).forEach((p, j) => {
        runs.push(doc.text(`${i + j + 1}) `, CP.bold));
        runs.push(...doc.inline(p.answer || '-'));
        runs.push(doc.text('      '));
      });
      doc.p(runs);
    }
    doc.p([]);
    if (opts.sol) {
      for (const [i, p] of problems.entries()) {
        const sol = p.solution || p.solutionText || '';
        if (!sol && !p.solImage) continue;
        const prefix = [doc.text(`${i + 1}. `, CP.bold), doc.text('정답 ', CP.bold), ...doc.inline(p.answer || '-', CP.bold), doc.text('  ')];
        if (sol && p.solMode !== 'image') await addRich(doc, sol, { prefix, figures: [], getBlob });
        else { doc.p(prefix); doc.p([await doc.image(await getBlob(p.solImage), (p.solWFrac || 0.45) * 210)]); }
        doc.p([]);
      }
    }
  }

  // ---- 패키지 조립
  let section = await sk.file('Contents/section0.xml').async('string');
  section = section
    .replace(/<hp:margin [^>]*\/>/, `<hp:margin header="2835" footer="2835" gutter="0" left="${MARGIN}" right="${MARGIN}" top="4252" bottom="4252"/>`)
    .replace(/<hp:colPr [^>]*\/>/, cols === 2
      ? `<hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="2" sameSz="1" sameGap="${COL_GAP}"><hp:colLine type="SOLID" width="0.12 mm" color="#000000"/></hp:colPr>`
      : '<hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/>')
    .replace(/<\/hs:sec>\s*$/, doc.paras.join('') + '</hs:sec>');

  const base = header.match(/<hh:charPr [^>]*id="0"[^>]*>[\s\S]*?<\/hh:charPr>/)[0];
  const variant = (id, heightV, { bold = false, color = '#000000' } = {}) => base
    .replace(/id="0"/, `id="${id}"`)
    .replace(/height="\d+"/, `height="${heightV}"`)
    .replace(/textColor="[^"]*"/, `textColor="${color}"`)
    .replace(/<hh:bold\/>/, '')
    .replace(/(<hh:offset [^>]*\/>)/, bold ? '$1<hh:bold/>' : '$1');
  const added = [variant(CP.bold, BASE, { bold: true }), variant(CP.title, 1500, { bold: true }), variant(CP.small, 800, { color: '#555555' })];
  header = header
    .replace(/<hh:charProperties itemCnt="(\d+)">/, (_, n) => `<hh:charProperties itemCnt="${+n + added.length}">`)
    .replace('</hh:charProperties>', added.join('') + '</hh:charProperties>');
  if (doc.images.length) {
    header = header.replace('</hh:refList>', `<hh:binDataList itemCnt="${doc.images.length}">` +
      doc.images.map((im, i) => `<hh:binItem id="${i}" Type="Embedding" BinData="${im.name}.png" Format="png"/>`).join('') +
      '</hh:binDataList></hh:refList>');
  }

  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  let hpf = await sk.file('Contents/content.hpf').async('string');
  hpf = hpf
    .replace(/<opf:title\/>|<opf:title>[^<]*<\/opf:title>/, `<opf:title>${esc(opts.title || '문제지')}</opf:title>`)
    .replace(/synthetic-fixture-author/g, '문제 저장소')
    .replace(/(name="CreatedDate" content="text">)[^<]*/, `$1${now}`)
    .replace(/(name="ModifiedDate" content="text">)[^<]*/, `$1${now}`)
    .replace('</opf:manifest>', doc.images.map(im => `<opf:item id="${im.name}" href="BinData/${im.name}.png" media-type="image/png" isEmbeded="1"/>`).join('') + '</opf:manifest>');

  const out = new JSZip();
  out.file('mimetype', 'application/hwp+zip', { compression: 'STORE' });
  const order = ['version.xml', 'Contents/header.xml', 'Contents/section0.xml', 'Preview/PrvText.txt', 'settings.xml',
    'Preview/PrvImage.png', 'META-INF/container.rdf', 'Contents/content.hpf', 'META-INF/container.xml', 'META-INF/manifest.xml'];
  const replaced = {
    'Contents/header.xml': header, 'Contents/section0.xml': section, 'Contents/content.hpf': hpf,
    'Preview/PrvText.txt': doc.plain.join(' ').slice(0, 1000),
  };
  for (const name of order) {
    const data = replaced[name] ?? await sk.file(name).async('uint8array');
    out.file(name, data, { compression: 'DEFLATE', createFolders: false });
  }
  for (const im of doc.images) out.file(`BinData/${im.name}.png`, im.data, { compression: 'DEFLATE', createFolders: false });
  const blob = await out.generateAsync({ type: 'blob', mimeType: 'application/hwp+zip' });
  return { blob, failedEq: doc.failedEq };
}
