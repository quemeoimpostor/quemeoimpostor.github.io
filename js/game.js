import {
  db, ref, onValue, update, set, serverTimestamp, onDisconnect,
  agora, mmss, esc, garantirLogin, idYoutube, podeSubstituir, listaVideos, palavrasDe,
  avancarFase, enviarPalavra, checarProntosVotar, resultado, tentarCriarPartida, tentarLimpeza, limparSaidos,
  MIN_JOGADORES, MAX_JOGADORES, PALAVRAS_POR_JOGADOR, TEMPOS, FOTO_VAZIA
} from "./common.js";

const $ = s => document.querySelector(s);

let eu = null;
let jogadores = {};
let sala = {};
let videos = [];
const carregou = { jogadores: false, sala: false };
const perfil = {
  name: localStorage.getItem("imp_nome") || "",
  photo: localStorage.getItem("imp_foto") || ""
};
let telaAtual = "";
let palavrasMostradas = -1;
let ultimoAvanco = { chave: "", t: 0 };
let chaveListaLobby = "";

const foto = u => jogadores[u]?.photo || FOTO_VAZIA;
const nome = (u, g) => jogadores[u]?.name || g?.players?.[u]?.name || "Jogador";

// ============================================================
//  Início
// ============================================================
try {
  const user = await garantirLogin();
  eu = user.uid;
} catch (e) {
  $("#carregando").textContent = "Não foi possível conectar. Confira a configuração do Firebase em js/config.js.";
  throw e;
}

presenca();
ligarEventos();

onValue(ref(db, "players"), s => { jogadores = s.val() || {}; carregou.jogadores = true; render(); });
onValue(ref(db, "room"), s => { sala = s.val() || {}; carregou.sala = true; render(); });
onValue(ref(db, "videos"), s => { videos = listaVideos(s.val()); });
setInterval(tick, 250);

function presenca() {
  onValue(ref(db, ".info/connected"), async s => {
    if (s.val() !== true) return;
    const r = ref(db, `players/${eu}`);
    await onDisconnect(r).update({ online: false, ready: false, lastSeen: serverTimestamp() });
    const dados = { online: true, lastSeen: serverTimestamp() };
    if (perfil.name) dados.name = perfil.name;
    if (perfil.photo) dados.photo = perfil.photo;
    update(r, dados);
  });
}

function minhaPartida() {
  const g = sala.game;
  if (g && g.order && g.turnos && g.order.includes(eu) && !g.returned?.[eu]) return g;
  return null;
}

function mostrar(id) {
  document.querySelectorAll(".tela").forEach(t => { t.hidden = t.id !== id; });
  $("#carregando").hidden = true;
  if (id !== "tela-video") $("#video-frame").src = "about:blank";
}

// ============================================================
//  Render geral
// ============================================================
function render() {
  if (!carregou.jogadores || !carregou.sala) return;
  const g = minhaPartida();
  if (!g) return renderLobby();

  if (jogadores[eu]?.ready) update(ref(db, `players/${eu}`), { ready: false });

  const fase = g.state?.phase;
  const chave = `${g.id}:${fase}`;
  if (chave !== telaAtual) {
    telaAtual = chave;
    montarFase(g, fase);
  }
  atualizarFase(g, fase);
  atualizarTempos(g);
}

function tick() {
  if (!carregou.jogadores || !carregou.sala) return;
  checarInicio();
  tentarLimpeza(sala);
  limparSaidos(jogadores, sala);

  const g = minhaPartida();
  if (!g) {
    if (telaAtual !== "lobby") render();
    else atualizarStatusLobby();
    return;
  }
  const st = g.state || {};
  if (["countdown", "watch", "voting"].includes(st.phase) && agora() >= st.endsAt) {
    const chave = g.id + st.phase;
    if (ultimoAvanco.chave !== chave || Date.now() - ultimoAvanco.t > 3000) {
      ultimoAvanco = { chave, t: Date.now() };
      avancarFase(st.phase).catch(() => {});
    }
  }
  checarProntosVotar(g, jogadores);
  atualizarTempos(g);
}

// ============================================================
//  Lobby
// ============================================================
function listaProntos() {
  return Object.entries(jogadores)
    .filter(([, p]) => p.online && p.ready && p.name && p.photo)
    .sort((a, b) => (a[1].readyAt || 0) - (b[1].readyAt || 0))
    .map(([u]) => u);
}

// Regras para começar:
// - precisa de pelo menos 4 prontos;
// - se alguém na sala ainda não clicou em Começar, espera essa pessoa;
// - se alguém saiu da sala há pouco, espera 10 s para ver se ela volta
//   (se voltar, espera ela clicar);
// - com 10 prontos, começa na hora.
function estadoLobby() {
  const t = agora();
  const espera = TEMPOS.esperaSaida * 1000;
  const presentes = Object.entries(jogadores).filter(([, p]) => p.online && p.name && p.photo).map(([u]) => u);
  const prontos = listaProntos();
  const naoProntos = presentes.filter(u => !jogadores[u].ready);
  const sairam = Object.entries(jogadores)
    .filter(([, p]) => !p.online && p.name && p.lastSeen && t - p.lastSeen < espera)
    .map(([u]) => u);
  let podeComecar = false;
  let esperaAte = 0;
  if (prontos.length >= MIN_JOGADORES) {
    if (prontos.length >= MAX_JOGADORES) podeComecar = true;
    else if (!naoProntos.length) {
      if (!sairam.length) podeComecar = true;
      else esperaAte = Math.max(...sairam.map(u => jogadores[u].lastSeen)) + espera;
    }
  }
  return { presentes, prontos, naoProntos, sairam, podeComecar, esperaAte };
}

function checarInicio() {
  if (minhaPartida()) return;
  if (sala.game && !podeSubstituir(sala.game)) return;
  const e = estadoLobby();
  if (!e.podeComecar) return;
  const grupo = e.prontos.slice(0, MAX_JOGADORES);
  if (!grupo.includes(eu)) return;
  tentarCriarPartida(grupo, jogadores, videos);
}

function renderLobbyLista() { if (telaAtual === "lobby") renderLobby(); }

function renderLobby() {
  if (telaAtual !== "lobby") {
    telaAtual = "lobby";
    palavrasMostradas = -1;
    chaveListaLobby = "";
    mostrar("tela-lobby");
    $("#input-nome").value = perfil.name;
  }

  const img = $("#minha-foto");
  if (img.dataset.src !== perfil.photo) {
    img.src = perfil.photo || FOTO_VAZIA;
    img.dataset.src = perfil.photo;
  }
  $(".avatar-upload").classList.toggle("tem-foto", !!perfil.photo);
  $(".avatar-dica").textContent = perfil.photo ? "Trocar foto" : "Escolher foto";

  const pronto = !!jogadores[eu]?.ready;
  const btn = $("#btn-comecar");
  btn.disabled = !pronto && !(perfil.name && perfil.photo);
  btn.textContent = pronto ? "Cancelar" : "Começar";
  btn.classList.toggle("pronto", pronto);
  $("#perfil-aviso").textContent =
    !perfil.photo ? "Escolha uma foto para poder começar." :
    !perfil.name ? "Escreva seu nome para poder começar." : "";

  const { sairam } = estadoLobby();
  const online = Object.entries(jogadores)
    .filter(([u, p]) => p.name && (p.online || sairam.includes(u)))
    .sort((a, b) => (a[0] === eu ? -1 : b[0] === eu ? 1 : 0) || (b[1].ready ? 1 : 0) - (a[1].ready ? 1 : 0));
  const chave = JSON.stringify(online.map(([u, p]) => [u, p.name, !!p.ready, !!p.online, (p.photo || "").length]));
  if (chave !== chaveListaLobby) {
    chaveListaLobby = chave;
    $("#lista-jogadores").innerHTML = online.length ? online.map(([u, p]) => `
      <li class="jogador ${p.ready ? "pronto" : ""} ${u === eu ? "sou-eu" : ""} ${p.online ? "" : "saiu"}">
        <div class="foto-eu">
          ${u === eu ? '<span class="selo-eu">Você</span>' : ""}
          <img class="avatar" src="${p.photo || FOTO_VAZIA}" alt="">
        </div>
        <span class="jogador-nome">${esc(p.name)}</span>
        <span class="jogador-estado">${!p.online ? "Saiu" : p.ready ? "Pronto" : "Esperando"}</span>
      </li>`).join("") : `<li class="vazio">Ninguém por aqui ainda.</li>`;
  }
  atualizarStatusLobby();
}

function atualizarStatusLobby() {
  const e = estadoLobby();
  $("#contador-prontos").textContent = `${e.prontos.length} de ${e.presentes.length} prontos`;
  const nomes = lista => lista.map(u => jogadores[u]?.name || "alguém").join(", ");
  const g = sala.game;
  let msg;
  if (g && !podeSubstituir(g)) {
    if (g.order?.includes(eu) && g.state?.phase === "results") {
      const s = Math.max(0, Math.ceil((g.state.endsAt - agora()) / 1000));
      msg = `Esperando o resto voltar. A sala anterior fecha em ${s}s.`;
    } else {
      msg = "Tem uma partida rolando. Quando ela acabar, a próxima pode começar.";
    }
  } else if (jogadores[eu]?.ready && e.prontos.indexOf(eu) >= MAX_JOGADORES) {
    msg = `A partida está cheia (${MAX_JOGADORES} pessoas). Você entra na próxima.`;
  } else if (e.prontos.length < MIN_JOGADORES) {
    const falta = MIN_JOGADORES - e.prontos.length;
    msg = `Precisa de mais ${falta} pronto${falta > 1 ? "s" : ""} para começar (mínimo ${MIN_JOGADORES}, máximo ${MAX_JOGADORES}).`;
  } else if (e.podeComecar) {
    msg = "Começando…";
  } else if (e.naoProntos.length) {
    msg = `Esperando ${nomes(e.naoProntos)} clicar em Começar.`;
  } else if (e.esperaAte) {
    const s = Math.max(0, Math.ceil((e.esperaAte - agora()) / 1000));
    msg = `${nomes(e.sairam)} saiu. Começa em ${s}s se ninguém voltar. Para esperar, alguém clica em Cancelar.`;
  } else {
    msg = "";
  }
  $("#status-lobby").textContent = msg;
  // a lista muda quando alguém some da janela de 10 s
  const chaveSairam = e.sairam.join(",");
  if (chaveSairam !== atualizarStatusLobby.ultima) { atualizarStatusLobby.ultima = chaveSairam; chaveListaLobby = ""; renderLobbyLista(); }
}

function processarFoto(arquivo) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(arquivo);
    img.onload = () => {
      const S = 256;
      const c = document.createElement("canvas");
      c.width = c.height = S;
      const lado = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - lado) / 2;
      const sy = (img.naturalHeight - lado) / 2;
      c.getContext("2d").drawImage(img, sx, sy, lado, lado, 0, 0, S, S);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(); };
    img.src = url;
  });
}

// ============================================================
//  Eventos
// ============================================================
function ligarEventos() {
  const inNome = $("#input-nome");
  let t;
  inNome.addEventListener("input", () => {
    perfil.name = inNome.value.trim().slice(0, 16);
    localStorage.setItem("imp_nome", perfil.name);
    clearTimeout(t);
    t = setTimeout(() => update(ref(db, `players/${eu}`), { name: perfil.name, online: true }), 300);
    renderLobby();
  });

  $("#input-foto").addEventListener("change", async e => {
    const arq = e.target.files[0];
    e.target.value = "";
    if (!arq) return;
    try {
      perfil.photo = await processarFoto(arq);
      try { localStorage.setItem("imp_foto", perfil.photo); } catch { /* sem espaço, tudo bem */ }
      update(ref(db, `players/${eu}`), { photo: perfil.photo, online: true });
      renderLobby();
    } catch {
      $("#perfil-aviso").textContent = "Não deu para abrir essa imagem. Tente um JPG ou PNG.";
    }
  });

  $("#btn-comecar").addEventListener("click", () => {
    const pronto = !!jogadores[eu]?.ready;
    if (!pronto && !(perfil.name && perfil.photo)) return;
    update(ref(db, `players/${eu}`), pronto
      ? { ready: false }
      : { ready: true, readyAt: serverTimestamp(), name: perfil.name, photo: perfil.photo, online: true });
  });

  const inPalavra = $("#input-palavra");
  inPalavra.addEventListener("input", () => {
    inPalavra.value = inPalavra.value.replace(/\s+/g, "");
  });
  inPalavra.addEventListener("keydown", e => { if (e.key === "Enter") enviar(); });
  $("#btn-enviar").addEventListener("click", enviar);

  $("#btn-votacao").addEventListener("click", () => {
    const g = minhaPartida();
    if (g?.state?.phase !== "discussion") return;
    set(ref(db, `room/game/prontosVotar/${eu}`), true);
  });

  $("#cartas-voto").addEventListener("click", e => {
    const carta = e.target.closest(".carta");
    const g = minhaPartida();
    if (!carta || carta.disabled || g?.state?.phase !== "voting") return;
    set(ref(db, `room/game/votes/${eu}`), carta.dataset.uid);
  });

}

async function enviar() {
  const g = minhaPartida();
  if (!g) return;
  const inp = $("#input-palavra");
  const palavra = inp.value.replace(/\s+/g, "").slice(0, 24);
  if (!palavra) return;
  inp.value = "";
  await enviarPalavra(g, eu, palavra).catch(() => {});
}

// ============================================================
//  Fases
// ============================================================
function fotoComSelo(u) {
  return `<div class="foto-eu">${u === eu ? '<span class="selo-eu">Você</span>' : ""}<img class="avatar" src="${foto(u)}" alt=""></div>`;
}

function montarFase(g, fase) {
  const muitos = g.order.length > 5 ? "muitos" : "";
  switch (fase) {
    case "countdown":
      mostrar("tela-contagem");
      break;
    case "watch": {
      mostrar("tela-video");
      const id = idYoutube(eu === g.impostor ? g.videos.impostor : g.videos.normal);
      $("#video-frame").src =
        `https://www.youtube.com/embed/${id}?autoplay=1&playsinline=1&loop=1&playlist=${id}&rel=0`;
      break;
    }
    case "discussion":
      mostrar("tela-discussao");
      palavrasMostradas = -1;
      $("#chat-mensagens").innerHTML = "";
      {
        const n = g.order.length;
        const fila = $("#fila-discussao");
        fila.className = `fila-discussao parede ${n > 6 ? "lotada" : ""}`;
        fila.style.setProperty("--colunas", n);
        fila.style.setProperty("--colunas-celular", n > 5 ? Math.ceil(n / 2) : n);
      }
      $("#fila-discussao").innerHTML = g.order.map((u, i) => `
        <div class="suspeito ${u === eu ? "sou-eu" : ""}" data-uid="${u}">
          <span class="posicao">${i + 1}º</span>
          ${fotoComSelo(u)}
          <span class="suspeito-nome">${esc(nome(u, g))}</span>
          <span class="pips">${"<i></i>".repeat(PALAVRAS_POR_JOGADOR)}</span>
        </div>`).join("");
      break;
    case "voting":
      mostrar("tela-votacao");
      $("#cartas-voto").className = `fila parede ${muitos}`;
      $("#cartas-voto").innerHTML = g.order.map(u => `
        <button class="suspeito carta ${u === eu ? "sou-eu" : ""}" data-uid="${u}" ${u === eu ? "disabled" : ""}>
          ${fotoComSelo(u)}
          <span class="suspeito-nome">${esc(nome(u, g))}</span>
        </button>`).join("");
      break;
    case "results":
      mostrar("tela-resultado");
      montarResultado(g);
      break;
  }
}

function atualizarFase(g, fase) {
  if (fase === "discussion") atualizarDiscussao(g);
  if (fase === "voting") atualizarVotacao(g);
}

function atualizarTempos(g) {
  const st = g.state || {};
  const resta = Math.max(0, (st.endsAt || 0) - agora());
  switch (st.phase) {
    case "countdown":
      $("#contagem-numero").textContent = Math.max(1, Math.ceil(resta / 1000));
      break;
    case "watch":
      $("#video-tempo").textContent = mmss(resta);
      $("#video-barra").style.width = `${(resta / (TEMPOS.assistir * 1000)) * 100}%`;
      break;
    case "voting":
      $("#votacao-tempo").textContent = mmss(resta);
      $("#votacao-barra").style.width = `${(resta / (TEMPOS.votacao * 1000)) * 100}%`;
      break;
    case "results": {
      atualizarRevelacao(g);
      const el = $("#resultado-limpeza");
      if (el) {
        const voltaram = g.order.filter(u => g.returned?.[u]).length;
        el.textContent = `${voltaram} de ${g.order.length} já voltaram. A sala fecha sozinha em ${Math.ceil(resta / 1000)}s.`;
      }
      break;
    }
  }
}

function atualizarDiscussao(g) {
  const words = palavrasDe(g);
  const total = g.turnos.length;
  const acabou = words.length >= total;
  const vez = acabou ? null : g.turnos[words.length];

  document.querySelectorAll("#fila-discussao .suspeito").forEach(el => {
    const u = el.dataset.uid;
    el.classList.toggle("na-vez", u === vez);
    el.classList.toggle("pronto-votar", acabou && !!g.prontosVotar?.[u]);
    const feitas = words.filter(w => w.uid === u).length;
    el.querySelectorAll(".pips i").forEach((p, i) => p.classList.toggle("cheio", i < feitas));
  });

  if (words.length !== palavrasMostradas) {
    palavrasMostradas = words.length;
    const lista = $("#chat-mensagens");
    lista.innerHTML = words.map(w => `
      <li class="msg ${w.uid === eu ? "minha" : ""}">
        <img class="avatar avatar-p" src="${foto(w.uid)}" alt="">
        <div>
          <span class="msg-nome">${w.uid === eu ? "Você" : esc(nome(w.uid, g))}</span>
          <span class="msg-palavra ${w.skipped ? "pulou" : ""}">${esc(w.word)}</span>
        </div>
      </li>`).join("");
    lista.scrollTop = lista.scrollHeight;
  }

  const minhaVez = vez === eu;
  const inp = $("#input-palavra");
  $("#chat-entrada").hidden = acabou;
  inp.disabled = !minhaVez;
  $("#btn-enviar").disabled = !minhaVez;
  inp.placeholder = minhaVez ? "Sua vez: escreva uma palavra" : vez ? `Vez de ${nome(vez, g)}…` : "";
  if (minhaVez && document.activeElement !== inp) inp.focus();

  const btn = $("#btn-votacao");
  btn.hidden = !acabou;
  if (acabou) {
    const presentes = g.order.filter(u => jogadores[u]?.online);
    const prontos = presentes.filter(u => g.prontosVotar?.[u]).length;
    const euPronto = !!g.prontosVotar?.[eu];
    btn.disabled = euPronto;
    btn.textContent = euPronto
      ? `Esperando os outros (${prontos} de ${presentes.length})`
      : `INICIAR VOTAÇÃO (${prontos} de ${presentes.length})`;
  }
}

function atualizarVotacao(g) {
  const meuVoto = g.votes?.[eu];
  document.querySelectorAll("#cartas-voto .carta").forEach(c => {
    c.classList.toggle("escolhido", c.dataset.uid === meuVoto);
  });
  const qtd = Object.keys(g.votes || {}).length;
  const total = g.order.length;
  $("#votacao-status").textContent = meuVoto
    ? `Seu voto: ${nome(meuVoto, g)}. Dá para trocar até o tempo acabar. (${qtd} de ${total} votaram)`
    : `Toque em quem você acha que viu o vídeo diferente. (${qtd} de ${total} votaram)`;
}

function montarResultado(g) {
  const r = resultado(g);
  const impostorVenceu = r.vencedor === "impostor";
  const vencedores = impostorVenceu ? [g.impostor] : g.order.filter(u => u !== g.impostor);
  const quem = u => `<span class="quem"><img class="avatar avatar-p" src="${foto(u)}" alt="">
    <span class="${u === g.impostor ? "alvo-impostor" : ""}">${esc(nome(u, g))}</span></span>`;

  $("#vencedor").innerHTML = `
    <h2 class="vencedor-titulo ${impostorVenceu ? "lado-impostor" : "lado-inocente"}">
      ${impostorVenceu ? "O IMPOSTOR" : "OS INOCENTES"}
    </h2>
    <div class="vencedor-fotos ${vencedores.length > 3 ? "muitos" : ""}">
      ${vencedores.map(u => `<figure><img class="avatar" src="${foto(u)}" alt=""><figcaption>${esc(nome(u, g))}</figcaption></figure>`).join("")}
    </div>
    <p class="vencedor-nota">${impostorVenceu
      ? `${esc(nome(g.impostor, g))} viu o vídeo diferente e ninguém descobriu.`
      : `Descobriram: ${esc(nome(g.impostor, g))} era o impostor.`}</p>
    <h3 class="votos-titulo">Quem votou em quem</h3>
    <ul class="votos">
      ${g.order.map(u => {
        const alvo = g.votes?.[u];
        return `<li class="${u === eu ? "minha-linha" : ""}">${quem(u)}<span class="votou-em">${alvo ? "votou em" : "não votou"}</span>${alvo ? quem(alvo) : "<span class='quem'></span>"}</li>`;
      }).join("")}
    </ul>
    <button id="btn-voltar" class="btn btn-principal">Voltar ao lobby</button>
    <p id="resultado-limpeza" class="status"></p>`;

  $("#btn-voltar").addEventListener("click", e => {
    e.stopPropagation();
    update(ref(db), { [`room/game/returned/${eu}`]: true, [`players/${eu}/ready`]: false });
  });
  atualizarRevelacao(g);
}

// A etapa da revelação segue o relógio do servidor: todo mundo vê
// "E quem venceu foi..." e o vencedor ao mesmo tempo, sem como pular.
function atualizarRevelacao(g) {
  const passou = agora() - (g.state?.resultsAt || 0);
  const etapa = passou < 900 ? 1 : passou < 3900 ? 2 : 3;
  const rev = $("#revelacao");
  for (let i = 1; i <= 3; i++) rev.classList.toggle(`etapa-${i}`, i <= etapa);
}
