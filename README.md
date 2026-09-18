# Quem é o impostor?

Jogo para 4 a 10 pessoas: todos veem o mesmo short, menos 1, que vê um diferente. Cada um escreve uma palavra por vez (duas voltas) e depois todos votam em quem acham que é o impostor.

## Arquivos

```
index.html            jogo (lobby, vídeo, discussão, votação, resultado)
ADM/index.html        painel do organizador  →  seusite/ADM
css/style.css         visual
js/config.js          ← configuração do Firebase, senha do ADM e tempos
js/videos.js          lista inicial de shorts (depois, gerencie pelo /ADM)
js/common.js          regras compartilhadas
js/game.js            lógica do jogo
js/admin.js           lógica do painel
database.rules.json   regras do banco (copiar para o Firebase)
```

## 1. Firebase (uns 5 minutos)

1. Entre em https://console.firebase.google.com e crie um projeto (pode desligar o Google Analytics).
2. **Realtime Database**: menu Criação > Realtime Database > Criar banco de dados. Escolha a região e comece no **modo bloqueado**.
   Depois abra a aba **Regras**, apague o que estiver lá, cole o conteúdo de `database.rules.json` e clique em Publicar.
3. **Authentication**: menu Criação > Authentication > Vamos começar > aba Método de login > **Anônimo** > Ativar.
4. Ainda em Authentication, aba **Configurações > Domínios autorizados**, adicione `SEU-USUARIO.github.io`.
5. Engrenagem > Configurações do projeto > "Seus apps" > ícone `</>` (Web). Registre o app e copie o objeto `firebaseConfig`.
   Cole em `js/config.js`. Confira se o `databaseURL` está preenchido (se não estiver, pegue na página do Realtime Database).
6. Ainda em `js/config.js`, troque `ADMIN_SENHA`.

Não precisa do Firebase Storage: as fotos são cortadas em quadrado de 256×256 no navegador e salvas compactadas direto no banco.

## 2. GitHub Pages

1. Crie um repositório e envie todos os arquivos mantendo as pastas.
2. Settings > Pages > Source: "Deploy from a branch" > branch `main`, pasta `/ (root)` > Save.
3. Em um ou dois minutos o site fica em `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.
   O painel fica em `.../NOME-DO-REPO/ADM/` (com A, D, M maiúsculos).

## Testar no seu PC antes

Abrir o `index.html` com duplo clique não funciona (o navegador bloqueia módulos JS em `file://`). Na pasta do projeto rode:

```
python -m http.server 8000
```

e abra `http://localhost:8000`. Para simular 4 jogadores, use 4 janelas: uma normal, uma anônima, e outros navegadores (cada janela anônima/navegador conta como um jogador diferente).

## Regras que o jogo segue

- Mínimo de 4 e máximo de 10 jogadores. Começa na hora em que todos que estão na sala clicam em Começar
  (com pelo menos 4). Se alguém sai da sala antes, o jogo espera 10 s para ver se a pessoa volta;
  se voltar, espera ela clicar. Qualquer um pode clicar em Cancelar para parar a contagem.
- Contagem de 5 s, 1:30 de vídeo, discussão em turnos (2 palavras por pessoa), 30 s de votação.
- A ordem das fotos é sorteada a cada partida, e a fala segue essa ordem nas duas voltas.
- A votação só começa quando todos que estão online clicarem em INICIAR VOTAÇÃO.
- Não dá para votar em si mesmo. Dá para trocar o voto enquanto o tempo corre.
- **Os inocentes vencem só se o impostor for o mais votado sem empate.** Empate ou erro = vitória do impostor.
- Depois do resultado, a sala some quando todos voltam ao lobby ou após 60 s. O nome e a foto ficam salvos.

## Painel /ADM

Mostra os dois vídeos da rodada, quem é o impostor, a ordem de fala, as palavras e votos ao vivo, e permite:
avançar fase, pular a vez de quem sumiu, encerrar partida, adicionar/remover pares de vídeos,
trocar qual vídeo do par é o do impostor (menos no par da rodada atual), escolher o próximo par,
remover jogadores, ver o histórico e limpar dados antigos.

Na primeira vez que o painel abre, ele copia os pares de `js/videos.js` para o Firebase.
Daí em diante a lista oficial é a do painel.

## Limitações honestas

- Como tudo roda no navegador (sem servidor), os dados da partida, inclusive quem é o impostor, ficam no banco.
  Alguém que abrir as ferramentas de desenvolvedor consegue descobrir. Entre amigos, tudo bem; para blindar
  de verdade seria preciso Cloud Functions (plano pago do Firebase).
- A senha do ADM também fica no código do site. É uma tranca leve, não segurança de verdade.
- Alguns shorts têm incorporação desativada pelo dono e não tocam fora do YouTube. Teste cada link pelo painel.
- Alguns navegadores bloqueiam autoplay com som; nesse caso é só tocar no play.
