POKÉMON JORNADA — projeto de navegador

COMO ABRIR
1. Extraia pokemon_jornada_vscode.zip.
2. Abra a pasta pokemon_age_style no VS Code.
3. Abra index.html no navegador ou use a extensão Live Server.
4. Mantenha a internet conectada: dados, sprites, movimentos e evoluções vêm da PokéAPI.

O QUE ESTA VERSÃO TEM
- Escolha entre Kanto, Johto, Hoenn, Sinnoh, Unova, Kalos, Alola, Galar e Paldea.
- Escolha um dos três iniciais oficiais da região, tente até cinco vezes a roleta de Pokémon básico aleatório da região ou escolha uma espécie básica da Pokédex nacional para uma tentativa única. Pokémon lendários e míticos não são permitidos; a chance depende da raridade.
- Encontros limitados à Pokédex regional selecionada; no começo aparecem Pokémon básicos, enquanto espécies evoluídas ficam mais comuns após avançar nos desafios. Lendários e míticos ficam fora dos encontros selvagens.
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
