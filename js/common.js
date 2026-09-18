import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, onValue, runTransaction, push, set, update, remove, get,
  onDisconnect, serverTimestamp, query, limitToLast
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  firebaseConfig, TEMPOS, MIN_JOGADORES, MAX_JOGADORES, PALAVRAS_POR_JOGADOR, ADMIN_SENHA
} from "./config.js";
import { VIDEOS } from "./videos.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

export { ref, onValue, runTransaction, push, set, update, remove, get, onDisconnect, serverTimestamp, query, limitToLast };
export { VIDEOS, TEMPOS, ADMIN_SENHA, PALAVRAS_POR_JOGADOR, MIN_JOGADORES, MAX_JOGADORES };

const TRINTA_MIN = 30 * 60 * 1000;

export const NOMES_FASE = {
  countdown: "Contagem",
  watch: "Assistindo",
  discussion: "Discussão",
  voting: "Votação",
  results: "Resultado"
};

export const FOTO_VAZIA = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#3a2f63"/><circle cx="50" cy="40" r="17" fill="#6d61a0"/><path d="M18 92c4-20 18-30 32-30s28 10 32 30z" fill="#6d61a0"/></svg>`
);

// ---------- relógio do servidor (todos veem o mesmo tempo) ----------
let offset = 0;
onValue(ref(db, ".info/serverTimeOffset"), s => { offset = s.val() || 0; });
export const agora = () => Date.now() + offset;

export function mmss(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- login anônimo (mantém o mesmo jogador ao recarregar) ----------
export function garantirLogin() {
  return new Promise((resolve, reject) => {
    let tentou = false;
    const parar = onAuthStateChanged(auth, u => {
      if (u) { parar(); resolve(u); }
      else if (!tentou) { tentou = true; signInAnonymously(auth).catch(reject); }
    });
  });
}

// ---------- vídeos ----------
const REGEX_YT = /(?:shorts\/|v=|youtu\.be\/|embed\/)([\w-]{11})/;
export function idYoutube(url) {
  const m = String(url).match(REGEX_YT);
  return m ? m[1] : String(url).trim();
}
export function linkValido(url) {
  return REGEX_YT.test(String(url)) || /^[\w-]{11}$/.test(String(url).trim());
}

// Lista de pares vinda do Firebase (/videos), em ordem. Se o banco ainda
// estiver vazio, usa a lista inicial do arquivo videos.js.
export function listaVideos(valor) {
  const itens = Object.entries(valor || {})
    .map(([key, v]) => ({ key, ...v }))
    .filter(v => v.normal && v.impostor)
    .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  if (itens.length) return itens;
  return VIDEOS.map((v, i) => ({ key: `inicial-${i}`, ordem: i, ...v }));
}

// ---------- utilidades ----------
function embaralhar(lista) {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Ordem de fala: segue a ordem das fotos (sorteada a cada partida),
// repetida em cada volta.
function gerarTurnos(ordem, voltas) {
  const turnos = [];
  for (let v = 0; v < voltas; v++) turnos.push(...ordem);
  return turnos;
}

// ---------- regras da partida ----------
export function todosVoltaram(g) {
  return (g.order || []).every(u => g.returned && g.returned[u]);
}

export function podeSubstituir(g) {
  if (!g) return true;
  if (!g.order || !g.turnos || agora() - (g.createdAt || 0) > TRINTA_MIN) return true;
  const st = g.state || {};
  return st.phase === "results" && (todosVoltaram(g) || agora() >= st.endsAt);
}

// Inocentes vencem só se o impostor for o mais votado, sem empate.
export function resultado(g) {
  const contagem = {};
  (g.order || []).forEach(u => { contagem[u] = 0; });
  Object.values(g.votes || {}).forEach(alvo => {
    if (contagem[alvo] !== undefined) contagem[alvo]++;
  });
  const max = Math.max(0, ...Object.values(contagem));
  const topo = Object.keys(contagem).filter(u => contagem[u] === max);
  const pego = max > 0 && topo.length === 1 && topo[0] === g.impostor;
  return { contagem, pego, vencedor: pego ? "inocentes" : "impostor" };
}

export const palavrasDe = g => Object.values(g?.state?.words || {});

function proximoEstado(st, forcar) {
  const t = agora();
  switch (st.phase) {
    case "countdown": return { ...st, phase: "watch", endsAt: t + TEMPOS.assistir * 1000 };
    case "watch": return { ...st, phase: "discussion", endsAt: 0 };
    case "discussion": {
      const qtd = Object.values(st.words || {}).length;
      if (!forcar && qtd < (st.total || 0)) return undefined;
      return { ...st, phase: "voting", endsAt: t + TEMPOS.votacao * 1000 };
    }
    case "voting": return { ...st, phase: "results", endsAt: t + TEMPOS.limpezaLobby * 1000, resultsAt: t };
  }
  return undefined;
}

export function avancarFase(faseEsperada, forcar = false) {
  return runTransaction(ref(db, "room/game/state"), st => {
    if (!st || st.phase !== faseEsperada) return;
    return proximoEstado(st, forcar);
  });
}

export function enviarPalavra(g, uid, palavra, pulou = false) {
  return runTransaction(ref(db, "room/game/state"), st => {
    if (!st || st.phase !== "discussion") return;
    const words = Object.values(st.words || {});
    if (words.length >= g.turnos.length) return;
    if (g.turnos[words.length] !== uid) return;
    const item = { uid, word: palavra, at: Date.now() };
    if (pulou) item.skipped = true;
    words.push(item);
    return { ...st, words };
  });
}

// Todos (que estão online) clicaram em "Iniciar votação"?
let ultimoPronto = 0;
export function checarProntosVotar(g, jogadores) {
  const st = g?.state;
  if (!st || st.phase !== "discussion") return;
  if (palavrasDe(g).length < g.turnos.length) return;
  const presentes = g.order.filter(u => jogadores[u]?.online);
  if (!presentes.every(u => g.prontosVotar?.[u])) return;
  if (Date.now() - ultimoPronto < 2000) return;
  ultimoPronto = Date.now();
  avancarFase("discussion").catch(() => {});
}

export function resumoHistorico(g) {
  const r = resultado(g);
  const nome = u => g.players?.[u]?.name || "?";
  return {
    round: g.round || 0,
    pairIndex: g.pairIndex ?? 0,
    finishedAt: agora(),
    jogadores: (g.order || []).length,
    impostor: nome(g.impostor),
    vencedor: r.vencedor,
    videos: g.videos || {},
    palavras: palavrasDe(g).map(w => `${nome(w.uid)}: ${w.word}`),
    votos: (g.order || []).map(u => `${nome(u)} votou em ${g.votes?.[u] ? nome(g.votes[u]) : "ninguém"}`)
  };
}

// ---------- criar partida (só uma vence a corrida) ----------
let ultimaCriacao = 0;
export async function tentarCriarPartida(uids, jogadores, videos) {
  if (Date.now() - ultimaCriacao < 3000 || !videos.length) return;
  ultimaCriacao = Date.now();
  let substituido = null;
  const res = await runTransaction(ref(db, "room"), r => {
    r = r || {};
    if (r.game && !podeSubstituir(r.game)) return;
    substituido = r.game || null;
    const round = (r.round || 0) + 1;
    const pairIndex = (round - 1) % videos.length;
    const par = videos[pairIndex];
    const order = embaralhar(uids);
    const turnos = gerarTurnos(order, PALAVRAS_POR_JOGADOR);
    const players = {};
    uids.forEach(u => { players[u] = { name: jogadores[u]?.name || "Jogador" }; });
    const escolhido = r.proximoImpostor && uids.includes(r.proximoImpostor) ? r.proximoImpostor : null;
    return {
      ...r,
      round,
      proximoImpostor: null,
      game: {
        id: "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        createdAt: agora(),
        round,
        pairIndex,
        pairKey: par.key,
        videos: { normal: par.normal, impostor: par.impostor },
        impostor: escolhido || order[Math.floor(Math.random() * order.length)],
        impostorEscolhido: !!escolhido,
        order,
        turnos,
        players,
        state: { phase: "countdown", endsAt: agora() + TEMPOS.contagem * 1000, total: turnos.length }
      }
    };
  }).catch(() => null);
  if (res?.committed) {
    if (substituido?.state?.phase === "results") push(ref(db, "history"), resumoHistorico(substituido));
    const up = {};
    uids.forEach(u => { up[`players/${u}/ready`] = false; });
    update(ref(db), up);
  }
}

// ---------- apagar sala antiga ----------
let ultimaLimpeza = 0;
export async function tentarLimpeza(sala) {
  if (!sala.game || !podeSubstituir(sala.game)) return;
  if (Date.now() - ultimaLimpeza < 3000) return;
  ultimaLimpeza = Date.now();
  let removido = null;
  const res = await runTransaction(ref(db, "room/game"), atual => {
    if (!atual || !podeSubstituir(atual)) return;
    removido = atual;
    return null;
  }).catch(() => null);
  if (res?.committed && removido?.state?.phase === "results") {
    push(ref(db, "history"), resumoHistorico(removido));
  }
}

// ---------- apagar quem saiu ----------
// Quem fica offline é apagado do banco depois da janela de espera do lobby
// (10 s + folga). Se a pessoa estiver numa partida em andamento, espera a
// partida acabar para a foto dela continuar aparecendo no resultado.
// Se ela voltar depois, o nome e a foto são recuperados do próprio navegador.
let ultimaLimpezaSaidos = 0;
export function limparSaidos(jogadores, sala) {
  if (Date.now() - ultimaLimpezaSaidos < 5000) return;
  ultimaLimpezaSaidos = Date.now();
  const limite = (TEMPOS.esperaSaida + 5) * 1000;
  const g = sala.game;
  const naPartida = g && g.order && !podeSubstituir(g) ? g.order : [];
  const up = {};
  Object.entries(jogadores).forEach(([u, p]) => {
    if (p.online) return;
    if (naPartida.includes(u)) return;
    const velho = !p.lastSeen || agora() - p.lastSeen > limite;
    if (velho || !p.name) up[`players/${u}`] = null;
  });
  if (Object.keys(up).length) update(ref(db), up).catch(() => {});
}
