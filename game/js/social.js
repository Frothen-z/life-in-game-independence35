import { createSocialService } from './services/social-service.js';

let api;
let service;
let socialChannel;
let activeConversation;
let socialAbort;

const $ = (selector) => document.querySelector(selector);

function socialError(error) {
  const text = String(error?.message || error || '').toLowerCase();
  if (text.includes('already_friends')) return 'Вы уже друзья';
  if (text.includes('incoming_request_exists')) return 'У этого пользователя уже есть заявка для вас';
  if (text.includes('contact_blocked')) return 'Контакт недоступен';
  if (text.includes('friends_only')) return 'Личные сообщения доступны друзьям';
  if (text.includes('rate_limited')) return 'Слишком быстро. Подождите секунду';
  return 'Не удалось выполнить действие. Попробуйте ещё раз';
}

function setSocialStatus(message = '') {
  const element = $('#social-status');
  if (element) element.textContent = message;
}

function avatar(profile) {
  const element = document.createElement('div');
  element.className = 'social-avatar';
  if (profile?.photo) element.style.backgroundImage = `url(${profile.photo})`;
  else element.textContent = (profile?.name || '?').slice(0, 1).toUpperCase();
  return element;
}

function button(label, variant, handler) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `social-action ${variant || ''}`.trim();
  element.textContent = label;
  element.addEventListener('click', handler, { signal: socialAbort.signal });
  return element;
}

function userCard(profile, actions = []) {
  const card = document.createElement('article');
  card.className = 'social-user-card';
  card.appendChild(avatar(profile));
  const copy = document.createElement('div');
  copy.className = 'social-user-copy';
  const name = document.createElement('strong');
  name.textContent = profile?.name || 'Игрок';
  const username = document.createElement('span');
  username.textContent = profile?.username ? `@${profile.username}` : '';
  const status = document.createElement('small');
  status.textContent = profile?.status || 'В Life in Game';
  copy.append(name, username, status);
  card.appendChild(copy);
  if (actions.length) {
    const controls = document.createElement('div');
    controls.className = 'social-user-actions';
    actions.forEach((action) => controls.appendChild(action));
    card.appendChild(controls);
  }
  return card;
}

function showPanel(panel) {
  document.querySelectorAll('.social-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.socialTab === panel));
  document.querySelectorAll('.social-panel').forEach((item) => item.classList.toggle('hidden', item.id !== `social-${panel}`));
  setSocialStatus('');
  if (panel === 'people') return;
  if (panel === 'friends') loadFriends();
  if (panel === 'chats') loadConversations();
  if (panel === 'notifications') loadNotifications();
}

async function searchPeople(event) {
  event.preventDefault();
  const query = $('#social-search-input')?.value || '';
  const list = $('#social-search-results');
  if (!service || !list) return;
  list.replaceChildren();
  if (query.trim().length < 2) { setSocialStatus('Введите минимум 2 символа'); return; }
  setSocialStatus('Ищем людей…');
  try {
    const results = await service.searchProfiles(query);
    if (!results.length) {
      const empty = document.createElement('p');
      empty.className = 'social-empty';
      empty.textContent = 'Никого не нашли';
      list.appendChild(empty);
    }
    for (const profile of results) {
      const add = button('Добавить', 'primary', async () => {
        add.disabled = true;
        try {
          await service.sendFriendRequest(profile.id);
          add.textContent = 'Заявка отправлена';
          api.showToast('Заявка в друзья отправлена');
        } catch (error) {
          add.disabled = false;
          api.showToast(socialError(error));
        }
      });
      list.appendChild(userCard(profile, [add]));
    }
    setSocialStatus('');
  } catch (error) {
    setSocialStatus(socialError(error));
  }
}

async function loadFriends() {
  const incoming = $('#social-incoming');
  const friendsList = $('#social-friends-list');
  if (!service || !incoming || !friendsList) return;
  incoming.replaceChildren();
  friendsList.replaceChildren();
  setSocialStatus('Обновляем список друзей…');
  try {
    const [requests, friends] = await Promise.all([service.getIncomingRequests(), service.listFriends()]);
    if (requests.length) {
      const title = document.createElement('h3');
      title.className = 'social-section-title';
      title.textContent = `Входящие заявки · ${requests.length}`;
      incoming.appendChild(title);
    }
    for (const request of requests) {
      const accept = button('Принять', 'primary', async () => {
        try { await service.respondToRequest(request.id, true); await loadFriends(); }
        catch (error) { api.showToast(socialError(error)); }
      });
      const decline = button('Отклонить', '', async () => {
        try { await service.respondToRequest(request.id, false); await loadFriends(); }
        catch (error) { api.showToast(socialError(error)); }
      });
      incoming.appendChild(userCard(request.profile, [accept, decline]));
    }
    if (!friends.length) {
      const empty = document.createElement('p');
      empty.className = 'social-empty';
      empty.textContent = 'Здесь появятся ваши друзья';
      friendsList.appendChild(empty);
    }
    for (const friend of friends) {
      const message = button('Сообщение', 'primary', () => openDm(friend));
      friendsList.appendChild(userCard(friend, [message]));
    }
    setSocialStatus('');
  } catch (error) {
    setSocialStatus(socialError(error));
  }
}

async function openDm(friend) {
  try {
    const id = await service.getOrCreateDm(friend.id);
    showPanel('chats');
    await loadConversations();
    await openConversation(id, { participants: [friend] });
  } catch (error) {
    api.showToast(socialError(error));
  }
}

function conversationTitle(conversation) {
  if (conversation?.title) return conversation.title;
  const names = (conversation?.participants || []).map((item) => item.name).filter(Boolean);
  return names.join(', ') || 'Диалог';
}

async function loadConversations() {
  const list = $('#social-conversation-list');
  if (!service || !list) return;
  list.replaceChildren();
  try {
    const conversations = await service.listConversations();
    if (!conversations.length) {
      const empty = document.createElement('p');
      empty.className = 'social-empty';
      empty.textContent = 'Откройте диалог из списка друзей';
      list.appendChild(empty);
      return;
    }
    for (const conversation of conversations) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'conversation-row';
      row.textContent = conversationTitle(conversation);
      row.addEventListener('click', () => openConversation(conversation.id, conversation), { signal: socialAbort.signal });
      list.appendChild(row);
    }
  } catch (error) {
    setSocialStatus(socialError(error));
  }
}

async function openConversation(id, meta = {}) {
  activeConversation = id;
  const title = $('#social-chat-title');
  if (title) title.textContent = conversationTitle(meta);
  await loadMessages();
  try { await service.markConversationRead(id); } catch {}
}

async function loadMessages() {
  const list = $('#social-messages');
  if (!service || !list || !activeConversation) return;
  list.replaceChildren();
  try {
    const messages = await service.listMessages(activeConversation);
    for (const message of messages) {
      const item = document.createElement('div');
      item.className = `social-message ${message.sender_id === api.userId() ? 'mine' : ''}`;
      const body = document.createElement('p');
      body.textContent = message.deleted_at ? 'Сообщение удалено' : message.body;
      const time = document.createElement('time');
      time.dateTime = message.created_at;
      time.textContent = new Date(message.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      item.append(body, time);
      list.appendChild(item);
    }
    list.scrollTop = list.scrollHeight;
  } catch (error) {
    setSocialStatus(socialError(error));
  }
}

async function sendMessage(event) {
  event.preventDefault();
  const input = $('#social-message-input');
  const body = input?.value.trim();
  if (!service || !activeConversation) { api.showToast('Сначала выберите диалог'); return; }
  if (!body) return;
  input.disabled = true;
  try {
    await service.sendMessage(activeConversation, body);
    input.value = '';
    await loadMessages();
  } catch (error) {
    api.showToast(socialError(error));
  } finally {
    input.disabled = false;
    input.focus();
  }
}

function notificationText(item) {
  const name = item.actor?.name || 'Пользователь';
  if (item.kind === 'friend_request') return `${name} отправил(а) заявку в друзья`;
  if (item.kind === 'friend_accepted') return `${name} принял(а) вашу заявку`;
  if (item.kind === 'message') return `${name} отправил(а) сообщение`;
  return 'Новое уведомление';
}

async function refreshBadge() {
  if (!service) return;
  try {
    const notifications = await service.listNotifications();
    const unread = notifications.filter((item) => !item.read_at).length;
    const badge = $('#social-badge');
    if (badge) {
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.classList.toggle('hidden', unread === 0);
    }
  } catch {}
}

async function loadNotifications() {
  const list = $('#social-notification-list');
  if (!service || !list) return;
  list.replaceChildren();
  try {
    const items = await service.listNotifications();
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'social-empty';
      empty.textContent = 'Новых уведомлений нет';
      list.appendChild(empty);
    }
    for (const item of items) {
      const row = document.createElement('article');
      row.className = `notification-row ${item.read_at ? '' : 'unread'}`;
      row.appendChild(avatar(item.actor));
      const text = document.createElement('p');
      text.textContent = notificationText(item);
      row.appendChild(text);
      list.appendChild(row);
    }
    await service.markNotificationsRead();
    await refreshBadge();
  } catch (error) {
    setSocialStatus(socialError(error));
  }
}

function openSocial() {
  const overlay = $('#social-overlay');
  overlay?.classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  const authGate = $('#social-auth-gate');
  const content = $('#social-content');
  const authenticated = api.isAuthenticated();
  authGate?.classList.toggle('hidden', authenticated);
  content?.classList.toggle('hidden', !authenticated);
  if (authenticated) showPanel('friends');
}

function closeSocial() {
  $('#social-overlay')?.classList.add('hidden');
}

function injectSocialUI() {
  if ($('#social-overlay')) return;
  const root = document.createElement('div');
  root.innerHTML = `
    <div id="social-overlay" class="social-overlay hidden">
      <section class="social-card" role="dialog" aria-modal="true" aria-labelledby="social-title">
        <header class="social-head">
          <div><span class="social-kicker">Life in Game</span><h2 id="social-title">Сообщество</h2></div>
          <button type="button" class="modal-close" id="social-close" aria-label="Закрыть">✕</button>
        </header>
        <div id="social-auth-gate" class="social-auth-gate hidden">
          <h3>Войдите в облачный аккаунт</h3>
          <p>Друзья, сообщения и уведомления синхронизируются между устройствами и недоступны гостям.</p>
        </div>
        <div id="social-content">
          <nav class="social-tabs" aria-label="Разделы сообщества">
            <button type="button" class="social-tab" data-social-tab="people">Люди</button>
            <button type="button" class="social-tab active" data-social-tab="friends">Друзья</button>
            <button type="button" class="social-tab" data-social-tab="chats">Чаты</button>
            <button type="button" class="social-tab" data-social-tab="notifications">Уведомления</button>
          </nav>
          <p id="social-status" class="social-status" aria-live="polite"></p>
          <section id="social-people" class="social-panel hidden">
            <form id="social-search-form" class="social-search"><input id="social-search-input" maxlength="40" placeholder="Имя или @логин" aria-label="Поиск людей"><button type="submit">Найти</button></form>
            <div id="social-search-results" class="social-list"></div>
          </section>
          <section id="social-friends" class="social-panel">
            <div id="social-incoming" class="social-list"></div>
            <h3 class="social-section-title">Мои друзья</h3>
            <div id="social-friends-list" class="social-list"></div>
          </section>
          <section id="social-chats" class="social-panel hidden social-chat-layout">
            <aside id="social-conversation-list" class="conversation-list"></aside>
            <div class="social-chat-main">
              <h3 id="social-chat-title">Выберите диалог</h3>
              <div id="social-messages" class="social-messages"></div>
              <form id="social-message-form" class="social-compose"><input id="social-message-input" maxlength="2000" placeholder="Напишите сообщение…" aria-label="Сообщение"><button type="submit">Отправить</button></form>
            </div>
          </section>
          <section id="social-notifications" class="social-panel hidden"><div id="social-notification-list" class="social-list"></div></section>
        </div>
      </section>
    </div>`;
  document.body.appendChild(root.firstElementChild);
}

export function initSocialUI(mainApi) {
  api = mainApi;
  socialAbort = new AbortController();
  injectSocialUI();
  const launch = $('#btn-social');
  launch?.classList.remove('hidden');
  launch?.addEventListener('click', openSocial, { signal: socialAbort.signal });
  $('#social-close')?.addEventListener('click', closeSocial, { signal: socialAbort.signal });
  $('#social-overlay')?.addEventListener('click', (event) => {
    if (event.target?.id === 'social-overlay') closeSocial();
  }, { signal: socialAbort.signal });
  document.querySelectorAll('.social-tab').forEach((tab) => {
    tab.addEventListener('click', () => showPanel(tab.dataset.socialTab), { signal: socialAbort.signal });
  });
  $('#social-search-form')?.addEventListener('submit', searchPeople, { signal: socialAbort.signal });
  $('#social-message-form')?.addEventListener('submit', sendMessage, { signal: socialAbort.signal });
  window.addEventListener('keydown', (event) => { if (event.code === 'Escape') closeSocial(); }, { signal: socialAbort.signal });

  if (api.isAuthenticated()) {
    service = createSocialService(api.client(), api.userId());
    socialChannel = service.subscribe(() => {
      refreshBadge();
      if (activeConversation) loadMessages();
    });
    refreshBadge();
  }
}

export function disposeSocialUI() {
  socialAbort?.abort();
  socialAbort = null;
  if (socialChannel && api?.client()) {
    try { api.client().removeChannel(socialChannel); } catch {}
  }
  socialChannel = null;
  service = null;
  api = null;
  activeConversation = null;
}
