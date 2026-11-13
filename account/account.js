/* Pokémon Jornada — Contas online (ETAPA 1: cadastro, login, sessão, sair • ETAPA 2: sincronização do save)
   Este arquivo é carregado DEPOIS de todos os scripts do jogo e não altera nenhuma
   regra do jogo. O salvamento local do jogo continua exatamente como era. */
(function () {
  'use strict';
  const CFG = window.PJ_CONFIG || {};
  const SESSION_KEY = 'pj_session_v1';
  const REVOKE_KEY = 'pj_revoke_v1';          // tokens cujo "sair" não chegou ao servidor
  const RPC_URL = String(CFG.SUPABASE_URL || '').replace(/\/+$/, '') + '/rest/v1/rpc/';
  const NAME_RE = /^[A-Za-z0-9À-ÖØ-öø-ÿ_. -]+$/;
  const HAS_ALNUM = /[A-Za-z0-9À-ÖØ-öø-ÿ]/;

  let session = null;          // { token, username, playerId }
  let online = true;           // último resultado de contato com o servidor
  let gate = null;
  let revalidateTimer = null;

  /* ---------- armazenamento (tolerante a falhas) ---------- */
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function loadSession() {
    try {
      const s = JSON.parse(store.get(SESSION_KEY) || 'null');
      return s && typeof s.token === 'string' && s.token.length >= 32 ? s : null;
    } catch (e) { return null; }
  }
  function saveSession(s) { session = s; store.set(SESSION_KEY, JSON.stringify(s)); }
  function clearSession() { session = null; store.del(SESSION_KEY); }

  /* ---------- chamadas ao servidor (funções RPC do Supabase) ---------- */
  async function rpc(fn, args, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 12000);
    try {
      const res = await fetch(RPC_URL + fn, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': CFG.SUPABASE_KEY },
        body: JSON.stringify(args || {}),
        signal: ctrl.signal
      });
      let body = null;
      try { body = await res.json(); } catch (e) {}
      if (!res.ok) {
        const notConfigured = res.status === 404 || (body && body.code === 'PGRST202');
        return {
          ok: false, error: 'server_error', status: res.status,
          message: notConfigured
            ? 'O servidor ainda não foi configurado (execute o arquivo SQL no Supabase).'
            : 'O servidor respondeu com um erro (' + res.status + '). Tente novamente em instantes.'
        };
      }
      if (!body || typeof body !== 'object') return { ok: false, error: 'server_error', message: 'Resposta inesperada do servidor.' };
      online = true;
      return body;
    } catch (e) {
      online = false;
      return { ok: false, error: 'network', message: 'Sem conexão com o servidor. Verifique sua internet e tente novamente.' };
    } finally { clearTimeout(timer); }
  }

  /* ---------- validações (espelham as do servidor; o servidor é quem decide) ---------- */
  function checkName(n) {
    n = n.trim();
    if (!n) return 'Digite um nome de jogador.';
    if (n.length < 3 || n.length > 20 || !NAME_RE.test(n) || !HAS_ALNUM.test(n) || /  /.test(n))
      return 'Nome inválido. Use de 3 a 20 caracteres: letras, números, espaço, ponto, hífen ou sublinhado.';
    return '';
  }

  /* ---------- bloqueio do jogo enquanto não há login ---------- */
  const GAME_SELECTORS = ['header', '.layout', 'footer', '#modalRoot'];
  function lockGame(on) {
    document.documentElement.classList.toggle('pj-locked', on);
    GAME_SELECTORS.forEach(sel => document.querySelectorAll(sel).forEach(n => {
      if (on) n.setAttribute('inert', ''); else n.removeAttribute('inert');
    }));
  }

  /* ---------- tela de login/cadastro ---------- */
  function ensureGate() {
    if (gate && gate.isConnected) return gate;
    gate = document.createElement('div');
    gate.id = 'pjGate';
    gate.setAttribute('role', 'dialog');
    gate.setAttribute('aria-modal', 'true');
    gate.setAttribute('aria-labelledby', 'pjTitle');
    gate.innerHTML =
      '<div class="pj-wrap">' +
      '<div class="brand pj-brand"><div class="ball"></div><div>POKÉMON JORNADA <div class="muted small" style="letter-spacing:0;font-weight:500">Alola • RPG de navegador • projeto de fã</div></div></div>' +
      '<section class="hero"><div><h1 id="pjTitle"></h1><p id="pjSub"></p></div><div class="heroicon">🧢</div></section>' +
      '<div class="panel pj-card" id="pjCard"></div>' +
      '<p class="small muted pj-foot">Projeto de fã não oficial. Sua senha nunca é guardada em texto puro.</p>' +
      '</div>';
    document.body.appendChild(gate);
    lockGame(true);
    return gate;
  }
  function closeGate() {
    if (gate) { gate.remove(); gate = null; }
    lockGame(false);
  }
  function setHero(title, sub) {
    gate.querySelector('#pjTitle').textContent = title;
    gate.querySelector('#pjSub').textContent = sub;
  }
  function msgBox(card, kind, text) {
    let m = card.querySelector('.pj-msg');
    if (!text) { if (m) m.remove(); return; }
    if (!m) {
      m = document.createElement('p');
      m.setAttribute('role', 'alert');
      const form = card.querySelector('form');
      form.insertBefore(m, form.firstChild);
    }
    m.className = 'pj-msg ' + kind;
    m.textContent = text;
  }

  function showLoading(text) {
    ensureGate();
    setHero('Pokémon Jornada', 'Carregando sua conta…');
    gate.querySelector('#pjCard').innerHTML =
      '<div class="pj-loading"><div class="pj-spin"></div><div>' + text + '</div></div>';
  }

  function passField(id, label, autocomplete) {
    return '<div><label class="small muted" for="' + id + '">' + label + '</label>' +
      '<div class="pj-pass"><input class="field" id="' + id + '" type="password" autocomplete="' + autocomplete + '" maxlength="72" required>' +
      '<button type="button" data-toggle="' + id + '" aria-label="Mostrar senha">Mostrar</button></div></div>';
  }
  function wireToggles(card) {
    card.querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => {
      const input = card.querySelector('#' + b.dataset.toggle);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.textContent = show ? 'Ocultar' : 'Mostrar';
      b.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
    });
  }
  function tabs(active) {
    return '<div class="pj-tabs" role="tablist">' +
      '<button type="button" role="tab" data-tab="login" class="' + (active === 'login' ? 'active' : '') + '">Entrar</button>' +
      '<button type="button" role="tab" data-tab="register" class="' + (active === 'register' ? 'active' : '') + '">Criar conta</button></div>';
  }

  function showLogin(notice) {
    ensureGate();
    setHero('Entrar na sua jornada', 'Use sua conta de treinador para continuar de onde parou.');
    const card = gate.querySelector('#pjCard');
    card.innerHTML = tabs('login') +
      '<form id="pjLoginForm" novalidate>' +
      '<div><label class="small muted" for="pjLName">Nome do jogador</label>' +
      '<input class="field" id="pjLName" type="text" autocomplete="username" maxlength="20" autocapitalize="none" spellcheck="false" required></div>' +
      passField('pjLPass', 'Senha', 'current-password') +
      '<button class="primary" type="submit" id="pjLBtn">Entrar</button>' +
      '<div class="small muted pj-center">Ainda não tem conta? <button type="button" class="pj-link" data-tab="register">Criar conta</button></div>' +
      '</form>';
    wireToggles(card);
    card.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => (b.dataset.tab === 'register' ? showRegister() : showLogin()));
    if (notice) msgBox(card, notice.kind, notice.text);
    const form = card.querySelector('form');
    const nameI = card.querySelector('#pjLName'), passI = card.querySelector('#pjLPass'), btn = card.querySelector('#pjLBtn');
    form.onsubmit = async ev => {
      ev.preventDefault();
      if (btn.disabled) return;
      const name = nameI.value.trim(), pass = passI.value;
      if (!name || !pass) { msgBox(card, 'error', 'Digite o nome do jogador e a senha.'); return; }
      btn.disabled = true; btn.textContent = 'Entrando…'; msgBox(card, '', '');
      const r = await rpc('pj_login', { p_username: name, p_password: pass });
      btn.disabled = false; btn.textContent = 'Entrar';
      if (!r.ok) { msgBox(card, r.error === 'too_many_attempts' ? 'warn' : 'error', r.message || 'Não foi possível entrar.'); passI.value = ''; passI.focus(); return; }
      passI.value = '';
      onAuthenticated(r);
    };
    nameI.focus();
  }

  function showRegister(notice) {
    ensureGate();
    setHero('Criar sua conta', 'Escolha um nome de treinador exclusivo e uma senha para guardar sua jornada.');
    const card = gate.querySelector('#pjCard');
    card.innerHTML = tabs('register') +
      '<form id="pjRegForm" novalidate>' +
      '<div><label class="small muted" for="pjRName">Nome do jogador</label>' +
      '<input class="field" id="pjRName" type="text" autocomplete="username" maxlength="20" autocapitalize="none" spellcheck="false" required>' +
      '<p class="small muted pj-hint">3 a 20 caracteres. Maiúsculas e minúsculas contam como o mesmo nome.</p></div>' +
      passField('pjRPass', 'Senha (mínimo de 8 caracteres)', 'new-password') +
      passField('pjRPass2', 'Confirmar senha', 'new-password') +
      '<button class="primary" type="submit" id="pjRBtn">Criar conta</button>' +
      '<div class="small muted pj-center">Já tem conta? <button type="button" class="pj-link" data-tab="login">Entrar</button></div>' +
      '</form>';
    wireToggles(card);
    card.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => (b.dataset.tab === 'register' ? showRegister() : showLogin()));
    if (notice) msgBox(card, notice.kind, notice.text);
    const form = card.querySelector('form');
    const nameI = card.querySelector('#pjRName'), p1 = card.querySelector('#pjRPass'), p2 = card.querySelector('#pjRPass2'), btn = card.querySelector('#pjRBtn');
    [nameI, p1, p2].forEach(i => i.addEventListener('input', () => i.classList.remove('invalid')));
    form.onsubmit = async ev => {
      ev.preventDefault();
      if (btn.disabled) return;
      const name = nameI.value.trim(), a = p1.value, b = p2.value;
      let err = checkName(name), bad = nameI;
      if (!err && a.length < 8) { err = 'A senha precisa ter pelo menos 8 caracteres.'; bad = p1; }
      if (!err && a !== b) { err = 'A confirmação de senha não confere.'; bad = p2; }
      if (err) { msgBox(card, 'error', err); bad.classList.add('invalid'); bad.focus(); return; }
      btn.disabled = true; btn.textContent = 'Criando conta…'; msgBox(card, '', '');
      const r = await rpc('pj_register', { p_username: name, p_password: a, p_confirm: b });
      btn.disabled = false; btn.textContent = 'Criar conta';
      if (!r.ok) {
        msgBox(card, r.error === 'too_many_attempts' ? 'warn' : 'error', r.message || 'Não foi possível criar a conta.');
        if (r.error === 'name_taken' || r.error === 'invalid_username') { nameI.classList.add('invalid'); nameI.focus(); }
        return;
      }
      p1.value = p2.value = '';
      onAuthenticated(r);
    };
    nameI.focus();
  }

  /* =====================================================================
     ETAPA 2 — Sincronização do save com a nuvem
     O jogo continua salvando em localStorage (chave SAVE) como sempre. Este módulo:
       - observa cada save() do jogo e envia a cópia para a nuvem (com atraso/fila/novas tentativas);
       - ao entrar, compara save local x nuvem e NUNCA sobrescreve sem decisão segura;
       - guarda cópias de segurança locais antes de qualquer substituição.
     ===================================================================== */
  const SLOT = 'pokemon_jornada_save_v2';        // mesmo slot usado pelo jogo
  const META_KEY = 'pj_sync_v1';                 // { owner, base, dirty, at }
  const STASH_PREFIX = 'pj_stash_v1_';           // save local de outra conta neste navegador
  const BACKUPS_KEY = 'pj_local_backups_v1';     // cópias de segurança antes de substituir o save local
  const PUSH_DELAY = 2500;

  let syncReady = false;       // reconciliação concluída para a sessão atual
  let syncPaused = false;      // jogador escolheu "decidir depois"
  let deciding = false;        // há uma caixa de decisão aberta
  let pushing = false, pushAgain = false, pushTimer = null, retryTimer = null, retryN = 0;
  let syncStatus = 'idle';     // idle | synced | syncing | pending | offline | paused | conflict | error
  let lastSyncAt = null;

  const getMeta = () => { try { return JSON.parse(store.get(META_KEY) || '{}') || {}; } catch (e) { return {}; } };
  const setMeta = m => store.set(META_KEY, JSON.stringify(m));
  const slotRaw = () => store.get(SLOT);
  function parseSave(raw) { try { const o = JSON.parse(raw); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch (e) { return null; } }
  function hasProgress(raw) { const o = raw && parseSave(raw); return !!(o && o.started && Array.isArray(o.party) && o.party.length); }
  function summarize(o) {
    if (!o) return null;
    return { trainer: o.name, level: o.trainerLevel, money: o.money, party: (o.party || []).length, stored: (o.pc || []).length, started: !!o.started };
  }
  function backupLocal(raw, reason) {
    if (!raw) return;
    let list = []; try { list = JSON.parse(store.get(BACKUPS_KEY) || '[]'); } catch (e) {}
    if (!Array.isArray(list)) list = [];
    if (list.some(b => b.raw === raw)) return;
    list.push({ at: new Date().toISOString(), reason, raw });
    while (list.length > 3) list.shift();
    if (!store.set(BACKUPS_KEY, JSON.stringify(list))) { list = list.slice(-1); store.set(BACKUPS_KEY, JSON.stringify(list)); }
  }
  function stable(v) {   // JSON com chaves ordenadas (o servidor reordena as chaves do jsonb)
    const norm = x => Array.isArray(x) ? x.map(norm) : x && typeof x === 'object' ? Object.keys(x).sort().reduce((o, k) => (o[k] = norm(x[k]), o), {}) : x;
    try { return JSON.stringify(norm(v)); } catch (e) { return ''; }
  }
  const deviceLabel = () => (navigator.userAgentData && navigator.userAgentData.platform) || (navigator.platform || 'navegador');

  function setStatus(s) { syncStatus = s; updateAccountUI(); }
  const STATUS_TEXT = {
    idle: ['', 'Conectado ao servidor'], synced: ['Salvo na nuvem', 'Progresso sincronizado com a nuvem'],
    syncing: ['Sincronizando…', 'Enviando progresso para a nuvem'], pending: ['Pendente', 'Alterações salvas neste navegador, aguardando envio'],
    offline: ['Offline', 'Sem conexão — o progresso está salvo neste navegador e será enviado quando a internet voltar'],
    paused: ['Sync pausada', 'Sincronização pausada: use "Sincronizar agora" no Perfil'],
    conflict: ['Decisão pendente', 'O save local e o da nuvem diferem'], error: ['Erro ao sincronizar', 'Falha ao sincronizar; nova tentativa em breve']
  };

  /* ----- envio (push) ----- */
  function schedulePush(delay) {
    if (!session || !syncReady || syncPaused || deciding) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => doPush(), delay == null ? PUSH_DELAY : delay);
  }
  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryN = Math.min(retryN + 1, 5);
    retryTimer = setTimeout(() => { if (getMeta().dirty) doPush(); }, Math.min(60000, 4000 * Math.pow(2, retryN - 1)));
  }
  async function doPush(opts) {
    opts = opts || {};
    if (!session) return 'auth';
    if (pushing) { pushAgain = true; return 'busy'; }
    const raw = slotRaw(), data = raw && parseSave(raw);
    if (!data) return 'empty';
    pushing = true; setStatus('syncing');
    const meta = getMeta();
    const base = opts.base != null ? opts.base : (meta.owner === session.playerId ? Number(meta.base) || 0 : 0);
    let r;
    try { r = await rpc('pj_put_save', { p_token: session.token, p_data: data, p_base_revision: base, p_force: !!opts.force, p_device: deviceLabel() }, 20000); }
    finally { pushing = false; }
    if (r.ok) {
      retryN = 0; lastSyncAt = Date.now();
      const changed = slotRaw() !== raw;
      setMeta({ owner: session.playerId, base: r.revision, dirty: changed, at: lastSyncAt });
      setStatus(changed ? 'pending' : 'synced');
      if (pushAgain || changed) { pushAgain = false; schedulePush(800); }
      return 'ok';
    }
    pushAgain = false;
    if (r.error === 'conflict') {
      setStatus('conflict');
      if (!opts.inDialog) resolveConflict({ revision: r.revision, updated_at: r.updated_at, summary: r.summary }, 'changed');
      return 'conflict';
    }
    if (r.error === 'invalid_session') {
      setStatus('pending'); expireSession(); return 'auth';
    }
    setStatus(r.error === 'network' ? 'offline' : 'error');
    scheduleRetry();
    return r.error === 'network' ? 'offline' : 'error';
  }
  function expireSession() {
    stopPresence(); stopRevalidate(); clearSession(); unmountAccountUI(); syncReady = false;
    showLogin({ kind: 'warn', text: 'Sua sessão expirou. Entre novamente — seu progresso local foi preservado e será sincronizado.' });
  }

  /* ----- observa os saves do jogo (sem alterar a lógica do jogo) ----- */
  const gameSave = window.save;
  if (typeof gameSave === 'function') {
    window.save = function () {
      const out = gameSave.apply(this, arguments);
      try {
        const m = getMeta();
        if (session && m.owner === session.playerId) {
          if (!m.dirty) setMeta({ ...m, dirty: true });
          if (syncReady && !syncPaused) { setStatus(online ? 'pending' : 'offline'); schedulePush(); }
        }
      } catch (e) {}
      return out;
    };
  }
  // antes de "importar" ou "apagar" no jogo, guarda cópia local de segurança
  ['importSave', 'resetGame'].forEach(fn => {
    const orig = window[fn];
    if (typeof orig === 'function') window[fn] = function () { try { backupLocal(slotRaw(), fn); } catch (e) {} return orig.apply(this, arguments); };
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && getMeta().dirty && syncReady && !syncPaused) { clearTimeout(pushTimer); doPush(); } });
  window.addEventListener('pagehide', () => { if (getMeta().dirty && syncReady && !syncPaused) doPush(); });

  /* ----- decisões do jogador (nunca sobrescreve sozinho) ----- */
  function sumHtml(title, s, extra) {
    if (!s) return '<div class="small muted">sem dados</div>';
    return '<div class="pj-sum"><b>' + esc(title) + '</b><div class="small muted">' +
      'Treinador <b>' + esc(s.trainer == null ? '—' : s.trainer) + '</b> · Nível ' + esc(s.level == null ? '—' : s.level) +
      ' · ₽ ' + esc(s.money == null ? '—' : s.money) + '<br>Equipe: ' + esc(s.party) + ' · PC: ' + esc(s.stored) + (extra ? '<br>' + esc(extra) : '') + '</div></div>';
  }
  const fmtDate = d => { try { return new Date(d).toLocaleString('pt-BR'); } catch (e) { return ''; } };

  function askDecision(cfg) {
    return new Promise(resolve => {
      deciding = true; ensureGate(); setHero(cfg.title, cfg.sub);
      const card = gate.querySelector('#pjCard');
      card.innerHTML = '<form onsubmit="return false"><div class="pj-choices">' +
        cfg.options.map((o, i) => '<div class="pj-choice">' + o.html + '<button type="button" class="' + (o.cls || '') + '" data-i="' + i + '">' + esc(o.label) + '</button></div>').join('') +
        '</div>' + (cfg.later ? '<div class="small muted pj-center"><button type="button" class="pj-link" data-later="1">Decidir depois (continuar jogando sem sincronizar)</button></div>' : '') + '</form>';
      const done = v => { deciding = false; resolve(v); };
      card.querySelectorAll('[data-i]').forEach(b => b.onclick = async () => {
        const o = cfg.options[+b.dataset.i];
        if (o.confirm && !confirm(o.confirm)) return;
        card.querySelectorAll('button').forEach(x => x.disabled = true);
        const res = await o.run();
        if (res && res.error) {
          card.querySelectorAll('button').forEach(x => x.disabled = false);
          msgBox(card, res.error === 'network' ? 'warn' : 'error', res.message || 'Não foi possível concluir. Tente novamente.'); return;
        }
        done(o.value);
      });
      const l = card.querySelector('[data-later]'); if (l) l.onclick = () => done('later');
    });
  }

  async function pullCloud(reason) {
    const r = await rpc('pj_get_save', { p_token: session.token }, 20000);
    if (!r.ok) { if (r.error === 'invalid_session') expireSession(); return r; }
    if (!r.has_save || !r.data) return { ok: false, error: 'empty', message: 'Não há save na nuvem.' };
    backupLocal(slotRaw(), reason || 'before-pull');
    if (!store.set(SLOT, JSON.stringify(r.data))) return { ok: false, error: 'storage', message: 'Não foi possível gravar o save neste navegador.' };
    setMeta({ owner: session.playerId, base: r.revision, dirty: false, at: Date.now() });
    location.reload();                                  // o jogo reinicia lendo o save exatamente como sempre fez
    return new Promise(() => {});
  }

  // conflito: existe progresso diferente aqui e na nuvem
  async function resolveConflict(cloud, kind) {
    if (deciding) return 'busy';
    const localO = parseSave(slotRaw());
    const choice = await askDecision({
      title: 'Qual progresso você quer manter?',
      sub: kind === 'changed' ? 'O save da nuvem mudou (provavelmente em outro computador) enquanto este navegador também tinha alterações.'
        : 'Este navegador e a nuvem têm progressos diferentes. Nada será apagado sem a sua escolha.',
      later: true,
      options: [
        { html: sumHtml('Progresso na nuvem', cloud.summary, cloud.updated_at ? 'Salvo em ' + fmtDate(cloud.updated_at) : ''), label: 'Usar o da nuvem', cls: 'primary',
          run: () => pullCloud(kind === 'changed' ? 'conflict-keep-cloud' : 'link-keep-cloud'), value: 'cloud' },
        { html: sumHtml('Progresso deste navegador', summarize(localO)), label: 'Usar o deste navegador', cls: 'gold',
          confirm: 'Isto vai substituir o progresso da nuvem pelo deste navegador. A versão atual da nuvem fica guardada como backup no servidor. Continuar?',
          run: async () => { const r = await doPush({ force: true, base: cloud.revision, inDialog: true }); return r === 'ok' ? null : { error: r === 'offline' ? 'network' : 'error', message: r === 'offline' ? 'Sem conexão. Tente novamente quando a internet voltar.' : 'Não foi possível enviar. Tente novamente.' }; }, value: 'local' }
      ]
    });
    if (choice === 'later') { syncPaused = true; syncReady = true; setStatus('paused'); closeGate(); return 'later'; }
    if (choice === 'local') { syncPaused = false; syncReady = true; closeGate(); return 'local'; }
    return choice;
  }

  // save local antigo (sem dono) e conta sem save na nuvem: oferecer vincular
  async function offerLink() {
    const localO = parseSave(slotRaw());
    const choice = await askDecision({
      title: 'Vincular seu progresso a esta conta?',
      sub: 'Encontramos um jogo salvo neste navegador. Você pode levá-lo para a sua conta e continuar de qualquer computador.',
      later: true,
      options: [
        { html: sumHtml('Progresso deste navegador', summarize(localO)), label: 'Vincular à minha conta', cls: 'primary',
          run: async () => { const r = await doPush({ base: 0, inDialog: true }); return r === 'ok' ? null : { error: r === 'offline' ? 'network' : 'error', message: r === 'offline' ? 'Sem conexão. Tente novamente quando a internet voltar.' : 'Não foi possível enviar. Tente novamente.' }; }, value: 'link' },
        { html: '<div class="pj-sum"><b>Começar uma jornada nova</b><div class="small muted">O save deste navegador continua guardado como cópia de segurança e não é apagado.</div></div>', label: 'Começar do zero', cls: '',
          confirm: 'Começar uma jornada nova nesta conta? O progresso atual deste navegador fica guardado como cópia de segurança local.',
          run: async () => { backupLocal(slotRaw(), 'fresh-start'); store.del(SLOT); setMeta({ owner: session.playerId, base: 0, dirty: false }); location.reload(); return new Promise(() => {}); }, value: 'fresh' }
      ]
    });
    if (choice === 'later') { syncPaused = true; syncReady = true; setStatus('paused'); closeGate(); return 'later'; }
    syncPaused = false; syncReady = true; closeGate(); return choice;
  }

  // compara save local x nuvem e decide o que fazer, com segurança
  async function reconcile(info) {
    const P = session.playerId;
    const cloudRev = info && info.has_save ? Number(info.save_revision) || 0 : 0;
    let meta = getMeta(), raw = slotRaw();
    syncPaused = false;
    setStatus('syncing');

    if (meta.owner && meta.owner !== P) {               // slot pertence a outra conta deste navegador
      if (raw) store.set(STASH_PREFIX + meta.owner, JSON.stringify({ raw, meta }));
      store.del(SLOT); setMeta({}); meta = {}; raw = null;
      let st = null; try { st = JSON.parse(store.get(STASH_PREFIX + P) || 'null'); } catch (e) {}
      if (st && st.raw) {                                // esta conta já tinha cópia local aqui: restaura
        store.set(SLOT, st.raw); setMeta(st.meta || { owner: P, base: 0, dirty: true }); store.del(STASH_PREFIX + P);
      }
      location.reload(); return new Promise(() => {});   // o jogo em memória ainda tem o progresso da outra conta: reinicia
    }

    if (meta.owner === P) {
      if (!raw) {                                        // slot vazio nesta conta
        if (cloudRev > 0) { const r = await pullCloud('empty-slot'); if (r && r.error) { syncReady = false; setStatus('error'); } return; }
        setMeta({ owner: P, base: 0, dirty: false }); syncReady = true; setStatus('synced'); return;
      }
      if (cloudRev === 0) { syncReady = true; if (hasProgress(raw)) await doPush({ base: 0 }); else setStatus('synced'); return; }
      if (cloudRev === Number(meta.base)) { syncReady = true; if (meta.dirty) await doPush(); else { lastSyncAt = meta.at || lastSyncAt; setStatus('synced'); } return; }
      if (cloudRev > Number(meta.base) && !meta.dirty) { const r = await pullCloud('cloud-newer'); if (r && r.error) { syncReady = false; setStatus('error'); } return; }
      return conflictFromInfo(info);
    }

    // slot sem dono (save antigo, de antes das contas) ou vazio
    if (!hasProgress(raw)) {
      if (cloudRev > 0) { const r = await pullCloud('empty-slot'); if (r && r.error) { syncReady = false; setStatus('error'); } return; }
      setMeta({ owner: P, base: 0, dirty: false }); syncReady = true; setStatus('synced'); return;
    }
    backupLocal(raw, 'pre-link');                       // o save antigo nunca fica só em um lugar
    if (cloudRev === 0) return offerLink();
    return conflictFromInfo(info);
  }
  async function conflictFromInfo(info) {
    const r = await rpc('pj_get_save', { p_token: session.token }, 20000);
    if (!r.ok) { if (r.error === 'invalid_session') expireSession(); else { syncReady = false; setStatus(r.error === 'network' ? 'offline' : 'error'); } return; }
    const isOwned = getMeta().owner === session.playerId;
    if (!isOwned && r.has_save && stable(r.data) === stable(parseSave(slotRaw()))) {   // já são o mesmo progresso: só vincula
      setMeta({ owner: session.playerId, base: r.revision, dirty: false, at: Date.now() });
      syncReady = true; setStatus('synced'); return 'same';
    }
    return resolveConflict({ revision: r.revision, updated_at: r.updated_at, summary: r.summary }, isOwned ? 'changed' : 'link');
  }

  async function runSync() {                            // validação + reconciliação (boot, login, volta da internet)
    const info = await rpc('pj_validate_session', { p_token: session.token }, 10000);
    if (!info.ok) {
      if (info.error === 'invalid_session') { expireSession(); return 'auth'; }
      setStatus(info.error === 'network' ? 'offline' : 'error'); return 'offline';
    }
    saveSession({ token: session.token, username: info.username, playerId: info.player_id });
    updateAccountUI();
    await reconcile(info);
    return 'done';
  }

  /* ---------- sessão ---------- */
  async function onAuthenticated(r) {
    saveSession({ token: r.token, username: r.username, playerId: r.player_id });
    retryPendingRevokes(); stopRevalidate(); syncReady = false;
    showLoading('Sincronizando seu progresso…');
    const res = await runSync();
    if (res !== 'auth' && !deciding) closeGate();
    if (session) mountAccountUI();
    if (res === 'offline') startRevalidate();
  }

  async function boot() {
    retryPendingRevokes();
    const s = loadSession();
    if (!s) { showLogin(); return; }
    session = s;
    showLoading('Verificando sua sessão…');
    const res = await runSync();
    if (res === 'auth') return;
    if (!deciding) closeGate();
    mountAccountUI();
    if (res === 'offline') startRevalidate();
  }

  function startRevalidate() { stopRevalidate(); revalidateTimer = setInterval(revalidate, 30000); }
  function stopRevalidate() { if (revalidateTimer) { clearInterval(revalidateTimer); revalidateTimer = null; } }
  async function revalidate() {
    if (!session || deciding) return;
    const res = await runSync();
    if (res === 'done') { stopRevalidate(); if (!deciding) closeGate(); }
    updateAccountUI();
  }
  window.addEventListener('online', () => { online = true; retryPendingRevokes(); if (session && !deciding) { if (syncReady) { if (getMeta().dirty) doPush(); else runSync(); } else revalidate(); } updateAccountUI(); });
  window.addEventListener('offline', () => { online = false; if (session) setStatus('offline'); updateAccountUI(); });

  /* ---------- sair ---------- */
  function retryPendingRevokes() {
    let list = []; try { list = JSON.parse(store.get(REVOKE_KEY) || '[]'); } catch (e) {}
    if (!Array.isArray(list) || !list.length) return;
    Promise.all(list.map(t => rpc('pj_logout', { p_token: t }, 6000).then(r => (r.ok ? null : t)))).then(rest => {
      rest = rest.filter(Boolean);
      if (rest.length) store.set(REVOKE_KEY, JSON.stringify(rest)); else store.del(REVOKE_KEY);
    });
  }
  async function logout() {
    if (!session) return;
    stopPresence();
    try { if (typeof state !== 'undefined' && state.activeBattle && !confirm('Há uma batalha em andamento. Sair da conta vai encerrá-la. Deseja sair mesmo assim?')) return; } catch (e) {}
    try { if (typeof save === 'function' && typeof state !== 'undefined' && state.started) save(true); } catch (e) {}
    clearTimeout(pushTimer);
    if (syncReady && !syncPaused && getMeta().dirty) await doPush();   // tenta enviar o que falta; se falhar, fica guardado localmente
    const token = session.token;
    const r = await rpc('pj_logout', { p_token: token }, 5000);
    if (!r.ok) {
      let list = []; try { list = JSON.parse(store.get(REVOKE_KEY) || '[]'); } catch (e) {}
      list.push(token); store.set(REVOKE_KEY, JSON.stringify(list.slice(-5)));
    }
    clearSession();
    location.reload();
  }

  /* ---------- conta no cabeçalho e no Perfil ---------- */
  function statusInfo() {
    const s = !online && syncStatus !== 'conflict' ? 'offline' : syncStatus;
    return STATUS_TEXT[s] || STATUS_TEXT.idle;
  }
  function mountAccountUI() {
    const top = document.querySelector('.topstats');
    if (!top || !session) return;
    let box = document.getElementById('pjAccount');
    if (!box) {
      box = document.createElement('span');
      box.id = 'pjAccount';
      box.className = 'pj-acct';
      box.innerHTML = '<span class="pill" id="pjAcctPill"><i class="pj-dot" id="pjDot"></i>Conta: <b id="pjAcctName"></b> <span class="small" id="pjSyncTxt"></span></span>' +
        '<button type="button" class="pj-logout" id="pjLogoutBtn" title="Sair da conta">Sair</button>';
      top.appendChild(box);
      box.querySelector('#pjLogoutBtn').onclick = logout;
    }
    mountFloat();
    mountSocialNav();
    mountPvpNav();
    updateAccountUI();
    startPresence();
    startPvpPolling();
    startSocialNotifications();
  }
  function unmountAccountUI() {
    ['pjAccount', 'pjFloat'].forEach(id => { const b = document.getElementById(id); if (b) b.remove(); });
    if (floatObs) { floatObs.disconnect(); floatObs = null; }
  }
  // As telas/modais do jogo (ex.: criação do personagem) cobrem o cabeçalho: um atalho flutuante mantém o "Sair" acessível.
  let floatObs = null;
  function mountFloat() {
    if (document.getElementById('pjFloat') || !session) return;
    const f = document.createElement('div');
    f.id = 'pjFloat'; f.className = 'pj-float hidden';
    f.innerHTML = '<span><i class="pj-dot"></i><b id="pjFloatName"></b></span><button type="button" id="pjFloatLogout">Sair da conta</button>';
    document.body.appendChild(f);
    f.querySelector('#pjFloatLogout').onclick = logout;
    const root = document.getElementById('modalRoot');
    const upd = () => f.classList.toggle('hidden', !(root && root.querySelector('.modalback')) || !!gate);
    if (root) { floatObs = new MutationObserver(upd); floatObs.observe(root, { childList: true, subtree: true }); }
    upd();
  }
  function updateAccountUI() {
    if (!session) return;
    const [txt, tip] = statusInfo();
    const bad = !online || ['offline', 'pending', 'paused', 'conflict', 'error'].includes(syncStatus);
    const n = document.getElementById('pjAcctName'); if (n) n.textContent = session.username;
    const fn = document.getElementById('pjFloatName'); if (fn) fn.textContent = session.username;
    const d = document.getElementById('pjDot'); if (d) d.className = 'pj-dot' + (bad ? ' off' : '');
    const t = document.getElementById('pjSyncTxt'); if (t) t.textContent = txt ? '· ' + txt : '';
    const p = document.getElementById('pjAcctPill'); if (p) p.title = tip;
    const s = document.getElementById('pjProfAcctStatus'); if (s) s.textContent = tip + (lastSyncAt ? ' (último envio: ' + fmtDate(lastSyncAt) + ')' : '');
    const pn = document.getElementById('pjProfAcctName'); if (pn) pn.textContent = session.username;
  }
  async function syncNow() {
    if (!session) return;
    if (deciding) return;
    if (!syncReady || syncPaused) { const r = await runSync(); if (r === 'done' && !deciding) closeGate(); }
    else { clearTimeout(pushTimer); const r = await doPush(); if (r === 'empty') setStatus('synced'); }
    try { if (typeof toast === 'function') toast(syncStatus === 'synced' ? 'Progresso sincronizado com a nuvem.' : 'Sincronização: ' + statusInfo()[0]); } catch (e) {}
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  const prevProfile = window.profilePage;
  if (typeof prevProfile === 'function') {
    window.profilePage = function () {
      const base = prevProfile.apply(this, arguments);
      if (!session) return base;
      return base + '<div class="panel" style="margin-top:12px"><div class="row" style="flex-wrap:wrap">' +
        '<div><h3 style="margin:0 0 4px">Conta online</h3>' +
        '<div>Conectado como <b id="pjProfAcctName">' + esc(session.username) + '</b></div>' +
        '<div class="small muted" id="pjProfAcctStatus"></div></div>' +
        '<div class="wrap"><button class="gold" type="button" onclick="PJAccount.syncNow()">Sincronizar agora</button>' +
        '<button class="soft" type="button" onclick="PJAccount.logout()">Sair da conta</button></div></div>' +
        '<p class="small muted" style="margin:10px 0 0">Seu progresso é salvo neste navegador e enviado automaticamente para a sua conta. Entre com o mesmo nome em outro computador para continuar de onde parou.</p></div>';
    };
  }


  /* ---------- presença online e perfis públicos ---------- */
  const REGION_NAMES = ['Kanto','Johto','Hoenn','Sinnoh','Unova','Kalos','Alola','Galar','Paldea'];
  const REGION_KEYS = ['kanto','johto','hoenn','sinnoh','unova','kalos','alola','galar','paldea'];
  let presenceTimer = null, onlineTimer = null, onlineBusy = false;
  function localProfileData() {
    let d = {}; try { d = JSON.parse(store.get(SLOT) || '{}') || {}; } catch(e) {}
    return d;
  }
  async function pingPresence() {
    if (!session || !online || document.visibilityState === 'hidden') return;
    await rpc('pj_presence_ping', { p_token: session.token }, 7000);
  }
  function startPresence() {
    stopPresence();
    pingPresence();
    presenceTimer = setInterval(pingPresence, 45000);
    refreshOnlinePlayers();
    onlineTimer = setInterval(() => { refreshOnlinePlayers(); refreshSocialIfVisible(); }, 60000);
  }
  function stopPresence() {
    if (presenceTimer) clearInterval(presenceTimer);
    if (onlineTimer) clearInterval(onlineTimer);
    presenceTimer = onlineTimer = null;
  }
  async function refreshOnlinePlayers() {
    if (!session || onlineBusy || !online) return;
    const host = document.getElementById('pjOnlinePlayers');
    if (!host) return;
    onlineBusy = true;
    try {
      const r = await rpc('pj_online_players', { p_token: session.token }, 9000);
      if (!r.ok || !Array.isArray(r.players)) return;
      renderOnlinePlayers(r.players);
    } finally { onlineBusy = false; }
  }
  function renderOnlinePlayers(players) {
    const host = document.getElementById('pjOnlinePlayers');
    if (!host) return;
    if (!players.length) {
      host.innerHTML = '<div class="pj-online-empty">Nenhum treinador online no momento. Quando seus amigos entrarem, eles aparecerão aqui.</div>';
      return;
    }
    host.innerHTML = players.map(p => {
      const pr = p.profile || {};
      const rank = Math.max(1, Math.min(8, Number(pr.rank) || 1));
      const names = ['Novato','Aprendiz','Treinador','Experiente','Veterano','Elite','Mestre','Lenda'];
      return '<button type="button" class="pj-online-player" data-player="' + esc(p.player_id) + '">' +
        '<span class="pj-online-dot"></span><span class="pj-online-name">' + esc(pr.name || p.username) + '</span>' +
        '<span class="pj-online-rank"><img class="pj-rank-symbol" src="assets/ranks/rank-' + rank + '.png" alt="">' + names[rank-1] + '</span></button>';
    }).join('');
    host.querySelectorAll('[data-player]').forEach(b => b.addEventListener('click', () => {
      const p = players.find(x => x.player_id === b.dataset.player);
      if (p) openPublicProfile(p);
    }));
  }
  function safeNum(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  function openPublicProfile(player) {
    const p = player.profile || {}, region = Math.max(0, Math.min(8, safeNum(p.initialRegion ?? p.region)));
    const rank = Math.max(1, Math.min(8, safeNum(p.rank) || 1));
    const rankNames = ['Novato','Aprendiz','Treinador','Experiente','Veterano','Elite','Mestre','Lenda'];
    const avatar = encodeURIComponent(p.trainerAvatar || 'red');
    const team = Array.isArray(p.party) ? p.party.slice(0,6) : [];
    const teamHtml = team.map(m => '<div class="pj-public-mon">' +
      (m.sprite ? '<img src="' + esc(m.sprite) + '" alt="">' : '') +
      '<b>' + esc(m.name || 'Pokémon') + '</b><small>Nv. ' + safeNum(m.level) + '</small></div>').join('');
    const challenges = p.challenges && typeof p.challenges === 'object' ? p.challenges : {};
    const trophies = p.tournamentChampions || {}, leagues = p.leagueChampions || {};
    const dirs = ['kanto','johto','hoenn','sinnoh','unova','kalos','alola','galar','paldea'];
    const regionSections = REGION_NAMES.map((name, i) => {
      const earned = Array.isArray(challenges[i] || challenges[String(i)]) ? (challenges[i] || challenges[String(i)]) : [];
      const badges = earned.map(n => '<div class="pj-public-award"><img src="assets/badges/' + dirs[i] + '-' + (safeNum(n)+1) + '.png" alt=""><small>Insígnia ' + (safeNum(n)+1) + '</small></div>').join('');
      const zRewards = i === 6 && p.alolaZRewardsClaimed && typeof p.alolaZRewardsClaimed === 'object'
        ? Object.values(p.alolaZRewardsClaimed).filter(Boolean) : [];
      const crystals = zRewards.map(id => '<div class="pj-public-award"><img src="assets/z-crystals/' + encodeURIComponent(String(id)) + '.png" alt=""><small>' + esc(String(id).replace(/-z$/,'').replace(/-/g,' ')) + '</small></div>').join('');
      const tour = !!(trophies[i] || trophies[String(i)]);
      const league = !!(leagues[i] || leagues[String(i)]);
      const t = tour ? '<div class="pj-public-award pj-public-trophy"><span>🏆</span><small>Torneio regional</small></div>' : '';
      const l = league ? '<div class="pj-public-award pj-public-trophy"><img src="assets/trophies/league-' + (i+1) + '.png" alt=""><small>Liga Pokémon</small></div>' : '';
      const content = badges + crystals + t + l;
      return '<section class="pj-public-region"><b>' + name + '</b><div class="pj-public-awards">' +
        (content || '<small class="pj-public-none">Nenhuma conquista registrada</small>') + '</div></section>';
    }).join('');
    const root = document.getElementById('modalRoot');
    if (!root) return;
    root.innerHTML = '<div class="modalback pj-public-backdrop" role="presentation"><div class="modal pj-public-modal" role="dialog" aria-modal="true" aria-label="Perfil de treinador">' +
      '<div class="pj-public-head"><img src="https://play.pokemonshowdown.com/sprites/trainers/' + avatar + '.png" alt="" onerror="this.style.display=\'none\'">' +
      '<div><span class="eyebrow">PERFIL DO TREINADOR</span><h2>' + esc(p.name || player.username) + '</h2><b class="pj-profile-rank"><img class="pj-rank-symbol pj-rank-symbol-large" src="assets/ranks/rank-' + rank + '.png" alt="">' + rankNames[rank-1] + ' · Rank ' + rank + '</b><p class="small muted">Região inicial: ' + REGION_NAMES[region] + '</p></div>' +
      '<button type="button" class="pj-public-close" aria-label="Fechar">✕</button></div>' +
      (player.player_id !== (session && session.playerId) ? '<div class="pj-profile-actions"><button type="button" class="primary" id="pjAddFriendBtn">Adicionar amigo</button><button type="button" class="gold" id="pjBattleRequestBtn">⚔️ Batalhar</button><span class="small muted" id="pjProfileActionMsg"></span></div>' : '') +
      '<div class="pj-public-stats"><div><b>' + safeNum(p.wins) + '</b><small>Vitórias</small></div><div><b>' + safeNum(p.trainerWins) + '</b><small>Vitórias contra treinadores</small></div><div><b>' + safeNum(p.losses) + '</b><small>Derrotas</small></div><div><b>' + Object.values(challenges).reduce((a,x)=>a+(Array.isArray(x)?x.length:0),0) + '</b><small>Insígnias</small></div></div>' +
      '<h3>Time principal</h3><div class="pj-public-team">' + (teamHtml || '<p class="pj-public-none">Time não informado.</p>') + '</div>' +
      '<h3>Prêmios e insígnias por região</h3><div class="pj-public-regions">' + regionSections + '</div></div></div>';
    root.querySelector('.pj-public-close').onclick = () => { root.innerHTML = ''; };
    root.querySelector('.pj-public-backdrop').addEventListener('click', e => { if (e.target.classList.contains('pj-public-backdrop')) root.innerHTML = ''; });
    const modal = root.querySelector('.pj-public-modal');
    if (modal) modal.addEventListener('click', e => e.stopPropagation());
    const addBtn = root.querySelector('#pjAddFriendBtn');
    if (addBtn) addBtn.onclick = () => sendSocialRequest('friend', player.player_id, addBtn);
    const battleBtn = root.querySelector('#pjBattleRequestBtn');
    if (battleBtn) battleBtn.onclick = () => sendSocialRequest('battle', player.player_id, battleBtn);
  }
  /* ---------- Amigos e solicitações de batalha ---------- */
  let socialRefreshBusy = false;
  function rankMarkup(rank, large) {
    const n = Math.max(1, Math.min(8, safeNum(rank) || 1));
    return '<img class="pj-rank-symbol' + (large ? ' pj-rank-symbol-large' : '') + '" src="assets/ranks/rank-' + n + '.png" alt="">';
  }
  function mountSocialNav() {
    const nav = document.querySelector('.nav');
    if (!nav || nav.querySelector('[data-page="friends"]')) return;
    const label = document.createElement('small'); label.textContent = 'Comunidade';
    const btn = document.createElement('button'); btn.type = 'button'; btn.dataset.page = 'friends'; btn.textContent = '👥 Amigos';
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav button[data-page]').forEach(b => b.classList.toggle('active', b === btn));
      if (typeof window.setPage === 'function') window.setPage('friends');
      renderFriendsPage();
    });
    nav.append(label, btn);
  }
  function socialCall(fn, args) { return rpc(fn, Object.assign({ p_token: session && session.token }, args || {}), 12000); }
  async function sendSocialRequest(kind, targetId, button) {
    if (!session || !targetId) return;
    const original = button.textContent;
    button.disabled = true; button.textContent = 'Enviando…';
    const fn = kind === 'friend' ? 'pj_friend_request' : 'pj_battle_request';
    const r = await socialCall(fn, { p_target: targetId });
    button.disabled = false;
    const msg = document.getElementById('pjProfileActionMsg');
    if (r.ok) {
      button.textContent = kind === 'friend' ? 'Solicitação enviada' : 'Convite enviado';
      if (msg) msg.textContent = r.message || (kind === 'friend' ? 'Pedido de amizade enviado.' : 'Solicitação de batalha enviada.');
      if (typeof toast === 'function') toast(r.message || 'Solicitação enviada.');
    } else {
      button.textContent = original;
      if (msg) msg.textContent = r.message || 'Não foi possível enviar a solicitação.';
      else if (typeof toast === 'function') toast(r.message || 'Não foi possível enviar a solicitação.');
    }
  }
  function socialPlayerCard(p, actions) {
    const rank = safeNum((p.profile || {}).rank) || 1;
    const isOnline = !!p.online;
    return '<article class="pj-social-player"><button type="button" class="pj-social-open" data-profile="' + esc(p.player_id) + '">' +
      '<span class="pj-social-presence ' + (isOnline ? 'online' : '') + '"></span><span class="pj-social-player-name">' + esc(p.username || (p.profile || {}).name || 'Treinador') + '</span>' +
      '<span class="pj-social-rank">' + rankMarkup(rank, false) + '<small>' + ['Novato','Aprendiz','Treinador','Experiente','Veterano','Elite','Mestre','Lenda'][Math.max(0,Math.min(7,rank-1))] + '</small></span></button>' +
      (actions || '') + '</article>';
  }
  function requestCard(r, kind) {
    const who = kind === 'incoming' ? 'Enviado por ' : 'Para ';
    const controls = kind === 'incoming'
      ? '<div class="pj-social-controls"><button type="button" class="primary" data-social-accept="' + r.id + '" data-kind="' + r.type + '">Aceitar</button><button type="button" class="soft" data-social-decline="' + r.id + '" data-kind="' + r.type + '">Recusar</button></div>'
      : '<small class="muted">Aguardando resposta</small>';
    return '<article class="pj-social-request"><div><b>' + esc(r.username || 'Treinador') + '</b><small>' + who + (r.type === 'battle' ? 'solicitação de batalha' : 'pedido de amizade') + '</small></div>' + controls + '</article>';
  }
  async function loadSocialData() {
    const r = await socialCall('pj_social_data', {});
    if (!r.ok) throw new Error(r.message || 'Não foi possível carregar seus amigos.');
    return r;
  }
  async function renderFriendsPage() {
    const main = document.getElementById('main'); if (!main || socialRefreshBusy) return;
    main.innerHTML = '<section class="hero"><div><h1>Amigos</h1><p>Gerencie suas amizades e convites para batalhas.</p></div><div class="heroicon">👥</div></section><div class="panel pj-social-loading">Carregando comunidade…</div>';
    socialRefreshBusy = true;
    try {
      const data = await loadSocialData();
      if (!document.getElementById('main') || !document.querySelector('.nav button[data-page="friends"].active')) return;
      const friends = data.friends || [], fi = data.friend_incoming || [], fo = data.friend_outgoing || [];
      const bi = data.battle_incoming || [], bo = data.battle_outgoing || [];
      main.innerHTML = '<section class="hero"><div><h1>Amigos</h1><p>Encontre seus amigos, aceite pedidos e combine batalhas.</p></div><div class="heroicon">👥</div></section>' +
        '<section class="panel pj-social-section"><div class="pj-online-heading"><h2>Meus amigos (' + friends.length + ')</h2><button type="button" class="soft" id="pjSocialRefresh">Atualizar</button></div>' +
        (friends.length ? '<div class="pj-social-list">' + friends.map(p => socialPlayerCard(p, '<button type="button" class="soft" data-battle-player="' + esc(p.player_id) + '">⚔️ Batalhar</button>')).join('') + '</div>' : '<p class="pj-online-empty">Você ainda não tem amigos. Abra o perfil de um treinador e envie um pedido de amizade.</p>') + '</section>' +
        '<section class="panel pj-social-section"><h2>Pedidos de amizade (' + fi.length + ')</h2>' + (fi.length ? '<div class="pj-social-requests">' + fi.map(r => requestCard({...r,type:'friend'},'incoming')).join('') + '</div>' : '<p class="pj-online-empty">Nenhum pedido recebido.</p>') +
        (fo.length ? '<h3>Pedidos enviados</h3><div class="pj-social-requests">' + fo.map(r => requestCard({...r,type:'friend'},'outgoing')).join('') + '</div>' : '') + '</section>' +
        '<section class="panel pj-social-section"><h2>Solicitações de batalha</h2>' +
        (bi.length ? '<h3>Recebidas</h3><div class="pj-social-requests">' + bi.map(r => requestCard({...r,type:'battle'},'incoming')).join('') + '</div>' : '<p class="pj-online-empty">Nenhuma solicitação de batalha recebida.</p>') +
        (bo.length ? '<h3>Enviadas</h3><div class="pj-social-requests">' + bo.map(r => requestCard({...r,type:'battle'},'outgoing')).join('') + '</div>' : '') + '</section>';
      main.querySelector('#pjSocialRefresh').onclick = renderFriendsPage;
      main.querySelectorAll('[data-profile]').forEach(b => b.onclick = async () => {
        const id = b.dataset.profile;
        const found = friends.find(x => x.player_id === id);
        if (found) openPublicProfile(found);
        else if (typeof toast === 'function') toast('O perfil completo fica disponível pela lista de treinadores online.');
      });
      main.querySelectorAll('[data-battle-player]').forEach(b => b.onclick = () => sendSocialRequest('battle', b.dataset.battlePlayer, b));
      main.querySelectorAll('[data-social-accept],[data-social-decline]').forEach(b => b.onclick = async () => {
        b.disabled = true;
        const accept = b.hasAttribute('data-social-accept');
        const id = b.dataset.socialAccept || b.dataset.socialDecline;
        const fn = b.dataset.kind === 'friend' ? 'pj_friend_respond' : 'pj_battle_respond';
        const r = await socialCall(fn, { p_request_id: Number(id), p_accept: accept });
        if (typeof toast === 'function') toast(r.message || (r.ok ? 'Solicitação atualizada.' : 'Não foi possível atualizar.'));
        if (r.ok) {
          renderFriendsPage();
          // A navegação para a arena é disparada quando a partida ativa chega pelo polling, para os dois jogadores.
        } else b.disabled = false;
      });
    } catch (e) {
      main.innerHTML = '<section class="hero"><div><h1>Amigos</h1><p>Gerencie suas amizades e convites para batalhas.</p></div><div class="heroicon">👥</div></section><div class="panel"><p class="pj-msg error">' + esc(e.message) + '</p><p class="small muted">Execute o SQL atualizado no Supabase para ativar os recursos sociais.</p><button type="button" class="soft" onclick="PJAccount.openFriends()">Tentar novamente</button></div>';
    } finally { socialRefreshBusy = false; }
  }
  async function refreshSocialIfVisible() {
    if (document.querySelector('.nav button[data-page="friends"].active')) renderFriendsPage();
  }

  // Notificações em tempo real para pedidos recebidos. O primeiro carregamento cria a linha de base sem alertas antigos.
  let socialKnownInitialized = false;
  let socialKnownFriend = new Set(), socialKnownBattle = new Set(), socialPollTimer = null;
  function updateSocialBadges(friendCount, battleCount) {
    [['friends',friendCount],['pvp',battleCount]].forEach(([page,count]) => {
      const btn = document.querySelector('.nav button[data-page="' + page + '"]'); if (!btn) return;
      let badge = btn.querySelector('.pj-nav-badge');
      if (count > 0) { if (!badge) { badge = document.createElement('span'); badge.className = 'pj-nav-badge'; btn.appendChild(badge); } badge.textContent = String(count); }
      else if (badge) badge.remove();
    });
  }
  async function refreshSocialNotifications() {
    if (!session || !online) return;
    try {
      const d = await loadSocialData();
      const friends = d.friend_incoming || [], battles = d.battle_incoming || [];
      const friendIds = new Set(friends.map(x => String(x.id))), battleIds = new Set(battles.map(x => String(x.id)));
      updateSocialBadges(friends.length, battles.length);
      let hasNewRequest = false;
      if (socialKnownInitialized) {
        const newFriends = friends.filter(x => !socialKnownFriend.has(String(x.id)));
        const newBattles = battles.filter(x => !socialKnownBattle.has(String(x.id)));
        hasNewRequest = newFriends.length > 0 || newBattles.length > 0;
        newFriends.forEach(x => { if (typeof toast === 'function') toast('Novo pedido de amizade de ' + (x.username || 'um treinador') + '! Abra Amigos para responder.'); });
        newBattles.forEach(x => { if (typeof toast === 'function') toast('Novo desafio de batalha de ' + (x.username || 'um treinador') + '! Abra Amigos para responder.'); });
      }
      socialKnownFriend = friendIds; socialKnownBattle = battleIds; socialKnownInitialized = true;
      if (hasNewRequest && document.querySelector('.nav button[data-page="friends"].active') && !socialRefreshBusy) renderFriendsPage();
    } catch (e) { /* falha temporária não deve interromper a presença nem o combate */ }
  }
  function startSocialNotifications() {
    if (socialPollTimer) clearInterval(socialPollTimer);
    socialKnownInitialized = false; socialKnownFriend = new Set(); socialKnownBattle = new Set();
    refreshSocialNotifications();
    socialPollTimer = setInterval(() => { if (document.visibilityState !== 'hidden') refreshSocialNotifications(); }, 3500);
  }

  const baseHomePage = window.homePage;
  if (typeof baseHomePage === 'function') {
    window.homePage = function() {
      const base = baseHomePage.apply(this, arguments);
      if (!session) return base;
      return base + '<section class="panel pj-online-panel"><div class="pj-online-heading"><div><span class="eyebrow">COMUNIDADE</span><h2>Treinadores online</h2></div><span class="pj-online-live"><i></i> Ao vivo</span></div><div id="pjOnlinePlayers" class="pj-online-list"><div class="pj-online-empty">Carregando treinadores online…</div></div></section>';
    };
  }

  /* ---------- Batalhas PvP online por turnos ---------- */
  let pvpMatch = null, pvpPollTimer = null, pvpResolving = false, pvpPageBusy = false, pvpAutoOpenedMatchId = null;
  const PVP_RANK_NAMES = ['Novato','Aprendiz','Treinador','Experiente','Veterano','Elite','Mestre','Lenda'];
  const PVP_TYPE_COLORS={normal:['#69727e','#3e4855'],fire:['#c94b32','#742c25'],water:['#287dc0','#174a7b'],electric:['#b18b16','#66500c'],grass:['#398b50','#205b37'],ice:['#4a9fae','#28636f'],fighting:['#b64d3d','#702c2b'],poison:['#9254a8','#56316b'],ground:['#a77a3c','#684b28'],flying:['#6e78bd','#3c467f'],psychic:['#c04d82','#713054'],bug:['#78952e','#485c1d'],rock:['#887c50','#51492f'],ghost:['#6653a5','#3c306b'],dragon:['#5364c4','#303b7b'],dark:['#514b5a','#302c38'],steel:['#718b9b','#405665'],fairy:['#bd729d','#754465']};
  const PVP_Z_TYPES=window.PJ_Z_TYPES||{'normalium-z':'normal','firium-z':'fire','waterium-z':'water','electrium-z':'electric','grassium-z':'grass','icium-z':'ice','fightinium-z':'fighting','poisonium-z':'poison','groundium-z':'ground','flyinium-z':'flying','psychium-z':'psychic','buginium-z':'bug','rockium-z':'rock','ghostium-z':'ghost','dragonium-z':'dragon','darkinium-z':'dark','steelium-z':'steel','fairium-z':'fairy'};
  const pvpTypeStyle=t=>{const c=PVP_TYPE_COLORS[String(t||'normal').toLowerCase()]||PVP_TYPE_COLORS.normal;return 'background:linear-gradient(135deg,'+c[0]+','+c[1]+');border-color:'+c[0]+';color:#fff;'};
  const pvpZPower=p=>p>=130?200:p>=100?180:p>=90?175:p>=80?160:p>=70?140:p>=60?120:100;
  function cloneJson(v) { return JSON.parse(JSON.stringify(v)); }
  function pvpSide(m) { return m && session && m.player_a === session.playerId ? 'a' : 'b'; }
  function pvpMon(team, index) { return team && team[index] ? team[index] : null; }
  function pvpAliveIndex(team, current) {
    if (team[current] && Number(team[current].hp) > 0) return current;
    return team.findIndex(x => Number(x.hp) > 0);
  }
  async function fetchPvpMatch() {
    if (!session || !online) return null;
    const r = await socialCall('pj_pvp_get', {});
    if (!r.ok) throw new Error(r.message || 'Não foi possível consultar a batalha.');
    pvpMatch = r.match || null;
    return pvpMatch;
  }
  async function refreshPvp() {
    try {
      const previous = pvpMatch && pvpMatch.id;
      const m = await fetchPvpMatch();
      if (m && m.status === 'active' && m.id !== previous && m.id !== pvpAutoOpenedMatchId) {
        pvpAutoOpenedMatchId = m.id;
        openPvpPage();
      }
      if (document.querySelector('.nav button[data-page="pvp"].active')) renderPvpPage(false);
      if (m && m.status === 'active' && m.action_a && m.action_b) await resolvePvpRound(m);
    } catch (e) {
      const host = document.getElementById('pjPvpMount');
      if (host && document.querySelector('.nav button[data-page="pvp"].active')) host.innerHTML = '<p class="pj-msg error">' + esc(e.message) + '</p>';
    }
  }
  function startPvpPolling() {
    if (pvpPollTimer) clearInterval(pvpPollTimer);
    refreshPvp();
    pvpPollTimer = setInterval(() => {
      if (document.visibilityState !== 'hidden') refreshPvp();
    }, 2200);
  }
  function openPvpPage() {
    const nav = document.querySelector('.nav');
    if (nav) document.querySelectorAll('.nav button[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === 'pvp'));
    if (typeof state !== 'undefined') state.activePage = 'pvp';
    renderPvpPage(true);
    refreshPvp();
  }
  function pvpTeamHtml(team, active, label, own) {
    const mon = pvpMon(team, active);
    if (!mon) return '<div class="combatant"><p class="pj-online-empty">Sem Pokémon nesta equipe.</p></div>';
    const hp = Math.max(0, Math.min(100, 100 * safeNum(mon.hp) / Math.max(1, safeNum(mon.maxHp))));
    return '<div class="combatant ' + (own ? 'pj-pvp-own' : 'enemy') + '"><div class="small muted">' + label + '</div><img src="' + esc(mon.sprite || '') + '" alt=""><div class="name">' + esc(cap(mon.megaFormName || mon.name || 'Pokémon')) + (mon.megaActive?' <span class="small">MEGA</span>':'') + ' <span class="small">Nv.' + safeNum(mon.level) + '</span></div><div class="bar"><i style="width:' + hp + '%;' + (own ? '' : 'background:#e66') + '"></i></div><div class="small muted">' + safeNum(mon.hp) + '/' + safeNum(mon.maxHp) + ' HP</div></div>';
  }
  function renderPvpPage(load) {
    const main = document.getElementById('main'); if (!main) return;
    if (load || !document.getElementById('pjPvpMount')) main.innerHTML = '<section class="hero"><div><h1>Batalha Pokémon</h1><p>Combate online por turnos contra outro treinador.</p></div><div class="heroicon">⚔️</div></section><section class="panel" id="pjPvpMount"><div class="pj-social-loading">Conectando à arena…</div></section>';
    const host = document.getElementById('pjPvpMount'); if (!host) return;
    if (!pvpMatch) { host.innerHTML = '<div class="empty">Você não tem uma batalha online em andamento.<br><button class="primary" style="margin-top:12px" type="button" id="pjPvpRefresh">Verificar desafios</button></div>'; host.querySelector('#pjPvpRefresh').onclick = refreshPvp; return; }
    const m = pvpMatch, side = pvpSide(m), own = m['team_'+side] || [], enemySide = side === 'a' ? 'b' : 'a', enemy = m['team_'+enemySide] || [];
    const ownActive = safeNum(m['active_'+side]), enemyActive = safeNum(m['active_'+enemySide]);
    const myAction = m['action_'+side], waiting = !!myAction;
    const opponentName = m['name_'+enemySide] || 'Treinador adversário';
    const ownMon = pvpMon(own, ownActive), finished = m.status === 'finished';
    const won = m.winner_id && m.winner_id === session.playerId;
    let moves = '';
    if (ownMon) moves = (ownMon.moves || []).map((mv,i) => '<button class="move pj-pvp-type-move" style="' + pvpTypeStyle(mv.type) + '" data-pvp-move="' + i + '" ' + (waiting || safeNum(mv.pp) <= 0 || finished ? 'disabled' : '') + '><span>' + esc(cap(mv.name)) + '<small class="move-info" style="display:block;color:#fff">' + esc(cap(mv.type || 'normal')) + ' · PP ' + safeNum(mv.pp) + '/' + safeNum(mv.maxPp || mv.pp) + ' · ' + (mv.power || 'Status') + '</small></span></button>').join('');
    const switchButtons = own.map((x,i) => i === ownActive || safeNum(x.hp) <= 0 ? '' : '<button class="soft" data-pvp-switch="' + i + '" ' + (waiting || finished ? 'disabled' : '') + '>' + esc(cap(x.name)) + ' · Nv. ' + safeNum(x.level) + '</button>').join('');
    const megaOpts=(window.PJ_MEGAS||[]).filter(x=>Number(ownMon?.speciesId||ownMon?.id)===Number(x.speciesId)&&Number(state?.bag?.[x.stone]||0)>0);
    const megaUsed=!!own.some(x=>x.pvpMegaUsed), zUsed=!!own.some(x=>x.pvpZUsed);
    const zOpts=ownMon?(ownMon.moves||[]).flatMap((mv,i)=>Object.entries(PVP_Z_TYPES).filter(([id,type])=>type===mv.type&&Number(state?.bag?.[id]||0)>0).map(([id,type])=>({id,type,mv,i}))):[];
    const specialHtml=!finished&&!waiting?'<section class="pj-pvp-special"><div class="row"><b>✨ Poderes especiais</b><span class="small muted">Uma vez por batalha</span></div><div class="wrap">'+(megaOpts.length&&!megaUsed?megaOpts.map(x=>'<button class="gold" data-pvp-mega="'+esc(x.stone)+'">'+esc(x.label)+'</button>').join(''):'<button class="soft" disabled>Mega Evolução indisponível</button>')+(zOpts.length&&!zUsed?zOpts.map(x=>'<button class="gold" data-pvp-z="'+x.i+'" data-crystal="'+esc(x.id)+'">✨ Movimento Z · '+esc(cap(x.type))+'</button>').join(''):'<button class="soft" disabled>Movimento Z indisponível</button>')+'</div><small class="muted">Mega Evolução e Movimento Z podem ser usados na mesma batalha, mas por Pokémon diferentes.</small></section>':'';
    host.innerHTML = '<div class="battle"><div class="row"><span class="type">' + (finished ? (won ? 'Vitória!' : 'Batalha encerrada') : 'Batalha online') + '</span><span class="muted small">Turno ' + safeNum(m.turn) + '</span></div>' +
      '<div class="battle-trainer-line"><b>' + esc(opponentName) + '</b><span class="small muted">Treinador adversário · VS · Você</span></div>' +
      '<div class="battlefield">' + pvpTeamHtml(enemy,enemyActive,'Equipe adversária',false) + pvpTeamHtml(own,ownActive,'Seu Pokémon',true) + '</div>' +
      (finished ? '<p class="pj-pvp-finish">' + (won ? 'Você venceu a batalha!' : 'O adversário venceu a batalha.') + '</p>' :
       (waiting ? '<p class="pj-pvp-wait">Movimento enviado! Aguardando a jogada do adversário…</p>' : '<div class="row"><b>Escolha um movimento</b><span class="muted small">Sua vez</span></div><div class="moves pj-pvp-moves">' + (moves || '<p class="muted">Nenhum movimento disponível.</p>') + '</div><div class="wrap"><b>Trocar Pokémon:</b> ' + (switchButtons || '<small class="muted">Nenhum Pokémon disponível para troca.</small>') + '</div>')) +
      '<div class="log" id="pjPvpLog">' + esc(m.last_log || 'A batalha começou!') + '</div>' + specialHtml +
      '<div class="pj-pvp-footer"><span class="small muted">' + (finished ? 'Resultado registrado no histórico.' : 'A tela é sincronizada automaticamente entre os dois treinadores.') + '</span>'+(finished?'<button type="button" class="primary" id="pjPvpClose">Fechar batalha</button>':'')+'<button type="button" class="soft" id="pjPvpRefresh">Atualizar</button></div></div>';
    host.querySelector('#pjPvpRefresh').onclick = refreshPvp;
    host.querySelectorAll('[data-pvp-move]').forEach(b => b.onclick = () => submitPvpAction({type:'move',index:Number(b.dataset.pvpMove)}));
    host.querySelectorAll('[data-pvp-switch]').forEach(b => b.onclick = () => submitPvpAction({type:'switch',index:Number(b.dataset.pvpSwitch)}));
    host.querySelectorAll('[data-pvp-mega]').forEach(b=>b.onclick=()=>submitPvpMega(b.dataset.pvpMega));
    host.querySelectorAll('[data-pvp-z]').forEach(b=>b.onclick=()=>submitPvpZ(Number(b.dataset.pvpZ),b.dataset.crystal));
    const closeBtn=host.querySelector('#pjPvpClose');if(closeBtn)closeBtn.onclick=closeFinishedPvp;
  }
  async function submitPvpMega(stone){
    const side=pvpSide(pvpMatch),team=pvpMatch['team_'+side]||[],mon=team[safeNum(pvpMatch['active_'+side])];
    const mega=(window.PJ_MEGAS||[]).find(x=>x.stone===stone&&Number(x.speciesId)===Number(mon?.speciesId||mon?.id));
    if(!mega||!Number(state?.bag?.[stone]||0)||team.some(x=>x.pvpMegaUsed)||mon?.pvpZUsed){if(typeof toast==='function')toast('Mega Evolução indisponível para este Pokémon.');return;}
    try{const res=await fetch('https://pokeapi.co/api/v2/pokemon/'+encodeURIComponent(mega.slug));if(!res.ok)throw new Error('API indisponível');const p=await res.json();const stats={};(p.stats||[]).forEach(x=>stats[x.stat.name]=x.base_stat);
      const applied={sprite:p.sprites?.other?.['official-artwork']?.front_default||p.sprites?.front_default||mon.sprite,types:(p.types||[]).map(x=>x.type.name),stats,ability:p.abilities?.[0]?.ability?.name||mon.ability,megaActive:true,megaFormName:mega.label};
      await submitPvpAction({type:'mega',stone,label:mega.label,applied});
    }catch(e){if(typeof toast==='function')toast('Não foi possível carregar a forma Mega. Tente novamente.');}
  }
  async function submitPvpZ(index,crystalId){
    const side=pvpSide(pvpMatch),team=pvpMatch['team_'+side]||[],mon=team[safeNum(pvpMatch['active_'+side])],move=mon?.moves?.[index],type=PVP_Z_TYPES[crystalId];
    if(!move||!type||move.type!==type||!Number(state?.bag?.[crystalId]||0)||team.some(x=>x.pvpZUsed)||mon?.pvpMegaUsed){if(typeof toast==='function')toast('Movimento Z indisponível para este Pokémon.');return;}
    await submitPvpAction({type:'z',index,crystalId,power:move.power?pvpZPower(safeNum(move.power)):0});
  }
  async function closeFinishedPvp(){
    if(!pvpMatch||pvpMatch.status!=='finished')return;
    const r=await socialCall('pj_pvp_close',{p_match_id:pvpMatch.id});
    if(!r.ok){if(typeof toast==='function')toast(r.message||'Não foi possível fechar a batalha.');return;}
    pvpMatch=null;renderPvpPage(true);if(typeof toast==='function')toast('Batalha fechada.');
  }
  async function submitPvpAction(action) {
    if (!pvpMatch || pvpMatch.status !== 'active' || pvpMatch['action_'+pvpSide(pvpMatch)]) return;
    const r = await socialCall('pj_pvp_action', {p_match_id:pvpMatch.id,p_turn:pvpMatch.turn,p_action:action});
    if (!r.ok) { if (typeof toast === 'function') toast(r.message || 'Não foi possível enviar sua jogada.'); return; }
    await refreshPvp();
  }
  function applyPvpAction(team, active, action, targetTeam, targetActive, log) {
    if (!action) return {active,log};
    if (action.type === 'switch') {
      const idx = Number(action.index);
      if (team[idx] && idx !== active && safeNum(team[idx].hp) > 0) { active = idx; log.push('O treinador trocou para ' + cap(team[idx].name) + '!'); }
      return {active,log};
    }
    const attacker = team[active], defender = targetTeam[targetActive];
    if(!attacker||safeNum(attacker.hp)<=0)return {active,log};
    if(action.type==='mega'){
      if(!attacker.pvpMegaUsed&&!attacker.pvpZUsed&&action.applied){Object.assign(attacker,action.applied);attacker.pvpMegaUsed=true;log.push('✨ '+cap(attacker.name)+' Mega Evoluiu para '+cap(action.label||'Mega Evolução')+'!');}
      return {active,log};
    }
    if(action.type==='z'){
      const zm=attacker.moves&&attacker.moves[Number(action.index)];
      if(!zm||attacker.pvpZUsed||attacker.pvpMegaUsed)return {active,log};
      attacker.pvpZUsed=true;const zMove=Object.assign({},zm,{name:zm.name+' (Movimento Z)',power:safeNum(action.power)});
      if(!zm.power){Object.keys(attacker.stats||{}).forEach(k=>attacker.stats[k]=Math.round(safeNum(attacker.stats[k])*1.5));log.push('✨ '+cap(attacker.name)+' liberou o poder do '+cap(String(action.crystalId||'Cristal Z'))+'! Seus atributos foram fortalecidos.');return {active,log};}
      attacker.moves[Number(action.index)]=zMove;const out=applyPvpAction(team,active,{type:'move',index:Number(action.index)},targetTeam,targetActive,log);attacker.moves[Number(action.index)]=zm;
      if(log.length)log[log.length-1]='✨ Movimento Z! '+log[log.length-1];return out;
    }
    const move = attacker && attacker.moves && attacker.moves[Number(action.index)];
    if (!attacker || !defender || !move || safeNum(move.pp) <= 0 || safeNum(attacker.hp) <= 0) return {active,log};
    move.pp = Math.max(0,safeNum(move.pp)-1);
    if (Math.random()*100 > (move.accuracy == null ? 100 : safeNum(move.accuracy))) { log.push(cap(attacker.name)+' usou '+cap(move.name)+', mas errou!'); return {active,log}; }
    if (!move.power) { log.push(cap(attacker.name)+' usou '+cap(move.name)+'!'); return {active,log}; }
    let result = typeof window.damageCalc === 'function' ? window.damageCalc(attacker,defender,move) : {damage:Math.max(1,Math.floor((safeNum(move.power)*safeNum(attacker.level))/Math.max(1,safeNum(defender.level)*1.7))),mult:1};
    defender.hp = Math.max(0,safeNum(defender.hp)-safeNum(result.damage));
    log.push(cap(attacker.name)+' usou '+cap(move.name)+' e causou '+safeNum(result.damage)+' de dano.'+(result.mult>1?' Foi super efetivo!':result.mult===0?' Não afetou o adversário!':result.mult<1?' Não foi muito efetivo.':''));
    return {active,log};
  }
  async function resolvePvpRound(m) {
    if (pvpResolving || !m || !m.action_a || !m.action_b || m.status !== 'active') return;
    pvpResolving = true;
    try {
      const a = cloneJson(m.team_a), b = cloneJson(m.team_b), log = [];
      let ai = safeNum(m.active_a), bi = safeNum(m.active_b);
      const firstA = (m.action_a.type === 'switch'||m.action_a.type==='mega'), firstB = (m.action_b.type === 'switch'||m.action_b.type==='mega');
      if (firstA) ai = applyPvpAction(a,ai,m.action_a,b,bi,log).active;
      if (firstB) bi = applyPvpAction(b,bi,m.action_b,a,ai,log).active;
      if (!firstA) applyPvpAction(a,ai,m.action_a,b,bi,log);
      if (!firstB) applyPvpAction(b,bi,m.action_b,a,ai,log);
      ai = pvpAliveIndex(a,ai); bi = pvpAliveIndex(b,bi);
      const aLost = ai < 0, bLost = bi < 0;
      const finished = aLost || bLost;
      const winner = finished ? (aLost ? m.player_b : m.player_a) : null;
      if (finished) log.push(aLost ? 'A equipe de '+(m.name_a||'Treinador')+' foi derrotada.' : 'A equipe de '+(m.name_b||'Treinador')+' foi derrotada.');
      const payload = {team_a:a,team_b:b,active_a:Math.max(0,ai),active_b:Math.max(0,bi),status:finished?'finished':'active',winner_id:winner,last_log:log.join(' ')};
      const r = await socialCall('pj_pvp_resolve',{p_match_id:m.id,p_turn:m.turn,p_result:payload});
      if (r.ok) { await fetchPvpMatch(); if (document.querySelector('.nav button[data-page="pvp"].active')) renderPvpPage(false); if (finished && typeof toast==='function') toast(winner===session.playerId?'Você venceu a batalha!':'Você perdeu a batalha.'); }
    } finally { pvpResolving = false; }
  }
  function mountPvpNav() {
    const nav = document.querySelector('.nav'); if (!nav || nav.querySelector('[data-page="pvp"]')) return;
    const label = document.createElement('small'); label.textContent = 'Combate online';
    const btn = document.createElement('button'); btn.type='button'; btn.dataset.page='pvp'; btn.textContent='⚔️ Batalha PvP';
    btn.addEventListener('click',openPvpPage); nav.append(label,btn);
  }

  /* ---------- API pública ---------- */
  window.PJAccount = {
    rpc, logout, syncNow, refreshOnlinePlayers, openFriends: renderFriendsPage, openPvp: openPvpPage,
    session: () => (session ? { username: session.username, playerId: session.playerId } : null),
    token: () => (session ? session.token : null),
    isOnline: () => online,
    status: () => syncStatus,
    meta: getMeta
  };

  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_KEY) {
    ensureGate(); setHero('Configuração ausente', 'O arquivo account/config.js precisa da URL e da chave publishable do Supabase.');
    gate.querySelector('#pjCard').innerHTML = '<p class="pj-msg error">Configuração do servidor ausente.</p>';
    return;
  }
  boot();
})();
