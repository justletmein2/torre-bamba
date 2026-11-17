// Conexão com o Firebase do Forma Palavras (mesmo projeto, mesmo login, mesmo perfil).
// Os dados do Torre Bamba ficam num caminho próprio: torrebamba/rooms/{CODIGO}/...
//   meta               estado da sala (anfitrião, status, horário do início, semente das peças)
//   players/{uid}      quem está na sala (nome, boneco)
//   estado/{uid}       a torre de cada um durante a partida (cada um escreve a sua)
//   resultado/{uid}    como cada um terminou (chegou na linha ou caiu tudo)
// Com ?local=1 tudo roda num "banco de teste" no próprio navegador (cada aba é um jogador).
import { firebaseConfig } from './config.js';

const V = '11.0.2';
const params = new URLSearchParams(location.search);
export const LOCAL = params.has('local');
const SALAS = 'torrebamba/rooms/';
const PERFIS = 'cacapalavras/profiles/';
const TAGS = 'cacapalavras/tags/';
let B = null, uid = null, offset = 0;

async function backendFirebase() {
  const [{ initializeApp, getApps }, A, D] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-database.js`),
  ]);
  // mesmo nome de app do Forma Palavras: assim o login de lá vale aqui
  const app = getApps().find(a => a.name === 'cacapalavras') || initializeApp(firebaseConfig, 'cacapalavras');
  const auth = A.getAuth(app), db = D.getDatabase(app);
  await auth.authStateReady();
  if (!auth.currentUser) await A.signInAnonymously(auth);
  D.onValue(D.ref(db, '.info/serverTimeOffset'), s => { offset = s.val() || 0; });
  const ref = p => D.ref(db, p);
  const u = auth.currentUser;
  return {
    uid: u.uid,
    logado: u.providerData.length > 0,
    get: async p => (await D.get(ref(p))).val(),
    set: (p, v) => D.set(ref(p), v),
    update: (p, v) => D.update(ref(p), v),
    remove: p => D.remove(ref(p)),
    on: (p, cb) => D.onValue(ref(p), s => cb(s.val())),
    aoSair: (p, v) => D.onDisconnect(ref(p)).update(v),
  };
}

// banco de teste: cada caminho "folha" vira uma chave do localStorage (abas não se atropelam)
function backendLocal() {
  const PREF = 'tbdb:';
  const ouvintes = [];
  const montar = prefixo => {
    let raiz;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k.startsWith(PREF)) continue;
      const p = k.slice(PREF.length);
      if (p !== prefixo && !p.startsWith(prefixo + '/')) continue;
      let v; try { v = JSON.parse(localStorage.getItem(k)); } catch { continue; }
      if (p === prefixo) { raiz = v; continue; }
      if (typeof raiz !== 'object' || raiz == null) raiz = {};
      const ks = p.slice(prefixo.length + 1).split('/');
      let o = raiz; for (const x of ks.slice(0, -1)) { o[x] = o[x] || {}; o = o[x]; }
      o[ks[ks.length - 1]] = v;
    }
    return raiz ?? null;
  };
  const avisar = () => ouvintes.forEach(([p, cb]) => cb(montar(p)));
  addEventListener('storage', e => { if (e.key && e.key.startsWith(PREF)) avisar(); });
  let id = sessionStorage.getItem('tb_local_uid');
  if (!id) { id = 'u' + Math.random().toString(36).slice(2, 9); sessionStorage.setItem('tb_local_uid', id); }
  const saidas = [];
  addEventListener('pagehide', () => saidas.forEach(([p, v]) => api.update(p, v)));
  const api = {
    uid: id, logado: false,
    get: async p => montar(p),
    set: async (p, v) => { if (v == null) localStorage.removeItem(PREF + p); else localStorage.setItem(PREF + p, JSON.stringify(v)); avisar(); },
    update: async (p, v) => { let a; try { a = JSON.parse(localStorage.getItem(PREF + p)); } catch {} localStorage.setItem(PREF + p, JSON.stringify({ ...(a || {}), ...v })); avisar(); },
    remove: async p => { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k === PREF + p || k.startsWith(PREF + p + '/')) localStorage.removeItem(k); } avisar(); },
    on: (p, cb) => { const o = [p, cb]; ouvintes.push(o); setTimeout(() => cb(montar(p))); return () => ouvintes.splice(ouvintes.indexOf(o), 1); },
    aoSair: (p, v) => saidas.push([p, v]),
  };
  return api;
}

let conectando = null;
export function conectar() {
  if (!conectando) conectando = (async () => {
    B = LOCAL ? backendLocal() : await backendFirebase();
    uid = B.uid;
    return uid;
  })().catch(e => { conectando = null; throw e; });
  return conectando;
}
export const conectado = () => !!B;
export const agora = () => Date.now() + offset;
export const meuId = () => uid;
export const logado = () => !!(B && B.logado);

// ---------- perfil (o mesmo do Forma Palavras) ----------
export async function lerPerfil() { return (await B.get(PERFIS + uid)) || null; }
export function salvarPerfil(d) { return B.update(PERFIS + uid, d); }
export async function reservarTag(tag, antiga) {
  const k = tag.toLowerCase();
  const dono = await B.get(TAGS + k);
  if (dono && dono !== uid) return false;
  await B.set(TAGS + k, uid);
  if (antiga && antiga.toLowerCase() !== k && (await B.get(TAGS + antiga.toLowerCase())) === uid) await B.remove(TAGS + antiga.toLowerCase()).catch(() => {});
  return true;
}

// ---------- salas ----------
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export async function criarSala() {
  for (let t = 0; t < 8; t++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CHARS[Math.floor(Math.random() * CHARS.length)];
    if (await B.get(SALAS + code + '/meta')) continue;
    await B.set(SALAS + code + '/meta', { host: uid, status: 'lobby', rodada: 0, criada: agora() });
    return code;
  }
  throw new Error('Não consegui criar a sala, tente de novo');
}
export const lerMeta = code => B.get(SALAS + code + '/meta');
export async function entrarSala(code, publico, cb) {
  const eu = `${SALAS}${code}/players/${uid}`;
  const atual = await B.get(eu);
  await B.update(eu, { ...publico, online: true, ...(atual ? {} : { entrou: agora() }) });
  B.aoSair(eu, { online: false });
  const st = { meta: null, players: {} };
  const offs = [
    B.on(SALAS + code + '/meta', v => { st.meta = v; cb(st); }),
    B.on(SALAS + code + '/players', v => { st.players = v || {}; cb(st); }),
  ];
  return () => { offs.forEach(f => f && f()); B.update(eu, { online: false }); };
}
export const atualizarMeta = (code, d) => B.update(SALAS + code + '/meta', d);
export const atualizarEu = (code, d) => B.update(`${SALAS}${code}/players/${uid}`, d);
export async function limparPartida(code) {
  await Promise.all(['estado', 'resultado'].map(k => B.remove(SALAS + code + '/' + k)));
}
export const enviarEstado = (code, e) => B.set(`${SALAS}${code}/estado/${uid}`, e);
export const enviarResultado = (code, r) => B.set(`${SALAS}${code}/resultado/${uid}`, r);
export function ouvirPartida(code, cb) {
  const st = { estado: {}, resultado: {} };
  const offs = ['estado', 'resultado'].map(k => B.on(SALAS + code + '/' + k, v => { st[k] = v || {}; cb(st, k); }));
  return () => offs.forEach(f => f && f());
}
