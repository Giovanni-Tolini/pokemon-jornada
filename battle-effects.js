/* Pokémon Jornada — motor integrado de condições e efeitos de batalha.
   Mantém os efeitos temporários dentro de state.activeBattle e usa os dados
   oficiais de movimentos da PokéAPI, com regras locais para movimentos comuns. */
(()=>{
 'use strict';
 const moveCache=new Map();
 const STATUS_LABEL={burn:'queimado',poison:'envenenado',toxic:'gravemente envenenado',paralysis:'paralisado',sleep:'dormindo',freeze:'congelado',confusion:'confuso'};
 const STATS=['attack','defense','special-attack','special-defense','speed','accuracy','evasion'];
 const STAT_PT={attack:'Ataque',defense:'Defesa','special-attack':'Ataque especial','special-defense':'Defesa especial',speed:'Velocidade',accuracy:'Precisão',evasion:'Evasão'};
 const FALLBACK={
  'thunder-wave':{ailment:'paralysis',chance:100},'toxic':{ailment:'toxic',chance:100},'will-o-wisp':{ailment:'burn',chance:100},'poison-powder':{ailment:'poison',chance:75},'poison-gas':{ailment:'poison',chance:90},'sludge':{ailment:'poison',chance:30},'sludge-bomb':{ailment:'poison',chance:30},'poison-jab':{ailment:'poison',chance:30},'sleep-powder':{ailment:'sleep',chance:75},'hypnosis':{ailment:'sleep',chance:60},'sing':{ailment:'sleep',chance:55},'spore':{ailment:'sleep',chance:100},'dark-void':{ailment:'sleep',chance:50},'confuse-ray':{ailment:'confusion',chance:100},'supersonic':{ailment:'confusion',chance:55},'sweet-kiss':{ailment:'confusion',chance:75},'swagger':{ailment:'confusion',chance:100},'flatter':{ailment:'confusion',chance:100},
  'swords-dance':{stages:[['attack',2]],self:true},'howl':{stages:[['attack',1]],self:true},'sharpen':{stages:[['attack',1]],self:true},'meditate':{stages:[['attack',1]],self:true},'growl':{stages:[['attack',-1]]},'charm':{stages:[['attack',-2]]},'feather-dance':{stages:[['attack',-2]]},'tail-whip':{stages:[['defense',-1]]},'leer':{stages:[['defense',-1]]},'growl':{stages:[['attack',-1]]},'string-shot':{stages:[['speed',-2]]},'scary-face':{stages:[['speed',-2]]},'thunder-wave':{ailment:'paralysis',chance:100},'agility':{stages:[['speed',2]],self:true},'rock-polish':{stages:[['speed',2]],self:true},'double-team':{stages:[['evasion',1]],self:true},'minimize':{stages:[['evasion',2]],self:true},'sand-attack':{stages:[['accuracy',-1]]},'smokescreen':{stages:[['accuracy',-1]]},'flash':{stages:[['accuracy',-1]]},'screech':{stages:[['defense',-2]]},'iron-defense':{stages:[['defense',2]],self:true},'harden':{stages:[['defense',1]],self:true},'withdraw':{stages:[['defense',1]],self:true},'defense-curl':{stages:[['defense',1]],self:true},'amnesia':{stages:[['special-defense',2]],self:true},'calm-mind':{stages:[['special-attack',1],['special-defense',1]],self:true},'nasty-plot':{stages:[['special-attack',2]],self:true},'charge-beam':{stages:[['special-attack',1]],self:true},'metal-sound':{stages:[['special-defense',-2]]},'cotton-spore':{stages:[['speed',-2]]},'cotton-guard':{stages:[['defense',3]],self:true},'light-screen':{screen:'light'},'reflect':{screen:'reflect'},'aurora-veil':{screen:'both'},'rest':{ailment:'sleep',chance:100,self:true,heal:true}
 };
 const css=document.createElement('style');css.textContent=`.battle-status-line{display:flex;justify-content:center;gap:5px;flex-wrap:wrap;margin:4px 0}.battle-status-chip{font-size:10px;font-weight:800;padding:2px 7px;border-radius:999px;background:#3a4658;border:1px solid #8190a5;color:#fff}.battle-status-chip.burn{background:#713b27;border-color:#e58a52}.battle-status-chip.poison,.battle-status-chip.toxic{background:#59356c;border-color:#bd80df}.battle-status-chip.paralysis{background:#6a5b20;border-color:#e3ca57}.battle-status-chip.sleep,.battle-status-chip.freeze{background:#28556d;border-color:#7dc8ec}.battle-status-chip.confusion{background:#67435d;border-color:#d48ab8}.battle-stage-line{font-size:10px;color:#b9c9dc;text-align:center;margin-top:3px}.battle-screen-note{font-size:11px;color:#b7d7f4;margin:5px 0;text-align:center}`;document.head.append(css);
 const safeName=s=>String(s||'').toLowerCase().replace(/\s+/g,'-');
 const cap=s=>typeof window.cap==='function'?window.cap(s):String(s||'').replace(/(^|-)([a-z])/g,(_,a,b)=>b.toUpperCase());
 const getMoveData=async name=>{let key=safeName(name);if(moveCache.has(key))return moveCache.get(key);let p=fetch('https://pokeapi.co/api/v2/move/'+key).then(r=>{if(!r.ok)throw Error('move not found '+key);return r.json()});moveCache.set(key,p);try{return await p}catch(e){moveCache.delete(key);return null}};
 const sideOf=(mon,b)=>mon===b.enemy?'enemy':'player';
 const stagesFor=(mon,b)=>{b.statStages=b.statStages||{};let id=mon.uid||('enemy-'+(mon.id||mon.name));b.statStages[id]=b.statStages[id]||{};return b.statStages[id]};
 const stageMult=n=>n>=0?(2+n)/2:2/(2-n);
 const getStage=(mon,b,key)=>Number(stagesFor(mon,b)[key]||0);
 const stagedStat=(mon,b,key)=>{let base=Number(mon.stats?.[key]||50),stage=getStage(mon,b,key);return base*stageMult(stage)};
 const accuracyRatio=(attacker,defender,b)=>stageMult(getStage(attacker,b,'accuracy'))/stageMult(getStage(defender,b,'evasion'));
 const ensureBattle=(b)=>{b.statStages=b.statStages||{};b.screens=b.screens||{player:{},enemy:{}};b.participantUids=b.participantUids||[];};
 const mark=(mon,b)=>{if(mon?.uid&&b&&!b.participantUids.includes(mon.uid))b.participantUids.push(mon.uid)};
 const statusImmune=(target,status,moveName)=>{
  const types=target.types||[];
  if(status==='burn'&&types.includes('fire'))return 'Pokémon do tipo Fogo não pode ser queimado.';
  if((status==='poison'||status==='toxic')&&(types.includes('poison')||types.includes('steel')))return 'Esse Pokémon é imune a envenenamento.';
  if(status==='paralysis'&&types.includes('electric'))return 'Pokémon do tipo Elétrico é imune à paralisia.';
  if(status==='freeze'&&types.includes('ice'))return 'Pokémon do tipo Gelo não pode ser congelado.';
  if(['sleep','poison','toxic','paralysis','burn','freeze'].includes(status)&&target.status)return 'O alvo já possui uma condição de status.';
  if(status==='confusion'&&target.confusionTurns>0)return 'O alvo já está confuso.';
  if((moveName||'').includes('powder')&&types.includes('grass'))return 'Pokémon do tipo Planta é imune a movimentos de pó.';
  return '';
 };
 const applyAilment=(target,status,moveName)=>{
  const immune=statusImmune(target,status,moveName);if(immune)return {ok:false,message:immune};
  if(status==='confusion'){target.confusionTurns=2+Math.floor(Math.random()*3);return {ok:true,message:cap(target.name)+' ficou confuso!'};}
  target.status=status;
  if(status==='sleep')target.sleepTurns=moveName==='rest'?2:1+Math.floor(Math.random()*3);
  if(status==='toxic')target.toxicCounter=0;
  return {ok:true,message:cap(target.name)+' ficou '+(STATUS_LABEL[status]||status)+'!'};
 };
 const changeStage=(mon,b,key,delta)=>{
  if(!STATS.includes(key))return '';
  let stages=stagesFor(mon,b),old=Number(stages[key]||0),next=Math.max(-6,Math.min(6,old+delta));
  if(next===old)return cap(mon.name)+' não teve alteração: '+STAT_PT[key]+' já está no limite.';
  stages[key]=next;let verb=next>old?'aumentou':'diminuiu',degree=Math.abs(delta)>=2?' bastante':'';
  return STAT_PT[key]+' de '+cap(mon.name)+' '+verb+degree+'!';
 };
 const resolveMoveEffect=async(name)=>{
  const data=await getMoveData(name),fb=FALLBACK[safeName(name)]||{};
  let ailment=data?.meta?.ailment?.name;
  if(!ailment||ailment==='none')ailment=fb.ailment||null;
  if(ailment==='paralysis')ailment='paralysis';if(ailment==='poison'&&safeName(name)==='toxic')ailment='toxic';
  const rawChance=data?.meta?.ailment_chance;const chance=rawChance>0?rawChance:(fb.chance??(ailment&&data?.damage_class?.name==='status'?100:0));
  let stages=[];
  if(data?.stat_changes?.length){stages=data.stat_changes.map(x=>[x.stat.name,x.change]);}
  if(!stages.length&&fb.stages)stages=fb.stages;
  const target=data?.target?.name||'';
  let self=fb.self===true||/user|users-field|users-side/.test(target);
  if(['swords-dance','agility','rock-polish','double-team','minimize','iron-defense','harden','withdraw','defense-curl','amnesia','calm-mind','nasty-plot','cotton-guard','howl','sharpen','meditate'].includes(safeName(name)))self=true;
  let screen=fb.screen||(['light-screen','reflect','aurora-veil'].includes(safeName(name))?({ 'light-screen':'light','reflect':'reflect','aurora-veil':'both'}[safeName(name)]):null);
  const rawStatChance=data?.meta?.stat_chance;const statChance=rawStatChance>0?rawStatChance:(stages.length?100:(data?.damage_class?.name==='status'?100:0));
  const ailmentSelf=fb.ailmentSelf===true||(!!ailment&&(fb.self===true||/user|users-field/.test(target)));
  return {data,ailment,chance,stages,self,screen,statChance,ailmentSelf,heal:fb.heal===true};
 };
 const getCurrentEnemy=b=>b.enemy;
 const effectiveDamage=(attacker,defender,move,b,screenSide)=>{
  const physical=move.damageClass==='physical'||move.damageClass==='physical'&&move.damageClass!=='special';
  let attack=stagedStat(attacker,b,physical?'attack':'special-attack'),defense=stagedStat(defender,b,physical?'defense':'special-defense');
  if(attacker.status==='burn'&&physical)attack*=.5;
  const types=attacker.types||[],defTypes=defender.types||[];let mult=typeof window.multiplier==='function'?window.multiplier(move.type,defTypes):1;
  if(!move.power||mult===0)return {damage:0,mult};
  const stab=types.includes(move.type)?1.5:1;
  let damage=Math.floor((((2*attacker.level/5+2)*move.power*Math.max(1,attack)/Math.max(1,defense))/50+2)*stab*mult*(.85+Math.random()*.15));
  const screens=b.screens?.[screenSide]||{};
  if((physical&&screens.reflect>0)||(!physical&&screens.light>0))damage=Math.floor(damage*.5);
  if(screens.aurora>0)damage=Math.floor(damage*.5);
  return {damage:mult===0?0:Math.max(1,damage),mult};
 };
 const canAct=async(mon,move,b)=>{
  if(mon.flinchTurns>0){mon.flinchTurns=0;return {ok:false,message:cap(mon.name)+' recuou e perdeu a ação!'};}
  if(mon.status==='sleep'){
   if((mon.sleepTurns||0)>0){mon.sleepTurns--;return {ok:false,message:cap(mon.name)+' continua dormindo e perdeu o turno.'};}
   mon.status=null;return {ok:true,message:cap(mon.name)+' acordou!'};
  }
  if(mon.status==='freeze'){
   if(move?.type==='fire'||Math.random()<.2){mon.status=null;return {ok:true,message:cap(mon.name)+' descongelou!'};}
   return {ok:false,message:cap(mon.name)+' está congelado e não conseguiu se mover.'};
  }
  if(mon.status==='paralysis'&&Math.random()<.25)return {ok:false,message:cap(mon.name)+' está paralisado e não conseguiu se mover!'};
  if(mon.confusionTurns>0){mon.confusionTurns--;if(Math.random()<1/3){let pseudo={name:'confusão',power:40,type:'normal',damageClass:'physical'};let d=effectiveDamage(mon,mon,pseudo,b,sideOf(mon,b));mon.hp=Math.max(0,mon.hp-d.damage);if(mon===b.enemy)b.enemyHp=mon.hp;return {ok:false,message:cap(mon.name)+' se atingiu por causa da confusão e perdeu '+d.damage+' HP!'};}if(mon.confusionTurns===0)return {ok:true,message:cap(mon.name)+' deixou de ficar confuso.'};}
  return {ok:true,message:''};
 };
 const applyMoveEffects=async(user,target,move,b,hitDamage,moveData)=>{
  const lines=[],name=safeName(move.name),eff=await resolveMoveEffect(move.name),statusChance=Math.random()*100;
  if(eff.screen){let side=sideOf(user,b),bucket=b.screens[side]||(b.screens[side]={});if(eff.screen==='light'){bucket.light=5;lines.push('Light Screen protege a equipe contra ataques especiais por 5 turnos!');}if(eff.screen==='reflect'){bucket.reflect=5;lines.push('Reflect protege a equipe contra ataques físicos por 5 turnos!');}if(eff.screen==='both'){bucket.aurora=5;lines.push('Aurora Veil reduz o dano recebido por 5 turnos!');}}
  if(eff.stages.length&&Math.random()*100<eff.statChance){let recipient=eff.self?user:target;for(const [stat,delta] of eff.stages){let line=changeStage(recipient,b,stat,delta);if(line)lines.push(line);}}
  const hasHit=move.power?hitDamage>0:true;
  if(eff.heal){user.hp=user.maxHp;user.status=null;user.sleepTurns=0;user.toxicCounter=0;lines.push(cap(user.name)+' recuperou todo o HP e descansou!');}
  if(eff.ailment&&hasHit&&statusChance<eff.chance){const ailmentTarget=eff.ailmentSelf?user:target;const result=applyAilment(ailmentTarget,eff.ailment,name);if(result.ok)lines.push(result.message);else if(!move.power)lines.push(result.message);}
  const flinchChance=Number(eff.data?.meta?.flinch_chance||0);if(hitDamage>0&&flinchChance>0&&Math.random()*100<flinchChance){target.flinchTurns=1;lines.push(cap(target.name)+' recuou!');}
  return lines;
 };
 const endTurnEffects=(b)=>{
  const lines=[];
  for(const [mon,side] of [[activeMon(), 'player'],[b.enemy,'enemy']]){
   if(!mon||mon.hp<=0)continue;
   let fraction=0,label='';
   if(mon.status==='burn'){fraction=1/16;label=cap(mon.name)+' sofre com a queimadura!';}
   else if(mon.status==='poison'){fraction=1/8;label=cap(mon.name)+' sofre com o veneno!';}
   else if(mon.status==='toxic'){mon.toxicCounter=Math.min(15,(mon.toxicCounter||0)+1);fraction=mon.toxicCounter/16;label=cap(mon.name)+' sofre com o envenenamento grave!';}
   if(fraction){let dmg=Math.max(1,Math.floor(mon.maxHp*fraction));mon.hp=Math.max(0,mon.hp-dmg);if(mon===b.enemy)b.enemyHp=Math.max(0,b.enemyHp-dmg);lines.push(label+' Perdeu '+dmg+' HP.');}
  }
  for(const side of ['player','enemy'])for(const key of ['light','reflect','aurora'])if(b.screens?.[side]?.[key]>0)b.screens[side][key]--;
  if(activeMon())activeMon().flinchTurns=0;if(b.enemy)b.enemy.flinchTurns=0;
  return lines;
 };
 const effectiveSpeed=(mon,b)=>{let speed=stagedStat(mon,b,'speed');if(mon.status==='paralysis')speed*=.5;return speed;};
 const nextTurn=(b)=>{b.turn='player';b.turnNumber=(b.turnNumber||1)+1;b.roundOrderChecked=false;b.enemyFirstDone=false;b.enemyFirstPending=false;};
 const forceSwitchIfNeeded=(b,mon,side)=>{
  if(mon.hp>0)return false;
  if(side==='enemy')return true;
  const next=state.party.find(x=>x.hp>0&&x.uid!==mon.uid);
  if(next){b.turn='switch';b.log+=' '+cap(mon.name)+' foi derrotado. Escolha outro Pokémon.';return true;}
  state.losses=(state.losses||0)+1;const result=typeof window.makeResult==='function'?window.makeResult(b,false,'Equipe derrotada','Todos os seus Pokémon foram derrotados.',0,0):null;
  if(result&&typeof window.displayResult==='function')window.displayResult(result);else{state.activeBattle=null;save(true);setPage('battle');}
  return true;
 };
 window.playerMove=async function(index){
  const b=state.activeBattle;if(!b||b.turn!=='player'||b.actionBusy)return;
  const user=activeMon(),move=user?.moves?.[index];if(!user||!move||move.pp<=0)return;
  ensureBattle(b);mark(user,b);
  if(!b.roundOrderChecked){b.roundOrderChecked=true;if(effectiveSpeed(b.enemy,b)>effectiveSpeed(user,b)){b.enemyFirstPending=true;b.turn='enemy';await window.enemyTurn();if(state.activeBattle===b&&b.turn==='player')return window.playerMove(index);return;}}
  b.actionBusy=true;b.turn='processing';
  const zPending=b.zMovePending&&b.zMovePending.index===index?b.zMovePending:null;
  try{
   const gate=await canAct(user,move,b);if(!gate.ok){b.log=gate.message;if(user.hp<=0){forceSwitchIfNeeded(b,user,'player');save(true);renderBattle();return;}if(b.enemyFirstDone){const residual=endTurnEffects(b);if(residual.length)b.log+=' '+residual.join(' ');if(forceSwitchIfNeeded(b,user,'player')){save(true);renderBattle();return;}if(b.enemyHp<=0){await window.finishOpponent();return;}nextTurn(b);save(true);renderBattle();}else{b.turn='enemy';renderBattle();await window.enemyTurn();}return;}
   let message=gate.message?gate.message+' ':'';move.pp--;
   let hit=false,damage=0,md=await getMoveData(move.name);
   const accuracy=Number(move.accuracy??md?.accuracy??100);
   const accRatio=accuracyRatio(user,b.enemy,b);
   if(Math.random()*100>accuracy*accRatio){message+=cap(user.name)+' usou '+cap(move.name)+', mas errou!';}
   else{
    hit=true;
    if(move.power){const d=effectiveDamage(user,b.enemy,move,b,'enemy');damage=d.damage;b.enemyHp=Math.max(0,b.enemyHp-damage);b.enemy.hp=b.enemyHp;message+=cap(user.name)+' usou '+cap(move.name)+' e causou '+damage+' de dano.';if(d.mult>1)message+=' Foi super efetivo!';if(d.mult===0)message+=' Não afetou o adversário.';else if(d.mult<1)message+=' Não foi muito efetivo!';}
    else message+=cap(user.name)+' usou '+cap(move.name)+'!';
    const lines=await applyMoveEffects(user,b.enemy,move,b,damage,md);if(lines.length)message+=' '+lines.join(' ');
   }
   b.log=message;
   if(b.enemyHp<=0){await window.finishOpponent();return;}
   if(b.enemyFirstDone){const residual=endTurnEffects(b);if(residual.length)b.log+=' '+residual.join(' ');if(forceSwitchIfNeeded(b,user,'player')){save(true);renderBattle();return;}if(b.enemyHp<=0){await window.finishOpponent();return;}nextTurn(b);save(true);renderBattle();}else{b.turn='enemy';renderBattle();await window.enemyTurn();}
  }catch(e){console.error('Falha no motor de efeitos (jogador):',e);if(state.activeBattle===b){b.turn='player';b.log='O movimento não pôde ser concluído. Tente novamente.';save(true);renderBattle();}}
  finally{if(zPending){move.power=zPending.oldPower;b.zMovePending=null;}b.actionBusy=false;}
 };
 window.enemyTurn=async function(){
  const b=state.activeBattle;if(!b||b.enemyBusy||b.turn==='switch')return;
  const enemy=b.enemy,user=activeMon();if(!enemy||!user)return;ensureBattle(b);mark(user,b);b.enemyBusy=true;b.turn='processing-enemy';
  try{
   const choices=(enemy.moves||[]).filter(x=>x.pp>0),move=choices[Math.floor(Math.random()*choices.length)]||enemy.moves?.[0];
   if(!move){b.log+=' '+cap(enemy.name)+' não possui movimentos disponíveis.';nextTurn(b);save(true);renderBattle();return;}
   const gate=await canAct(enemy,move,b);let message=gate.message?gate.message+' ':'';
   if(gate.ok){move.pp--;let md=await getMoveData(move.name),accuracy=Number(move.accuracy??md?.accuracy??100),accRatio=accuracyRatio(enemy,user,b),damage=0;
    if(Math.random()*100>accuracy*accRatio)message+=cap(enemy.name)+' usou '+cap(move.name)+', mas errou!';
    else{
     if(move.power){const d=effectiveDamage(enemy,user,move,b,'player');damage=d.damage;if(b.kind==='wild'&&damage>0)damage=Math.max(1,Math.floor(damage*.6));user.hp=Math.max(0,user.hp-damage);message+=cap(enemy.name)+' usou '+cap(move.name)+' e causou '+damage+' de dano.';if(d.mult>1)message+=' Foi super efetivo!';if(d.mult===0)message+=' Não teve efeito.';else if(d.mult<1)message+=' Não foi muito efetivo!';}
     else message+=cap(enemy.name)+' usou '+cap(move.name)+'!';
     const lines=await applyMoveEffects(enemy,user,move,b,damage,md);if(lines.length)message+=' '+lines.join(' ');
    }
   }
   b.log+=(b.log?' ':'')+message;
   if(b.enemyHp<=0){await window.finishOpponent();return;}
   if(b.enemyFirstPending){b.enemyFirstPending=false;b.enemyFirstDone=true;if(forceSwitchIfNeeded(b,user,'player')){save(true);renderBattle();return;}b.turn='player';save(true);renderBattle();return;}
   if(forceSwitchIfNeeded(b,user,'player')){save(true);renderBattle();return;}
   if(b.enemyHp<=0){await window.finishOpponent();return;}
   const residual=endTurnEffects(b);if(residual.length)b.log+=' '+residual.join(' ');
   if(forceSwitchIfNeeded(b,user,'player')){save(true);renderBattle();return;}
   if(b.enemyHp<=0){await window.finishOpponent();return;}
   nextTurn(b);save(true);renderBattle();
  }catch(e){console.error('Falha no motor de efeitos (adversário):',e);if(state.activeBattle===b){nextTurn(b);b.log+=' O turno adversário foi encerrado após uma falha.';save(true);renderBattle();}}
  finally{b.enemyBusy=false;}
 };
 const battleCleanup=(b)=>{
  if(!b||state.activeBattle)return;
  if(b.megaOriginal){const mon=[...(state.party||[]),...(state.pc||[])].find(x=>x.uid===b.megaOriginal.uid);if(mon)Object.assign(mon,b.megaOriginal.data);b.megaOriginal=null;}
  if(b.zStatOriginal){const mon=[...(state.party||[]),...(state.pc||[])].find(x=>x.uid===b.zStatOriginal.uid);if(mon)mon.stats=b.zStatOriginal.stats;b.zStatOriginal=null;}
  for(const mon of [...(state.party||[]),...(state.pc||[])]){mon.confusionTurns=0;mon.flinchTurns=0;}
  if(b.kind==='mega-trial'&&state.megaTrialBackup){if(state.battleResult){state.battleResult.megaTrialUid=b.megaTrialUid;state.battleResult.megaTrialStone=b.megaTrialStone;}state.party=state.megaTrialBackup;state.megaTrialBackup=null;state.megaTrialStone=null;state.megaTrialUid=null;save(true);if(typeof render==='function')render();}
 };
 const oldDisplayResult=window.displayResult;if(oldDisplayResult)window.displayResult=function(r){const b=state.activeBattle;const result=oldDisplayResult(r);battleCleanup(b);return result;};
 const playerMoveCore=window.playerMove,enemyTurnCore=window.enemyTurn;
 window.playerMove=async function(i){const b=state.activeBattle;await playerMoveCore(i);battleCleanup(b);};
 window.enemyTurn=async function(){const b=state.activeBattle;await enemyTurnCore();battleCleanup(b);};
 const oldRender=window.renderBattle;
 window.renderBattle=function(){oldRender();const b=state.activeBattle,host=document.getElementById('battleMount');if(!b||!host)return;ensureBattle(b);
  const add=(selector,mon)=>{const node=host.querySelector(selector+' .name');if(!node||!mon)return;node.querySelector('.battle-status-line')?.remove();node.querySelector('.battle-stage-line')?.remove();const chips=[];if(mon.status)chips.push(`<span class="battle-status-chip ${mon.status}">${STATUS_LABEL[mon.status]||mon.status}</span>`);if(mon.confusionTurns>0)chips.push('<span class="battle-status-chip confusion">Confuso</span>');const stages=stagesFor(mon,b),stageText=STATS.filter(k=>stages[k]).map(k=>`${STAT_PT[k]} ${stages[k]>0?'+':''}${stages[k]}`).join(' · ');if(chips.length){const line=document.createElement('div');line.className='battle-status-line';line.innerHTML=chips.join('');node.append(line);}if(stageText){const line=document.createElement('div');line.className='battle-stage-line';line.textContent=stageText;node.append(line);}};
  add('.combatant:not(.enemy)',activeMon());add('.combatant.enemy',b.enemy);
  const notes=[];for(const side of ['player','enemy']){const s=b.screens[side]||{};if(s.light>0)notes.push((side==='player'?'Sua equipe':'Equipe adversária')+' · Light Screen '+s.light);if(s.reflect>0)notes.push((side==='player'?'Sua equipe':'Equipe adversária')+' · Reflect '+s.reflect);if(s.aurora>0)notes.push((side==='player'?'Sua equipe':'Equipe adversária')+' · Aurora Veil '+s.aurora);}if(notes.length){const log=host.querySelector('.log');if(log)log.insertAdjacentHTML('beforebegin','<div class="battle-screen-note">'+notes.map(x=>x.replace(/</g,'&lt;')).join(' · ')+'</div>');}
 };
 // O Centro Pokémon remove todas as condições e dados voláteis; status não vaza para uma batalha nova.
 const oldHeal=window.healParty;window.healParty=function(){state.party.forEach(m=>{m.status=null;m.sleepTurns=0;m.toxicCounter=0;m.confusionTurns=0;});if(oldHeal)oldHeal();};
})();
