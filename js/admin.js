import {
  db, ref, onValue, set, update, remove, push, get, query, limitToLast,
  agora, mmss, esc, garantirLogin, idYoutube, linkValido, listaVideos, palavrasDe,
  avancarFase, enviarPalavra, checarProntosVotar, resultado, tentarLimpeza, limparSaidos, resumoHistorico,
  VIDEOS, FOTO_VAZIA, NOMES_FASE, ADMIN_SENHA
} from "./common.js";

const $ = s => document.querySelector(s);
const TRES_DIAS = 3 * 24 * 60 * 60 * 1000;
const MAX_HISTORICO = 50;

let jogadores = {};
let sala = {};
let videos = [];
let historico = [];
let iniciado = false;

const foto = u => jogadores[u]?.photo || FOTO_VAZIA;
const nome = (u, g) => jogadores[u]?.name || g?.players?.[u]?.name || "Jogador";
const partidaAtiva = () => (sala.game?.order && sala.game?.turnos ? sala.game : null);

// ---------- senha ----------
$("#form-senha").addEventListener("submit", e => {
  e.preventDefault();
  if ($("#senha").value === ADMIN_SENHA) {
    sessionStorage.setItem("imp_adm", "ok");
    iniciar();
  } else {
    $("#senha-erro").textContent = "Senha incorreta.";
  }
});
if (sessionStorage.getItem("imp_adm") === "ok") iniciar();

async function iniciar() {
  if (iniciado) return;
  iniciado = true;
  $("#adm-porta").hidden = true;
  $("#adm-painel").hidden = false;
  await garantirLogin();

  // na primeira vez, copia a lista inicial de vídeos.js para o Firebase
  const snapVideos = await get(ref(db, "videos"));
  if (!snapVideos.exists()) {
    const inicial = {};
    VIDEOS.forEach((v, i) => { inicial[`par-${i + 1}`] = { ...v, ordem: i }; });
    await set(ref(db, "videos"), inicial);
  }

  onValue(ref(db, "players"), s => { jogadores = s.val() || {}; render(); });
  onValue(ref(db, "room"), s => { sala = s.val() || {}; render(); });
  onValue(ref(db, "videos"), s => { videos = listaVideos(s.val()); render(); });
  onValue(query(ref(db, "history"), limitToLast(30)), s => {
    historico = Object.entries(s.val() || {}).map(([k, h]) => ({ k, ...h })).reverse();
    renderHistorico();
  });
  document.addEventListener("click", acao);
  $("#form-video").addEventListener("submit", adicionarVideo);
  setInterval(tick, 500);
  limparAntigos(false);
}

function tick() {
  tentarLimpeza(sala);
  limparSaidos(jogadores, sala);
  const g = partidaAtiva();
  const st = g?.state;
  if (!st) return;
  if (["countdown", "watch", "voting"].includes(st.phase) && agora() >= st.endsAt + 1500) {
    avancarFase(st.phase).catch(() => {});
  }
  checarProntosVotar(g, jogadores);
  const el = $("#adm-tempo");
  if (el) {
    el.textContent = st.phase === "discussion"
      ? `${palavrasDe(g).length} de ${g.turnos.length} palavras`
      : mmss((st.endsAt || 0) - agora());
  }
}

function render() {
  renderProximoImpostor();
  renderPartida();
  renderVideos();
  renderJogadores();
}

// ---------- partida atual ----------
function cartaoVideo(rotulo, url, ehImpostor) {
  const id = idYoutube(url);
  return `<button type="button" class="adm-video ${ehImpostor ? "eh-impostor" : ""}" data-acao="assistir" data-url="${esc(url)}" data-rotulo="${esc(rotulo)}">
    <img src="https://i.ytimg.com/vi/${esc(id)}/hqdefault.jpg" alt="">
    <span><strong>${rotulo}</strong><br>${esc(url)}<br><span class="assistir-aqui">▶ Assistir aqui</span></span></button>`;
}

function renderPartida() {
  const el = $("#adm-partida");
  const g = partidaAtiva();
  if (!videos.length) { el.innerHTML = "<p>Adicione pelo menos um par de vídeos abaixo.</p>"; return; }
  const proximo = (sala.round || 0) % videos.length;

  if (!g) {
    el.innerHTML = `
      <p>Nenhuma partida rolando agora. A próxima será a rodada ${(sala.round || 0) + 1}, usando o par ${proximo + 1}.</p>
      <div class="adm-videos">
        ${cartaoVideo("Vídeo normal (inocentes)", videos[proximo].normal, false)}
        ${cartaoVideo("Vídeo do impostor", videos[proximo].impostor, true)}
      </div>
      <div class="adm-acoes"><button class="btn" data-acao="zerar-rodadas">Zerar contador de rodadas</button></div>`;
    return;
  }

  const st = g.state || {};
  const words = palavrasDe(g);
  const r = resultado(g);
  const vez = st.phase === "discussion" && words.length < g.turnos.length ? g.turnos[words.length] : null;
  const por = g.order.length;
  const voltas = [];
  for (let i = 0; i < g.turnos.length; i += por) voltas.push(g.turnos.slice(i, i + por).map(u => esc(nome(u, g))).join(", "));

  el.innerHTML = `
    <dl class="adm-fatos">
      <div><dt>Rodada</dt><dd>${g.round}</dd></div>
      <div><dt>Jogadores</dt><dd>${por}</dd></div>
      <div><dt>Fase</dt><dd>${NOMES_FASE[st.phase] || "?"}</dd></div>
      <div><dt>Tempo ou progresso</dt><dd id="adm-tempo"></dd></div>
      <div><dt>Par de vídeos</dt><dd>${(g.pairIndex ?? 0) + 1}</dd></div>
      ${st.phase === "results" ? `<div><dt>Vencedor</dt><dd class="${r.pego ? "verde" : "vermelho"}">${r.pego ? "Inocentes" : "Impostor"}</dd></div>` : ""}
    </dl>
    <div class="adm-videos">
      ${cartaoVideo("Vídeo normal (inocentes)", g.videos.normal, false)}
      ${cartaoVideo(`Vídeo do impostor: ${esc(nome(g.impostor, g))}`, g.videos.impostor, true)}
    </div>
    <p class="status">${g.impostorEscolhido ? "Impostor escolhido por você." : "Impostor sorteado."}</p>
    <p class="status">Ordem de fala: ${voltas.map((v, i) => `volta ${i + 1}: ${v}`).join(" | ")}</p>
    <div class="rolagem">
      <table class="adm-tabela">
        <thead><tr><th>Jogador</th><th>Palavras</th><th>Pronto p/ votar</th><th>Votou em</th><th>Votos recebidos</th><th>Voltou ao lobby</th><th>Conexão</th></tr></thead>
        <tbody>
          ${g.order.map(u => `
            <tr class="${u === g.impostor ? "linha-impostor" : ""}">
              <td><span class="quem"><img class="avatar avatar-p" src="${foto(u)}" alt="">${esc(nome(u, g))}</span>
                ${u === g.impostor ? '<span class="etiqueta etiqueta-impostor">impostor</span>' : ""}
                ${u === vez ? '<span class="etiqueta">na vez</span>' : ""}</td>
              <td>${words.filter(w => w.uid === u).map(w => esc(w.word)).join(", ") || "–"}</td>
              <td>${g.prontosVotar?.[u] ? "Sim" : "Não"}</td>
              <td>${g.votes?.[u] ? esc(nome(g.votes[u], g)) : "–"}</td>
              <td>${r.contagem[u] || 0}</td>
              <td>${g.returned?.[u] ? "Sim" : "Não"}</td>
              <td>${jogadores[u]?.online ? "Online" : "Offline"}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <div class="adm-acoes">
      <button class="btn btn-principal" data-acao="avancar">${st.phase === "results" ? "Fechar sala agora" : "Avançar fase"}</button>
      ${vez ? `<button class="btn" data-acao="pular">Pular a vez de ${esc(nome(vez, g))}</button>` : ""}
      <button class="btn btn-perigo" data-acao="encerrar">Encerrar partida</button>
    </div>`;
  tick();
}

// ---------- próximo impostor ----------
let chaveProximo = "";
function renderProximoImpostor() {
  const el = $("#adm-proximo");
  if (!el) return;
  const noLobby = Object.entries(jogadores)
    .filter(([u, p]) => p.online && p.name && !(partidaAtiva()?.order || []).includes(u))
    .sort((a, b) => a[1].name.localeCompare(b[1].name));
  const atual = sala.proximoImpostor || "";
  const atualInfo = atual && jogadores[atual];
  const chave = JSON.stringify([atual, atualInfo?.name, atualInfo?.online, noLobby.map(([u, p]) => [u, p.name])]);
  if (chave === chaveProximo) return;
  chaveProximo = chave;
  const opcoes = [...noLobby];
  if (atual && atualInfo && !noLobby.some(([u]) => u === atual)) opcoes.push([atual, atualInfo]);
  el.innerHTML = `
    <div class="campo-linha">
      <select id="sel-proximo" class="campo" aria-label="Impostor da próxima partida">
        <option value="">Sortear (padrão)</option>
        ${opcoes.map(([u, p]) => `<option value="${u}" ${u === atual ? "selected" : ""}>${esc(p.name)}${p.online ? "" : " (offline)"}</option>`).join("")}
      </select>
    </div>
    <p class="status">${atual
      ? `Na próxima partida, ${esc(atualInfo?.name || "a pessoa escolhida")} será o impostor, se estiver entre os jogadores. Se não estiver, o jogo sorteia. A escolha vale para uma partida só e não pode ser mudada depois que a partida começa.`
      : "Padrão: o impostor é sorteado. Escolha alguém só se quiser decidir."}</p>`;
}

document.addEventListener("change", async e => {
  if (e.target.id !== "sel-proximo") return;
  const u = e.target.value;
  if (!u) { set(ref(db, "room/proximoImpostor"), null); return; }
  const n = jogadores[u]?.name || "essa pessoa";
  const ok = await confirmar(`Escolher ${n} como impostor?`, "Vale só para a próxima partida. Ninguém no jogo fica sabendo que foi escolhido.", "Escolher");
  if (ok) set(ref(db, "room/proximoImpostor"), u);
  else { chaveProximo = ""; renderProximoImpostor(); }
});

// ---------- vídeos ----------
function renderVideos() {
  if (!videos.length) { $("#adm-videos").innerHTML = ""; return; }
  const proximo = (sala.round || 0) % videos.length;
  const atual = partidaAtiva()?.pairKey;
  const link = (url, rotulo) => `<button type="button" class="btn btn-mini" data-acao="assistir" data-url="${esc(url)}" data-rotulo="${esc(rotulo)}">▶ Assistir</button> <span class="id-video">${esc(idYoutube(url))}</span>`;
  $("#adm-videos").innerHTML = `
    <table class="adm-tabela">
      <thead><tr><th>Par</th><th>Normal (inocentes)</th><th>Impostor</th><th>Situação</th><th></th></tr></thead>
      <tbody>
        ${videos.map((v, i) => {
          const naRodada = v.key === atual;
          return `
          <tr class="${naRodada ? "linha-impostor" : i === proximo ? "linha-destaque" : ""}">
            <td>${i + 1}</td>
            <td>${link(v.normal, `Par ${i + 1}: vídeo normal`)}</td>
            <td>${link(v.impostor, `Par ${i + 1}: vídeo do impostor`)}</td>
            <td>${naRodada ? "Na rodada atual" : i === proximo ? "Próximo" : ""}</td>
            <td class="celula-acoes">
              ${naRodada ? "<span class='status'>Bloqueado até a rodada acabar</span>" : `
                <button class="btn" data-acao="trocar" data-key="${esc(v.key)}">Trocar impostor ⇄ normal</button>
                ${i === proximo ? "" : `<button class="btn" data-acao="usar-par" data-i="${i}">Usar na próxima</button>`}
                <button class="btn btn-perigo" data-acao="remover-video" data-key="${esc(v.key)}" ${videos.length <= 1 ? "disabled" : ""}>Remover</button>`}
            </td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;
}

async function adicionarVideo(e) {
  e.preventDefault();
  const normal = $("#novo-normal").value.trim();
  const impostor = $("#novo-impostor").value.trim();
  const aviso = $("#video-aviso");
  if (!linkValido(normal) || !linkValido(impostor)) {
    aviso.textContent = "Cole dois links de YouTube (shorts ou vídeo normal).";
    return;
  }
  if (idYoutube(normal) === idYoutube(impostor)) {
    aviso.textContent = "Os dois links são o mesmo vídeo. Use vídeos diferentes.";
    return;
  }
  const ultimaOrdem = videos.reduce((m, v) => Math.max(m, v.ordem || 0), 0);
  await push(ref(db, "videos"), { normal, impostor, ordem: ultimaOrdem + 1 });
  $("#novo-normal").value = "";
  $("#novo-impostor").value = "";
  aviso.textContent = "Par adicionado no fim da lista.";
}

// ---------- jogadores ----------
function renderJogadores() {
  const lista = Object.entries(jogadores)
    .filter(([, p]) => p.name)
    .sort((a, b) => (b[1].online ? 1 : 0) - (a[1].online ? 1 : 0));
  $("#adm-jogadores").innerHTML = lista.length ? `
    <table class="adm-tabela">
      <thead><tr><th>Jogador</th><th>Conexão</th><th>Pronto</th><th></th></tr></thead>
      <tbody>
        ${lista.map(([u, p]) => `
          <tr>
            <td><span class="quem"><img class="avatar avatar-p" src="${p.photo || FOTO_VAZIA}" alt="">${esc(p.name)}</span></td>
            <td>${p.online ? "Online" : "Offline"}</td>
            <td>${p.ready ? "Sim" : "Não"}</td>
            <td><button class="btn" data-acao="remover" data-uid="${u}">Remover</button></td>
          </tr>`).join("")}
      </tbody>
    </table>`
    : "<p>Ninguém entrou ainda.</p>";
}

// ---------- histórico ----------
function renderHistorico() {
  $("#adm-historico").innerHTML = historico.length ? `
    <table class="adm-tabela">
      <thead><tr><th>Rodada</th><th>Quando</th><th>Vencedor</th><th>Impostor</th><th>Palavras</th><th>Votos</th></tr></thead>
      <tbody>
        ${historico.map(h => `
          <tr>
            <td>${h.round} (par ${(h.pairIndex ?? 0) + 1}, ${h.jogadores || "?"} jogadores)</td>
            <td>${new Date(h.finishedAt).toLocaleString("pt-BR")}</td>
            <td class="${h.vencedor === "inocentes" ? "verde" : "vermelho"}">${h.vencedor === "inocentes" ? "Inocentes" : "Impostor"}</td>
            <td>${esc(h.impostor)}</td>
            <td>${(h.palavras || []).map(esc).join("<br>")}</td>
            <td>${(h.votos || []).map(esc).join("<br>")}</td>
          </tr>`).join("")}
      </tbody>
    </table>`
    : "<p>As partidas terminadas aparecem aqui.</p>";
}

// ---------- limpeza do banco ----------
// Remove jogadores offline há mais de 3 dias e mantém só as últimas 50 partidas.
// Roda sozinha sempre que o painel abre; o botão faz o mesmo na hora.
async function limparAntigos(avisar) {
  const [snapJ, snapH] = await Promise.all([get(ref(db, "players")), get(ref(db, "history"))]);
  const up = {};
  let jogadoresRemovidos = 0;
  Object.entries(snapJ.val() || {}).forEach(([u, p]) => {
    const antigo = !p.online && (!p.lastSeen || agora() - p.lastSeen > TRES_DIAS);
    const semPerfil = !p.online && !p.name;
    if (antigo || semPerfil) { up[`players/${u}`] = null; jogadoresRemovidos++; }
  });
  const chavesH = Object.keys(snapH.val() || {}).sort();
  const sobra = chavesH.slice(0, Math.max(0, chavesH.length - MAX_HISTORICO));
  sobra.forEach(k => { up[`history/${k}`] = null; });
  if (Object.keys(up).length) await update(ref(db), up);
  if (avisar) {
    $("#limpeza-aviso").textContent =
      `Limpeza feita: ${jogadoresRemovidos} jogador(es) antigo(s) e ${sobra.length} partida(s) antiga(s) do histórico removidos.`;
  }
}

// ---------- janela de confirmação ----------
function confirmar(titulo, texto, botao = "Confirmar") {
  return new Promise(resolve => {
    const d = $("#dlg-confirmar");
    $("#dlg-confirmar-titulo").textContent = titulo;
    $("#dlg-confirmar-texto").textContent = texto;
    $("#dlg-confirmar-ok").textContent = botao;
    d.returnValue = "";
    d.addEventListener("close", () => resolve(d.returnValue === "ok"), { once: true });
    d.showModal();
  });
}

// ---------- assistir vídeo no painel ----------
// Usa o player oficial do YouTube, que avisa quando o dono bloqueou a incorporação.
let ytCarregando = null;
let player = null;
function carregarYouTube() {
  if (window.YT?.Player) return Promise.resolve();
  if (!ytCarregando) {
    ytCarregando = new Promise(resolve => {
      window.onYouTubeIframeAPIReady = resolve;
      const sc = document.createElement("script");
      sc.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(sc);
    });
  }
  return ytCarregando;
}

const ERROS_YT = {
  2: "O link parece inválido. Confira se copiou o endereço inteiro.",
  5: "O navegador não conseguiu tocar este vídeo. Tente outro navegador.",
  100: "Vídeo não encontrado: foi removido ou está privado.",
  101: "Bloqueado: o dono do vídeo não permite que ele toque fora do YouTube. Troque este vídeo.",
  150: "Bloqueado: o dono do vídeo não permite que ele toque fora do YouTube. Troque este vídeo."
};

async function assistir(url, rotulo) {
  const d = $("#dlg-video");
  const id = idYoutube(url);
  const status = $("#dlg-video-status");
  $("#dlg-video-titulo").textContent = rotulo || "Vídeo";
  $("#dlg-video-link").href = url.startsWith("http") ? url : `https://www.youtube.com/shorts/${id}`;
  status.className = "status";
  status.textContent = "Carregando…";
  $("#dlg-video-palco").innerHTML = '<div id="dlg-video-player"></div>';
  d.showModal();
  await carregarYouTube();
  if (!d.open) return;
  player = new YT.Player("dlg-video-player", {
    videoId: id,
    width: "100%",
    height: "100%",
    playerVars: { autoplay: 1, playsinline: 1, rel: 0 },
    events: {
      onReady: () => {
        status.className = "status verde";
        status.textContent = "Carregou. Se ele tocar aqui, vai tocar no jogo também.";
      },
      onError: e => {
        status.className = "status vermelho";
        status.textContent = ERROS_YT[e.data] || `O YouTube recusou este vídeo (erro ${e.data}). Troque por outro.`;
      }
    }
  });
}

$("#dlg-video").addEventListener("close", () => {
  try { player?.destroy(); } catch { /* já fechado */ }
  player = null;
  $("#dlg-video-palco").innerHTML = "";
});

// ---------- ações ----------
async function encerrar(pedirConfirmacao = true) {
  const g = sala.game;
  if (pedirConfirmacao && !(await confirmar("Encerrar a partida?", "Todo mundo volta para o lobby e a rodada é descartada.", "Encerrar"))) return;
  if (g?.state?.phase === "results") push(ref(db, "history"), resumoHistorico(g));
  await remove(ref(db, "room/game"));
}

async function acao(e) {
  const b = e.target.closest("[data-acao]");
  if (!b || b.disabled) return;
  const g = partidaAtiva();
  const st = g?.state;
  const nPar = key => videos.findIndex(x => x.key === key) + 1;
  switch (b.dataset.acao) {
    case "assistir":
      assistir(b.dataset.url, b.dataset.rotulo);
      break;
    case "assistir-campo": {
      const url = $(`#${b.dataset.campo}`).value.trim();
      if (!linkValido(url)) { $("#video-aviso").textContent = "Cole um link do YouTube no campo antes de testar."; return; }
      assistir(url, b.dataset.rotulo);
      break;
    }
    case "avancar":
      if (st?.phase === "results") encerrar(false);
      else if (st) avancarFase(st.phase, true);
      break;
    case "pular":
      enviarPalavra(g, g.turnos[palavrasDe(g).length], "(pulou)", true);
      break;
    case "encerrar":
      encerrar(true);
      break;
    case "trocar": {
      const v = videos.find(x => x.key === b.dataset.key);
      if (!v || v.key === g?.pairKey) return;
      const ok = await confirmar(`Trocar os vídeos do par ${nPar(v.key)}?`,
        "O vídeo que hoje é do impostor passa a ser o normal, e o normal passa a ser o do impostor.", "Trocar");
      if (ok && v.key !== partidaAtiva()?.pairKey) update(ref(db, `videos/${v.key}`), { normal: v.impostor, impostor: v.normal });
      break;
    }
    case "remover-video": {
      const v = videos.find(x => x.key === b.dataset.key);
      if (!v || v.key === g?.pairKey || videos.length <= 1) return;
      const ok = await confirmar(`Remover o par ${nPar(v.key)}?`, "Os dois links deste par saem da lista. Isso não pode ser desfeito.", "Remover");
      if (ok && v.key !== partidaAtiva()?.pairKey) remove(ref(db, `videos/${v.key}`));
      break;
    }
    case "usar-par": {
      const i = Number(b.dataset.i);
      if (await confirmar(`Usar o par ${i + 1} na próxima rodada?`, "A lista continua a partir dele depois.", "Usar")) set(ref(db, "room/round"), i);
      break;
    }
    case "zerar-rodadas":
      if (await confirmar("Zerar o contador de rodadas?", "A próxima partida volta a usar o par 1.", "Zerar")) set(ref(db, "room/round"), 0);
      break;
    case "remover": {
      const u = b.dataset.uid;
      const n = jogadores[u]?.name || "este jogador";
      if (await confirmar(`Remover ${n}?`, "Os dados dessa pessoa (nome e foto) são apagados do Firebase. Se ela ainda estiver com o jogo aberto, precisa recarregar a página.", "Remover")) {
        remove(ref(db, `players/${u}`));
      }
      break;
    }
    case "limpar":
      if (await confirmar("Limpar dados antigos?", "Remove jogadores offline há mais de 3 dias e deixa só as últimas 50 partidas no histórico.", "Limpar")) limparAntigos(true);
      break;
    case "apagar-historico":
      if (await confirmar("Apagar todo o histórico?", "Todas as partidas registradas somem. Isso não pode ser desfeito.", "Apagar")) remove(ref(db, "history"));
      break;
  }
}
