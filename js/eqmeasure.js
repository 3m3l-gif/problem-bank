// 한글 수식 상자 크기 계산.
// python-hwpx (Apache-2.0) hwpx/equation/measure.py 를 자바스크립트로 옮긴 것입니다.
// 폭·높이는 HYhwpEQ 글꼴 기준으로 한컴이 저장한 상자에 맞춘 값입니다.

const T = {"GREEK": ["DELTA", "GAMMA", "LAMBDA", "OMEGA", "PHI", "PI", "PSI", "SIGMA", "THETA", "UPSILON", "XI", "alpha", "beta", "chi", "delta", "epsilon", "eta", "gamma", "iota", "kappa", "lambda", "mu", "nu", "omega", "omicron", "phi", "pi", "psi", "rho", "sigma", "tau", "theta", "upsilon", "varepsilon", "varphi", "varpi", "varrho", "varsigma", "vartheta", "xi", "zeta"], "OPERATORS": ["FORALL", "GEQ", "LEQ", "Leftarrow", "NEQ", "Rightarrow", "THEREFORE", "TIMES", "TRIANGLE", "`", "angle", "approx", "ast", "because", "bullet", "cap", "cdot", "cdots", "circ", "cong", "cup", "ddots", "div", "dots", "emptyset", "equiv", "exists", "forall", "geq", "gg", "in", "inf", "infinity", "infty", "land", "ldots", "leftarrow", "leftrightarrow", "leq", "ll", "lor", "mapsto", "mp", "nabla", "neg", "neq", "notin", "oplus", "otimes", "partial", "pm", "prime", "prop", "propto", "rightarrow", "sim", "simeq", "star", "subset", "subseteq", "supset", "supseteq", "therefore", "times", "to", "triangle", "vdots"], "SYMBOL_OPERATORS": ["!=", "+-", "-+", "->", "<-", "<->", "<=", "==", "=>", ">=", "~=", "~|~"], "FUNCTIONS": ["arccos", "arcsin", "arctan", "cos", "cosh", "cot", "csc", "det", "dim", "exp", "gcd", "lg", "ln", "log", "max", "min", "mod", "sec", "sin", "sinh", "tan", "tanh"], "BIG_OPERATORS": ["bigcap", "bigcup", "coprod", "dint", "iiint", "iint", "int", "lim", "liminf", "limsup", "oint", "prod", "sum", "tint"], "ACCENTS": ["acute", "bar", "breve", "check", "ddot", "dot", "dyad", "grave", "hat", "overline", "tilde", "underline", "vec", "widehat", "widetilde"], "MATRIX_ENVIRONMENTS": ["Bmatrix", "Vmatrix", "bmatrix", "cases", "dmatrix", "matrix", "pmatrix", "vmatrix"]};
// 상수: em 단위 (python-hwpx measure.py 와 동일)
const DIGIT = 0.47, LOWER = 0.57, UPPER = 0.81, UPRIGHT_LOWER = 0.4, UPRIGHT_UPPER = 0.67, GREEK_LOWER = 0.57, GREEK_UPPER = 0.78;
const HANGUL = 0.83, PUNCT = 0.15, COMMA_SPACE = 0.17, BRACKET = 0.35, BRACE = 0.56, BAR = 0.45, DOUBLE_BAR = 1.3, PRIME = 0.21, DEGREE = 0.73;
const OPERATOR_GLYPH = 0.52, OPERATOR_SPACE = 0.18, FUNCTION_PAD = 0.16, SPACE = 0.25, THIN_SPACE = 0.09, OTHER = 0.36, SYMBOL = 1.05;
const SCRIPT_SCALE = 0.55, SCRIPT_WIDTH = 0.66, SCRIPT_RAISE = 0.48, SUBSCRIPT_DROP = -0.2;
const FRACTION_PAD = 0.25, FRACTION_GAP = 0.34, FRACTION_AXIS = 0.37, ATOP_GAP = 0.14;
const ROOT_SIGN = 1.21, ROOT_INDEX_ROOM = 0.41, ROOT_TOP = 0.14, BIG_OPERATOR = 1.24, BIG_OPERATOR_HEIGHT = 1.25;
const INTEGRAL_SIGN = 0.88, INTEGRAL_SPACE = 0.36, INTEGRAL_HEIGHT = 2.27, INTEGRAL_LIMIT_EXTRA = 0.2;
const LIMIT_SCALE = 0.75, LIMIT_GAP = 0.035, ACCENT_TOP = 0.25, COLUMN_GAP = 0.2, ROW_GAP = 0.25, LINE_GAP = 0.3, ASCENT = 0.85, DESCENT = 0.14;

const MATRICES = new Set([...T.MATRIX_ENVIRONMENTS, 'pile', 'lpile', 'rpile']);
const INTEGRALS = { int: 1, oint: 1, dint: 2, tint: 3 };
const MATRIX_DELIMITERS = { pmatrix: ['(', 2], bmatrix: ['[', 2], Bmatrix: ['{', 2], vmatrix: ['|', 2], Vmatrix: ['|', 2], dmatrix: ['|', 2], cases: ['{', 1] };
const LETTER_WIDTHS = { a: 0.51, b: 0.42, c: 0.32, d: 0.46, f: 0.67, k: 0.4, n: 0.6, r: 0.37, x: 0.52, y: 0.51, i: 0.31, j: 0.31, l: 0.31, t: 0.31, m: 1.03, w: 1.03 };
const UPRIGHT_WIDTHS = { f: 0.32, i: 0.32, j: 0.32, l: 0.32, r: 0.32, t: 0.32, m: 0.84, w: 0.84 };
const STRETCHED = { '(': 0.39, ')': 0.39, '[': 0.52, ']': 0.52, '|': 0.52, '{': 0.58, '}': 0.58 };
const STRETCHED_NAMES = { lbrace: '{', rbrace: '}', langle: '(', rangle: ')', lfloor: '[', rfloor: ']', lceil: '[', rceil: ']', line: '|', vert: '|' };
const OPERATOR_GLYPHS = { '+': 0.65, '-': 0.69, '=': 0.71, '<': 0.8, '>': 0.8, times: 0.61 };
const SIGNS = new Set(['+', '-', '+-', '-+', 'pm', 'mp']);
const GREEK_WIDTHS = { alpha: 0.61, beta: 0.54, theta: 0.43, lambda: 0.52, sigma: 0.52 };
const KEYWORD_GLYPHS = { lbrace: BRACE, rbrace: BRACE, langle: BRACKET, rangle: BRACKET, lfloor: BRACKET, rfloor: BRACKET, lceil: BRACKET, rceil: BRACKET, prime: PRIME, deg: DEGREE };
const CASED_KEYWORD_GLYPHS = { LINE: BAR, vert: BAR, VERT: DOUBLE_BAR };
const LIMIT_WORDS = new Set(['lim', 'limsup', 'liminf', 'max', 'min']);
const FONT_WORDS = new Set(['rm', 'it', 'bold']);
const GREEK = new Set(T.GREEK), OPERATORS = new Set(T.OPERATORS), FUNCTIONS = new Set(T.FUNCTIONS);
const BIG_OPERATORS = new Set(T.BIG_OPERATORS), ACCENT_SET = new Set(T.ACCENTS);
const RELATIONS = new Set(['=', '<', '>', '+', '-', '×', '÷', ...T.SYMBOL_OPERATORS]);
const SYMBOL_RELATIONS = new Set(['sim', 'simeq', 'approx', 'cong', 'equiv', 'in', 'ni', 'notin', 'subset', 'supset', 'nsubset',
  'nsupset', 'subseteq', 'supseteq', 'cup', 'cap', 'smallinter', 'smallunion', 'perp', 'parallel',
  'propto', 'prop', 'le', 'ge', 'leq', 'geq', 'ne', 'neq', 'times', 'div', 'divide', 'pm', 'mp',
  'cdot', 'circ', 'bullet', 'rarrow', 'larrow', 'lrarrow', 'rightarrow', 'leftarrow', 'therefore',
  'because', 'vee', 'wedge', 'oplus', 'otimes', 'll', 'gg', 'lsub', 'rsub']);
const SYMBOL_ORDINARY = new Set(['inf', 'infinity', 'angle', 'triangle', 'partial', 'nabla', 'hbar', 'emptyset',
  'aleph', 'forall', 'exists', 'neg', 'cdots', 'ldots', 'vdots', 'ddots', 'dagger', 'box', 'diamond', 'centigrade']);
const BREAK_CHARS = new Set('{}^_&#()[]|');
const SYMBOL_OPS_SORTED = [...T.SYMBOL_OPERATORS].sort((a, b) => b.length - a.length);
const MAX_GROUP_DEPTH = 64, MAX_SOURCE_LENGTH = 10000;

const isDigitCh = c => /\p{Nd}/u.test(c);
const isAlphaCh = c => /\p{L}/u.test(c);
const isAlphaStr = s => s.length > 0 && /^\p{L}+$/u.test(s);
const isDigitStr = s => s.length > 0 && /^\p{Nd}+$/u.test(s);
const isUpperStr = s => s !== s.toLowerCase() && s === s.toUpperCase();

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"') {
      const j = src.indexOf('"', i + 1);
      if (j === -1) { tokens.push(src.slice(i)); i = n; } else { tokens.push(src.slice(i, j + 1)); i = j + 1; }
      continue;
    }
    const op = SYMBOL_OPS_SORTED.find(o => src.startsWith(o, i));
    if (op) { tokens.push(op); i += op.length; continue; }
    if (BREAK_CHARS.has(ch)) { tokens.push(ch); i++; continue; }
    if (isDigitCh(ch) || ch === '.') { let j = i; while (j < n && (isDigitCh(src[j]) || src[j] === '.')) j++; tokens.push(src.slice(i, j)); i = j; continue; }
    if (isAlphaCh(ch)) { let j = i; while (j < n && isAlphaCh(src[j])) j++; tokens.push(src.slice(i, j)); i = j; continue; }
    tokens.push(ch); i++;
  }
  return tokens;
}

const box = (width, ascent, descent) => ({ width, ascent, descent });
const height = b => b.ascent + b.descent;
const scaled = (b, f) => box(b.width * f, b.ascent * f, b.descent * f);
const EMPTY = () => box(0, 0, 0);

function row(boxes) {
  let r = box(0, ASCENT, DESCENT);
  for (const b of boxes) r = box(r.width + b.width, Math.max(r.ascent, b.ascent), Math.max(r.descent, b.descent));
  return r;
}
function stack(lines, gap) {
  const h = lines.reduce((s, l) => s + height(l), 0) + gap * (lines.length - 1);
  return box(Math.max(...lines.map(l => l.width)), lines[0].ascent, h - lines[0].ascent);
}
function fraction(num, den, gap = FRACTION_GAP) {
  return box(Math.max(num.width, den.width) + 2 * FRACTION_PAD, height(num) + gap / 2 + FRACTION_AXIS, height(den) + gap / 2 - FRACTION_AXIS);
}
function grid(rows) {
  if (!rows.length) return row([]);
  const columns = Math.max(...rows.map(r => r.length));
  const widths = Array.from({ length: columns }, (_, c) => Math.max(0, ...rows.filter(r => c < r.length).map(r => r[c].width)));
  const h = rows.reduce((s, r) => s + Math.max(...r.map(height)), 0) + ROW_GAP * (rows.length - 1);
  return box(widths.reduce((a, b) => a + b, 0) + COLUMN_GAP * (columns - 1), h / 2 + FRACTION_AXIS, h / 2 - FRACTION_AXIS);
}
function binomial(top, bottom) {
  const b = grid([[top], [bottom]]);
  return box(b.width + 2 * STRETCHED['('], b.ascent, b.descent);
}
const script = b => box(b.width * SCRIPT_WIDTH, b.ascent * SCRIPT_SCALE, b.descent * SCRIPT_SCALE);

function charWidth(ch, upright = false) {
  if (ch >= '가' && ch <= '힣') return HANGUL;
  if (isDigitCh(ch)) return DIGIT;
  if (ch === ' ') return SPACE;
  if (upright) return isUpperStr(ch) ? UPRIGHT_UPPER : (UPRIGHT_WIDTHS[ch] ?? UPRIGHT_LOWER);
  return LETTER_WIDTHS[ch] ?? (isUpperStr(ch) ? UPPER : LOWER);
}
const uprightWord = w => [...w].reduce((s, c) => s + charWidth(c, true), 0);
const isOperator = t => OPERATORS.has(t) || RELATIONS.has(t) || SYMBOL_RELATIONS.has(t.toLowerCase());

function tokenWidth(t, upright = false, sign = false) {
  const lower = t.toLowerCase();
  if (t.startsWith('"')) return [...t.replace(/^"+|"+$/g, '')].reduce((s, c) => s + charWidth(c, upright), 0);
  if (GREEK.has(t)) return GREEK_WIDTHS[t] ?? (isUpperStr(t) ? GREEK_UPPER : GREEK_LOWER);
  if (t in CASED_KEYWORD_GLYPHS) return CASED_KEYWORD_GLYPHS[t];
  if (lower in KEYWORD_GLYPHS) return KEYWORD_GLYPHS[lower];
  if (isOperator(t)) return (OPERATOR_GLYPHS[t] ?? OPERATOR_GLYPH) + (sign ? 1 : 2) * OPERATOR_SPACE;
  if (SYMBOL_ORDINARY.has(lower)) return SYMBOL;
  if (isDigitStr(t.replaceAll('.', ''))) return [...t].reduce((s, c) => s + (isDigitCh(c) ? DIGIT : PUNCT), 0);
  if (isAlphaStr(t)) return [...t].reduce((s, c) => s + charWidth(c, upright), 0);
  if (['(', ')', '[', ']'].includes(t)) return BRACKET;
  if (t === '|') return BAR;
  if (t === "'") return PRIME;
  if (t === ',') return PUNCT + COMMA_SPACE;
  if (['.', ';', ':', '!'].includes(t)) return PUNCT;
  return OTHER;
}
function followsOperand(t, operand) {
  if (FONT_WORDS.has(t.toLowerCase())) return operand;
  return !(isOperator(t) || ['(', '[', ','].includes(t));
}
function stretched(t) {
  if (t == null) return 0;
  const name = t === 'VERT' ? t : t.toLowerCase();
  return STRETCHED[STRETCHED_NAMES[name] ?? t] ?? BRACKET;
}

class TooDeep extends Error {}

class Measurer {
  constructor(tokens) { this.t = tokens; this.p = 0; this.tooDeep = false; this.upright = false; }
  peek() { return this.p < this.t.length ? this.t[this.p] : null; }
  next() { const v = this.peek(); if (v !== null) this.p++; return v; }

  sequence(depth, stop = null) {
    const lines = [];
    let items = [];
    let operand = false;
    for (;;) {
      const t = this.peek();
      if (t === null || t === stop || (stop === 'RIGHT' && (t === 'RIGHT' || t === 'right'))) break;
      this.next();
      if (t === '#') { lines.push(row(items)); items = []; operand = false; }
      else if (t === '&') operand = false;
      else if (!this.infix(t, items, depth)) {
        items.push(this.dispatch(t, depth, !operand && SIGNS.has(t)));
        operand = followsOperand(t, operand);
      }
    }
    return lines.length ? stack([...lines, row(items)], LINE_GAP) : row(items);
  }
  infix(t, items, depth) {
    if (t === '^' || t === '_') items.push(this.scripts(items.length ? items.pop() : EMPTY(), t, depth));
    else if (t === 'over' || t.toLowerCase() === 'atop') {
      const num = items.length ? items.pop() : row([]);
      items.push(fraction(num, this.atom(depth), t === 'over' ? FRACTION_GAP : ATOP_GAP));
    } else if (t.toLowerCase() === 'choose') {
      const top = items.length ? items.pop() : row([]);
      items.push(binomial(top, this.atom(depth)));
    } else return false;
    return true;
  }
  atom(depth) { const t = this.next(); return t === null ? EMPTY() : this.dispatch(t, depth); }
  group(depth) {
    if (depth + 1 > MAX_GROUP_DEPTH) { this.tooDeep = true; return EMPTY(); }
    const up = this.upright;
    const inner = this.sequence(depth + 1, '}');
    this.upright = up;
    if (this.peek() === '}') this.next();
    return inner;
  }
  scripts(base, op, depth) {
    const s = { [op]: script(this.atom(depth)) };
    const f = this.peek();
    if ((f === '^' || f === '_') && f !== op) { this.next(); s[f] = script(this.atom(depth)); }
    const upper = s['^'], lower = s['_'];
    const width = base.width + Math.max(upper ? upper.width : 0, lower ? lower.width : 0);
    const top = Math.max(base.ascent - ASCENT, 0), bottom = Math.max(base.descent - DESCENT, 0);
    const ascent = upper ? Math.max(base.ascent, top + SCRIPT_RAISE + height(upper)) : base.ascent;
    const descent = lower ? Math.max(base.descent, bottom + SUBSCRIPT_DROP + height(lower)) : base.descent;
    return box(width, ascent, descent);
  }
  dispatch(t, depth, sign = false) {
    if (depth > 200) throw new TooDeep();
    if (t === '{') return this.group(depth);
    if (t === 'sqrt' || t === 'root') return this.root(t, depth);
    if (ACCENT_SET.has(t)) { const inner = this.atom(depth); return box(inner.width, inner.ascent + ACCENT_TOP, inner.descent); }
    if (t.toLowerCase() === 'binom') { const top = this.atom(depth); return binomial(top, this.atom(depth)); }
    if (MATRICES.has(t)) {
      const b = this.matrix(depth);
      const [d, c] = MATRIX_DELIMITERS[t] ?? ['', 0];
      return box(b.width + c * (STRETCHED[d] ?? BRACKET), b.ascent, b.descent);
    }
    if (t === 'LEFT' || t === 'left') return this.delimited(depth);
    if (t === 'RIGHT' || t === 'right') return box(stretched(this.next()), ASCENT, DESCENT);
    if (t in INTEGRALS) return this.integral(t, depth);
    if (LIMIT_WORDS.has(t.toLowerCase()) && (this.peek() === '_' || this.peek() === 'from')) return this.limit(t, depth);
    if (BIG_OPERATORS.has(t) && !LIMIT_WORDS.has(t.toLowerCase()) && t !== 'iint' && t !== 'iiint') return this.bigOperator(depth);
    return this.symbol(t, sign);
  }
  symbol(t, sign = false) {
    if (FUNCTIONS.has(t) || LIMIT_WORDS.has(t.toLowerCase())) return box(uprightWord(t) + FUNCTION_PAD, ASCENT, DESCENT);
    if (FONT_WORDS.has(t.toLowerCase()) || t === 'of' || t === '&') {
      if (t.toLowerCase() === 'rm' || t.toLowerCase() === 'it') this.upright = t.toLowerCase() === 'rm';
      return EMPTY();
    }
    if (t === '~') return box(SPACE, 0, 0);
    if (t === '`') return box(THIN_SPACE, 0, 0);
    return box(tokenWidth(t, this.upright, sign), ASCENT, DESCENT);
  }
  root(t, depth) {
    let index = EMPTY();
    if (t === 'root') { index = this.atom(depth); if (this.peek() === 'of') this.next(); }
    const inner = this.atom(depth);
    const overhang = Math.max(0, script(index).width - ROOT_INDEX_ROOM);
    return box(inner.width + ROOT_SIGN + overhang, inner.ascent + ROOT_TOP, inner.descent);
  }
  delimited(depth) {
    const opening = stretched(this.next());
    const body = this.sequence(depth, 'RIGHT');
    let closing = 0;
    if (this.peek() === 'RIGHT' || this.peek() === 'right') { this.next(); closing = stretched(this.next()); }
    return box(body.width + opening + closing, body.ascent, body.descent);
  }
  integral(t, depth) {
    const width = INTEGRAL_SIGN * INTEGRALS[t];
    let ascent = INTEGRAL_HEIGHT * 0.6, descent = INTEGRAL_HEIGHT * 0.4, limitWidth = 0;
    while (['_', '^', 'from', 'to'].includes(this.peek())) {
      const upper = ['^', 'to'].includes(this.next());
      const lim = script(this.atom(depth));
      limitWidth = Math.max(limitWidth, lim.width);
      if (upper) ascent += INTEGRAL_LIMIT_EXTRA; else descent += INTEGRAL_LIMIT_EXTRA;
    }
    return box(width + limitWidth + INTEGRAL_SPACE, ascent, descent);
  }
  limit(t, depth) {
    this.next();
    const lim = scaled(this.atom(depth), LIMIT_SCALE);
    const width = uprightWord(t) + FUNCTION_PAD;
    return box(Math.max(width, lim.width), ASCENT, DESCENT + height(lim) + LIMIT_GAP);
  }
  bigOperator(depth) {
    const b = box(BIG_OPERATOR, BIG_OPERATOR_HEIGHT * 0.6, BIG_OPERATOR_HEIGHT * 0.4);
    const limits = [];
    while (['_', '^', 'from', 'to'].includes(this.peek())) { this.next(); limits.push(scaled(this.atom(depth), LIMIT_SCALE)); }
    if (!limits.length) return b;
    const extra = limits.reduce((s, l) => s + height(l), 0) / 2;
    return box(Math.max(b.width, ...limits.map(l => l.width)), b.ascent + extra, b.descent + extra);
  }
  matrix(depth) {
    if (this.peek() !== '{') return box(LOWER * 6, ASCENT, DESCENT);
    this.next();
    const rows = [[]];
    const up = this.upright;
    while (this.peek() !== null && this.peek() !== '}') {
      rows[rows.length - 1].push(this.cell(depth));
      if (this.peek() === '#') { this.next(); rows.push([]); }
      else if (this.peek() === '&') this.next();
    }
    if (this.peek() === '}') this.next();
    this.upright = up;
    return grid(rows.filter(r => r.length));
  }
  cell(depth) {
    const items = [];
    let operand = false;
    while (![null, '}', '&', '#'].includes(this.peek())) {
      const t = this.next() ?? '';
      if (!this.infix(t, items, depth + 1)) {
        items.push(this.dispatch(t, depth + 1, !operand && SIGNS.has(t)));
        operand = followsOperand(t, operand);
      }
    }
    return row(items);
  }
}

// 파이썬 round() 와 같은 짝수 반올림
function roundHalfEven(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** 한글이 수식 상자를 잡는 크기 {width, height, baseLine} (HWPUNIT, baseUnit=1/100pt) */
export function measureEquation(scriptText, baseUnit = 1000) {
  const text = scriptText.trim();
  let b = null;
  if (text.length <= MAX_SOURCE_LENGTH) {
    const m = new Measurer(tokenize(text));
    try { b = m.sequence(0); } catch { b = null; }
    if (m.tooDeep) b = null;
  }
  if (!b) {
    const visible = text.replace(/[{} ]/g, '').length;
    b = box(Math.max(1, visible) * LOWER, ASCENT, DESCENT);
  }
  const h = Math.max(height(b), ASCENT + DESCENT);
  return {
    width: Math.max(1, roundHalfEven(b.width * baseUnit)),
    height: Math.max(1, roundHalfEven(h * baseUnit)),
    baseLine: Math.max(1, Math.min(100, roundHalfEven(100 * b.ascent / h))),
  };
}
