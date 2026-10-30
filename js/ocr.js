// 문제·해설 이미지를 Claude 로 읽어 텍스트(+LaTeX 수식)로 바꿉니다.
// API 키는 이 브라우저(localStorage)에만 저장되고, 요청은 브라우저에서 Anthropic 으로 바로 갑니다.

const KEY = 'pb_api_key';
const MODEL = 'claude-opus-5-5';

export const getApiKey = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
export const setApiKey = k => { try { k ? localStorage.setItem(KEY, k) : localStorage.removeItem(KEY); } catch {} };

let sdkP;
async function client() {
  const apiKey = getApiKey();
  if (!apiKey) throw new OcrError('설정(⚙)에서 Claude API 키를 먼저 입력하세요', 'nokey');
  sdkP ||= import('../vendor/anthropic/anthropic-sdk.mjs');
  const { default: Anthropic } = await sdkP;
  return { Anthropic, c: new Anthropic({ apiKey, dangerouslyAllowBrowser: true }) };
}

export class OcrError extends Error {
  constructor(msg, code) { super(msg); this.code = code; }
}

const LATEX_RULES = `수식 규칙:
- 수식은 모두 LaTeX 로 $...$ 안에 쓰고, 한 줄을 차지하는 큰 수식만 $$...$$ 로 씁니다.
- 한글 문서의 수식으로 바뀌므로 이 명령만 쓰세요: \\frac \\sqrt ^ _ \\left( \\right) \\le \\ge \\ne \\pm \\times \\div \\cdot \\cdots \\to \\infty
  그리스 문자, \\sin \\cos \\tan \\log \\ln \\lim \\sum \\int, \\overline \\vec \\overrightarrow \\bar \\hat, \\angle \\triangle \\circ \\perp \\parallel,
  \\in \\subset \\cup \\cap \\emptyset, \\text{...}, \\mathrm{...}, 그리고 cases / pmatrix 환경.
- \\, \\quad 같은 간격 명령과 \\displaystyle 은 쓰지 마세요.
- 한글 낱말은 수식 밖에 쓰세요.`;

const PROBLEM_PROMPT = n => `이 이미지는 한국 중·고등학교 수학 문제 한 개입니다. 문제를 풀지 말고 보이는 그대로 옮겨 적으세요.

- body: 문제 본문. 문제 번호와 배점([4점] 등)은 빼고, 줄바꿈은 원본처럼 유지합니다.
- <보기> 상자(ㄱ, ㄴ, ㄷ …)가 있으면 body 안에 "<보기>" 줄 다음에 한 줄씩 넣습니다.
- choices: 객관식 선택지 ①~⑤ 의 내용만 순서대로 (번호 기호 빼고). 선택지가 없으면 빈 배열.
- format: 선택지가 있으면 "객관식", 답을 써넣는 문제면 "단답형", 풀이 과정을 쓰라는 문제면 "서술형".
- ${n ? `이 문제에는 그림(그래프·도형·표)이 ${n}개 있습니다. 그림이 있는 자리에 [그림1]${n > 1 ? ', [그림2]' : ''} 처럼 표시만 하고, 그림 속 글자는 옮기지 마세요.` : '그림이 있으면 무시하고 글만 옮기세요.'}

${LATEX_RULES}`;

const SOLUTION_PROMPT = `이 이미지는 한국 중·고등학교 수학 문제 한 개의 정답과 해설입니다. 보이는 그대로 옮겨 적으세요.

- answer: 최종 정답만. 객관식이면 ①~⑤ 기호 하나, 아니면 값 (수식이면 $...$).
- solution: 해설 본문 전체. 줄바꿈은 원본처럼 유지하고, 문제 번호와 "정답" 표시는 빼세요. 그래프·그림은 [그림] 으로만 표시하세요.

${LATEX_RULES}`;

const PROBLEM_SCHEMA = {
  type: 'object',
  properties: {
    body: { type: 'string' },
    choices: { type: 'array', items: { type: 'string' } },
    format: { type: 'string', enum: ['객관식', '단답형', '서술형'] },
  },
  required: ['body', 'choices', 'format'],
  additionalProperties: false,
};
const SOLUTION_SCHEMA = {
  type: 'object',
  properties: { answer: { type: 'string' }, solution: { type: 'string' } },
  required: ['answer', 'solution'],
  additionalProperties: false,
};

async function toBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

async function ask(blob, prompt, schema) {
  const { Anthropic, c } = await client();
  const media_type = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(blob.type) ? blob.type : 'image/png';
  let res;
  try {
    res = await c.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type, data: await toBase64(blob) } },
          { type: 'text', text: prompt },
        ],
      }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new OcrError('API 키가 올바르지 않습니다 (설정에서 확인)', 'auth');
    if (e instanceof Anthropic.PermissionDeniedError) throw new OcrError('이 API 키로는 사용할 수 없습니다: ' + e.message, 'auth');
    if (e instanceof Anthropic.RateLimitError) throw new OcrError('요청이 많아 잠시 막혔습니다. 조금 뒤 다시 시도하세요', 'rate');
    if (e instanceof Anthropic.BadRequestError) throw new OcrError('요청 오류: ' + e.message, 'bad');
    if (e instanceof Anthropic.APIConnectionError) throw new OcrError('Claude 에 연결하지 못했습니다 (인터넷 확인)', 'net');
    if (e instanceof Anthropic.APIError) throw new OcrError('Claude 오류: ' + e.message, 'api');
    throw e;
  }
  if (res.stop_reason === 'refusal') throw new OcrError('Claude 가 이 이미지를 처리하지 않았습니다', 'refusal');
  if (res.stop_reason === 'max_tokens') throw new OcrError('내용이 너무 길어 끝까지 읽지 못했습니다', 'long');
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  try { return JSON.parse(text); } catch { throw new OcrError('인식 결과를 해석하지 못했습니다', 'parse'); }
}

/** 문제 이미지 → { body, choices, format } */
export const readProblem = (blob, figureCount) => ask(blob, PROBLEM_PROMPT(figureCount), PROBLEM_SCHEMA);
/** 해설 이미지 → { answer, solution } */
export const readSolution = blob => ask(blob, SOLUTION_PROMPT, SOLUTION_SCHEMA);

/** 설정 화면의 '키 확인' 버튼용 */
export async function testKey() {
  const { Anthropic, c } = await client();
  try {
    await c.models.retrieve(MODEL);
    return true;
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new OcrError('API 키가 올바르지 않습니다', 'auth');
    if (e instanceof Anthropic.APIConnectionError) throw new OcrError('Claude 에 연결하지 못했습니다', 'net');
    throw new OcrError(e.message, 'api');
  }
}
