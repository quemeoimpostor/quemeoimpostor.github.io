// ============================================================
//  CONFIGURAÇÕES — é aqui que você mexe
// ============================================================

// 1) Cole aqui o objeto que o Firebase te dá em:
//    Configurações do projeto > Seus apps > App da Web > "Configuração do SDK"
//    (o campo databaseURL aparece depois que você cria o Realtime Database)
export const firebaseConfig = {
  apiKey: "AIzaSyB3tWxFykaaf378kvli7jhhD5nB2YHyTPw",
  authDomain: "impostor-shorts.firebaseapp.com",
  databaseURL: "https://impostor-shorts-default-rtdb.firebaseio.com",
  projectId: "impostor-shorts",
  storageBucket: "impostor-shorts.firebasestorage.app",
  messagingSenderId: "863296090598",
  appId: "1:863296090598:web:5eca5bcba516353a6de627"
};

// 2) Senha da página /ADM (troque antes de publicar)
export const ADMIN_SENHA = "problems";

// 3) Tempos, em segundos
export const TEMPOS = {
  contagem: 5,        // contagem antes do vídeo
  assistir: 90,       // tempo para assistir ao short (1:30)
  votacao: 30,        // tempo de votação
  limpezaLobby: 60,   // depois do resultado, a sala antiga some após esse tempo
  esperaSaida: 10     // se alguém sai do lobby, espera esse tempo para ver se a pessoa volta
};

// 4) Jogadores
export const MIN_JOGADORES = 4;
export const MAX_JOGADORES = 10;
export const PALAVRAS_POR_JOGADOR = 2;
