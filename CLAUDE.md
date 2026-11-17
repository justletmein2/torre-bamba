# Instruções para o Claude neste repositório

- Fale em português com o Lucas. Ele não é programador: explique em termos simples
  e diga o que ele precisa fazer, se houver algo. Ele prefere que você discorde com franqueza.
- Torre Bamba é um jogo multiplayer pelo navegador de empilhar peças com física (a torre balança;
  quem segurar a torre acima da linha por 3 segundos ganha). Tudo original.
- Usa o MESMO projeto Firebase do Forma Palavras (`caca-palavras-6cd16`), num caminho próprio
  (`torrebamba/rooms/...`), e o mesmo perfil/boneco. Não quebre o Forma Palavras nem o Pé na Tábua.
- Nunca mexa no Aura Battle (`duels-game`) nem no Firebase dele.
- `main` é o que está no ar: todo push em `main` publica o site no GitHub Pages.

## Como funciona

- `public/js/jogo.js`: tudo do jogo. Cada celular simula a PRÓPRIA torre (Matter.js, em
  `public/js/vendor/`) e manda um "retrato" dela pros outros (`estado/{uid}`); as peças vêm
  na mesma ordem pra todo mundo (semente em `meta`).
- `public/js/rede.js`: Firebase (ou banco de teste no navegador com `?local=1`).
- O boneco vem de `/forma-palavras/js/avatar.js` (mesmo endereço justletmein2.github.io).
- `database.rules.json` tem as regras do projeto INTEIRO (Forma Palavras + Pé na Tábua + Torre Bamba).
  Ao mudar, mantenha igual nos três repositórios e peça pro Lucas colar no Console do Firebase
  (Realtime Database → Regras).

## Testar

- Sirva uma pasta com `torre-bamba/` (= public) e `forma-palavras/` (= public do outro repo)
  lado a lado e abra `torre-bamba/index.html?local=1` em duas abas (cada aba é um jogador).
- `?local=1&linha=4` deixa a chegada baixinha pra testar a vitória rápido.
