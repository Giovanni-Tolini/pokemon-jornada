-- =====================================================================
--  POKÉMON JORNADA ALOLA — Contas e saves online (Supabase)
--  Cole este arquivo inteiro no SQL Editor do Supabase e clique em RUN.
--  É seguro executá-lo mais de uma vez (idempotente): não apaga contas.
--
--  Modelo de segurança:
--   * As tabelas têm RLS ativado e NENHUMA policy, e o acesso direto
--     de "anon"/"authenticated" é revogado. Com a chave publishable
--     ninguém consegue ler/gravar tabelas diretamente.
--   * Todo acesso passa por funções (RPC) SECURITY DEFINER, que validam
--     tudo no servidor: nome, senha, sessão e dono do save.
--   * Senhas: bcrypt (pgcrypto: crypt + gen_salt('bf')). Nunca em texto puro.
--   * Sessões: token aleatório de 256 bits; só o hash SHA-256 fica no banco.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- TABELAS
-- ---------------------------------------------------------------------
create table if not exists public.pj_players (
  id            uuid primary key default gen_random_uuid(),
  username      text        not null,            -- como o jogador digitou
  username_key  text        not null,            -- minúsculo; usado p/ unicidade
  password_hash text        not null,            -- bcrypt
  created_at    timestamptz not null default now(),
  last_login_at timestamptz,
  constraint pj_players_username_key_unique unique (username_key),
  constraint pj_players_username_len check (char_length(username) between 3 and 20)
);

create table if not exists public.pj_sessions (
  token_hash   text primary key,                 -- sha256(token) em hex
  player_id    uuid        not null references public.pj_players(id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null
);
create index if not exists pj_sessions_player_idx on public.pj_sessions(player_id);
create index if not exists pj_sessions_expires_idx on public.pj_sessions(expires_at);

create table if not exists public.pj_saves (      -- usado na ETAPA 2 (sincronização)
  player_id  uuid primary key references public.pj_players(id) on delete cascade,
  data       jsonb       not null,
  revision   bigint      not null default 1,
  updated_at timestamptz not null default now(),
  device     text
);

create table if not exists public.pj_save_backups ( -- cópias de segurança de saves sobrescritos
  id         bigserial primary key,
  player_id  uuid        not null references public.pj_players(id) on delete cascade,
  data       jsonb       not null,
  revision   bigint      not null,
  created_at timestamptz not null default now()
);
create index if not exists pj_save_backups_player_idx on public.pj_save_backups(player_id, created_at desc);

create table if not exists public.pj_attempts (   -- limitação de tentativas
  id           bigserial primary key,
  kind         text        not null,              -- 'login_fail' | 'register'
  key          text        not null,              -- nome (login) ou IP (registro)
  attempted_at timestamptz not null default now()
);
create index if not exists pj_attempts_idx on public.pj_attempts(kind, key, attempted_at desc);

-- ---------------------------------------------------------------------
-- SEGURANÇA DAS TABELAS: RLS ligado, sem policies, sem grants diretos
-- ---------------------------------------------------------------------
alter table public.pj_players      enable row level security;
alter table public.pj_sessions     enable row level security;
alter table public.pj_saves        enable row level security;
alter table public.pj_save_backups enable row level security;
alter table public.pj_attempts     enable row level security;

revoke all on public.pj_players, public.pj_sessions, public.pj_saves,
              public.pj_save_backups, public.pj_attempts from anon, authenticated;
revoke all on sequence public.pj_save_backups_id_seq, public.pj_attempts_id_seq from anon, authenticated;

-- ---------------------------------------------------------------------
-- FUNÇÕES INTERNAS (não expostas ao navegador)
-- ---------------------------------------------------------------------
create or replace function public._pj_err(p_code text, p_msg text)
returns jsonb language sql immutable as $$
  select jsonb_build_object('ok', false, 'error', p_code, 'message', p_msg)
$$;

-- Cria sessão e devolve o token em texto (só aqui ele existe em claro).
create or replace function public._pj_new_session(p_player uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_token text := encode(gen_random_bytes(32), 'hex');
begin
  insert into public.pj_sessions(token_hash, player_id, expires_at)
  values (encode(digest(v_token, 'sha256'), 'hex'), p_player, now() + interval '90 days');
  return v_token;
end $$;

-- Token -> id do jogador (ou NULL). Renova a sessão (janela deslizante).
create or replace function public._pj_auth(p_token text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text; v_player uuid; v_seen timestamptz;
begin
  if p_token is null or length(p_token) < 32 or length(p_token) > 200 then return null; end if;
  v_hash := encode(digest(p_token, 'sha256'), 'hex');
  select player_id, last_seen_at into v_player, v_seen
    from public.pj_sessions where token_hash = v_hash and expires_at > now();
  if v_player is null then return null; end if;
  if v_seen < now() - interval '1 hour' then
    update public.pj_sessions
       set last_seen_at = now(), expires_at = now() + interval '90 days'
     where token_hash = v_hash;
  end if;
  return v_player;
end $$;

create or replace function public._pj_save_summary(p_data jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'trainer',    p_data->>'name',
    'level',      p_data->'trainerLevel',
    'money',      p_data->'money',
    'party',      case when jsonb_typeof(p_data->'party')='array' then jsonb_array_length(p_data->'party') else 0 end,
    'stored',     case when jsonb_typeof(p_data->'pc')='array'    then jsonb_array_length(p_data->'pc')    else 0 end,
    'started',    coalesce((p_data->>'started')::boolean, false))
$$;

create or replace function public._pj_client_ip()
returns text language plpgsql stable as $$
declare h text;
begin
  h := current_setting('request.headers', true);
  if h is null or h = '' then return null; end if;
  return nullif(btrim(split_part(coalesce((h::jsonb)->>'x-forwarded-for', ''), ',', 1)), '');
exception when others then return null;
end $$;

-- ---------------------------------------------------------------------
-- API PÚBLICA (RPC) — é isto que o jogo chama
-- ---------------------------------------------------------------------

-- Cadastro ------------------------------------------------------------
create or replace function public.pj_register(p_username text, p_password text, p_confirm text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_name text := btrim(coalesce(p_username, ''));
  v_key  text;
  v_id   uuid;
  v_ip   text := public._pj_client_ip();
begin
  if char_length(v_name) < 3 or char_length(v_name) > 20
     or v_name !~ '^[A-Za-z0-9À-ÖØ-öø-ÿ_. -]+$'
     or v_name !~ '[A-Za-z0-9À-ÖØ-öø-ÿ]'
     or v_name ~ '  ' then
    return public._pj_err('invalid_username',
      'Nome inválido. Use de 3 a 20 caracteres: letras, números, espaço, ponto, hífen ou sublinhado.');
  end if;
  if p_password is null or char_length(p_password) < 8 then
    return public._pj_err('weak_password', 'A senha precisa ter pelo menos 8 caracteres.');
  end if;
  if octet_length(p_password) > 72 then
    return public._pj_err('password_too_long', 'A senha é longa demais (máximo de 72 bytes).');
  end if;
  if p_confirm is distinct from p_password then
    return public._pj_err('password_mismatch', 'A confirmação de senha não confere.');
  end if;

  v_key := lower(v_name);

  -- Anti-spam de cadastros por IP (só quando o IP é conhecido)
  if v_ip is not null then
    if (select count(*) from public.pj_attempts
         where kind = 'register' and key = v_ip and attempted_at > now() - interval '1 hour') >= 10 then
      return public._pj_err('too_many_attempts', 'Muitos cadastros deste local. Tente novamente mais tarde.');
    end if;
    insert into public.pj_attempts(kind, key) values ('register', v_ip);
  end if;

  -- A unicidade é garantida pelo índice único: seguro contra cadastros simultâneos.
  begin
    insert into public.pj_players(username, username_key, password_hash)
    values (v_name, v_key, crypt(p_password, gen_salt('bf', 10)))
    returning id into v_id;
  exception when unique_violation then
    return public._pj_err('name_taken', 'Este nome de jogador já está registrado. Escolha outro.');
  end;

  update public.pj_players set last_login_at = now() where id = v_id;
  return jsonb_build_object('ok', true, 'player_id', v_id, 'username', v_name,
                            'token', public._pj_new_session(v_id));
end $$;

-- Login ---------------------------------------------------------------
create or replace function public.pj_login(p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_key  text := lower(btrim(coalesce(p_username, '')));
  v_row  public.pj_players%rowtype;
  v_ok   boolean := false;
begin
  if v_key = '' or p_password is null or char_length(v_key) > 40 or octet_length(p_password) > 72 then
    return public._pj_err('bad_credentials', 'Nome ou senha incorretos.');
  end if;

  if (select count(*) from public.pj_attempts
       where kind = 'login_fail' and key = v_key and attempted_at > now() - interval '10 minutes') >= 8 then
    return public._pj_err('too_many_attempts',
      'Muitas tentativas incorretas. Aguarde alguns minutos e tente de novo.');
  end if;

  select * into v_row from public.pj_players where username_key = v_key;
  if found then
    v_ok := (crypt(p_password, v_row.password_hash) = v_row.password_hash);
  else
    perform crypt(p_password, gen_salt('bf', 10));  -- gasta o mesmo tempo quando o nome não existe
  end if;

  if not v_ok then
    insert into public.pj_attempts(kind, key) values ('login_fail', v_key);
    delete from public.pj_attempts where attempted_at < now() - interval '1 day';
    return public._pj_err('bad_credentials', 'Nome ou senha incorretos.');
  end if;

  delete from public.pj_attempts where kind = 'login_fail' and key = v_key;
  delete from public.pj_sessions where expires_at < now();
  update public.pj_players set last_login_at = now() where id = v_row.id;
  return jsonb_build_object('ok', true, 'player_id', v_row.id, 'username', v_row.username,
                            'token', public._pj_new_session(v_row.id));
end $$;

-- Validar sessão (ao abrir o jogo) -----------------------------------
create or replace function public.pj_validate_session(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_pid uuid := public._pj_auth(p_token); v_name text; v_rev bigint; v_upd timestamptz;
begin
  if v_pid is null then
    return public._pj_err('invalid_session', 'Sua sessão expirou. Entre novamente.');
  end if;
  select username into v_name from public.pj_players where id = v_pid;
  select revision, updated_at into v_rev, v_upd from public.pj_saves where player_id = v_pid;
  return jsonb_build_object('ok', true, 'player_id', v_pid, 'username', v_name,
                            'has_save', v_rev is not null, 'save_revision', v_rev, 'save_updated_at', v_upd);
end $$;

-- Sair ---------------------------------------------------------------
create or replace function public.pj_logout(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_token is not null and length(p_token) between 32 and 200 then
    delete from public.pj_sessions where token_hash = encode(digest(p_token, 'sha256'), 'hex');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Ler save da nuvem (ETAPA 2) ---------------------------------------
create or replace function public.pj_get_save(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_pid uuid := public._pj_auth(p_token); r public.pj_saves%rowtype;
begin
  if v_pid is null then return public._pj_err('invalid_session', 'Sua sessão expirou. Entre novamente.'); end if;
  select * into r from public.pj_saves where player_id = v_pid;
  if not found then return jsonb_build_object('ok', true, 'has_save', false, 'revision', 0); end if;
  return jsonb_build_object('ok', true, 'has_save', true, 'data', r.data, 'revision', r.revision,
                            'updated_at', r.updated_at, 'summary', public._pj_save_summary(r.data));
end $$;

-- Gravar save na nuvem (ETAPA 2) ------------------------------------
-- Concorrência otimista: só grava se p_base_revision == revisão atual.
-- Caso contrário devolve 'conflict' (nunca sobrescreve em silêncio).
-- p_force = true só deve ser usado depois de o jogador escolher "manter o meu".
-- O save anterior é copiado para pj_save_backups antes de ser substituído.
create or replace function public.pj_put_save(p_token text, p_data jsonb, p_base_revision bigint default 0,
                                              p_force boolean default false, p_device text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_pid uuid := public._pj_auth(p_token);
  r public.pj_saves%rowtype;
  v_new bigint;
begin
  if v_pid is null then return public._pj_err('invalid_session', 'Sua sessão expirou. Entre novamente.'); end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    return public._pj_err('invalid_data', 'Dados de save inválidos.');
  end if;
  if octet_length(p_data::text) > 6000000 then
    return public._pj_err('too_large', 'O save é grande demais.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('pj_save:' || v_pid::text, 0));  -- serializa por jogador
  select * into r from public.pj_saves where player_id = v_pid;

  if not found then
    if coalesce(p_base_revision, 0) <> 0 and not coalesce(p_force, false) then
      return jsonb_build_object('ok', false, 'error', 'conflict', 'revision', 0,
                                'message', 'O save da nuvem mudou. Escolha qual manter.');
    end if;
    insert into public.pj_saves(player_id, data, revision, device) values (v_pid, p_data, 1, left(p_device, 80));
    return jsonb_build_object('ok', true, 'revision', 1, 'updated_at', now());
  end if;

  if not coalesce(p_force, false) and coalesce(p_base_revision, -1) <> r.revision then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'revision', r.revision,
                              'updated_at', r.updated_at, 'summary', public._pj_save_summary(r.data),
                              'message', 'O save da nuvem mudou em outro dispositivo. Escolha qual manter.');
  end if;

  -- backup: sempre ao forçar; senão no máx. 1 a cada 30 min. Guarda os 5 mais recentes.
  if coalesce(p_force, false)
     or not exists (select 1 from public.pj_save_backups
                     where player_id = v_pid and created_at > now() - interval '30 minutes') then
    insert into public.pj_save_backups(player_id, data, revision) values (v_pid, r.data, r.revision);
    delete from public.pj_save_backups
     where player_id = v_pid
       and id not in (select id from public.pj_save_backups where player_id = v_pid
                       order by created_at desc, id desc limit 5);
  end if;

  v_new := r.revision + 1;
  update public.pj_saves set data = p_data, revision = v_new, updated_at = now(), device = left(p_device, 80)
   where player_id = v_pid;
  return jsonb_build_object('ok', true, 'revision', v_new, 'updated_at', now());
end $$;

-- ---------------------------------------------------------------------
-- PERMISSÕES: só as funções públicas podem ser chamadas pelo navegador
-- ---------------------------------------------------------------------
revoke all on function public._pj_err(text, text)               from public, anon, authenticated;
revoke all on function public._pj_new_session(uuid)             from public, anon, authenticated;
revoke all on function public._pj_auth(text)                    from public, anon, authenticated;
revoke all on function public._pj_save_summary(jsonb)           from public, anon, authenticated;
revoke all on function public._pj_client_ip()                   from public, anon, authenticated;

revoke all on function public.pj_register(text, text, text)     from public;
revoke all on function public.pj_login(text, text)              from public;
revoke all on function public.pj_validate_session(text)         from public;
revoke all on function public.pj_logout(text)                   from public;
revoke all on function public.pj_get_save(text)                 from public;
revoke all on function public.pj_put_save(text, jsonb, bigint, boolean, text) from public;

grant execute on function public.pj_register(text, text, text)  to anon, authenticated;
grant execute on function public.pj_login(text, text)           to anon, authenticated;
grant execute on function public.pj_validate_session(text)      to anon, authenticated;
grant execute on function public.pj_logout(text)                to anon, authenticated;
grant execute on function public.pj_get_save(text)              to anon, authenticated;
grant execute on function public.pj_put_save(text, jsonb, bigint, boolean, text) to anon, authenticated;

-- Pede ao PostgREST (API do Supabase) para recarregar o esquema.
notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- ETAPA 3: presença online e perfis públicos de treinadores
-- A presença expira automaticamente após 2 minutos sem heartbeat.
-- Apenas dados públicos do save são retornados; nunca senha/token.
-- ---------------------------------------------------------------------
create table if not exists public.pj_presence (
  player_id uuid primary key references public.pj_players(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);
create index if not exists pj_presence_seen_idx on public.pj_presence(last_seen_at desc);
alter table public.pj_presence enable row level security;
revoke all on public.pj_presence from anon, authenticated;

create or replace function public.pj_presence_ping(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_pid uuid := public._pj_auth(p_token);
begin
  if v_pid is null then return public._pj_err('invalid_session','Sessão inválida.'); end if;
  insert into public.pj_presence(player_id,last_seen_at) values(v_pid,now())
  on conflict(player_id) do update set last_seen_at=excluded.last_seen_at;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.pj_online_players(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_pid uuid := public._pj_auth(p_token); v_result jsonb;
begin
  if v_pid is null then return public._pj_err('invalid_session','Sessão inválida.'); end if;
  delete from public.pj_presence where last_seen_at < now() - interval '2 minutes';
  select coalesce(jsonb_agg(jsonb_build_object(
    'player_id',p.id,
    'username',p.username,
    'last_seen_at',pr.last_seen_at,
    'profile', case when s.data is null then '{}'::jsonb else jsonb_build_object(
      'name',coalesce(s.data->>'name',p.username),
      'rank',coalesce(s.data->'rank','1'::jsonb),
      'trainerAvatar',coalesce(s.data->>'trainerAvatar','red'),
      'initialRegion',coalesce(s.data->'initialRegion',s.data->'region','0'::jsonb),
      'region',coalesce(s.data->'region','0'::jsonb),
      'party',case when jsonb_typeof(s.data->'party')='array' then
        (select coalesce(jsonb_agg(jsonb_build_object(
          'name',m->>'name','level',m->'level','sprite',m->>'sprite','id',m->'id'
        ) order by ord),'[]'::jsonb)
         from jsonb_array_elements(s.data->'party') with ordinality as t(m,ord) where ord<=6)
        else '[]'::jsonb end,
      'wins',coalesce(s.data->'wins','0'::jsonb),
      'trainerWins',coalesce(s.data->'trainerWins','0'::jsonb),
      'losses',coalesce(s.data->'losses','0'::jsonb),
      'challenges',coalesce(s.data->'challenges','{}'::jsonb),
      'tournamentChampions',coalesce(s.data->'tournamentChampions','{}'::jsonb),
      'leagueChampions',coalesce(s.data->'leagueChampions','{}'::jsonb),
      'alolaZRewardsClaimed',coalesce(s.data->'alolaZRewardsClaimed','{}'::jsonb)
    ) end
  ) order by pr.last_seen_at desc),'[]'::jsonb)
  into v_result
  from public.pj_presence pr
  join public.pj_players p on p.id=pr.player_id
  left join public.pj_saves s on s.player_id=p.id
  where pr.last_seen_at >= now() - interval '2 minutes';
  return jsonb_build_object('ok',true,'players',v_result,'self',v_pid);
end $$;

revoke all on function public.pj_presence_ping(text) from public;
revoke all on function public.pj_online_players(text) from public;
grant execute on function public.pj_presence_ping(text) to anon, authenticated;
grant execute on function public.pj_online_players(text) to anon, authenticated;
notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- ETAPA 4: amizades e solicitações de batalha
-- ---------------------------------------------------------------------
create table if not exists public.pj_friend_requests (
  id bigserial primary key,
  sender_id uuid not null references public.pj_players(id) on delete cascade,
  receiver_id uuid not null references public.pj_players(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pj_friend_request_not_self check (sender_id <> receiver_id)
);
create index if not exists pj_friend_requests_receiver_idx on public.pj_friend_requests(receiver_id,status,created_at desc);
create index if not exists pj_friend_requests_sender_idx on public.pj_friend_requests(sender_id,status,created_at desc);

create table if not exists public.pj_friendships (
  player_low uuid not null references public.pj_players(id) on delete cascade,
  player_high uuid not null references public.pj_players(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(player_low,player_high),
  constraint pj_friendship_order check (player_low < player_high)
);

create table if not exists public.pj_battle_requests (
  id bigserial primary key,
  sender_id uuid not null references public.pj_players(id) on delete cascade,
  receiver_id uuid not null references public.pj_players(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pj_battle_request_not_self check (sender_id <> receiver_id)
);
create index if not exists pj_battle_requests_receiver_idx on public.pj_battle_requests(receiver_id,status,created_at desc);
create index if not exists pj_battle_requests_sender_idx on public.pj_battle_requests(sender_id,status,created_at desc);

alter table public.pj_friend_requests enable row level security;
alter table public.pj_friendships enable row level security;
alter table public.pj_battle_requests enable row level security;
revoke all on public.pj_friend_requests,public.pj_friendships,public.pj_battle_requests from anon,authenticated;
revoke all on sequence public.pj_friend_requests_id_seq,public.pj_battle_requests_id_seq from anon,authenticated;

create or replace function public.pj_friend_request(p_token text,p_target uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_pid uuid:=public._pj_auth(p_token); v_low uuid; v_high uuid;
begin
  if v_pid is null then return public._pj_err('invalid_session','Sessão inválida.'); end if;
  if p_target is null or p_target=v_pid or not exists(select 1 from public.pj_players where id=p_target) then
    return public._pj_err('invalid_target','Jogador inválido.'); end if;
  v_low:=least(v_pid,p_target); v_high:=greatest(v_pid,p_target);
  if exists(select 1 from public.pj_friendships where player_low=v_low and player_high=v_high) then
    return jsonb_build_object('ok',false,'error','already_friends','message','Vocês já são amigos.'); end if;
  if exists(select 1 from public.pj_friend_requests where status='pending' and ((sender_id=v_pid and receiver_id=p_target) or (sender_id=p_target and receiver_id=v_pid))) then
    return jsonb_build_object('ok',false,'error','request_pending','message','Já existe um pedido de amizade pendente entre vocês.'); end if;
  insert into public.pj_friend_requests(sender_id,receiver_id) values(v_pid,p_target);
  return jsonb_build_object('ok',true,'message','Pedido de amizade enviado.');
end $$;

create or replace function public.pj_friend_respond(p_token text,p_request_id bigint,p_accept boolean)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_pid uuid:=public._pj_auth(p_token); v_sender uuid; v_receiver uuid; v_status text;
begin
  if v_pid is null then return public._pj_err('invalid_session','Sessão inválida.'); end if;
  select sender_id,receiver_id,status into v_sender,v_receiver,v_status from public.pj_friend_requests where id=p_request_id for update;
  if v_receiver is distinct from v_pid or v_status is distinct from 'pending' then return public._pj_err('not_found','Pedido não encontrado ou já respondido.'); end if;
  update public.pj_friend_requests set status=case when p_accept then 'accepted' else 'declined' end,updated_at=now() where id=p_request_id;
  if p_accept then insert into public.pj_friendships(player_low,player_high) values(least(v_sender,v_receiver),greatest(v_sender,v_receiver)) on conflict do nothing; end if;
  return jsonb_build_object('ok',true,'message',case when p_accept then 'Pedido aceito. Vocês agora são amigos!' else 'Pedido recusado.' end);
end $$;

create or replace function public.pj_battle_request(p_token text,p_target uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_pid uuid:=public._pj_auth(p_token);
begin
  if v_pid is null then return public._pj_err('invalid_session','Sessão inválida.'); end if;
  if p_target is null or p_target=v_pid or not exists(select 1 from public.pj_players where id=p_target) then return public._pj_err('invalid_target','Jogador inválido.'); end if;
  if exists(select 1 from public.pj_battle_requests where status='pending' and created_at>now()-interval '10 minutes' and ((sender_id=v_pid and receiver_id=p_target) or (sender_id=p_target and receiver_id=v_pid))) then
    return jsonb_build_object('ok',false,'error','request_pending','message','Já existe uma solicitação de batalha pendente entre vocês.'); end if;
  insert into public.pj_battle_requests(sender_id,receiver_id) values(v_pid,p_target);
  return jsonb_build_object('ok',true,'message','Solicitação de batalha enviada.');
end $$;

create or replace function public.pj_battle_respond(p_token text,p_request_id bigint,p_accept boolean)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_pid uuid:=public._pj_auth(p_token); v_receiver uuid; v_status text; v_created timestamptz;
begin
  if v_pid is null then return public._pj_err('invalid_session','Sessão inválida.'); end if;
  select receiver_id,status,created_at into v_receiver,v_status,v_created from public.pj_battle_requests where id=p_request_id for update;
  if v_receiver is distinct from v_pid or v_status is distinct from 'pending' or v_created<now()-interval '10 minutes' then return public._pj_err('not_found','Solicitação não encontrada ou expirada.'); end if;
  update public.pj_battle_requests set status=case when p_accept then 'accepted' else 'declined' end,updated_at=now() where id=p_request_id;
  return jsonb_build_object('ok',true,'message',case when p_accept then 'Desafio aceito! Agora combinem o início da batalha.' else 'Desafio recusado.' end);
end $$;

create or replace function public.pj_social_data(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_pid uuid:=public._pj_auth(p_token); v_friends jsonb; v_fi jsonb; v_fo jsonb; v_bi jsonb; v_bo jsonb;
begin
  if v_pid is null then return public._pj_err('invalid_session','Sessão inválida.'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('player_id',p.id,'username',p.username,'online',exists(select 1 from public.pj_presence pr where pr.player_id=p.id and pr.last_seen_at>=now()-interval '2 minutes'),'profile',jsonb_build_object('rank',coalesce(s.data->'rank','1'::jsonb),'trainerAvatar',coalesce(s.data->>'trainerAvatar','red'),'initialRegion',coalesce(s.data->'initialRegion',s.data->'region','0'::jsonb),'region',coalesce(s.data->'region','0'::jsonb),'party',coalesce(s.data->'party','[]'::jsonb),'name',coalesce(s.data->>'name',p.username),'wins',coalesce(s.data->'wins','0'::jsonb),'trainerWins',coalesce(s.data->'trainerWins','0'::jsonb),'losses',coalesce(s.data->'losses','0'::jsonb),'challenges',coalesce(s.data->'challenges','{}'::jsonb),'tournamentChampions',coalesce(s.data->'tournamentChampions','{}'::jsonb),'leagueChampions',coalesce(s.data->'leagueChampions','{}'::jsonb),'alolaZRewardsClaimed',coalesce(s.data->'alolaZRewardsClaimed','{}'::jsonb)))),'[]'::jsonb)
  into v_friends from public.pj_friendships f join public.pj_players p on p.id=case when f.player_low=v_pid then f.player_high else f.player_low end left join public.pj_saves s on s.player_id=p.id where f.player_low=v_pid or f.player_high=v_pid;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'player_id',p.id,'username',p.username) order by r.created_at desc),'[]'::jsonb) into v_fi from public.pj_friend_requests r join public.pj_players p on p.id=r.sender_id where r.receiver_id=v_pid and r.status='pending';
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'player_id',p.id,'username',p.username) order by r.created_at desc),'[]'::jsonb) into v_fo from public.pj_friend_requests r join public.pj_players p on p.id=r.receiver_id where r.sender_id=v_pid and r.status='pending';
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'player_id',p.id,'username',p.username) order by r.created_at desc),'[]'::jsonb) into v_bi from public.pj_battle_requests r join public.pj_players p on p.id=r.sender_id where r.receiver_id=v_pid and r.status='pending' and r.created_at>now()-interval '10 minutes';
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'player_id',p.id,'username',p.username,'status',r.status) order by r.created_at desc),'[]'::jsonb) into v_bo from public.pj_battle_requests r join public.pj_players p on p.id=r.receiver_id where r.sender_id=v_pid and r.created_at>now()-interval '10 minutes' and r.status in ('pending','accepted');
  return jsonb_build_object('ok',true,'friends',v_friends,'friend_incoming',v_fi,'friend_outgoing',v_fo,'battle_incoming',v_bi,'battle_outgoing',v_bo);
end $$;

revoke all on function public.pj_friend_request(text,uuid) from public;
revoke all on function public.pj_friend_respond(text,bigint,boolean) from public;
revoke all on function public.pj_battle_request(text,uuid) from public;
revoke all on function public.pj_battle_respond(text,bigint,boolean) from public;
revoke all on function public.pj_social_data(text) from public;
grant execute on function public.pj_friend_request(text,uuid) to anon,authenticated;
grant execute on function public.pj_friend_respond(text,bigint,boolean) to anon,authenticated;
grant execute on function public.pj_battle_request(text,uuid) to anon,authenticated;
grant execute on function public.pj_battle_respond(text,bigint,boolean) to anon,authenticated;
grant execute on function public.pj_social_data(text) to anon,authenticated;
notify pgrst,'reload schema';


-- =====================================================================
-- ETAPA 3: BATALHAS MULTIPLAYER REAIS POR TURNOS
-- =====================================================================
create table if not exists public.pj_pvp_matches (
  id uuid primary key default gen_random_uuid(),
  player_a uuid not null references public.pj_players(id) on delete cascade,
  player_b uuid not null references public.pj_players(id) on delete cascade,
  name_a text not null,
  name_b text not null,
  team_a jsonb not null,
  team_b jsonb not null,
  active_a integer not null default 0,
  active_b integer not null default 0,
  turn integer not null default 1,
  action_a jsonb,
  action_b jsonb,
  status text not null default 'active' check(status in ('active','finished')),
  winner_id uuid references public.pj_players(id),
  last_log text not null default 'A batalha começou!',
  dismissed_a boolean not null default false,
  dismissed_b boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pj_pvp_different_players check(player_a <> player_b)
);
create index if not exists pj_pvp_player_a_idx on public.pj_pvp_matches(player_a,status,updated_at desc);
create index if not exists pj_pvp_player_b_idx on public.pj_pvp_matches(player_b,status,updated_at desc);
alter table public.pj_pvp_matches add column if not exists dismissed_a boolean not null default false;
alter table public.pj_pvp_matches add column if not exists dismissed_b boolean not null default false;
alter table public.pj_pvp_matches enable row level security;
revoke all on public.pj_pvp_matches from anon,authenticated;

-- Ao aceitar um desafio, cria a arena com cópias dos times atuais dos dois jogadores.
create or replace function public.pj_battle_respond(p_token text,p_request_id bigint,p_accept boolean)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare
 v_pid uuid:=public._pj_auth(p_token); v_sender uuid; v_receiver uuid; v_status text; v_created timestamptz;
 v_team_a jsonb; v_team_b jsonb; v_name_a text; v_name_b text; v_match uuid;
begin
 if v_pid is null then return public._pj_err('invalid_session','Sessão inválida.'); end if;
 select sender_id,receiver_id,status,created_at into v_sender,v_receiver,v_status,v_created from public.pj_battle_requests where id=p_request_id for update;
 if v_receiver is distinct from v_pid or v_status is distinct from 'pending' or v_created<now()-interval '10 minutes' then return public._pj_err('not_found','Solicitação não encontrada ou expirada.'); end if;
 if not p_accept then
   update public.pj_battle_requests set status='declined',updated_at=now() where id=p_request_id;
   return jsonb_build_object('ok',true,'message','Desafio recusado.');
 end if;
 if exists(select 1 from public.pj_pvp_matches where status='active' and (player_a in (v_sender,v_receiver) or player_b in (v_sender,v_receiver))) then
   return public._pj_err('already_battling','Um dos treinadores já está em outra batalha.');
 end if;
 select data->'party',coalesce(data->>'name',username) into v_team_a,v_name_a from public.pj_saves join public.pj_players on pj_players.id=pj_saves.player_id where player_id=v_sender;
 select data->'party',coalesce(data->>'name',username) into v_team_b,v_name_b from public.pj_saves join public.pj_players on pj_players.id=pj_saves.player_id where player_id=v_receiver;
 if coalesce(jsonb_typeof(v_team_a),'')<>'array' or coalesce(jsonb_array_length(v_team_a),0)=0 or coalesce(jsonb_typeof(v_team_b),'')<>'array' or coalesce(jsonb_array_length(v_team_b),0)=0 then
   return public._pj_err('empty_party','Os dois treinadores precisam ter ao menos um Pokémon salvo na equipe.');
 end if;
 update public.pj_battle_requests set status='accepted',updated_at=now() where id=p_request_id;
 insert into public.pj_pvp_matches(player_a,player_b,name_a,name_b,team_a,team_b)
 values(v_sender,v_receiver,v_name_a,v_name_b,v_team_a,v_team_b) returning id into v_match;
 return jsonb_build_object('ok',true,'match_id',v_match,'message','Desafio aceito! A batalha começou.');
end $$;

create or replace function public.pj_pvp_get(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_pid uuid:=public._pj_auth(p_token); r public.pj_pvp_matches%rowtype;
begin
 if v_pid is null then return public._pj_err('invalid_session','Sessão inválida.'); end if;
 select * into r from public.pj_pvp_matches where (player_a=v_pid or player_b=v_pid) and (status='active' or updated_at>now()-interval '1 day') and case when player_a=v_pid then not dismissed_a else not dismissed_b end order by (status='active') desc,updated_at desc limit 1;
 if not found then return jsonb_build_object('ok',true,'match',null); end if;
 return jsonb_build_object('ok',true,'match',jsonb_build_object('id',r.id,'player_a',r.player_a,'player_b',r.player_b,'name_a',r.name_a,'name_b',r.name_b,'team_a',r.team_a,'team_b',r.team_b,'active_a',r.active_a,'active_b',r.active_b,'turn',r.turn,'action_a',r.action_a,'action_b',r.action_b,'status',r.status,'winner_id',r.winner_id,'last_log',r.last_log));
end $$;

create or replace function public.pj_pvp_action(p_token text,p_match_id uuid,p_turn integer,p_action jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_pid uuid:=public._pj_auth(p_token); r public.pj_pvp_matches%rowtype;
begin
 if v_pid is null then return public._pj_err('invalid_session','Sessão inválida.'); end if;
 select * into r from public.pj_pvp_matches where id=p_match_id for update;
 if not found or r.status<>'active' or p_turn<>r.turn or (v_pid<>r.player_a and v_pid<>r.player_b) then return public._pj_err('stale_turn','A batalha mudou. Atualize a arena.'); end if;
 if p_action is null or coalesce(p_action->>'type','') not in ('move','switch','mega','z') or (p_action->>'type' in ('move','switch','z') and (coalesce((p_action->>'index')::integer,-1)<0 or (p_action->>'index')::integer>5)) or (p_action->>'type'='mega' and jsonb_typeof(p_action->'applied')<>'object') then return public._pj_err('invalid_action','Jogada inválida.'); end if;
 if v_pid=r.player_a then
   if r.action_a is not null then return public._pj_err('already_played','Você já escolheu sua jogada neste turno.'); end if;
   update public.pj_pvp_matches set action_a=p_action,updated_at=now() where id=p_match_id;
 else
   if r.action_b is not null then return public._pj_err('already_played','Você já escolheu sua jogada neste turno.'); end if;
   update public.pj_pvp_matches set action_b=p_action,updated_at=now() where id=p_match_id;
 end if;
 return jsonb_build_object('ok',true,'message','Jogada enviada.');
end $$;

create or replace function public.pj_pvp_resolve(p_token text,p_match_id uuid,p_turn integer,p_result jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_pid uuid:=public._pj_auth(p_token); r public.pj_pvp_matches%rowtype; v_winner uuid;
begin
 if v_pid is null then return public._pj_err('invalid_session','Sessão inválida.'); end if;
 select * into r from public.pj_pvp_matches where id=p_match_id for update;
 if not found or r.status<>'active' or r.turn<>p_turn or (v_pid<>r.player_a and v_pid<>r.player_b) then return public._pj_err('stale_turn','Este turno já foi resolvido.'); end if;
 if r.action_a is null or r.action_b is null then return public._pj_err('waiting_player','Aguardando os dois treinadores escolherem suas jogadas.'); end if;
 if jsonb_typeof(p_result->'team_a')<>'array' or jsonb_typeof(p_result->'team_b')<>'array' then return public._pj_err('invalid_result','Resultado de batalha inválido.'); end if;
 v_winner:=nullif(p_result->>'winner_id','')::uuid;
 update public.pj_pvp_matches set team_a=p_result->'team_a',team_b=p_result->'team_b',active_a=greatest(0,coalesce((p_result->>'active_a')::integer,0)),active_b=greatest(0,coalesce((p_result->>'active_b')::integer,0)),status=case when p_result->>'status'='finished' then 'finished' else 'active' end,winner_id=v_winner,last_log=left(coalesce(p_result->>'last_log','Turno concluído.'),1000),turn=turn+1,action_a=null,action_b=null,updated_at=now() where id=p_match_id;
 if v_winner is not null then
   update public.pj_saves set data=jsonb_set(jsonb_set(data,'{wins}',to_jsonb(coalesce((data->>'wins')::integer,0)+case when player_id=v_winner then 1 else 0 end),true),'{trainerWins}',to_jsonb(coalesce((data->>'trainerWins')::integer,0)+case when player_id=v_winner then 1 else 0 end),true),updated_at=now() where player_id in (r.player_a,r.player_b) and player_id=v_winner;
   update public.pj_saves set data=jsonb_set(data,'{losses}',to_jsonb(coalesce((data->>'losses')::integer,0)+1),true),updated_at=now() where player_id in (r.player_a,r.player_b) and player_id<>v_winner;
 end if;
 return jsonb_build_object('ok',true,'message','Turno sincronizado.');
end $$;

create or replace function public.pj_pvp_close(p_token text,p_match_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_pid uuid:=public._pj_auth(p_token); r public.pj_pvp_matches%rowtype;
begin
 if v_pid is null then return public._pj_err('invalid_session','Sessão inválida.'); end if;
 select * into r from public.pj_pvp_matches where id=p_match_id for update;
 if not found or (v_pid<>r.player_a and v_pid<>r.player_b) then return public._pj_err('not_found','Batalha não encontrada.'); end if;
 if r.status<>'finished' then return public._pj_err('still_active','Só é possível fechar uma batalha encerrada.'); end if;
 if v_pid=r.player_a then update public.pj_pvp_matches set dismissed_a=true,updated_at=now() where id=p_match_id;
 else update public.pj_pvp_matches set dismissed_b=true,updated_at=now() where id=p_match_id; end if;
 return jsonb_build_object('ok',true,'message','Batalha fechada.');
end $$;

revoke all on function public.pj_pvp_get(text) from public;
revoke all on function public.pj_pvp_action(text,uuid,integer,jsonb) from public;
revoke all on function public.pj_pvp_resolve(text,uuid,integer,jsonb) from public;
revoke all on function public.pj_pvp_close(text,uuid) from public;
grant execute on function public.pj_pvp_get(text) to anon,authenticated;
grant execute on function public.pj_pvp_action(text,uuid,integer,jsonb) to anon,authenticated;
grant execute on function public.pj_pvp_resolve(text,uuid,integer,jsonb) to anon,authenticated;
grant execute on function public.pj_pvp_close(text,uuid) to anon,authenticated;
notify pgrst,'reload schema';
