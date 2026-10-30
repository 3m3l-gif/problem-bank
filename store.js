// 저장소 계층: Google Drive (기본) / 이 브라우저(IndexedDB, 테스트용 ?local)
// Drive 구조:  내 드라이브/문제 저장소/{bank.json, 원본/, 이미지/}

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_KEY = 'pb_token';

export class AuthError extends Error { constructor() { super('Google 로그인이 필요합니다'); } }
export class ConflictError extends Error { constructor() { super('다른 기기나 탭에서 저장소가 바뀌었습니다'); } }

export const emptyBank = () => ({ version: 1, nextId: 1, docs: [], problems: [] });

// ---------------------------------------------------------------- IndexedDB (이미지 캐시)
const idb = (() => {
  let dbp;
  const open = () => dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('problem-bank', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('blobs'); r.result.createObjectStore('kv'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = async (store, mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req?.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    get: (s, k) => tx(s, 'readonly', o => o.get(k)).catch(() => undefined),
    put: (s, k, v) => tx(s, 'readwrite', o => o.put(v, k)).catch(() => {}),
    del: (s, k) => tx(s, 'readwrite', o => o.delete(k)).catch(() => {}),
  };
})();

// ---------------------------------------------------------------- Google Drive
export class DriveStore {
  constructor(clientId) {
    this.clientId = clientId;
    this.kind = 'drive';
    try { Object.assign(this, JSON.parse(localStorage.getItem(TOKEN_KEY)) || {}); } catch {}
  }

  get signedIn() { return !!this.token && Date.now() < this.exp - 60_000; }

  async #gis() {
    for (let i = 0; i < 100 && !window.google?.accounts?.oauth2; i++) await new Promise(r => setTimeout(r, 100));
    if (!window.google?.accounts?.oauth2) throw new Error('Google 로그인 스크립트를 불러오지 못했습니다 (인터넷 연결 확인)');
    this.tc ||= google.accounts.oauth2.initTokenClient({ client_id: this.clientId, scope: SCOPE, callback: () => {} });
    return this.tc;
  }

  // 반드시 버튼 클릭 같은 사용자 동작 안에서 호출 (팝업 차단 방지)
  async signIn() {
    const tc = await this.#gis();
    const r = await new Promise((res, rej) => {
      tc.callback = res;
      tc.error_callback = e => rej(new Error(e?.type === 'popup_closed' ? '로그인 창이 닫혔습니다' : (e?.message || '로그인 실패')));
      tc.requestAccessToken({ prompt: this.token ? '' : 'consent' });
    });
    if (r.error) throw new Error(r.error_description || r.error);
    if (!google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE)) throw new Error('Drive 접근 권한을 허용해야 합니다');
    this.token = r.access_token;
    this.exp = Date.now() + r.expires_in * 1000;
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: this.token, exp: this.exp }));
  }

  signOut() {
    if (this.token) google?.accounts?.oauth2?.revoke(this.token, () => {});
    this.token = null;
    localStorage.removeItem(TOKEN_KEY);
  }

  async #req(url, opt = {}) {
    if (!this.signedIn) throw new AuthError();
    const r = await fetch(url, { ...opt, headers: { ...opt.headers, Authorization: 'Bearer ' + this.token } });
    if (r.status === 401) { this.token = null; throw new AuthError(); }
    if (!r.ok) throw new Error(`Google Drive 오류 ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r;
  }

  async #find(key) {
    const q = encodeURIComponent(`appProperties has { key='pbank' and value='${key}' } and trashed=false`);
    const r = await this.#req(`${API}/files?q=${q}&fields=files(id,modifiedTime)&orderBy=createdTime&spaces=drive`);
    return (await r.json()).files[0];
  }

  async #upload(blob, meta) {
    if (blob.size > 4 * 1024 * 1024) {
      // 큰 파일: 재개 가능 업로드
      const r = await this.#req(`${UPLOAD}/files?uploadType=resumable&fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': blob.type || 'application/octet-stream' },
        body: JSON.stringify(meta),
      });
      const put = await fetch(r.headers.get('Location'), { method: 'PUT', body: blob });
      if (!put.ok) throw new Error(`업로드 실패 ${put.status}`);
      return (await put.json()).id;
    }
    const b = 'pb' + Math.random().toString(36).slice(2);
    const body = new Blob([
      `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
      `--${b}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`, blob, `\r\n--${b}--`,
    ]);
    const r = await this.#req(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body,
    });
    return (await r.json()).id;
  }

  async #folder(key, name, parent) {
    const f = await this.#find(key);
    if (f) return f.id;
    const r = await this.#req(`${API}/files?fields=id`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', appProperties: { pbank: key }, ...(parent && { parents: [parent] }) }),
    });
    return (await r.json()).id;
  }

  // 폴더 준비 + bank.json 읽기
  async init() {
    this.root = await this.#folder('root', '문제 저장소');
    [this.srcDir, this.imgDir] = await Promise.all([
      this.#folder('src', '원본', this.root),
      this.#folder('img', '이미지', this.root),
    ]);
    const f = await this.#find('db');
    if (!f) {
      const bank = emptyBank();
      this.bankId = await this.#upload(new Blob([JSON.stringify(bank)], { type: 'application/json' }),
        { name: 'bank.json', parents: [this.root], appProperties: { pbank: 'db' } });
      this.bankTime = (await this.#meta(this.bankId)).modifiedTime;
      return bank;
    }
    this.bankId = f.id;
    this.bankTime = f.modifiedTime;
    const r = await this.#req(`${API}/files/${f.id}?alt=media`, { cache: 'no-store' });
    return { ...emptyBank(), ...(await r.json()) };
  }

  async #meta(id) {
    return (await this.#req(`${API}/files/${id}?fields=modifiedTime`, { cache: 'no-store' })).json();
  }

  async saveBank(bank, force = false) {
    if (!force) {
      const { modifiedTime } = await this.#meta(this.bankId);
      if (modifiedTime !== this.bankTime) throw new ConflictError();
    }
    const r = await this.#req(`${UPLOAD}/files/${this.bankId}?uploadType=media&fields=modifiedTime`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bank),
    });
    this.bankTime = (await r.json()).modifiedTime;
  }

  async putFile(blob, name, where) {
    const id = await this.#upload(blob, { name, parents: [where === 'src' ? this.srcDir : this.imgDir] });
    idb.put('blobs', id, blob);
    return id;
  }

  async getBlob(id) {
    const hit = await idb.get('blobs', id);
    if (hit) return hit;
    const blob = await (await this.#req(`${API}/files/${id}?alt=media`)).blob();
    idb.put('blobs', id, blob);
    return blob;
  }

  async deleteFile(id) {
    if (!id) return;
    idb.del('blobs', id);
    // 바로 지우지 않고 휴지통으로 (30일간 복구 가능)
    await this.#req(`${API}/files/${id}?fields=id`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
    }).catch(() => {});
  }

  get folderUrl() { return this.root && `https://drive.google.com/drive/folders/${this.root}`; }
}

// ---------------------------------------------------------------- 이 브라우저에만 저장 (테스트용)
export class LocalStore {
  kind = 'local';
  signedIn = true;
  async signIn() {}
  signOut() {}
  async init() { return { ...emptyBank(), ...((await idb.get('kv', 'bank')) || {}) }; }
  async saveBank(bank) { await idb.put('kv', 'bank', bank); }
  async putFile(blob) { const id = 'local-' + crypto.randomUUID(); await idb.put('blobs', id, blob); return id; }
  async getBlob(id) { const b = await idb.get('blobs', id); if (!b) throw new Error('파일 없음'); return b; }
  async deleteFile(id) { if (id) await idb.del('blobs', id); }
  folderUrl = null;
}
