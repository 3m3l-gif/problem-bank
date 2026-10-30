// LaTeX -> 한글(EqEdit) 수식 스크립트 변환.
// python-hwpx (Apache-2.0, https://github.com/airmang/python-hwpx) 의 hwpx/equation/authoring.py 를
// 자바스크립트로 옮긴 것입니다. 변환표는 해당 프로젝트가 실제 한글에서 렌더 검증한 토큰 집합입니다.
// 지원하지 않는 명령은 UnsupportedLatexError 를 던집니다 (조용히 틀리게 바꾸지 않음).

const LATEX_TO_EQEDIT = {"\\alpha": "alpha", "\\beta": "beta", "\\gamma": "gamma", "\\delta": "delta", "\\epsilon": "epsilon", "\\varepsilon": "varepsilon", "\\zeta": "zeta", "\\eta": "eta", "\\theta": "theta", "\\vartheta": "vartheta", "\\iota": "iota", "\\kappa": "kappa", "\\lambda": "lambda", "\\mu": "mu", "\\nu": "nu", "\\xi": "xi", "o": "omicron", "\\pi": "pi", "\\varpi": "varpi", "\\rho": "rho", "\\varrho": "varrho", "\\sigma": "sigma", "\\varsigma": "varsigma", "\\tau": "tau", "\\upsilon": "upsilon", "\\phi": "phi", "\\varphi": "varphi", "\\chi": "chi", "\\psi": "psi", "\\omega": "omega", "\\Gamma": "GAMMA", "\\Delta": "DELTA", "\\Theta": "THETA", "\\Lambda": "LAMBDA", "\\Xi": "XI", "\\Pi": "PI", "\\Sigma": "SIGMA", "\\Upsilon": "UPSILON", "\\Phi": "PHI", "\\Psi": "PSI", "\\Omega": "OMEGA", "\\pm": "+-", "\\mp": "-+", "\\times": "times", "\\cdot": "cdot", "\\div": "div", "\\ast": "ast", "\\star": "star", "\\circ": "circ", "\\bullet": "bullet", "\\oplus": "oplus", "\\otimes": "otimes", "\\leq": "leq", "\\geq": "geq", "\\neq": "neq", "\\equiv": "equiv", "\\approx": "approx", "\\sim": "sim", "\\simeq": "simeq", "\\cong": "cong", "\\propto": "propto", "\\ll": "ll", "\\gg": "gg", "\\in": "in", "\\notin": "notin", "\\subset": "subset", "\\subseteq": "subseteq", "\\supset": "supset", "\\supseteq": "supseteq", "\\cup": "cup", "\\cap": "cap", "\\emptyset": "emptyset", "\\forall": "FORALL", "\\exists": "exists", "\\neg": "neg", "\\land": "land", "\\lor": "lor", "\\infty": "infty", "\\partial": "partial", "\\nabla": "nabla", "\\angle": "angle", "\\triangle": "TRIANGLE", "\\therefore": "therefore", "\\because": "because", "\\cdots": "cdots", "\\ldots": "ldots", "\\vdots": "vdots", "\\ddots": "ddots", "\\prime": "prime", "\\rightarrow": "->", "\\leftarrow": "leftarrow", "\\leftrightarrow": "<->", "\\Rightarrow": "Rightarrow", "\\Leftarrow": "Leftarrow", "\\to": "->", "\\mapsto": "mapsto", "\\,": "`", "\\sin": "sin", "\\cos": "cos", "\\tan": "tan", "\\cot": "cot", "\\sec": "sec", "\\csc": "csc", "\\sinh": "sinh", "\\cosh": "cosh", "\\tanh": "tanh", "\\arcsin": "arcsin", "\\arccos": "arccos", "\\arctan": "arctan", "\\log": "log", "\\ln": "ln", "\\lg": "lg", "\\exp": "exp", "\\det": "det", "\\dim": "dim", "\\gcd": "gcd", "\\max": "max", "\\min": "min", "\\bmod": "mod", "\\int": "int", "\\iint": "dint", "\\iiint": "tint", "\\oint": "oint", "\\sum": "sum", "\\prod": "prod", "\\coprod": "coprod", "\\lim": "lim", "\\bigcup": "bigcup", "\\bigcap": "bigcap", "\\mid": "~|~", "\\le": "leq", "\\ge": "geq", "\\ne": "neq", "\\dots": "cdots"};
const ACCENTS = {"\\bar": "bar", "\\vec": "vec", "\\overleftrightarrow": "dyad", "\\hat": "hat", "\\tilde": "tilde", "\\dot": "dot", "\\ddot": "ddot", "\\acute": "acute", "\\grave": "grave", "\\check": "check", "\\breve": "breve", "\\overline": "overline", "\\underline": "underline", "\\overrightarrow": "vec"};
ACCENTS['\\overrightarrow'] = 'vec';
const DELIMS = {"\\langle": "<", "\\rangle": ">", "\\{": "{", "\\}": "}", "\\lfloor": "lfloor", "\\rfloor": "rfloor", "\\lceil": "lceil", "\\rceil": "rceil"};
const DELIM_SINGLE = new Set(["(", ")", ".", "/", "<", ">", "[", "]", "{", "|", "}"]);
const RESERVED = new Set(["BOLD", "Bmatrix", "DELTA", "FORALL", "GAMMA", "GEQ", "IT", "LAMBDA", "LEFT", "LEQ", "Leftarrow", "NEQ", "OMEGA", "PHI", "PI", "PSI", "RIGHT", "RM", "Rightarrow", "SIGMA", "THEREFORE", "THETA", "TIMES", "TRIANGLE", "UPSILON", "Vmatrix", "XI", "`", "acute", "alpha", "angle", "approx", "arccos", "arcsin", "arctan", "ast", "atop", "bar", "because", "beta", "bigcap", "bigcup", "binom", "bmatrix", "bold", "breve", "bullet", "cap", "cases", "cdot", "cdots", "check", "chi", "choose", "circ", "cong", "coprod", "cos", "cosh", "cot", "csc", "cup", "ddot", "ddots", "delta", "det", "dim", "dint", "div", "dmatrix", "dot", "dots", "dyad", "emptyset", "epsilon", "equiv", "eta", "exists", "exp", "forall", "gamma", "gcd", "geq", "gg", "grave", "hat", "iiint", "iint", "in", "inf", "infinity", "infty", "int", "iota", "it", "kappa", "lambda", "land", "ldots", "left", "leftarrow", "leftrightarrow", "leq", "lg", "lim", "liminf", "limsup", "ll", "ln", "log", "lor", "mapsto", "matrix", "max", "min", "mod", "mp", "mu", "nabla", "neg", "neq", "notin", "nu", "of", "oint", "omega", "omicron", "oplus", "otimes", "over", "overline", "partial", "phi", "pi", "pm", "pmatrix", "prime", "prod", "prop", "propto", "psi", "rho", "right", "rightarrow", "rm", "root", "sec", "sigma", "sim", "simeq", "sin", "sinh", "sqrt", "star", "subset", "subseteq", "sum", "supset", "supseteq", "tan", "tanh", "tau", "therefore", "theta", "tilde", "times", "tint", "to", "triangle", "underline", "upsilon", "varepsilon", "varphi", "varpi", "varrho", "varsigma", "vartheta", "vdots", "vec", "vmatrix", "widehat", "widetilde", "xi", "zeta"]);
const MAX_DEPTH = 64, MAX_LEN = 10000;
const TEXT_COMMANDS = new Set(['\\text', '\\mathrm', '\\textrm', '\\mbox']);
const ENV = { matrix: 'matrix', pmatrix: 'pmatrix', bmatrix: 'bmatrix', vmatrix: 'dmatrix', cases: 'cases' };
const PASSTHROUGH = new Set("+-=<>,.;:!|/()[]'~");
const isAlpha = c => /\p{L}/u.test(c);
const isDigit = c => c >= '0' && c <= '9';

export class UnsupportedLatexError extends Error {}

function lex(src) {
  const tokens = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (/\s/.test(ch)) i++;
    else if (ch === '\\') {
      if (i + 1 >= n) throw new UnsupportedLatexError('dangling backslash');
      const nx = src[i + 1];
      if (nx === '\\') { tokens.push('\\\\'); i += 2; }
      else if (!isAlpha(nx)) { tokens.push('\\' + nx); i += 2; }
      else { let j = i + 1; while (j < n && isAlpha(src[j])) j++; tokens.push(src.slice(i, j)); i = j; }
    } else if ('{}^_&'.includes(ch)) { tokens.push(ch); i++; }
    else if (isDigit(ch) || ch === '.') { let j = i; while (j < n && (isDigit(src[j]) || src[j] === '.')) j++; tokens.push(src.slice(i, j)); i = j; }
    else if (isAlpha(ch)) { let j = i; while (j < n && isAlpha(src[j])) j++; tokens.push(src.slice(i, j)); i = j; }
    else if (PASSTHROUGH.has(ch)) { tokens.push(ch); i++; }
    else throw new UnsupportedLatexError('unsupported character: ' + ch);
  }
  return tokens;
}

class Parser {
  constructor(tokens) { this.t = tokens; this.p = 0; }
  peek() { return this.p < this.t.length ? this.t[this.p] : null; }
  next() { const v = this.peek(); if (v !== null) this.p++; return v; }
  expect(e) { const v = this.next(); if (v !== e) throw new UnsupportedLatexError(`expected ${e}, found ${v}`); }

  parse() {
    const parts = this.sequence(0, new Set());
    if (this.peek() !== null) throw new UnsupportedLatexError('unbalanced group near ' + this.peek());
    return parts.join(' ');
  }
  sequence(depth, stop) {
    if (depth > MAX_DEPTH) throw new UnsupportedLatexError('nesting too deep');
    const parts = [];
    for (;;) {
      const tok = this.peek();
      if (tok === null || stop.has(tok)) break;
      if (tok === '^' || tok === '_') { this.next(); parts.push(`${tok}{${this.groupOrAtom(depth)}}`); continue; }
      parts.push(this.atom(depth));
    }
    return parts;
  }
  groupOrAtom(depth) {
    if (this.peek() === '{') {
      this.next();
      const inner = this.sequence(depth + 1, new Set(['}']));
      this.expect('}');
      return inner.join(' ');
    }
    return this.atom(depth);
  }
  atom(depth) {
    const tok = this.next();
    if (tok === null) return '';
    if (tok === '{') { const inner = this.sequence(depth + 1, new Set(['}'])); this.expect('}'); return '{' + inner.join(' ') + '}'; }
    if (tok === '}') throw new UnsupportedLatexError('unbalanced closing brace');
    if (tok === '\\frac' || tok === '\\dfrac' || tok === '\\tfrac') {
      const a = this.groupOrAtom(depth), b = this.groupOrAtom(depth);
      return `{${a}} over {${b}}`;
    }
    if (tok === '\\binom') { const a = this.groupOrAtom(depth), b = this.groupOrAtom(depth); return `{${a}} choose {${b}}`; }
    if (tok === '\\sqrt') {
      if (this.peek() === '[') {
        this.next();
        const idx = this.sequence(depth + 1, new Set([']']));
        this.expect(']');
        return `root {${idx.join(' ')}} of {${this.groupOrAtom(depth)}}`;
      }
      return `sqrt {${this.groupOrAtom(depth)}}`;
    }
    if (tok === '\\lbrace' || tok === '\\rbrace') return tok === '\\lbrace' ? 'LBRACE' : 'RBRACE';
    if (TEXT_COMMANDS.has(tok)) return this.textLiteral();
    if (tok === '\\mathbf') return `{rm {bold {${this.groupOrAtom(depth)}}} it}`;
    if (tok === '\\boldsymbol') return `{bold {${this.groupOrAtom(depth)}}}`;
    if (tok === '\\begin') return this.environment(depth);
    if (tok === '\\left') return this.leftRight(depth);
    if (tok === '\\right' || tok === '\\end') throw new UnsupportedLatexError(tok + ' without opener');
    if (tok in ACCENTS) return `${ACCENTS[tok]} {${this.groupOrAtom(depth)}}`;
    if (tok in LATEX_TO_EQEDIT) return LATEX_TO_EQEDIT[tok];
    if (tok === '\\\\') throw new UnsupportedLatexError('row break outside matrix');
    if (tok.startsWith('\\') && tok.length === 2 && !isAlpha(tok[1])) return this.escaped(tok[1]);
    if (tok.startsWith('\\')) throw new UnsupportedLatexError('unsupported command: ' + tok);
    if (tok === '&') throw new UnsupportedLatexError('& outside matrix');
    return /^\p{L}+$/u.test(tok) && RESERVED.has(tok) ? `"${tok}"` : tok;
  }
  escaped(ch) {
    if (ch === '{' || ch === '}') return ch === '{' ? 'LBRACE' : 'RBRACE';
    if ('%$&'.includes(ch)) return ch;
    throw new UnsupportedLatexError('unsupported escape: \\' + ch);
  }
  textLiteral() {
    this.expect('{');
    const parts = [];
    for (;;) {
      const tok = this.peek();
      if (tok === null) throw new UnsupportedLatexError('unterminated \\text');
      if (tok === '}') { this.next(); break; }
      if (tok === '{' || tok === '\\\\' || (tok.startsWith('\\') && tok.length > 2)) throw new UnsupportedLatexError('\\text supports plain characters only');
      this.next();
      parts.push(tok.startsWith('\\') ? tok[1] : tok);
    }
    const lit = parts.join(' ');
    if (lit.includes('"')) throw new UnsupportedLatexError('quote in \\text');
    return `{rm "${lit}" it}`;
  }
  environment(depth) {
    this.expect('{');
    const name = this.next();
    this.expect('}');
    const builder = ENV[name];
    if (!builder) throw new UnsupportedLatexError('unsupported environment: ' + name);
    const rows = [[]];
    let cur = [];
    const flush = () => { rows[rows.length - 1].push(cur.join(' ')); cur = []; };
    for (;;) {
      const tok = this.peek();
      if (tok === null) throw new UnsupportedLatexError('unterminated environment');
      if (tok === '\\end') {
        this.next(); this.expect('{'); const end = this.next(); this.expect('}');
        if (end !== name) throw new UnsupportedLatexError('environment mismatch');
        break;
      }
      if (tok === '&') { this.next(); flush(); continue; }
      if (tok === '\\\\') { this.next(); flush(); rows.push([]); continue; }
      if (tok === '^' || tok === '_') { this.next(); cur.push(`${tok}{${this.groupOrAtom(depth)}}`); continue; }
      cur.push(this.atom(depth));
    }
    flush();
    const body = rows.filter(r => r.some(Boolean)).map(r => r.join(' & ')).join(' # ');
    return `${builder} {${body}}`;
  }
  leftRight(depth) {
    const open = this.delim(this.next());
    const body = this.sequence(depth + 1, new Set(['\\right']));
    if (this.peek() !== '\\right') throw new UnsupportedLatexError('\\left without \\right');
    this.next();
    const close = this.delim(this.next());
    return `LEFT ${open} ${body.join(' ')} RIGHT ${close}`;
  }
  delim(tok) {
    if (tok === null) throw new UnsupportedLatexError('missing delimiter');
    if (tok in DELIMS) return DELIMS[tok];
    if (tok === '\\{' || tok === '\\lbrace') return 'LBRACE';
    if (tok === '\\}' || tok === '\\rbrace') return 'RBRACE';
    if (DELIM_SINGLE.has(tok)) return tok;
    throw new UnsupportedLatexError('unsupported delimiter: ' + tok);
  }
}

export function latexToEqedit(latex) {
  if (latex.length > MAX_LEN) throw new UnsupportedLatexError('too long');
  let text = latex.trim();
  for (const f of ['$$', '$']) {
    if (text.startsWith(f) && text.endsWith(f) && text.length > 2 * f.length) { text = text.slice(f.length, -f.length).trim(); break; }
  }
  if (text.includes('$')) throw new UnsupportedLatexError('interior $');
  if (!text) throw new UnsupportedLatexError('empty');
  return new Parser(lex(text)).parse();
}
