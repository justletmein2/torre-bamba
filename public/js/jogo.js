// Torre Bamba: peças caem, a torre balança (física de verdade), quem passar da linha primeiro ganha.
// Multiplayer: cada celular simula a PRÓPRIA torre e manda um "retrato" dela pros outros.
// Todo mundo recebe as mesmas peças na mesma ordem (mesma semente).
import * as rede from './rede.js';

const { Engine, Bodies, Body, Composite, Collision, Bounds } = window.Matter;
// a prévia (fora do site do jogo) não consegue falar com o servidor: só treino sozinho
const PREVIA = !rede.LOCAL && !/(^|\.)github\.io$|^localhost$|^127\./.test(location.hostname);
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- mundo ----------
const CEL = 40;                 // tamanho de um quadradinho
const COLS = 11;                // largura do mundo em quadradinhos
const LINHA = (rede.LOCAL && +new URLSearchParams(location.search).get('linha')) || 20;               // altura da chegada (em quadradinhos acima da plataforma)
const W = COLS * CEL, H = 17.5 * CEL; // H = altura da "janela"; a câmera sobe junto com a torre
const TOPO_MUNDO = -(LINHA + 5 - 16.3) * CEL; // ponto mais alto que a miniatura mostra
const CHAO = H - 1.2 * CEL;     // topo da plataforma
const BASE_L = 4.5 * CEL;       // largura da plataforma
const SEGURAR = 3000;
const QUEDA = 1.6 * CEL, QUEDA_RAPIDA = 11 * CEL; // px por segundo
// física: gravidade mais forte (o padrão deixa tudo "flutuando") e passos menores (menos tremedeira)
const GRAVIDADE = 0.0019, SUBPASSOS = 3;
const INERCIA = 1.05; // >1 = peça mais "pesada" pra tombar/girar. Escala do Lucas (0 = voa, 100 = Tetris): 1.6 ≈ 65, 1.25 ≈ 60, agora ≈ 53

const PECAS = {
  I: { c: [[0, 0], [1, 0], [2, 0], [3, 0]], cor: '#3ad1ff' },
  O: { c: [[0, 0], [1, 0], [0, 1], [1, 1]], cor: '#ffd23f' },
  T: { c: [[0, 0], [1, 0], [2, 0], [1, 1]], cor: '#b46bff' },
  S: { c: [[1, 0], [2, 0], [0, 1], [1, 1]], cor: '#4cdb7a' },
  Z: { c: [[0, 0], [1, 0], [1, 1], [2, 1]], cor: '#ff5f6d' },
  L: { c: [[0, 0], [0, 1], [0, 2], [1, 2]], cor: '#ff9f40' },
  J: { c: [[1, 0], [1, 1], [1, 2], [0, 2]], cor: '#4f7bff' },
};
const TIPOS = Object.keys(PECAS);

// sorteio igual pra todo mundo: "saquinho" com as 7 peças embaralhadas
function sorteador(semente) {
  let a = semente >>> 0;
  const r = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let saco = [], k = 0;
  return () => {
    if (!saco.length) { saco = [...TIPOS]; for (let i = saco.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [saco[i], saco[j]] = [saco[j], saco[i]]; } }
    const tipo = saco.pop(); k++;
    // de vez em quando a peça vem com uma ajuda (igual pra todo mundo): a 3ª, a 7ª, a 11ª...
    const mod = k % 4 === 3 ? (r() < 0.5 ? 'pedra' : 'planta') : null;
    return { tipo, mod };
  };
}

// ---------- estado geral ----------
let PERFIL = { tag: '', look: null, xp: 0 };
let AV = null;                   // desenhos de boneco do Forma Palavras
const M = { code: null, host: false, meta: null, players: {}, sair: null, rodadaVista: 0, partida: { estado: {}, resultado: {} }, sairPartida: null };
let J = null;                    // a partida em andamento
let fase = 'inicio';

function mostrar(id) {
  ['telaInicio', 'telaComo', 'telaSala', 'telaFim'].forEach(t => { $(t).hidden = t !== id; });
  const jogo = id === null;
  $('hud').hidden = !jogo; $('controles').hidden = !jogo;
}
let toastT = 0;
function toast(msg, ms = 2200) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
}
const bonecoSVG = (look, tam) => (AV && look ? AV.avatarSVG(look, tam, {}) : '');
const meuNome = () => PERFIL.tag || ($('nome').value.trim() || 'Jogador');
const publico = () => ({ name: meuNome().slice(0, 14), look: PERFIL.look || null });

// ---------- tema claro/escuro (a mesma escolha do Forma Palavras) ----------
const escuro = () => document.documentElement.dataset.tema === 'escuro';
function aplicarTema(t) {
  document.documentElement.dataset.tema = t;
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = t === 'escuro' ? '#0d0a26' : '#2a1b5e';
  $('btnTema').textContent = t === 'escuro' ? '☀️ Claro' : '🌙 Escuro';
}
let tema = 'claro';
try { tema = localStorage.getItem('cp_tema') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro'); } catch {}
aplicarTema(tema);
$('btnTema').onclick = () => { tema = tema === 'escuro' ? 'claro' : 'escuro'; try { localStorage.setItem('cp_tema', tema); } catch {} aplicarTema(tema); };

// ---------- som (bipes simples) ----------
let ac = null;
function bip(f = 440, dur = 0.08, tipo = 'triangle', vol = 0.12, desliza = 0) {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
    o.type = tipo; o.frequency.setValueAtTime(f, t);
    if (desliza) o.frequency.exponentialRampToValueAtTime(Math.max(40, f + desliza), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
  } catch {}
}
const som = {
  mexe: () => bip(520, 0.04, 'square', 0.05),
  gira: () => bip(700, 0.06, 'triangle', 0.08, 200),
  pousa: () => bip(160, 0.12, 'sine', 0.2, -60),
  pedra: () => { bip(90, 0.2, 'square', 0.14, -30); bip(1400, 0.05, 'square', 0.04); },
  planta: () => { bip(520, 0.1, 'sine', 0.12, 260); setTimeout(() => bip(780, 0.14, 'sine', 0.1, 300), 90); },
  caiu: () => bip(500, 0.5, 'sawtooth', 0.1, -420),
  conta: () => bip(660, 0.12, 'square', 0.08),
  ganhou: () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => bip(f, 0.18, 'triangle', 0.14), i * 120)); },
};

// ---------- musiquinha (feita na hora, sem arquivo) ----------
const N = { A2: 110, C3: 130.8, D3: 146.8, E3: 164.8, F3: 174.6, G3: 196, A3: 220, G4: 392, A4: 440, B4: 493.9, C5: 523.3, D5: 587.3, E5: 659.3, F5: 698.5, G5: 784, A5: 880 };
const MELODIA = ('E5 - G5 E5 C5 - D5 E5 G5 - E5 D5 C5 - A4 - D5 - F5 D5 B4 - C5 D5 E5 G5 E5 C5 D5 - - - '
  + 'A5 - G5 E5 G5 - E5 D5 C5 D5 E5 C5 A4 - G4 - A4 C5 D5 E5 D5 - C5 A4 C5 - - - C5 - - -').split(' ');
const BAIXO = 'C3 C3 A2 A2 D3 G3 C3 G3 F3 F3 A2 A2 D3 G3 C3 C3'.split(' ');
const musica = { ligada: true, t: 0, i: 0, timer: 0 };
try { musica.ligada = localStorage.getItem('tb-musica') !== '0'; } catch {}
function nota(f, quando, dur, tipo, vol) {
  const o = ac.createOscillator(), g2 = ac.createGain();
  o.type = tipo; o.frequency.value = f;
  g2.gain.setValueAtTime(0.0001, quando); g2.gain.linearRampToValueAtTime(vol, quando + 0.012); g2.gain.exponentialRampToValueAtTime(0.0001, quando + dur);
  o.connect(g2).connect(ac.destination); o.start(quando); o.stop(quando + dur + 0.03);
}
function tocarMusica() {
  if (!musica.ligada || musica.timer) return;
  try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch { return; }
  musica.t = ac.currentTime + 0.08;
  musica.timer = setInterval(() => {
    const passoS = fase === 'jogo' ? 0.2 : 0.25;   // na partida toca um pouco mais rápido
    while (musica.t < ac.currentTime + 0.35) {
      const m = MELODIA[musica.i % MELODIA.length];
      if (m !== '-') nota(N[m], musica.t, passoS * 1.7, 'triangle', 0.05);
      if (musica.i % 4 === 0) nota(N[BAIXO[(musica.i / 4) % BAIXO.length]], musica.t, passoS * 3.2, 'sine', 0.085);
      if (musica.i % 2 === 1) nota(N[BAIXO[Math.floor(musica.i / 4) % BAIXO.length]] * 2, musica.t, passoS * 0.6, 'square', 0.012);
      musica.t += passoS; musica.i++;
    }
  }, 90);
}
function pararMusica() { clearInterval(musica.timer); musica.timer = 0; }
function botaoMusica() { $('btnMusica').textContent = musica.ligada ? '🎵 Música' : '🔇 Sem música'; }
$('btnMusica').onclick = () => {
  musica.ligada = !musica.ligada; try { localStorage.setItem('tb-musica', musica.ligada ? '1' : '0'); } catch {}
  botaoMusica(); if (musica.ligada) tocarMusica(); else pararMusica();
};
botaoMusica();
addEventListener('pointerdown', () => tocarMusica());            // o navegador só deixa tocar depois de um toque
document.addEventListener('visibilitychange', () => { if (document.hidden) pararMusica(); else if (ac) tocarMusica(); });

// ---------- uma partida ----------
// online: { semente, inicio (horário do servidor), ids: quem joga }
function novaPartida({ semente, inicio, online, ids }) {
  const engine = Engine.create({ enableSleeping: true, positionIterations: 24, velocityIterations: 18, constraintIterations: 4 });
  engine.gravity.y = 1; engine.gravity.scale = GRAVIDADE;
  const base = Bodies.rectangle(W / 2, CHAO + CEL * 0.6, BASE_L, CEL * 1.2, { isStatic: true, friction: 1, label: 'base' });
  Composite.add(engine.world, base);
  const prox = sorteador(semente);
  J = {
    engine, base, prox, online, ids: ids || [], inicio,
    fila: [prox(), prox()], ativa: null, pecas: [], caidas: 0, fora: false, venceu: false,
    acima: 0, altura: 0, cam: 0, camAlvo: 0, camCand: 0, camCandT: 0, desce: false, acc: 0, ultimoEnvio: 0, fim: false, n: 0,
  };
  fase = 'jogo';
  mostrar(null);
  desenharVidas(); montarRivais();
}

function criarPeca(tipo) {
  const def = PECAS[tipo];
  const partes = def.c.map(([x, y]) => Bodies.rectangle(x * CEL + CEL / 2, y * CEL + CEL / 2, CEL, CEL));
  const corpo = Body.create({ parts: partes, ...MATERIAL });
  acertarInercia(corpo);
  // posição de cada quadradinho em relação ao centro da peça (pra desenhar e pro "retrato")
  const off = def.c.map(([x, y]) => [x * CEL + CEL / 2 - corpo.position.x, y * CEL + CEL / 2 - corpo.position.y]);
  corpo.tb = { tipo, off, nasceu: 0, membros: [{ tipo, mod: null, dx: 0, dy: 0, da: 0 }] };
  return corpo;
}

function proximaPeca() {
  const { tipo, mod } = J.fila.shift(); J.fila.push(J.prox());
  const p = criarPeca(tipo); p.tb.mod = mod; p.tb.membros[0].mod = mod;
  if (mod === 'pedra') aviso('🪨 Pedra: fica presa onde encostar!', 1700);
  if (mod === 'planta') aviso('🌿 Planta: junta com a peça que encostar!', 1700);
  // começa centralizada, num ponto da grade de meio quadradinho
  const larg = p.bounds.max.x - p.bounds.min.x;
  const x = Math.round((W / 2 - larg / 2) / (CEL / 2)) * (CEL / 2) + larg / 2;
  Body.setPosition(p, { x, y: J.cam + CEL * 1.2 + (p.position.y - p.bounds.min.y) });
  J.ativa = p; J.desce = J.desce && segurandoDesce;
  desenharPrevia();
}

// a peça ativa encosta em alguma coisa?
function bate(corpo) {
  for (const o of Composite.allBodies(J.engine.world)) {
    if (!Bounds.overlaps(corpo.bounds, o.bounds)) continue;
    const pa = corpo.parts.length > 1 ? corpo.parts.slice(1) : [corpo];
    const pb = o.parts.length > 1 ? o.parts.slice(1) : [o];
    for (const a of pa) for (const b of pb) {
      if (!Bounds.overlaps(a.bounds, b.bounds)) continue;
      const c = Collision.collides(a, b);
      if (c && c.depth > 0.5) return o;
    }
  }
  return null;
}
function tentar(mudar, desfazer) {
  mudar();
  if (bate(J.ativa)) { desfazer(); return false; }
  return true;
}
function mover(dx) {
  if (!J || !J.ativa || !jogando()) return;
  const p = J.ativa, x = p.position.x;
  // não coube o passo inteiro? chega o mais perto que der (até encostar)
  for (const f of [1, 0.5, 0.25, 0.1]) {
    if (tentar(() => Body.setPosition(p, { x: x + dx * f, y: p.position.y }), () => Body.setPosition(p, { x, y: p.position.y }))) { som.mexe(); return; }
  }
}
function girar() {
  if (!J || !J.ativa || !jogando()) return;
  const p = J.ativa, a = p.angle, x = p.position.x, y = p.position.y;
  const volta = () => { Body.setAngle(p, a); Body.setPosition(p, { x, y }); };
  Body.setAngle(p, a + Math.PI / 2);
  for (const dx of [0, -CEL / 2, CEL / 2, -CEL, CEL]) {
    Body.setPosition(p, { x: x + dx, y });
    if (!bate(p)) { som.gira(); return; }
  }
  volta();
}

// A biblioteca de física soma a inércia de cada quadradinho como se ele girasse sozinho
// (ignora a distância até o centro da peça). Resultado: peças de 4 blocos giravam como se
// pesassem ~10x menos. Aqui a inércia é recalculada direito (teorema dos eixos paralelos).
function acertarInercia(corpo, pedra = false) {
  if (pedra) { Body.setInertia(corpo, Infinity); return; } // pedra não gira
  const partes = corpo.parts.length > 1 ? corpo.parts.slice(1) : [corpo];
  const m = corpo.mass / partes.length;
  let I = 0;
  for (const p of partes) {
    const dx = p.position.x - corpo.position.x, dy = p.position.y - corpo.position.y;
    I += m * (CEL * CEL) / 6 + m * (dx * dx + dy * dy);
  }
  Body.setInertia(corpo, I * 4 * INERCIA); // x4 = mesma escala que a biblioteca usa internamente
}

// solta a peça na física quando ela encosta na torre
const MATERIAL = { friction: 1, frictionStatic: 2.6, restitution: 0, frictionAir: 0.03, density: 0.002, slop: 0.02 };
const PEDRA = { friction: 1, frictionStatic: 12, restitution: 0, frictionAir: 0.05, density: 0.006, slop: 0.02 };
function soltar(alvo) {
  let p = J.ativa; J.ativa = null;
  const mod = p.tb.mod;
  if (mod === 'planta' && alvo && alvo.label !== 'base') { p = juntar(p, alvo); som.planta(); }
  else {
    Composite.add(J.engine.world, p);
    if (mod === 'pedra') { Body.setStatic(p, true); som.pedra(); } // pedra: fica presa exatamente onde encostou
    else { Body.setVelocity(p, { x: 0, y: 0.5 }); som.pousa(); }    // encosta de leve: nada de "quicar"
    J.pecas.push(p);
  }
  p.tb.nasceu = performance.now(); J.n++;
  proximaPeca();
}
// a planta junta duas peças num corpo só: passam a se mexer (e a cair) juntas
const girado = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
function juntar(a, b) {
  const membros = [], partes = [];
  for (const c of [b, a]) for (const m of c.tb.membros) {
    const [mx, my] = girado(m.dx, m.dy, c.angle), wx = c.position.x + mx, wy = c.position.y + my, wa = c.angle + m.da;
    membros.push({ tipo: m.tipo, mod: m.mod, wx, wy, wa });
    for (const [ox2, oy2] of offsetsDe(m.tipo)) { const [qx, qy] = girado(ox2, oy2, wa); partes.push(Bodies.rectangle(wx + qx, wy + qy, CEL, CEL, { angle: wa })); }
  }
  const temPedra = membros.some(m => m.mod === 'pedra');
  const novo = Body.create({ parts: partes, ...(temPedra ? PEDRA : MATERIAL) });
  acertarInercia(novo, temPedra);
  novo.tb = { tipo: null, mod: null, nasceu: 0, membros: membros.map(m => ({ tipo: m.tipo, mod: m.mod, dx: m.wx - novo.position.x, dy: m.wy - novo.position.y, da: m.wa })) };
  // herda o movimento da peça da torre, mas sem giro brusco
  Body.setVelocity(novo, { x: b.velocity.x * 0.5, y: Math.max(0, b.velocity.y * 0.5) }); Body.setAngularVelocity(novo, 0);
  if (b.isStatic) Body.setStatic(novo, true);
  Composite.remove(J.engine.world, b);
  Composite.add(J.engine.world, novo);
  J.pecas[J.pecas.indexOf(b)] = novo;
  return novo;
}
// cada peça (ou grupo de peças juntadas) vira uma lista simples pra desenhar e pra mandar pros outros
function listaPecas(corpos) {
  const r = [];
  for (const c of corpos) for (const m of c.tb.membros) { const [mx, my] = girado(m.dx, m.dy, c.angle); r.push({ tipo: m.tipo, mod: m.mod, x: c.position.x + mx, y: c.position.y + my, a: c.angle + m.da }); }
  return r;
}

// peça que cai da plataforma não elimina ninguém: só atrasa (e a torre pode ter ido junto)
function perdeuPeca() {
  if (J.fora || J.venceu) return;
  J.caidas++;
  som.caiu(); desenharVidas();
  if (navigator.vibrate) navigator.vibrate(80);
}

const jogando = () => J && !J.fora && !J.venceu && !J.fim && agoraJogo() >= J.inicio;
const agoraJogo = () => (J && J.online ? rede.agora() : Date.now());

function passo(dt) {
  const ms = 1000 / 60;
  J.acc = Math.min(J.acc + dt, 100);
  while (J.acc >= ms) {
    J.acc -= ms;
    if (jogando() && J.ativa) {
      const p = J.ativa;
      const v = (J.desce ? QUEDA_RAPIDA : QUEDA) / 60;
      // nasceu em cima de alguma coisa (torre alta ou peça voando)? espera o lugar ficar livre
      if (!p.tb.livre) {
        // ainda não começou a cair: acompanha a câmera até o lugar ficar livre
        Body.setPosition(p, { x: p.position.x, y: J.cam + CEL * 1.2 + (p.position.y - p.bounds.min.y) });
        if (!bate(p)) p.tb.livre = true;
      }
      if (p.tb.livre) {
      const y = p.position.y;
      Body.setPosition(p, { x: p.position.x, y: y + v });
      const alvo = bate(p);
      if (alvo) {
        // só raspou numa quina? escorrega pro lado e continua no controle
        const x = p.position.x; let passou = false;
        for (const d of [-3, 3, -6, 6]) { Body.setPosition(p, { x: x + d, y: y + v }); if (!bate(p)) { passou = true; break; } }
        if (!passou) {
          // encosta de verdade: desce de 1 em 1 px até o limite (sem vão pra peça cair e quicar)
          let yy = y; Body.setPosition(p, { x, y });
          while (yy + 1 < y + v) { Body.setPosition(p, { x, y: yy + 1 }); if (bate(p)) { Body.setPosition(p, { x, y: yy }); break; } yy++; }
          soltar(alvo);
        }
      }
      else if (p.bounds.min.y > H + CEL) { J.ativa = null; perdeuPeca(); proximaPeca(); }
      }
    }
    for (let k = 0; k < SUBPASSOS; k++) Engine.update(J.engine, ms / SUBPASSOS);
    // amortece giro e tremidinhas pequenas (deixa a torre menos "nervosa")
    for (const p of J.pecas) {
      if (p.isStatic || p.isSleeping) continue;
      if (Math.abs(p.angularVelocity) < 0.015) Body.setAngularVelocity(p, p.angularVelocity * 0.95);
    }
  }
  // peças que caíram da plataforma
  for (const p of [...J.pecas]) {
    if (p.position.y > H + 2 * CEL || p.position.x < -3 * CEL || p.position.x > W + 3 * CEL) {
      Composite.remove(J.engine.world, p); J.pecas.splice(J.pecas.indexOf(p), 1); perdeuPeca();
    }
  }
  // altura: só conta peça que já parou
  const agoraMs = performance.now();
  let topo = CHAO;
  for (const p of J.pecas) {
    const parada = p.isSleeping || (p.speed < 0.25 && Math.abs(p.angularSpeed) < 0.02 && agoraMs - p.tb.nasceu > 400);
    if (parada && p.bounds.min.y < topo) topo = p.bounds.min.y;
  }
  J.altura = Math.max(0, (CHAO - topo) / CEL);
  // a câmera acompanha o topo da torre
  // (só muda de alvo quando a altura nova se firmou por meio segundo, e desliza devagar)
  const camNova = Math.min(0, topo - 9 * CEL);
  if (Math.abs(camNova - J.camCand) > CEL * 0.6) { J.camCand = camNova; J.camCandT = agoraMs; }
  else if (agoraMs - J.camCandT > 500) J.camAlvo = J.camCand;
  J.cam += (J.camAlvo - J.cam) * (1 - Math.exp(-dt / 650));
  if (!J.fora && !J.venceu && jogando()) {
    if (J.altura >= LINHA) {
      if (!J.acima) J.acima = agoraMs;
      const falta = SEGURAR - (agoraMs - J.acima);
      if (falta <= 0) venci();
      else { const s = Math.ceil(falta / 1000); if (s !== J.segVisto) { J.segVisto = s; som.conta(); } }
    } else { J.acima = 0; J.segVisto = 0; }
  }
}

function venci() {
  J.venceu = true; J.ativa = null; J.tempo = Math.round((agoraJogo() - J.inicio) / 1000);
  som.ganhou(); aviso('🏆 Segurou! Torre de pé!', 2500);
  if (J.online) { rede.enviarResultado(M.code, { venceu: true, t: rede.agora(), a: J.altura }).catch(() => {}); enviarEstado(true); }
  else setTimeout(() => fimSolo(true), 2200);
}

// ---------- retrato da torre pros outros ----------
function retrato() {
  const r = [];
  for (const p of listaPecas(J.ativa ? [...J.pecas, J.ativa] : J.pecas)) r.push(TIPOS.indexOf(p.tipo) + (p.mod === 'pedra' ? 10 : p.mod === 'planta' ? 20 : 0), Math.round(p.x / CEL * 10), Math.round(p.y / CEL * 10), Math.round(p.a * 100));
  return r.join(',');
}
function enviarEstado(forcar) {
  if (!J || !J.online) return;
  const t = performance.now();
  if (!forcar && t - J.ultimoEnvio < 220) return;
  J.ultimoEnvio = t;
  rede.enviarEstado(M.code, { a: Math.round(J.altura * 10) / 10, c: J.caidas, p: retrato() }).catch(() => {});
}

// ---------- desenho ----------
const tela = $('tela'), g = tela.getContext('2d');
let escala = 1, ox = 0, oy = 0;
function ajustarTela() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  tela.width = innerWidth * dpr; tela.height = innerHeight * dpr;
  const ctl = 104, topoLivre = 8;
  const disp = innerHeight - ctl - topoLivre;
  escala = Math.min(innerWidth / W, disp / H) * dpr;
  ox = (tela.width - W * escala) / 2;
  oy = (topoLivre * dpr) + (disp * dpr - H * escala);
}
addEventListener('resize', ajustarTela); ajustarTela();

function quadradinho(ctx, x, y, s, cor, olhos) {
  const r = s * 0.18;
  ctx.fillStyle = cor;
  ctx.beginPath(); ctx.roundRect(x - s / 2 + 1, y - s / 2 + 1, s - 2, s - 2, r); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  ctx.beginPath(); ctx.roundRect(x - s / 2 + 4, y - s / 2 + 4, s - 8, s * 0.22, r / 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(x - s / 2 + 1, y - s / 2 + 1, s - 2, s - 2, r); ctx.stroke();
  if (olhos) {
    ctx.fillStyle = '#23164d';
    ctx.beginPath(); ctx.arc(x - s * 0.15, y + s * 0.02, s * 0.07, 0, 7); ctx.arc(x + s * 0.15, y + s * 0.02, s * 0.07, 0, 7); ctx.fill();
  }
}
function desenharPeca(ctx, tipo, px, py, ang, s = CEL, olhos = true, mod = null) {
  const def = PECAS[tipo], off = offsetsDe(tipo);
  ctx.save(); ctx.translate(px, py); ctx.rotate(ang);
  off.forEach(([x, y], i) => quadradinho(ctx, x, y, s, mod === 'pedra' ? '#8f95a3' : def.cor, olhos && i === 0));
  if (mod === 'pedra' && olhos) { // rachaduras
    ctx.strokeStyle = 'rgba(40,40,60,.45)'; ctx.lineWidth = 2;
    off.forEach(([x, y], i) => { if (i === 0) return; ctx.beginPath(); ctx.moveTo(x - 9, y - 10); ctx.lineTo(x - 2, y - 1); ctx.lineTo(x - 8, y + 6); ctx.moveTo(x - 2, y - 1); ctx.lineTo(x + 8, y + 3); ctx.stroke(); });
  }
  if (mod === 'planta') {
    ctx.strokeStyle = '#1f9d55'; ctx.lineWidth = 4; ctx.lineJoin = 'round';
    off.forEach(([x, y]) => { ctx.beginPath(); ctx.roundRect(x - s / 2 + 3, y - s / 2 + 3, s - 6, s - 6, s * 0.15); ctx.stroke(); });
    if (olhos) { ctx.font = `${s * 0.5}px system-ui`; ctx.textAlign = 'center'; ctx.rotate(-ang); const [x, y] = off[off.length - 1]; const c = Math.cos(ang), n = Math.sin(ang); ctx.fillText('🌿', x * c - y * n, x * n + y * c + s * 0.18); }
  }
  ctx.restore();
}
// offsets de cada tipo (centro de massa), calculados uma vez
const OFFS = {};
function offsetsDe(tipo) {
  if (!OFFS[tipo]) {
    const c = PECAS[tipo].c, mx = c.reduce((s, [x]) => s + x, 0) / c.length, my = c.reduce((s, [, y]) => s + y, 0) / c.length;
    OFFS[tipo] = c.map(([x, y]) => [(x - mx) * CEL, (y - my) * CEL]);
  }
  return OFFS[tipo];
}

// vista: { y0, alt } = faixa do mundo que aparece
function desenharMundo(ctx, pecas, ativa, opts = {}) {
  const y0 = opts.y0 || 0, alt = opts.alt || H;
  // céu
  const gr = ctx.createLinearGradient(0, y0, 0, y0 + alt);
  if (escuro()) { gr.addColorStop(0, '#0d0a26'); gr.addColorStop(1, '#3a2a7a'); } else { gr.addColorStop(0, '#7f63ff'); gr.addColorStop(1, '#c7b8ff'); }
  ctx.fillStyle = gr; ctx.fillRect(0, y0, W, alt);
  if (!opts.mini) {
    ctx.fillStyle = escuro() ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.25)';
    const py = y0 * 0.6; // nuvens sobem mais devagar que a torre
    [[2, 3, 1.4], [8.5, 6, 1.8], [4, 10, 1.2], [7, -4, 1.5], [1.5, -9, 1.3], [8, -14, 1.6]].forEach(([x, y, r]) => { ctx.beginPath(); ctx.arc(x * CEL, y * CEL + py, r * CEL, 0, 7); ctx.arc((x + 1) * CEL, (y + 0.3) * CEL + py, r * CEL * 0.8, 0, 7); ctx.fill(); });
  }
  // linha de chegada
  const ly = CHAO - LINHA * CEL;
  ctx.save();
  ctx.strokeStyle = opts.acima ? '#ffd23f' : '#fff'; ctx.lineWidth = opts.mini ? 10 : 4; ctx.setLineDash([16, 12]);
  ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(W, ly); ctx.stroke(); ctx.restore();
  if (!opts.mini) {
    ctx.fillStyle = '#fff'; ctx.font = `900 ${CEL * 0.42}px Nunito, system-ui, sans-serif`; ctx.textAlign = 'right';
    ctx.fillText('🏁 CHEGADA', W - 8, ly - 8);
  }
  // plataforma
  ctx.fillStyle = '#8a5a2b'; ctx.beginPath(); ctx.roundRect(W / 2 - BASE_L / 2, CHAO, BASE_L, CEL * 1.2, 8); ctx.fill();
  ctx.fillStyle = '#4cdb7a'; ctx.beginPath(); ctx.roundRect(W / 2 - BASE_L / 2 - 4, CHAO - 4, BASE_L + 8, CEL * 0.35, 6); ctx.fill();
  // guia da peça ativa
  if (ativa) {
    ctx.fillStyle = 'rgba(255,255,255,.13)';
    ctx.fillRect(ativa.bounds.min.x, ativa.bounds.max.y, ativa.bounds.max.x - ativa.bounds.min.x, y0 + alt - ativa.bounds.max.y);
  }
  for (const p of pecas) desenharPeca(ctx, p.tipo, p.x, p.y, p.a, CEL, !opts.mini, p.mod);
  if (ativa) desenharPeca(ctx, ativa.tb.tipo, ativa.position.x, ativa.position.y, ativa.angle, CEL, true, ativa.tb.mod);
}

function desenhar() {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#2a1b5e'; g.fillRect(0, 0, tela.width, tela.height);
  if (!J) return;
  g.setTransform(escala, 0, 0, escala, ox, oy - J.cam * escala);
  g.save(); g.beginPath(); g.rect(0, J.cam, W, H); g.clip();
  desenharMundo(g, listaPecas(J.pecas), J.ativa, { acima: J.acima > 0, y0: J.cam });
  // marcadores da altura dos outros
  if (J.online) {
    let k = 0;
    for (const id of J.ids) {
      if (id === rede.meuId()) continue;
      const e = M.partida.estado[id]; if (!e) continue;
      const y = Math.max(J.cam + 110, Math.min(J.cam + H - 16, CHAO - (e.a || 0) * CEL));
      const nome = (M.players[id] && M.players[id].name) || '?';
      g.fillStyle = CORES_RIVAL[k++ % CORES_RIVAL.length];
      g.beginPath(); g.roundRect(4, y - 12, 74, 24, 10); g.fill();
      g.fillStyle = '#fff'; g.font = '800 13px Nunito, system-ui, sans-serif'; g.textAlign = 'left';
      g.fillText(nome.slice(0, 9), 10, y + 5);
    }
  }
  // quanto falta
  if (!J.acima) {
    g.fillStyle = 'rgba(35,22,77,.75)'; g.beginPath(); g.roundRect(W / 2 - 62, J.cam + 8, 124, 26, 12); g.fill();
    g.fillStyle = '#fff'; g.font = '800 14px Nunito, system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText(`${Math.min(LINHA, J.altura).toFixed(0)} de ${LINHA} 🏁`, W / 2, J.cam + 26);
  }
  // contagem pra segurar
  if (J.acima && !J.venceu) {
    const s = Math.ceil((SEGURAR - (performance.now() - J.acima)) / 1000);
    g.fillStyle = '#ffd23f'; g.strokeStyle = '#23164d'; g.lineWidth = 6; g.textAlign = 'center';
    g.font = `900 ${CEL * 2}px Nunito, system-ui, sans-serif`;
    const y = CHAO - LINHA * CEL - CEL * 1.6;
    g.strokeText(String(Math.max(1, s)), W / 2, y); g.fillText(String(Math.max(1, s)), W / 2, y);
  }
  g.restore();
}
const CORES_RIVAL = ['#ff5fa2', '#2fbf71', '#3aa0ff', '#ff9f40', '#b46bff'];

function desenharPrevia() {
  const c = $('previa'), ctx = c.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height);
  if (!J) return;
  const { tipo, mod } = J.fila[0], s = 0.36;
  ctx.setTransform(s, 0, 0, s, c.width / 2, c.height / 2);
  desenharPeca(ctx, tipo, 0, 0, 0, CEL, true, mod);
  $('previaMod').textContent = mod === 'pedra' ? '🪨 pedra' : mod === 'planta' ? '🌿 planta' : '';
}
function desenharVidas() {
  $('vidas').textContent = J.caidas ? `💥 ${J.caidas}` : '';
}
let avisoT = 0;
function aviso(txt, ms = 1800) {
  const a = $('aviso'); a.textContent = txt; a.hidden = false;
  clearTimeout(avisoT); avisoT = setTimeout(() => { a.hidden = true; }, ms);
}

// miniaturas das torres dos outros
function montarRivais() {
  const box = $('rivais');
  if (!J.online) { box.innerHTML = ''; return; }
  box.innerHTML = J.ids.filter(id => id !== rede.meuId()).map(id => {
    const p = M.players[id] || {};
    return `<div class="rival" data-id="${esc(id)}"><canvas width="100" height="230"></canvas><div class="nm">${esc(p.name || '?')}</div><div class="cr"></div></div>`;
  }).join('');
}
function desenharRivais() {
  if (!J || !J.online) return;
  document.querySelectorAll('#rivais .rival').forEach(el => {
    const e = M.partida.estado[el.dataset.id];
    const cv = el.querySelector('canvas'), ctx = cv.getContext('2d');
    const altT = H - TOPO_MUNDO, s = Math.min(cv.width / W, cv.height / altT);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(s, 0, 0, s, (cv.width - W * s) / 2, -TOPO_MUNDO * s);
    const pecas = [];
    if (e && e.p) {
      const n = e.p.split(',').map(Number);
      for (let i = 0; i + 3 < n.length; i += 4) pecas.push({ tipo: TIPOS[n[i] % 10] || 'O', mod: n[i] >= 20 ? 'planta' : n[i] >= 10 ? 'pedra' : null, x: n[i + 1] / 10 * CEL, y: n[i + 2] / 10 * CEL, a: n[i + 3] / 100 });
    }
    desenharMundo(ctx, pecas, null, { mini: true, y0: TOPO_MUNDO, alt: altT });
    const fora = !(M.players[el.dataset.id] && M.players[el.dataset.id].online);
    el.classList.toggle('fora', fora);
    el.querySelector('.cr').textContent = fora ? 'saiu' : `${Math.min(LINHA, (e && e.a) || 0).toFixed(0)}/${LINHA}`;
  });
}

// ---------- fundo do menu: peças caindo devagar ----------
const chuva = Array.from({ length: 9 }, (_, i) => ({ tipo: TIPOS[i % 7], x: Math.random(), y: Math.random(), a: Math.random() * 6, v: 0.03 + Math.random() * 0.04, g: (Math.random() - 0.5) * 0.6 }));
function desenharMenu(dt) {
  const w = tela.width, h = tela.height, dpr = w / innerWidth;
  g.setTransform(1, 0, 0, 1, 0, 0);
  const gr = g.createLinearGradient(0, 0, w * 0.4, h);
  if (escuro()) { gr.addColorStop(0, '#1a1340'); gr.addColorStop(1, '#0d0a26'); } else { gr.addColorStop(0, '#6a4be0'); gr.addColorStop(0.55, '#3b2a8f'); gr.addColorStop(1, '#2a1b5e'); }
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.globalAlpha = escuro() ? 0.3 : 0.45;
  for (const c of chuva) {
    c.y += c.v * dt / 1000; c.a += c.g * dt / 1000;
    if (c.y > 1.15) { c.y = -0.15; c.x = Math.random(); }
    g.setTransform(dpr * 0.9, 0, 0, dpr * 0.9, c.x * w, c.y * h);
    desenharPeca(g, c.tipo, 0, 0, c.a, CEL, true);
  }
  g.globalAlpha = 1;
}

// ---------- laço ----------
let ultimo = performance.now();
function laco(t) {
  const dt = t - ultimo; ultimo = t;
  if (J && fase === 'jogo') {
    const falta = J.inicio - agoraJogo();
    const cont = $('contagem');
    if (falta > 0) {
      const n = Math.ceil(falta / 1000);
      if (cont.textContent !== String(n)) { cont.textContent = n; som.conta(); }
      cont.hidden = false;
    } else if (!cont.hidden) { cont.hidden = true; if (!J.ativa && !J.n) proximaPeca(); }
    if (falta <= 0) passo(dt);
    enviarEstado();
    desenhar(); desenharRivais();
  } else desenharMenu(Math.min(dt, 100));
  requestAnimationFrame(laco);
}
requestAnimationFrame(laco);

// ---------- controles ----------
let segurandoDesce = false;
function botaoRepete(id, acao) {
  const b = $(id); let t = 0, i = 0;
  const parar = () => { clearTimeout(t); clearInterval(i); b.classList.remove('on'); };
  b.addEventListener('pointerdown', e => { e.preventDefault(); b.classList.add('on'); acao(); t = setTimeout(() => { i = setInterval(acao, 90); }, 260); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, parar));
}
botaoRepete('bEsq', () => mover(-CEL / 2));
botaoRepete('bDir', () => mover(CEL / 2));
$('bGira').addEventListener('pointerdown', e => { e.preventDefault(); $('bGira').classList.add('on'); girar(); });
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => $('bGira').addEventListener(ev, () => $('bGira').classList.remove('on')));
const desce = on => { segurandoDesce = on; if (J) J.desce = on; $('bDesce').classList.toggle('on', on); };
$('bDesce').addEventListener('pointerdown', e => { e.preventDefault(); desce(true); });
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => $('bDesce').addEventListener(ev, () => desce(false)));
addEventListener('keydown', e => {
  if (fase !== 'jogo') return;
  if (e.key === 'ArrowLeft') mover(-CEL / 2);
  else if (e.key === 'ArrowRight') mover(CEL / 2);
  else if (e.key === 'ArrowUp' || e.key === ' ') girar();
  else if (e.key === 'ArrowDown') desce(true);
  else return;
  e.preventDefault();
});
addEventListener('keyup', e => { if (e.key === 'ArrowDown') desce(false); });

// ---------- treino sozinho ----------
function comecarSolo() {
  M.code = null;
  novaPartida({ semente: Math.floor(Math.random() * 1e9), inicio: Date.now() + 3200, online: false });
}
function fimSolo(venceu) {
  if (!J || J.fim) return;
  J.fim = true; fase = 'fim';
  $('fimTitulo').textContent = `🏆 Conseguiu em ${J.tempo}s!`;
  $('fimLista').innerHTML = `<p>${J.n} peças usadas, ${J.caidas} ${J.caidas === 1 ? 'caiu' : 'caíram'}. Dá pra fazer mais rápido? 😏</p>`;
  $('btnDeNovo').hidden = false; $('fimEspera').hidden = true;
  if (venceu) ganharXP(5);
  mostrar('telaFim');
}

// ---------- salas ----------
const linkSala = code => location.origin + location.pathname + '?sala=' + code + (rede.LOCAL ? '&local=1' : '');
async function criarSala() {
  if (PREVIA) { toast('Aqui é só a prévia 🙂 As salas funcionam no jogo publicado.', 3200); return; }
  if (!(await garantirNome())) return;
  try {
    await rede.conectar();
    const code = await rede.criarSala();
    await entrar(code);
  } catch (e) { toast('Não deu pra criar a sala: ' + (e.message || e), 3000); }
}
async function garantirNome() {
  if (PERFIL.tag) return true;
  const n = $('nome').value.trim();
  if (n.length < 2) { $('nome').hidden = false; $('nome').focus(); toast('Escreve seu nome primeiro 🙂'); return false; }
  try { localStorage.setItem('tb-nome', n); } catch {}
  return true;
}
async function entrar(code) {
  if (PREVIA) { toast('Aqui é só a prévia 🙂 As salas funcionam no jogo publicado.', 3200); return; }
  code = (code || '').toUpperCase().trim();
  if (!/^[A-Z]{4}$/.test(code)) { toast('O código tem 4 letras'); return; }
  if (!(await garantirNome())) return;
  try {
    await rede.conectar();
    const meta = await rede.lerMeta(code);
    if (!meta) { toast('Não achei essa sala 🤔'); return; }
    if (M.sair) M.sair();
    M.code = code; M.rodadaVista = meta.status === 'playing' ? meta.rodada : 0;
    try { history.replaceState(null, '', '?sala=' + code + (rede.LOCAL ? '&local=1' : '')); } catch {}
    M.sair = await rede.entrarSala(code, publico(), st => { M.meta = st.meta; M.players = st.players; atualizouSala(); });
    if (M.sairPartida) M.sairPartida();
    M.sairPartida = rede.ouvirPartida(code, (st) => { M.partida = st; verResultado(); });
    fase = 'sala'; mostrar('telaSala'); desenharSala();
    if (meta.status === 'playing') toast('A partida já começou: você entra na próxima 😉', 3000);
  } catch (e) { toast('Não deu pra entrar: ' + (e.message || e), 3000); }
}
function sairSala() {
  if (M.sair) M.sair(); if (M.sairPartida) M.sairPartida();
  Object.assign(M, { code: null, meta: null, players: {}, sair: null, sairPartida: null });
  J = null; fase = 'inicio';
  try { history.replaceState(null, '', location.pathname + (rede.LOCAL ? '?local=1' : '')); } catch {}
  desenharEu(); mostrar('telaInicio');
}
function atualizouSala() {
  const meta = M.meta; if (!meta) return;
  M.host = meta.host === rede.meuId();
  // o anfitrião caiu? quem estiver na sala assume
  const hostOn = M.players[meta.host] && M.players[meta.host].online;
  if (!hostOn && !M.host && M.players[rede.meuId()]) {
    const on = Object.entries(M.players).filter(([, p]) => p.online).map(([id]) => id).sort();
    if (on[0] === rede.meuId()) rede.atualizarMeta(M.code, { host: rede.meuId() }).catch(() => {});
  }
  if (meta.status === 'playing' && meta.rodada !== M.rodadaVista) {
    M.rodadaVista = meta.rodada;
    if ((meta.ids || []).includes(rede.meuId())) {
      novaPartida({ semente: meta.semente, inicio: meta.inicio, online: true, ids: meta.ids });
      return;
    }
  }
  if (fase === 'sala') desenharSala();
  if (fase === 'jogo' && J && J.online) { montarRivaisSeMudou(); verResultado(); }
  if (fase === 'fim') desenharFim();
}
function montarRivaisSeMudou() {
  const n = document.querySelectorAll('#rivais .rival').length;
  if (n !== J.ids.length - 1) montarRivais();
}
function desenharSala() {
  $('salaCodigo').textContent = M.code;
  const lista = Object.entries(M.players).filter(([, p]) => p.online);
  $('listaJog').innerHTML = lista.map(([id, p]) => `<div class="jog"><div class="av">${bonecoSVG(p.look, 44) || '🙂'}</div>${esc(p.name)}${id === (M.meta && M.meta.host) ? '<small>👑 anfitrião</small>' : ''}</div>`).join('')
    + (lista.length < 2 ? '<p class="peq">Mande o convite pra alguém entrar 👆</p>' : '');
  $('btnComecar').hidden = !M.host;
  $('salaEspera').hidden = M.host;
}
async function comecarOnline() {
  if (!M.host) return;
  const ids = Object.entries(M.players).filter(([, p]) => p.online).map(([id]) => id);
  if (ids.length < 1) return;
  await rede.limparPartida(M.code).catch(() => {});
  await rede.atualizarMeta(M.code, { status: 'playing', rodada: (M.meta.rodada || 0) + 1, semente: Math.floor(Math.random() * 1e9), inicio: rede.agora() + 3800, ids });
}

// alguém chegou? todos os outros caíram?
function verResultado() {
  if (!J || !J.online || J.fim) return;
  // só vale resultado desta rodada (o da anterior pode demorar um instante pra sumir)
  const res = Object.fromEntries(Object.entries(M.partida.resultado || {}).filter(([, r]) => r && r.t >= J.inicio - 4500));
  const vencedores = Object.entries(res).filter(([id, r]) => r.venceu && J.ids.includes(id)).sort((a, b) => a[1].t - b[1].t);
  if (vencedores.length) { terminarOnline(vencedores[0][0]); return; }
}
function terminarOnline(vencedor) {
  J.fim = true; J.vencedor = vencedor; J.ativa = null;
  ganharXP(vencedor === rede.meuId() ? 10 : 3);
  setTimeout(() => { if (fase === 'jogo') { fase = 'fim'; desenharFim(); mostrar('telaFim'); } }, vencedor === rede.meuId() ? 2400 : 1200);
}
function desenharFim() {
  if (!J) return;
  const v = J.vencedor, eu = rede.meuId();
  $('fimTitulo').textContent = v === eu ? '🏆 Você venceu!' : v ? `🏆 ${(M.players[v] && M.players[v].name) || 'Alguém'} venceu!` : 'Fim de jogo';
  const est = M.partida.estado || {};
  const ordem = [...J.ids].sort((a, b) => (b === v) - (a === v) || ((est[b] && est[b].a) || 0) - ((est[a] && est[a].a) || 0));
  $('fimLista').innerHTML = ordem.map(id => {
    const p = M.players[id] || {}, e = est[id] || {};
    return `<div class="jog ${id === v ? 'vence' : ''} ${p.online ? '' : 'off'}"><div class="av">${bonecoSVG(p.look, 44) || '🙂'}</div>${esc(p.name || '?')}<small>${id === v ? '🏁 chegou!' : `${Math.min(LINHA, e.a || 0).toFixed(1)} de ${LINHA}`}</small></div>`;
  }).join('');
  $('btnDeNovo').hidden = !M.host; $('fimEspera').hidden = M.host;
}

// XP vai pro mesmo nível do Forma Palavras
async function ganharXP(n) {
  if (!PERFIL.tag || !rede.conectado()) return;
  try {
    const p = await rede.lerPerfil();
    const xp = ((p && p.xp) || 0) + n;
    await rede.salvarPerfil({ xp }); PERFIL.xp = xp;
    setTimeout(() => toast(`+${n} XP pro seu boneco ⭐`), 1500);
  } catch {}
}

// ---------- botões das telas ----------
$('btnSolo').onclick = () => comecarSolo();
$('btnCriar').onclick = () => criarSala();
$('btnEntrar').onclick = () => entrar($('codigo').value);
$('codigo').addEventListener('keydown', e => { if (e.key === 'Enter') entrar($('codigo').value); });
$('btnComo').onclick = () => mostrar('telaComo');
$('btnComoOk').onclick = () => mostrar(M.code ? 'telaSala' : 'telaInicio');
$('btnComecar').onclick = () => comecarOnline();
$('btnSairSala').onclick = () => sairSala();
$('btnCopiar').onclick = async () => {
  const link = linkSala(M.code);
  try { if (navigator.share) await navigator.share({ title: 'Torre Bamba', text: 'Bora jogar Torre Bamba comigo?', url: link }); else { await navigator.clipboard.writeText(link); toast('Convite copiado! 📋'); } }
  catch { try { await navigator.clipboard.writeText(link); toast('Convite copiado! 📋'); } catch { toast(link, 5000); } }
};
$('btnDeNovo').onclick = () => { if (M.code) comecarOnline(); else comecarSolo(); };
let sairArmado = 0;
$('btnSairJogo').onclick = () => {
  if (Date.now() - sairArmado > 2500) { sairArmado = Date.now(); toast('Toque de novo pra sair da partida'); return; }
  if (M.code) sairSala(); else { J = null; fase = 'inicio'; mostrar('telaInicio'); }
};
$('btnFimSair').onclick = () => { if (M.code) sairSala(); else { J = null; fase = 'inicio'; mostrar('telaInicio'); } };

// ---------- início ----------
function desenharEu() {
  const svg = bonecoSVG(PERFIL.look, 56);
  $('eu').innerHTML = PERFIL.tag ? `<div class="rosto">${svg || '🙂'}</div><div><b>${esc(PERFIL.tag)}</b><small>seu boneco do Forma Palavras</small></div>` : '';
  $('eu').hidden = !PERFIL.tag;
  $('nome').hidden = !!PERFIL.tag;
}
async function iniciar() {
  try { $('nome').value = localStorage.getItem('tb-nome') || ''; } catch {}
  mostrar('telaInicio');
  try { AV = await import(new URL('../../forma-palavras/js/avatar.js', import.meta.url).href); } catch { AV = null; }
  if (!PREVIA) try {
    await rede.conectar();
    const p = await rede.lerPerfil();
    if (p && p.tag) PERFIL = { ...PERFIL, ...p };
  } catch (e) { console.warn('Sem conexão com o servidor', e); }
  $('linkPortal').hidden = PREVIA; $('notaPrevia').hidden = !PREVIA;
  desenharEu();
  const sala = new URLSearchParams(location.search).get('sala');
  if (sala) { $('codigo').value = sala.toUpperCase(); entrar(sala); } // sem nome ainda: é só escrever e tocar em Entrar
}
iniciar();

// pra testes automáticos
window.__tb = { get J() { return J; }, M, mover, girar, desce, CEL, LINHA, Body };
