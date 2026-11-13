POKÉMON JORNADA — projeto de navegador

COMO ABRIR
1. Extraia pokemon_jornada_vscode.zip.
2. Abra a pasta pokemon_age_style - Copia no VS Code.
3. Abra index_evolucao_corrigido.html no navegador ou use a extensão Live Server.
4. Mantenha a internet conectada: dados, sprites, movimentos e evoluções vêm da PokéAPI.

O QUE ESTA VERSÃO TEM
- Escolha entre Kanto, Johto, Hoenn, Sinnoh, Unova, Kalos, Alola, Galar e Paldea.
- Escolha um dos três iniciais oficiais da região, tente até cinco vezes a roleta de Pokémon básico aleatório da região ou escolha uma espécie básica da Pokédex nacional para uma tentativa única. Pokémon lendários e míticos não são permitidos; a chance depende da raridade.
- Encontros limitados à Pokédex regional selecionada; no começo aparecem Pokémon básicos, enquanto espécies evoluídas ficam mais comuns após avançar nos desafios. Lendários e míticos ficam fora dos encontros selvagens. Em Alola, Ultra Beasts podem aparecer como selvagens com chance de 0,2% por encontro; elas nunca entram nas equipes de treinadores aleatórios.
- Níveis de Pokémon selvagens e treinadores aleatórios calculados a partir do primeiro Pokémon da equipe: por exemplo, nível 10 enfrenta nível 9 e nível 42 enfrenta nível 28. Os adversários comuns têm limite de nível 34; o dano selvagem continua reduzido para manter a exploração justa.
- Batalhas por turnos, movimentos consultados na PokéAPI, PP, precisão, STAB e efetividade de tipos.
- Pokémon ganham experiência e sobem de nível. Ao aprender um quinto movimento, o jogador escolhe qual dos quatro atuais substituir ou pode recusar o novo movimento.
- Evoluções consultadas na cadeia oficial da PokéAPI. Pedras e requisitos compatíveis são verificados; evoluções por troca usam o Cabo de Ligação para permitir jogo solo.
- Nível e rank de treinador separados: o nível recebe XP em batalhas selvagens e contra treinadores; o rank só recebe XP ao vencer treinadores, líderes, torneios e Liga. O rank é o único usado para liberar desafios.
- Desafios regionais com equipes fixas de Pokémon oficiais dos líderes de ginásio; níveis definidos por etapa, começando mais baixos. Alola usa as Grandes Provas dos Kahunas e suas equipes.
- Torneio regional com quatro adversários. A primeira participação libera viagens para outras regiões, mesmo sem vencer.
- Liga regional após concluir todos os desafios, com seis adversários.
- Loja Pokémon com Poké Bolas, Great Balls, Ultra Balls, Poções, Reviver e pedras evolutivas; itens podem ser usados na mochila ou durante batalhas quando aplicável.
- Rotas e áreas com pesos de encontro por habitat: florestas favorecem tipos Grama/Inseto, cavernas favorecem Pedra/Terrestre/Fantasma, áreas aquáticas favorecem Água/Gelo e assim por diante. Os tipos são favorecidos, não obrigatórios.
- Equipe, PC, Pokédex nacional pesquisável, mochila, salvamento local, exportação e importação de save. A Pokédex abre uma ficha com região, tipos, descrição e linha evolutiva; azul indica registrado e amarelo indica capturado.

LIMITAÇÕES DESTA ETAPA
- É um protótipo de fã, não um clone completo de Pokémon Age nem um jogo oficial.
- As nove regiões e suas estruturas competitivas estão representadas, mas mapas, história e elenco de treinadores ainda são compactos.
- Condições de evolução dependentes de horário, local específico, clima, itens equipados ou movimentos específicos ainda não estão todas simuladas.
- Efeitos avançados de movimentos de status, habilidades, itens segurados, Mega Evolução, Z-Moves, Dynamax e Terastalização ainda não estão implementados.
- A divisão de espécies por região usa faixas da Pokédex regional como regra de jogo; algumas espécies podem aparecer em mais de uma região nos jogos oficiais.
- O jogo precisa de internet para consultar a PokéAPI. O progresso fica salvo no navegador atual; exporte o save para fazer backup.

AVISO
Projeto de fã não oficial. Pokémon e suas marcas pertencem à Nintendo, Game Freak e The Pokémon Company.

Atualização de prêmios regionais:
- As insígnias dos ginásios agora usam as imagens da foto de referência, salvas em assets/badges/ (funcionam sem internet). Arquivos: kanto-1.png a kanto-8.png, johto-*, hoenn-*, sinnoh-*, unova-*, galar-* e paldea-*, na ordem dos ginásios de cada região. Alola continua sem insígnias de ginásio.
- Galar usa, na ordem: Grass, Water, Fire, Fighting, Fairy, Rock, Dark e Dragon.
- Kalos também usa imagens locais (assets/badges/kalos-1.png a kalos-8.png): Bug, Cliff, Rumble, Plant, Voltage, Fairy, Psychic, Iceberg.
- Os 8 ranks usam os símbolos de assets/ranks/rank-1.png a rank-8.png (Novato a Lenda).
- Cada Liga Pokémon usa um dos nove troféus da imagem de referência enviada, na ordem das regiões: Kanto a Paldea. O décimo troféu da imagem foi ignorado, conforme solicitado.
- Os nove recortes dos troféus ficam em assets/trophies/league-1.png até league-9.png.

Correções na criação do jogador:
- Roleta regional: são 5 giros reais. Conseguir um Pokémon não encerra a roleta; os giros restantes continuam disponíveis. O Pokémon conseguido fica guardado (e selecionado) até outro giro dar certo, e um giro que falha não o remove. Mudar de região não devolve giros.
- Corrigido o erro "Não foi possível preparar o Pokémon inicial": o estado de um jogador novo não tinha o registro de capturados (caught).
- A escolha de nome e de personagem visual agora aparece já na primeira abertura do jogo (no topo da tela de criação) e o personagem escolhido é aplicado ao começar.


ATUALIZAÇÃO — FORMAS REGIONAIS E POKÉMON SHINY
- Encontros selvagens podem gerar Pokémon Shiny com chance independente de 1 em 4.096. O status e o sprite Shiny são salvos no progresso e mantidos após evoluções.
- O indicador ✨ aparece na equipe, ficha individual, batalha e Pokédex.
- Formas regionais oficiais são carregadas pela PokéAPI: Alola, Galar e Paldea podem aparecer apenas em suas respectivas regiões. A Pokédex também cataloga as 16 formas de Hisui, mas Hisui não é uma região jogável nesta versão e essas formas não aparecem em encontros.
- Tipos, atributos, habilidades, movimentos e sprites das variantes são consultados na PokéAPI. Evoluções regionais usam os destinos regionais quando a cadeia oficial permite; a Loja inclui os itens Galarica para evoluções de Slowpoke de Galar.
- O sistema mantém as formas convencionais e adiciona registros separados para as variantes. Saves antigos continuam compatíveis.


ATUALIZAÇÃO — MEGA EVOLUÇÕES E MOVIMENTOS Z
- Kalos: após concluir pelo menos dois desafios regionais, fica disponível o Desafio especial de Mega Evolução. Antes de começar, o jogador escolhe um Pokémon da equipe que possua Mega Evolução e a forma desejada (incluindo X/Y quando aplicável). Durante a prova, somente esse Pokémon pode lutar. A vitória concede a Mega Pedra escolhida; a prova pode ser repetida para conquistar outras pedras.
- A lista inclui as 47 Mega Pedras oficiais associadas às formas Mega disponíveis por pedra. Rayquaza não aparece nessa lista porque sua Mega Evolução oficial não utiliza Mega Pedra: ela depende do movimento Dragon Ascent.
- Mega Evolução: basta possuir a Mega Pedra correspondente na mochila. Pode ser ativada uma vez por batalha; os dados oficiais de forma, tipos, atributos, habilidade e sprite são carregados da PokéAPI. A transformação termina ao encerrar a batalha e não altera permanentemente o Pokémon.
- Alola: ao vencer cada Grande Prova, o jogador escolhe um Cristal Z de tipagem entre os 18 tipos. Cristais exclusivos de Pokémon não são oferecidos. Saves com Grandes Provas concluídas antes desta atualização recebem uma opção para escolher as recompensas pendentes.
- Movimentos Z: basta possuir o cristal de tipagem compatível na mochila e conhecer um movimento daquele tipo. Um Movimento Z pode ser usado por batalha; o cristal não é consumido. Movimentos ofensivos recebem poder Z escalonado; movimentos de status aplicam um bônus temporário de atributos nesta versão.
- Mega Evolução e Movimento Z podem ser usados na mesma batalha, mas não pelo mesmo Pokémon. Nenhum item precisa ser equipado.
- A equipe completa é preservada durante o Desafio de Mega Evolução: apenas o Pokémon escolhido participa, e os demais retornam à equipe ao final. Saves antigos continuam compatíveis.

LIMITAÇÃO DA ATUALIZAÇÃO
- A PokéAPI é necessária para carregar sprites, atributos e habilidades das formas Mega. A sintaxe dos scripts foi validada, mas não foi possível completar uma partida real com dados externos neste ambiente.


ATUALIZAÇÃO — CONTAS ONLINE (ETAPA 1: cadastro, login e conexão com o Supabase)
- Ao abrir o jogo aparece a tela de Entrar / Criar conta. Depois do login o jogo funciona normalmente.
- Cadastro: nome exclusivo (sem diferenciar maiúsculas/minúsculas), senha de 8+ caracteres e confirmação. A unicidade é garantida no servidor.
- A sessão fica guardada no navegador: fechar e reabrir não pede login de novo. O botão "Sair" (cabeçalho e página Perfil) encerra a sessão.
- Sem internet, quem já estava logado continua jogando offline.
- Arquivos novos: account/ (config.js, account.js, account.css) e supabase/setup_pokemon_jornada.sql. Veja LEIA-ME_CONTAS_ONLINE.txt.


ATUALIZAÇÃO — CONTAS ONLINE (ETAPA 2: save na nuvem)
- Cada conta tem seu próprio save na nuvem. O jogo continua salvando no navegador (cópia de segurança) e o progresso é enviado automaticamente alguns segundos depois de cada salvamento.
- Em outro computador: entre com o mesmo nome e continue de onde parou.
- Save antigo (de antes das contas): ao criar/entrar numa conta, o jogo pergunta se quer vincular o save do navegador à conta.
- Se o save local e o da nuvem forem diferentes, aparece uma tela para escolher qual manter. Nada é sobrescrito sem escolha; o que for substituído fica guardado como backup (no navegador e/ou no servidor).
- Sem internet: continua jogando; as alterações ficam pendentes e são enviadas quando a conexão voltar (ou ao reabrir o jogo).
- Indicador de sincronização no cabeçalho e botão "Sincronizar agora" na página Perfil.

ATUALIZAÇÃO PvP E NOTIFICAÇÕES
- A batalha online agora usa a mesma composição visual das batalhas normais do jogo.
- Quando um desafio é aceito, os dois treinadores são direcionados automaticamente para a tela de Batalha PvP ao receberem a partida ativa.
- A aba Amigos mostra um contador de pedidos de amizade recebidos.
- A aba Batalha PvP mostra um contador de desafios recebidos.
- Novos pedidos recebidos geram avisos dentro do jogo; os contadores são atualizados periodicamente.
- Não é necessário executar um SQL novo nesta atualização: o esquema PvP/social existente permanece o mesmo.
