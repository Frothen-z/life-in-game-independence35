import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { initClubs, tryOpenClubNearPlayer, clubHintText, disposeClubs } from './clubs.js';
import { createGovernmentStreet, tryOpenGovNearPlayer, govHintText, setupGovUI, isGovModalOpen, closeGovCard } from './gov.js';
import { createLifecycle } from './core/lifecycle.js';
import { createAuthService, validateRegistration, authErrorMessage } from './services/auth-service.js';
import { createRealtimeRoom } from './services/realtime-room.js';
import { createMediaRoom, isMediaSignal } from './services/media-room.js';
import { sanitizeMafiaState } from './services/game-rules.js';
import { initSocialUI, disposeSocialUI } from './social.js';
import {
  CITY_DESTINATIONS,
  CITY_LAYOUT,
  districtAt,
  distanceToDestination,
  worldToMinimap
} from './world/city-layout.js';

// ========== CONFIG (облегчённый для стабильности) ==========
const CITY_SIZE = 16;          // было 28 — сильно уменьшил, чтобы не подвисало
const BLOCK_SIZE = 11;
const ROAD_WIDTH = 4.2;
const BUILDING_MIN = 5;
const BUILDING_MAX = 22;
const PLAYER_SPEED = 2.35;
const PLAYER_SPRINT = 5.4;
const JUMP_FORCE = 7.8;
const GRAVITY = 22;
const CAMERA_DIST = 5.0;
const CAMERA_HEIGHT = 2.0;
const MOUSE_SENS = 0.00215;
// Playable zone — player & camera cannot leave
const WORLD_BOUNDS = CITY_LAYOUT.bounds;
const ROAD_HALF_W = 5.0; // no grass on asphalt strip

const PLAYER_ACCELERATION = 7.5;
const PLAYER_BRAKING = 10.5;
const PLAYER_TURN_SPEED = Math.PI * 2.35;
const WALK_CYCLE_DISTANCE = 1.35;
const RUN_CYCLE_DISTANCE = 2.4;
const MAX_FRAME_DELTA = 0.1;
const FIXED_STEP = 1 / 120;
const MAX_FIXED_STEPS = 12;
const STEP_BLEND_DAMPING = 9;

// ========== STATE ==========
let scene, camera, renderer, clock;
let player, playerMixer, idleAction = null, walkAction = null;
let skin = null;
let idleSkin = null, walkSkin = null;
let idleMixer = null, walkMixer = null;
let keys = {};
let yaw = 0, pitch = 0.18;
let cameraMode = 'follow'; // 'follow' | 'diablo'
let rmbDown = false;
let mmbDown = false;
let freeCam = false; // pan camera without player
let moveTarget = null; // click-to-move in diablo mode
let camFocus = new THREE.Vector3(0, 0, 0);
const _raycaster = new THREE.Raycaster();
const _mouseNDC = new THREE.Vector2();
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hitPoint = new THREE.Vector3();
let velocityY = 0;
let isGrounded = true;
let isLocked = false;
let buildings = [];
let walkMeshes = []; // ground meshes for height raycast
const _groundRay = new THREE.Raycaster();
const _groundDown = new THREE.Vector3(0, -1, 0);

let fpsAccum = 0, fpsFrames = 0;
let animationFrameId = 0;
let fixedTimeAccumulator = 0;
let eventsController = null;
let isDisposed = false;
const lifecycle = createLifecycle();
let webglSupportCache;
let accountUiReady = false;

// Animation / locomotion helpers
let walkCycle = 0;
let currentSpeed = 0;
let walkBlend = 0;
let runBlend = 0;
let locomotionState = 'idle';
let skinGroundOffset = 0;
let currentUser = null;
let selectedClothes = 'default';
let customAvatarUrl = null;
let avaturnSdk = null;
let avaturnMessageHandler = null;
let avaturnFrameWindow = null;
let refIdleClips = [];
let refWalkClips = [];
let refClipsReady = null;
let restaurantZone = null;
let mafiaZone = null;
let cinemaZone = null;
let cinemaOpen = false;
let cinemaInRoom = false;
let mafiaOpen = false;
let mafiaInGame = false;
let restaurantOpen = false;
let selectedTableId = null;
let orderCart = [];
let joyX = 0, joyY = 0;
let isMobile = false;
let remotePlayers = new Map();
let multiplayerTimer = 0;
let supabaseClient = null;
let authService = null;
let cloudSession = null;
let cloudEnabled = false;
let playerId = null;
let clothingMeshes = { look: [], shoes: [], body: [], hair: [] };
let worldAnimators = [];
let navigationTarget = null;
let cityGuideLastUpdate = 0;

function hasCloudAccount() {
  return cloudEnabled && !!cloudSession?.user?.id && !currentUser?.isGuest;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const MODEL_FORWARD = new THREE.Vector3(0, 0, 1);
const desiredMoveDirection = new THREE.Vector3();
const characterForward = new THREE.Vector3();
const targetTurnQuaternion = new THREE.Quaternion();
const previousPlanarPosition = new THREE.Vector3();
const cameraForwardVector = new THREE.Vector3();
const cameraRightVector = new THREE.Vector3();
const movementStep = new THREE.Vector3();
const candidatePosition = new THREE.Vector3();

const loadingEl = document.getElementById('loading');
const toastEl = document.getElementById('toast');
const fpsEl = document.getElementById('fps');
const loadingText = loadingEl ? loadingEl.querySelector('p') : null;

function setLoading(text) {
  if (loadingText) loadingText.textContent = text;
}

function supportsWebGL() {
  if (typeof webglSupportCache === 'boolean') return webglSupportCache;
  try {
    const probe = document.createElement('canvas');
    webglSupportCache = !!(
      window.WebGLRenderingContext &&
      (probe.getContext('webgl2') || probe.getContext('webgl'))
    );
  } catch {
    webglSupportCache = false;
  }
  return webglSupportCache;
}

function showWebGLFallback() {
  loadingEl?.classList.add('hidden');
  document.getElementById('webgl-fallback')?.classList.remove('hidden');
  const profileButton = document.getElementById('webgl-profile');
  if (profileButton && !profileButton.dataset.bound) {
    profileButton.dataset.bound = '1';
    profileButton.addEventListener('click', openProfileModal);
  }
  const retryButton = document.getElementById('webgl-retry');
  if (retryButton && !retryButton.dataset.bound) {
    retryButton.dataset.bound = '1';
    retryButton.addEventListener('click', () => location.reload());
  }
  setupAccountUI();
}

function setupAccountUI() {
  if (accountUiReady) return;
  accountUiReady = true;
  document.getElementById('btn-profile')?.classList.remove('hidden');
  setupProfileUI();
  initSocialUI({
    client: () => supabaseClient,
    userId: () => cloudSession?.user?.id || playerId,
    isAuthenticated: hasCloudAccount,
    showToast
  });
  const fallbackSocial = document.getElementById('webgl-social');
  if (fallbackSocial && !fallbackSocial.dataset.bound) {
    fallbackSocial.dataset.bound = '1';
    fallbackSocial.addEventListener('click', () => document.getElementById('btn-social')?.click());
  }
}

function setupCityGuide() {
  const list = document.getElementById('city-destinations');
  if (!list || list.dataset.ready) return;
  list.dataset.ready = '1';
  CITY_DESTINATIONS.filter((destination) => destination.id !== 'spawn').forEach((destination) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'city-destination';
    button.dataset.destination = destination.id;
    button.textContent = destination.label;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      navigationTarget = destination;
      list.querySelectorAll('.city-destination').forEach((item) => {
        item.classList.toggle('active', item === button);
      });
      const marker = document.getElementById('city-map-target');
      if (marker) {
        const point = worldToMinimap(destination.x, destination.z);
        marker.style.left = `${point.left}%`;
        marker.style.top = `${point.top}%`;
        marker.classList.remove('hidden');
      }
      showToast(`Маршрут: ${destination.label}`);
    });
    list.appendChild(button);
  });
}

function updateCityGuide(now = 0) {
  if (!player || now - cityGuideLastUpdate < 100) return;
  cityGuideLastUpdate = now;
  const district = document.getElementById('city-district');
  if (district) district.textContent = districtAt(player.position.x, player.position.z);
  const marker = document.getElementById('city-map-player');
  if (marker) {
    const point = worldToMinimap(player.position.x, player.position.z);
    marker.style.left = `${point.left}%`;
    marker.style.top = `${point.top}%`;
    marker.style.transform = `translate(-50%, -50%) rotate(${-player.rotation.y}rad)`;
  }
  const status = document.getElementById('route-status');
  if (status && navigationTarget) {
    const distance = distanceToDestination(player.position, navigationTarget);
    if (distance < 4) {
      status.textContent = `${navigationTarget.label} · вы пришли`;
      document.querySelector(`[data-destination="${navigationTarget.id}"]`)?.classList.add('arrived');
    } else {
      status.textContent = `${navigationTarget.label} · ${Math.ceil(distance)} м`;
    }
  }
}

function smoothTri(t) {
  return t * t * (3 - 2 * t);
}



// ========== RESTAURANT INTERACTION ==========

const RESTAURANT_MENU = [
  { id: 'steak', name: 'Стейк рибай', desc: 'С соусом и овощами', price: 145000, cat: 'Горячее' },
  { id: 'pasta', name: 'Паста карбонара', desc: 'Бекон, пармезан', price: 78000, cat: 'Горячее' },
  { id: 'burger', name: 'Бургер Skyline', desc: 'Говядина, сыр, соус', price: 65000, cat: 'Горячее' },
  { id: 'salad', name: 'Цезарь с курицей', desc: 'Свежий салат', price: 52000, cat: 'Салаты' },
  { id: 'soup', name: 'Том ям', desc: 'Острый креветочный', price: 58000, cat: 'Супы' },
  { id: 'pizza', name: 'Пицца Маргарита', desc: '30 см', price: 72000, cat: 'Горячее' },
  { id: 'dessert', name: 'Чизкейк', desc: 'Нью-Йорк', price: 45000, cat: 'Десерты' },
  { id: 'coffee', name: 'Капучино', desc: '300 мл', price: 28000, cat: 'Напитки' },
  { id: 'juice', name: 'Свежий апельсин', desc: '250 мл', price: 22000, cat: 'Напитки' },
  { id: 'wine', name: 'Бокал вина', desc: 'Красное / белое', price: 55000, cat: 'Напитки' },
];

function formatSum(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' so\'m';
}


const RESTAURANT_TABLES = [
  { id: 1, name: 'Стол 1', seats: 2, free: true },
  { id: 2, name: 'Стол 2', seats: 2, free: true },
  { id: 3, name: 'Стол 3', seats: 4, free: false },
  { id: 4, name: 'Стол 4', seats: 4, free: true },
  { id: 5, name: 'Стол 5', seats: 6, free: true },
  { id: 6, name: 'Стол 6', seats: 2, free: false },
];

function getTableBookings() {
  try {
    const key = 'cityExplorer_tables_v1';
    return JSON.parse(localStorage.getItem(key) || '{}');
  } catch { return {}; }
}
function saveTableBookings(map) {
  localStorage.setItem('cityExplorer_tables_v1', JSON.stringify(map));
}

function isNearRestaurant() {
  if (!player || !restaurantZone) return false;
  const dx = player.position.x - restaurantZone.position.x;
  const dz = player.position.z - restaurantZone.position.z;
  return Math.sqrt(dx * dx + dz * dz) <= restaurantZone.radius;
}

function isNearNamedZone(zone) {
  if (!player || !zone) return false;
  const dx = player.position.x - zone.position.x;
  const dz = player.position.z - zone.position.z;
  return Math.sqrt(dx * dx + dz * dz) <= (zone.radius || 12);
}

function isNearCinema() {
  if (!player || !cinemaZone) return false;
  const dx = player.position.x - cinemaZone.position.x;
  const dz = player.position.z - cinemaZone.position.z;
  return Math.sqrt(dx * dx + dz * dz) <= cinemaZone.radius;
}

function isNearMafia() {
  if (!player || !mafiaZone) return false;
  const dx = player.position.x - mafiaZone.position.x;
  const dz = player.position.z - mafiaZone.position.z;
  return Math.sqrt(dx * dx + dz * dz) <= mafiaZone.radius;
}

function updateInteractHint() {
  const hint = document.getElementById('interact-hint');
  if (!hint) return;
  const menuHidden = document.getElementById('menu')?.classList.contains('hidden');
  if (!menuHidden || restaurantOpen || mafiaOpen || mafiaInGame || cinemaOpen || cinemaInRoom || isGovModalOpen()) {
    hint.classList.add('hidden');
    return;
  }
  if (isNearCinema()) {
    hint.innerHTML = 'Нажми <kbd>E</kbd> — Кинотеатр';
    hint.classList.remove('hidden');
  } else if (isNearMafia()) {
    hint.innerHTML = 'Нажми <kbd>E</kbd> — клуб «Мафия»';
    hint.classList.remove('hidden');
  } else if (isNearRestaurant()) {
    hint.innerHTML = 'Нажми <kbd>E</kbd> — Ресторан';
    hint.classList.remove('hidden');
  } else {
    const govHint = govHintText(player);
    if (govHint) {
      hint.innerHTML = govHint;
      hint.classList.remove('hidden');
    } else {
      const clubHint = clubHintText();
      if (clubHint) {
        hint.innerHTML = clubHint;
        hint.classList.remove('hidden');
      } else {
        hint.classList.add('hidden');
      }
    }
  }
}

function openRestaurantMenu() {
  if (restaurantOpen) return;
  restaurantOpen = true;
  selectedTableId = null;
  const modal = document.getElementById('restaurant-modal');
  modal?.classList.remove('hidden');
  document.getElementById('interact-hint')?.classList.add('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  // Reset tabs to tables
  document.querySelectorAll('.resto-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.panel === 'tables');
  });
  document.getElementById('panel-tables')?.classList.remove('hidden');
  document.getElementById('panel-menu')?.classList.add('hidden');
  document.getElementById('panel-order')?.classList.add('hidden');
  renderTables();
  renderFoodMenu();
  renderOrder();
  const bookBtn = document.getElementById('resto-book');
  if (bookBtn) bookBtn.disabled = true;
  const st = document.getElementById('resto-status');
  if (st) st.textContent = 'Нажми на свободный стол';
}

function closeRestaurantMenu() {
  restaurantOpen = false;
  selectedTableId = null;
  document.getElementById('restaurant-modal')?.classList.add('hidden');
}

function renderTables() {
  const grid = document.getElementById('tables-grid');
  if (!grid) return;
  const bookings = getTableBookings();
  const myName = currentUser?.name || '';
  grid.innerHTML = '';
  RESTAURANT_TABLES.forEach((t) => {
    const bookedBy = bookings[t.id];
    const isMine = bookedBy && bookedBy === myName;
    const isFree = t.free && !bookedBy;
    const card = document.createElement('div');
    let cls = 'table-card ';
    if (isMine) cls += 'mine';
    else if (isFree) cls += 'free';
    else cls += 'busy';
    if (selectedTableId === t.id) cls += ' selected';
    card.className = cls;
    card.innerHTML = `
      <span class="t-icon">🍽️</span>
      <div class="t-name">${t.name}</div>
      <div class="t-seats">${t.seats} места</div>
      <div class="t-status">${isMine ? 'Ваша бронь' : isFree ? 'Свободен' : 'Занят'}</div>
    `;
    if (isFree) {
      card.addEventListener('click', () => {
        selectedTableId = t.id;
        renderTables();
        const bookBtn = document.getElementById('resto-book');
        if (bookBtn) bookBtn.disabled = false;
        const st = document.getElementById('resto-status');
        if (st) st.textContent = `Выбран ${t.name} (${t.seats} мест)`;
      });
    }
    grid.appendChild(card);
  });
}

function bookSelectedTable() {
  if (!selectedTableId || !currentUser) return;
  const bookings = getTableBookings();
  if (bookings[selectedTableId]) {
    showToast('Этот стол уже занят');
    renderTables();
    return;
  }
  bookings[selectedTableId] = currentUser.name;
  saveTableBookings(bookings);
  showToast(`Стол ${selectedTableId} забронирован на ${currentUser.name}`);
  selectedTableId = null;
  renderTables();
  const bookBtn = document.getElementById('resto-book');
  if (bookBtn) bookBtn.disabled = true;
  const st = document.getElementById('resto-status');
  if (st) st.textContent = 'Бронь сохранена';
}

function setupRestaurantUI() {
  document.getElementById('resto-close')?.addEventListener('click', closeRestaurantMenu);
  document.getElementById('resto-book')?.addEventListener('click', bookSelectedTable);
  document.getElementById('resto-order-btn')?.addEventListener('click', submitOrder);
  document.getElementById('restaurant-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'restaurant-modal') closeRestaurantMenu();
  });
  document.querySelectorAll('.resto-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.resto-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const panel = tab.dataset.panel;
      document.getElementById('panel-tables')?.classList.toggle('hidden', panel !== 'tables');
      document.getElementById('panel-menu')?.classList.toggle('hidden', panel !== 'menu');
      document.getElementById('panel-order')?.classList.toggle('hidden', panel !== 'order');
      if (panel === 'menu') renderFoodMenu();
      if (panel === 'order') renderOrder();
    });
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyE') {
      if (!document.getElementById('menu')?.classList.contains('hidden')) return;
      if (mafiaInGame || mafiaOpen || cinemaInRoom || cinemaOpen) return;
      if (document.getElementById('club-lobby') && !document.getElementById('club-lobby').classList.contains('hidden')) return;
      if (document.getElementById('speaking-room') && !document.getElementById('speaking-room').classList.contains('hidden')) return;
      if (document.getElementById('chess-room') && !document.getElementById('chess-room').classList.contains('hidden')) return;
      if (document.getElementById('monopoly-room') && !document.getElementById('monopoly-room').classList.contains('hidden')) return;
      if (typeof tryOpenGovNearPlayer === 'function' && tryOpenGovNearPlayer(player)) return;
      if (tryOpenClubNearPlayer()) return;
      if (isNearCinema()) { openCinemaLobby(); return; }
      if (isNearMafia()) { openMafiaLobby(); return; }
      if (isNearRestaurant() && !restaurantOpen) openRestaurantMenu();
    }
    if (e.code === 'Escape' && restaurantOpen) closeRestaurantMenu();
    if (e.code === 'Escape' && isGovModalOpen()) closeGovCard();
  });
}

function renderFoodMenu() {
  const list = document.getElementById('food-list');
  if (!list) return;
  list.innerHTML = '';
  RESTAURANT_MENU.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'food-item';
    row.innerHTML = `
      <div>
        <div class="f-name">${item.name}</div>
        <div class="f-desc">${item.cat} · ${item.desc}</div>
      </div>
      <div class="f-price">${formatSum(item.price)}</div>
      <button type="button" class="f-add">+ В заказ</button>
    `;
    row.querySelector('.f-add').addEventListener('click', () => {
      addToOrder(item.id);
      showToast(`${item.name} добавлен`);
    });
    list.appendChild(row);
  });
}

function addToOrder(id) {
  const item = RESTAURANT_MENU.find((x) => x.id === id);
  if (!item) return;
  const existing = orderCart.find((x) => x.id === id);
  if (existing) existing.qty += 1;
  else orderCart.push({ id: item.id, name: item.name, price: item.price, qty: 1 });
}

function removeFromOrder(id) {
  orderCart = orderCart.filter((x) => x.id !== id);
  renderOrder();
}

function renderOrder() {
  const list = document.getElementById('order-list');
  const sumEl = document.getElementById('order-sum');
  if (!list) return;
  if (!orderCart.length) {
    list.innerHTML = '<div class="order-empty">Заказ пуст — добавь блюда во вкладке «Меню»</div>';
    if (sumEl) sumEl.textContent = formatSum(0);
    return;
  }
  list.innerHTML = '';
  let total = 0;
  orderCart.forEach((line) => {
    total += line.price * line.qty;
    const row = document.createElement('div');
    row.className = 'order-row';
    row.innerHTML = `
      <div>${line.name}<span class="o-qty">×${line.qty}</span></div>
      <div style="display:flex;align-items:center;gap:10px">
        <span>${formatSum(line.price * line.qty)}</span>
        <button type="button" title="Убрать">✕</button>
      </div>
    `;
    row.querySelector('button').addEventListener('click', () => removeFromOrder(line.id));
    list.appendChild(row);
  });
  if (sumEl) sumEl.textContent = formatSum(total);
}

function submitOrder() {
  if (!orderCart.length) {
    showToast('Добавь блюда в заказ');
    return;
  }
  const total = orderCart.reduce((s, x) => s + x.price * x.qty, 0);
  const summary = orderCart.map((x) => `${x.name}×${x.qty}`).join(', ');
  // Save last order
  try {
    const key = 'cityExplorer_orders_v1';
    const orders = JSON.parse(localStorage.getItem(key) || '[]');
    orders.push({
      user: currentUser?.name || 'guest',
      items: orderCart.slice(),
      total,
      at: Date.now()
    });
    localStorage.setItem(key, JSON.stringify(orders.slice(-20)));
  } catch {}
  showToast(`Заказ на ${formatSum(total)} принят`);
  orderCart = [];
  renderOrder();
}





// ========== PROFILE + MULTIPLAYER ==========
function ensurePlayerId() {
  if (!currentUser) return null;
  if (cloudSession?.user?.id) {
    playerId = cloudSession.user.id;
    return playerId;
  }
  const key = 'cityExplorer_pid_' + (currentUser.username || currentUser.name).toLowerCase();
  let id = localStorage.getItem(key);
  if (!id) {
    id = 'u_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
    localStorage.setItem(key, id);
  }
  playerId = id;
  return id;
}

function getProfileData() {
  if (!currentUser) return {};
  return {
    id: cloudSession?.user?.id || ensurePlayerId(),
    username: currentUser.username,
    name: currentUser.name,
    gender: currentUser.gender || 'male',
    status: currentUser.status || '',
    photo: currentUser.photo || '',
    birthday: currentUser.birthday || null,
    work: currentUser.work || '',
    city: currentUser.city || '',
    about: currentUser.about || '',
    clothes: currentUser.clothes || 'default',
    avatar_url: customAvatarUrl || currentUser.avatarUrl || null,
    avatar_version: Number(currentUser.avatarVersion || 1),
    updated_at: new Date().toISOString()
  };
}

function saveProfileLocal(data) {
  if (!currentUser) return;
  Object.assign(currentUser, {
    status: data.status || '',
    photo: data.photo || '',
    birthday: data.birthday || '',
    work: data.work || '',
    city: data.city || '',
    about: data.about || ''
  });
  if (!hasCloudAccount()) saveGuestProfile(currentUser);
}

function openProfileModal() {
  if (!currentUser) return;
  const modal = document.getElementById('profile-modal');
  modal?.classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();

  document.getElementById('profile-name').value = currentUser.name || '';
  document.getElementById('profile-username').value = currentUser.username ? `@${currentUser.username}` : '—';
  document.getElementById('profile-status').value = currentUser.status || '';
  document.getElementById('profile-city').value = currentUser.city || '';
  document.getElementById('profile-work').value = currentUser.work || '';
  document.getElementById('profile-birthday').value = currentUser.birthday || '';
  document.getElementById('profile-about').value = currentUser.about || '';

  const photoEl = document.getElementById('profile-photo');
  if (photoEl) {
    if (currentUser.photo) {
      photoEl.style.backgroundImage = `url(${currentUser.photo})`;
      photoEl.textContent = '';
    } else {
      photoEl.style.backgroundImage = '';
      photoEl.textContent = currentUser.gender === 'female' ? '👩' : '👨';
    }
  }
  const cloud = document.getElementById('profile-cloud-status');
  if (cloud) cloud.textContent = hasCloudAccount() ? 'Сохранено в облаке' : 'Гость: только это устройство';
}

function closeProfileModal() {
  document.getElementById('profile-modal')?.classList.add('hidden');
}

function setupProfileUI() {
  const profBtn = document.getElementById('btn-profile');
  if (profBtn) {
    profBtn.addEventListener('click', (e) => { e.preventDefault(); openProfileModal(); });
    profBtn.addEventListener('touchend', (e) => { e.preventDefault(); openProfileModal(); }, { passive: false });
  }
  document.getElementById('profile-close')?.addEventListener('click', closeProfileModal);
  document.getElementById('profile-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'profile-modal') closeProfileModal();
  });
  document.getElementById('profile-save')?.addEventListener('click', async () => {
    const data = {
      status: document.getElementById('profile-status')?.value?.trim() || '',
      city: document.getElementById('profile-city')?.value?.trim() || '',
      work: document.getElementById('profile-work')?.value?.trim() || '',
      birthday: document.getElementById('profile-birthday')?.value || '',
      about: document.getElementById('profile-about')?.value?.trim() || '',
      photo: currentUser?.photo || ''
    };
    try {
      saveProfileLocal(data);
      await pushProfileToCloud();
      showToast(hasCloudAccount() ? 'Профиль сохранён в облаке' : 'Гостевой профиль сохранён на устройстве');
      closeProfileModal();
    } catch (error) {
      console.warn('profile save', error);
      showToast('Не удалось сохранить профиль. Попробуйте ещё раз');
    }
  });

  document.getElementById('profile-photo-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;
    if (hasCloudAccount()) {
      try {
        currentUser.photo = await authService.uploadPhoto(cloudSession.user.id, file);
        const photoEl = document.getElementById('profile-photo');
        if (photoEl) { photoEl.style.backgroundImage = `url(${currentUser.photo})`; photoEl.textContent = ''; }
        await pushProfileToCloud();
        showToast('Фото сохранено в облаке');
        return;
      } catch (error) {
        console.warn('profile photo upload', error);
        const code = String(error?.message || '');
        if (code === 'PHOTO_TOO_LARGE') showToast('Фото должно быть меньше 3 МБ');
        else if (code === 'PHOTO_DIMENSIONS_TOO_LARGE') showToast('Фото не должно превышать 4096×4096');
        else if (code === 'UNSUPPORTED_PHOTO_TYPE') showToast('Поддерживаются JPG, PNG и WebP');
        else showToast('Файл не распознан как корректное изображение');
        return;
      }
    }
    if (file.size > 3_000_000) { showToast('Фото должно быть меньше 3 МБ'); return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      showToast('Поддерживаются JPG, PNG и WebP');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      currentUser.photo = reader.result;
      saveGuestProfile(currentUser);
      const photoEl = document.getElementById('profile-photo');
      if (photoEl) {
        photoEl.style.backgroundImage = `url(${currentUser.photo})`;
        photoEl.textContent = '';
      }
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('profile-logout')?.addEventListener('click', async () => {
    try { if (hasCloudAccount()) await authService?.signOut(); } catch {}
    location.reload();
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') closeProfileModal();
  }, eventsController ? { signal: eventsController.signal } : undefined);
}



let p2pSend = null;
let p2pLastSent = 0;
let lastPoseX = 0, lastPoseZ = 0;
let cityRoom = null;
let remoteAvatarTemplate = null;
let remoteAvatarLoading = null;

async function initMultiplayer() {
  ensurePlayerId();
  loadRemoteAvatarTemplates();
  const btn = document.getElementById('btn-profile');
  if (btn) {
    btn.classList.remove('hidden');
    btn.style.zIndex = '50';
    btn.style.pointerEvents = 'auto';
  }
  const onlineEl = document.getElementById('players-online');
  if (onlineEl) {
    onlineEl.classList.remove('hidden');
    onlineEl.textContent = 'Онлайн: подключение…';
  }

  if (hasCloudAccount()) {
    try { await pushProfileToCloud(); }
    catch (error) { console.warn('multiplayer profile sync', error); }
  }

  const roomId = (new URLSearchParams(location.search).get('room') || 'city-main')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 32) || 'city-main';

  if (hasCloudAccount()) {
    try {
      await connectSupabaseMultiplayer(roomId);
      showToast('Город синхронизирован');
      return;
    } catch (e) {
      console.error('Supabase realtime failed', e);
      showToast('Связь с городом потеряна · одиночный режим');
      if (onlineEl) onlineEl.textContent = 'Офлайн · только вы';
      return;
    }
  }

  // Guest mode is intentionally solo. Never fall back to an unauthenticated
  // public broker and pretend it is the real multiplayer.
  showToast('Гостевой режим · мультиплеер доступен после входа');
  if (onlineEl) onlineEl.textContent = 'Гость · одиночный режим';
}

async function connectSupabaseMultiplayer(roomId) {
  cityRoom = createRealtimeRoom({
    client: supabaseClient,
    topic: `city:${roomId}`,
    playerId,
    displayName: currentUser?.name,
    presence: { feature: 'city' },
    onMessage: (payload) => {
      if (!payload || Date.now() - (payload.t || 0) > 12000) return;
      upsertRemotePlayer(payload);
      const entry = remotePlayers.get(payload.id);
      if (entry) entry.lastSeen = Date.now();
    },
    onPresence: (members) => {
      const active = new Set(members.map((member) => String(member.id || member.key)));
      for (const [id, entry] of remotePlayers) {
        if (!active.has(id)) {
          scene?.remove(entry.group);
          remotePlayers.delete(id);
        }
      }
      const el = document.getElementById('players-online');
      if (el) el.textContent = `Онлайн: ${Math.max(1, members.length)}`;
    }
  });
  await cityRoom.connect();
  p2pSend = (payload) => {
    cityRoom.send({ ...payload, id: playerId }).catch((error) => {
      console.warn('city realtime send', error);
    });
  };
  lifecycle.interval(() => broadcastPose(false), 250);
  lifecycle.interval(() => pruneRemotePlayers(), 2000);
  broadcastPose(true);
}

function pruneRemotePlayers() {
  const now = Date.now();
  for (const [id, entry] of remotePlayers) {
    if (entry.lastSeen && now - entry.lastSeen > 10000) {
      scene.remove(entry.group);
      remotePlayers.delete(id);
    }
  }
  const onlineEl = document.getElementById('players-online');
  if (onlineEl) onlineEl.textContent = `Онлайн: ${1 + remotePlayers.size}`;
}

function broadcastPose(force) {
  if (!p2pSend || !player) return;
  const now = performance.now();
  if (!force && now - p2pLastSent < 200) return;
  p2pLastSent = now;
  try {
    // Facing from model forward in world space (stable)
    characterForward
      .copy(MODEL_FORWARD)
      .applyQuaternion(player.quaternion)
      .setY(0);
    if (characterForward.lengthSq() > 1e-6) characterForward.normalize();

    let facing = Math.atan2(characterForward.x, characterForward.z);

    // When moving, face the actual displacement direction so remote
    // walk anim always matches position change (fixes "runs back but faces forward")
    const dx = player.position.x - lastPoseX;
    const dz = player.position.z - lastPoseZ;
    const distSq = dx * dx + dz * dz;
    const moving = currentSpeed > 0.15 ? 1 : 0;
    if (moving && distSq > 1e-5) {
      facing = Math.atan2(dx, dz);
    }
    lastPoseX = player.position.x;
    lastPoseZ = player.position.z;

    p2pSend({
      name: currentUser?.name || 'Игрок',
      x: player.position.x,
      y: player.position.y,
      z: player.position.z,
      rot: facing,
      moving,
      avatar: customAvatarUrl || currentUser?.avatarUrl || null
    });
  } catch (e) {}
}





async function pushProfileToCloud() {
  if (!authService || !cloudSession?.user || !currentUser) return;
  const row = getProfileData();
  await authService.saveProfile(row);
}

async function pushPresence() {
  if (!supabaseClient || !player || !playerId) return;
  try {
    await supabaseClient.from('presence').upsert({
      id: playerId,
      name: currentUser?.name || 'Player',
      x: player.position.x,
      y: player.position.y,
      z: player.position.z,
      rot: player.rotation.y,
      room: 'city',
      updated_at: new Date().toISOString()
    });
  } catch (e) {}
}

async function pullPresence() {
  if (!supabaseClient || !playerId) return;
  try {
    const since = new Date(Date.now() - 15000).toISOString();
    const { data, error } = await supabaseClient
      .from('presence')
      .select('*')
      .eq('room', 'city')
      .gt('updated_at', since);
    if (error || !data) return;
    const seen = new Set();
    data.forEach((row) => {
      if (row.id === playerId) return;
      seen.add(row.id);
      upsertRemotePlayer(row);
    });
    // remove stale
    for (const [id, obj] of remotePlayers) {
      if (!seen.has(id)) {
        scene.remove(obj.group);
        remotePlayers.delete(id);
      }
    }
    const onlineEl = document.getElementById('players-online');
    if (onlineEl) onlineEl.textContent = `Онлайн: ${1 + remotePlayers.size}`;
  } catch (e) {}
}

















let remoteIdleTemplate = null;
let remoteWalkTemplate = null;
let remoteTemplatesLoading = null;

function loadRemoteAvatarTemplates() {
  if (remoteIdleTemplate && remoteWalkTemplate) {
    return Promise.resolve({ idle: remoteIdleTemplate, walk: remoteWalkTemplate });
  }
  if (remoteTemplatesLoading) return remoteTemplatesLoading;

  remoteTemplatesLoading = new Promise((resolve) => {
    const loader = new GLTFLoader();
    const asset = (file) => {
      try { return new URL('models/' + file, window.location.href).href; }
      catch { return 'models/' + file; }
    };

    const loadOne = (url) => new Promise((res) => {
      loader.load(
        url,
        (gltf) => {
          const model = gltf.scene;
          model.traverse((o) => {
            if (o.isMesh) {
              o.castShadow = false;
              o.receiveShadow = false;
            }
          });
          const box = new THREE.Box3().setFromObject(model);
          model.position.y = Number.isFinite(box.min.y) ? -box.min.y : 0;
          const clips = (gltf.animations || []).map((c) => {
            try { return makeInPlaceClip(c); } catch { return c; }
          });
          model.userData.clips = clips;
          res(model);
        },
        undefined,
        () => res(null)
      );
    });

    Promise.all([
      loadOne(asset('model_idle.glb')),
      loadOne(asset('model_walk.glb'))
    ]).then(([idle, walk]) => {
      // Fallbacks
      if (!idle && walk) idle = walk;
      if (!walk && idle) walk = idle;
      if (!idle) {
        return loadOne(asset('model.glb')).then((m) => {
          remoteIdleTemplate = m;
          remoteWalkTemplate = m;
          resolve({ idle: m, walk: m });
        });
      }
      remoteIdleTemplate = idle;
      remoteWalkTemplate = walk;
      console.log('Remote templates', {
        idleClips: idle?.userData?.clips?.map((c) => c.name),
        walkClips: walk?.userData?.clips?.map((c) => c.name)
      });
      resolve({ idle, walk });
    });
  });
  return remoteTemplatesLoading;
}

// alias used by initMultiplayer
function loadRemoteAvatarTemplate() {
  return loadRemoteAvatarTemplates().then((t) => t && t.idle);
}

function createRemoteSkins(idleTpl, walkTpl, opts = {}) {
  const idle = SkeletonUtils.clone(idleTpl);
  const walk = SkeletonUtils.clone(walkTpl);
  idle.name = 'RemoteIdle';
  walk.name = 'RemoteWalk';
  walk.visible = false;

  [idle, walk].forEach((root) => {
    root.rotation.y = 0;
    root.traverse((o) => {
      if (o.isMesh && o.material) {
        if (Array.isArray(o.material)) o.material = o.material.map((m) => m.clone());
        else o.material = o.material.clone();
      }
    });
  });

  const idleMixer = new THREE.AnimationMixer(idle);
  const walkMixer = new THREE.AnimationMixer(walk);
  let idleAction = null;
  let walkAction = null;

  const ownIdle = idleTpl.userData.clips || [];
  const ownWalk = walkTpl.userData.clips || [];
  const isCustom = !!opts.custom;

  // Idle: own first, else retarget ref
  let idleClip = pickBestClip(ownIdle, ['idle', 'wait', 'stand', 'breath']) || ownIdle[0];
  if (!idleClip && refIdleClips.length) idleClip = retargetClip(refIdleClips[0], idle);
  if (idleClip) {
    idleAction = idleMixer.clipAction(idleClip);
    idleAction.setLoop(THREE.LoopRepeat, Infinity);
    idleAction.play();
    idleMixer.update(0.05);
  }

  // Walk: for custom ALWAYS retarget from our walk model; else own clips
  let walkClip = null;
  if (isCustom && refWalkClips.length) {
    walkClip = retargetClip(pickBestClip(refWalkClips, ['walk', 'run']) || refWalkClips[0], walk);
  }
  if (!walkClip) walkClip = pickBestClip(ownWalk, ['walk', 'run']) || ownWalk[0];
  if (!walkClip && refWalkClips.length) {
    walkClip = retargetClip(refWalkClips[0], walk);
  }
  if (walkClip) {
    walkAction = walkMixer.clipAction(walkClip);
    walkAction.setLoop(THREE.LoopRepeat, Infinity);
    walkAction.play();
  }

  return { idle, walk, idleMixer, walkMixer, idleAction, walkAction };
}

function loadRemoteCustomAvatar(url) {
  return new Promise((resolve) => {
    const loader = new GLTFLoader();
    loader.load(url, (gltf) => {
      const model = gltf.scene;
      model.traverse((o) => {
        if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; }
      });
      const box = new THREE.Box3().setFromObject(model);
      model.position.y = Number.isFinite(box.min.y) ? -box.min.y : 0;
      model.userData.clips = (gltf.animations || []).map((c) => makeInPlaceClip(c));
      resolve(model);
    }, undefined, () => resolve(null));
  });
}


function setRemoteMoving(ent, moving) {
  const isMoving = !!moving;
  ent.moving = isMoving ? 1 : 0;
  if (!ent.idle || !ent.walk) return;

  if (isMoving) {
    ent.idle.visible = false;
    ent.walk.visible = true;
    if (ent.walkAction) ent.walkAction.timeScale = 1.15;
    if (ent.idleAction) ent.idleAction.timeScale = 0;
  } else {
    ent.walk.visible = false;
    ent.idle.visible = true;
    if (ent.walkAction) {
      ent.walkAction.timeScale = 0;
      ent.walkAction.time = 0;
    }
    if (ent.idleAction) {
      ent.idleAction.timeScale = 1;
      ent.idleAction.play();
    }
  }
}

function upsertRemotePlayer(row) {
  let entry = remotePlayers.get(row.id);
  if (!entry) {
    const group = new THREE.Group();
    group.name = 'Remote_' + row.id;

    const placeholder = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.28, 0.9, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0x3b82f6 })
    );
    body.position.y = 0.85;
    placeholder.add(body);
    group.add(placeholder);

    const label = makeNameSprite(row.name || 'Игрок');
    label.position.y = 2.15;
    group.add(label);

    scene.add(group);
    entry = {
      group,
      label,
      placeholder,
      target: new THREE.Vector3(row.x || 0, row.y || 0, row.z || 0),
      rot: row.rot || 0,
      lastSeen: Date.now(),
      name: row.name || 'Игрок',
      moving: 0
    };
    remotePlayers.set(row.id, entry);

    const applyDefaultSkins = () => {
      loadRemoteAvatarTemplates().then((tpl) => {
        if (!tpl || !tpl.idle || !remotePlayers.has(row.id)) return;
        const ent = remotePlayers.get(row.id);
        if (!ent || ent.idle) return;
        const skins = createRemoteSkins(tpl.idle, tpl.walk || tpl.idle, { custom: false });
        if (ent.placeholder) {
          ent.group.remove(ent.placeholder);
          ent.placeholder = null;
        }
        ent.group.add(skins.idle);
        ent.group.add(skins.walk);
        Object.assign(ent, skins);
        setRemoteMoving(ent, 0);
      });
    };

    if (row.avatar) {
      // Custom Avaturn avatar for this remote player
      loadReferenceClips().then(() => loadRemoteCustomAvatar(row.avatar)).then((model) => {
        if (!remotePlayers.has(row.id)) return;
        const ent = remotePlayers.get(row.id);
        if (!ent || ent.idle) return;
        if (!model) { applyDefaultSkins(); return; }
        const skins = createRemoteSkins(model, model, { custom: true });
        if (ent.placeholder) {
          ent.group.remove(ent.placeholder);
          ent.placeholder = null;
        }
        ent.group.add(skins.idle);
        ent.group.add(skins.walk);
        Object.assign(ent, skins);
        ent.avatarUrl = row.avatar;
        setRemoteMoving(ent, 0);
      });
    } else {
      applyDefaultSkins();
    }
  }

  entry.target.set(row.x || 0, row.y || 0, row.z || 0);
  entry.rot = row.rot || 0;
  entry.lastSeen = Date.now();

  // If avatar URL arrived later — rebuild skins once
  if (row.avatar && entry.avatarUrl !== row.avatar && entry.idle) {
    // already has skins from default; skip heavy reload mid-session unless first
  } else if (row.avatar && !entry.idle && !entry.loadingAvatar) {
    // handled above on create
  }

  const wantMove = row.moving ? 1 : 0;
  if (entry.idle && entry.moving !== wantMove) {
    setRemoteMoving(entry, wantMove);
  } else {
    entry.moving = wantMove;
  }

  // Upgrade default remote to custom avatar when URL first appears
  if (row.avatar && entry.avatarUrl !== row.avatar && !entry.loadingCustom) {
    entry.loadingCustom = true;
    loadReferenceClips().then(() => loadRemoteCustomAvatar(row.avatar)).then((model) => {
      entry.loadingCustom = false;
      if (!model || !remotePlayers.has(row.id)) return;
      const ent = remotePlayers.get(row.id);
      // Remove old skins
      if (ent.idle) { ent.group.remove(ent.idle); }
      if (ent.walk) { ent.group.remove(ent.walk); }
      const skins = createRemoteSkins(model, model, { custom: true });
      ent.group.add(skins.idle);
      ent.group.add(skins.walk);
      Object.assign(ent, skins);
      ent.avatarUrl = row.avatar;
      setRemoteMoving(ent, ent.moving);
    });
  }

  if (row.name && entry.name !== row.name) {
    entry.name = row.name;
    if (entry.label) {
      entry.group.remove(entry.label);
      entry.label = makeNameSprite(row.name);
      entry.label.position.y = 2.15;
      entry.group.add(entry.label);
    }
  }
}

function updateRemotePlayers(dt) {
  for (const [, entry] of remotePlayers) {
    entry.group.position.lerp(entry.target, 1 - Math.pow(0.002, dt));
    const cur = entry.group.rotation.y;
    let diff = entry.rot - cur;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    entry.group.rotation.y = cur + diff * Math.min(1, dt * 10);

    if (entry.moving) {
      entry.walkMixer?.update(dt);
    } else {
      entry.idleMixer?.update(dt);
    }
  }
}


function makeNameSprite(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  roundRect(ctx, 20, 12, 216, 40, 10);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 22px system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((text || 'Игрок').slice(0, 16), 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(1.6, 0.4, 1);
  return spr;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function startPresenceLoop() {
  // push / pull on interval
  lifecycle.interval(() => {
    pushPresence();
    pullPresence();
  }, 800);
}







// ========== MAFIA GAME ==========
const MAFIA_MIN_PLAYERS = 4;

// Timers (ms)
const T_SPEAK = 60 * 1000;       // 1 min per player
const T_FREE = 5 * 60 * 1000;    // 5 min free talk
const T_NIGHT = 60 * 1000;       // 1 min mafia night
const T_VOTE = 45 * 1000;        // voting window
const T_DEFENSE = 60 * 1000;     // 1 min defense

let mafiaRoomChannel = null;
let mafiaRoomId = null;
let mafiaExpectedHostId = null;
// mafiaOpen / mafiaInGame declared in global STATE above
let mafiaIsHost = false;
let mafiaLocalStream = null; // video + audio
let mafiaReady = false;
let mafiaMyRole = null;
let mafiaState = null;
let mafiaBotTimer = null;
let mafiaUiTick = null;
let mafiaJoined = false;
let mafiaMediaRoom = null;
let mafiaRemoteStreams = new Map(); // peerId -> MediaStream


function roleLabel(r) {
  if (r === 'mafia') return 'Мафия';
  if (r === 'civilian') return 'Мирный житель';
  return r || '—';
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function openMafiaLobby() {
  if (mafiaInGame) return;
  mafiaOpen = true;
  document.getElementById('mafia-modal')?.classList.remove('hidden');
  document.getElementById('interact-hint')?.classList.add('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  renderMafiaSlots();
}

function closeMafiaLobby() {
  if (mafiaInGame) return;
  mafiaOpen = false;
  document.getElementById('mafia-modal')?.classList.add('hidden');
}

function setupMafiaUI() {
  if (!mafiaUiTick) {
    mafiaUiTick = lifecycle.interval(() => {
      if (mafiaState && (mafiaInGame || mafiaOpen)) {
        updateMafiaTimerLabel();
        // keep local media policy in sync
        applyMafiaMediaPolicy();
      }
    }, 400);
  }
  document.getElementById('mafia-close')?.addEventListener('click', () => {
    leaveMafiaRoom();
    closeMafiaLobby();
  });
  document.getElementById('mafia-join-btn')?.addEventListener('click', () => joinMafiaRoom());
  document.getElementById('mafia-ready-btn')?.addEventListener('click', toggleMafiaReady);
  document.getElementById('mafia-cam-btn')?.addEventListener('click', toggleMafiaCamera);
  document.getElementById('mafia-leave-btn')?.addEventListener('click', () => {
    leaveMafiaRoom();
    exitMafiaGameUI();
  });
  document.getElementById('mafia-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'mafia-modal' && !mafiaInGame) {
      leaveMafiaRoom();
      closeMafiaLobby();
    }
  });
}

function updateMafiaTimerLabel() {
  const timerEl = document.getElementById('mafia-timer');
  if (!timerEl || !mafiaState) return;
  if (mafiaState.phaseEndsAt) {
    const sec = Math.max(0, Math.ceil((mafiaState.phaseEndsAt - Date.now()) / 1000));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    timerEl.textContent = sec ? `Осталось ${m}:${String(s).padStart(2, '0')}` : '';
  } else {
    timerEl.textContent = '';
  }
}

async function connectMafiaRealtime(roomId) {
  if (!hasCloudAccount() || !supabaseClient) throw new Error('AUTH_REQUIRED');
  if (mafiaRoomChannel) await mafiaRoomChannel.close();
  mafiaRoomChannel = createRealtimeRoom({
    client: supabaseClient,
    topic: `room:mafia:${roomId}`,
    playerId,
    displayName: currentUser?.name,
    presence: { roomId, feature: 'mafia', isHost: mafiaIsHost },
    onMessage: onMafiaMessage,
    onPresence: (members) => {
      const active = new Set(members.map((member) => String(member.id || member.key)));
      const announcedHosts = members
        .filter((member) => member.isHost)
        .map((member) => String(member.id || member.key))
        .filter(Boolean)
        .sort();
      if (!mafiaExpectedHostId && announcedHosts.length) mafiaExpectedHostId = announcedHosts[0];
      const currentHostId = mafiaState?.hostId;

      if (!mafiaIsHost && mafiaState && currentHostId && !active.has(currentHostId)) {
        if (mafiaState.phase === 'lobby') {
          const nextHost = [...active].sort()[0];
          if (nextHost === playerId) {
            mafiaIsHost = true;
            mafiaExpectedHostId = playerId;
            mafiaState.hostId = playerId;
            mafiaState.log = 'Бот: ведущий сменился. Лобби продолжает работу.';
            startMafiaHostLoop();
            mafiaRoomChannel?.track({ isHost: true }).catch(() => {});
            broadcastMafiaState();
            showToast('Вы стали ведущим стола');
          }
        } else if (mafiaState.phase !== 'end') {
          mafiaState.phase = 'end';
          mafiaState.winner = null;
          mafiaState.phaseEndsAt = 0;
          mafiaState.speakerId = null;
          mafiaState.log = 'Раунд остановлен: ведущий отключился. Вернитесь в город и создайте новый стол.';
          applyMafiaStateView();
          showToast('Ведущий отключился — раунд безопасно завершён');
        }
      }

      if (!mafiaIsHost || !mafiaState?.players) {
        syncMafiaPeers();
        return;
      }
      let changed = false;
      let chiefLeftAtNight = false;
      for (const member of members) {
        const id = String(member.id || member.key || '');
        if (!id || mafiaState.players[id]) continue;
        mafiaState.players[id] = makePlayerEntry(id, member.name);
        if (mafiaState.phase !== 'lobby') {
          mafiaState.players[id].alive = false;
          mafiaState.players[id].spectator = true;
        }
        changed = true;
      }
      for (const id of Object.keys(mafiaState.players)) {
        if (id !== playerId && !active.has(id)) {
          const wasSpeaker = mafiaState.speakerId === id;
          if (mafiaState.phase === 'night' && mafiaState.chiefMafia === id) chiefLeftAtNight = true;
          delete mafiaState.players[id];
          mafiaState.alive = (mafiaState.alive || []).filter((entry) => entry !== id);
          mafiaState.speakQueue = (mafiaState.speakQueue || []).filter((entry) => entry !== id);
          mafiaState.defenseTargets = (mafiaState.defenseTargets || []).filter((entry) => entry !== id);
          mafiaState.voteCandidates = (mafiaState.voteCandidates || []).filter((entry) => entry !== id);
          delete mafiaState.votes[id];
          delete mafiaState.voteSkip[id];
          Object.keys(mafiaState.votes || {}).forEach((voterId) => {
            if (mafiaState.votes[voterId] === id) delete mafiaState.votes[voterId];
          });
          if (wasSpeaker && ['intro_speak', 'day_speak'].includes(mafiaState.phase)) {
            mafiaState.speakIndex = Math.max(-1, mafiaState.speakIndex - 1);
            botNextSpeakerOrPhase();
          } else if (wasSpeaker && mafiaState.phase === 'defense') {
            mafiaState.defenseIndex = Math.max(-1, mafiaState.defenseIndex - 1);
            botNextDefenseOrVote();
          }
          changed = true;
        }
      }
      if (changed) {
        if (chiefLeftAtNight && mafiaState.phase === 'night') botEnterNight();
        if (mafiaState.phase !== 'lobby' && mafiaState.phase !== 'end') checkMafiaEnd();
        broadcastMafiaState();
        renderMafiaSlots();
      }
      syncMafiaPeers();
    }
  });
  await mafiaRoomChannel.connect();
  return mafiaRoomChannel;
}



// ----- Shared WebRTC media mesh (camera + mic) -----
function ensureMafiaMediaRoom() {
  if (mafiaMediaRoom) return mafiaMediaRoom;
  mafiaMediaRoom = createMediaRoom({
    selfId: playerId,
    send: async (message) => publishMafia(message),
    getAccessToken: () => cloudSession?.access_token || '',
    onRemoteStream: ({ peerId, source, stream }) => {
      if (source !== 'camera') return;
      if (stream.getTracks().length) mafiaRemoteStreams.set(peerId, stream);
      else mafiaRemoteStreams.delete(peerId);
      renderMafiaVideoGrid();
    },
    onPeerState: ({ state }) => {
      if (state === 'connected') showToast('Связь с игроком установлена');
      if (state === 'failed') showToast('Восстанавливаем медиасвязь…');
    },
    onError: (error, context) => console.warn('[mafia-media]', context, error)
  });
  return mafiaMediaRoom;
}

function closeAllMafiaPeers() {
  mafiaMediaRoom?.closePeers();
  mafiaRemoteStreams.clear();
}

async function syncMafiaPeers() {
  if (!mafiaJoined || !playerId || !mafiaLocalStream) return;
  const ids = Object.keys(mafiaState?.players || {}).filter((id) => id && id !== playerId);
  const media = ensureMafiaMediaRoom();
  await media.setLocalStream('camera', mafiaLocalStream);
  await media.syncPeers(ids);
  await media.announce('camera');
}


function publishMafia(msg) {
  if (!mafiaRoomChannel || !mafiaRoomId) return Promise.resolve(false);
  return mafiaRoomChannel.send(msg).catch((error) => {
    console.warn('mafia realtime send', error);
    return false;
  });
}

function publicMafiaState() {
  return sanitizeMafiaState(mafiaState);
}

function broadcastMafiaState() {
  if (!mafiaIsHost || !mafiaState) return;
  publishMafia({ type: 'state', state: publicMafiaState() });
}

async function joinMafiaRoom() {
  if (!hasCloudAccount()) {
    showToast('Войдите в аккаунт, чтобы играть в Mafia онлайн');
    return;
  }
  ensurePlayerId();
  let code = (document.getElementById('mafia-room-code')?.value || '').trim().toUpperCase();
  if (!code) {
    code = 'M' + Math.random().toString(36).slice(2, 7).toUpperCase();
    mafiaIsHost = true;
  } else {
    mafiaIsHost = false;
  }
  mafiaRoomId = code;
  mafiaExpectedHostId = mafiaIsHost ? playerId : null;
  mafiaJoined = true;
  mafiaReady = false;
  mafiaMyRole = null;

  const info = document.getElementById('mafia-room-info');
  info?.classList.remove('hidden');
  const lab = document.getElementById('mafia-room-label');
  if (lab) lab.textContent = code + (mafiaIsHost ? ' (хост-стол)' : '');
  document.getElementById('mafia-ready-btn').disabled = false;

  try {
    await connectMafiaRealtime(code);

    if (mafiaIsHost) {
      mafiaState = createEmptyMafiaState(code);
      mafiaState.players[playerId] = makePlayerEntry(playerId, currentUser?.name || 'Игрок');
      broadcastMafiaState();
      startMafiaHostLoop();
    } else {
      publishMafia({ type: 'hello' });
    }
    publishMafia({ type: 'join' });
    if (mafiaLocalStream) {
      publishMafia({ type: 'media-ready' });
      setTimeout(() => syncMafiaPeers(), 500);
    }
    showToast('Стол ' + code);
    renderMafiaSlots();
  } catch (e) {
    console.error(e);
    mafiaJoined = false;
    mafiaRoomId = null;
    showToast('Не удалось подключить защищённый стол');
  }
}

function makePlayerEntry(id, name) {
  return {
    id,
    name: name || 'Игрок',
    ready: false,
    alive: true,
    spectator: false
  };
}

function createEmptyMafiaState(room) {
  return {
    room,
    phase: 'lobby',
    players: {},
    roles: {},
    chiefMafia: null,
    alive: [],
    speakQueue: [],
    speakIndex: 0,
    speakerId: null,
    votes: {},
    voteSkip: {},
    voteCandidates: null, // runoff list
    defenseTargets: [],
    defenseIndex: 0,
    nightTarget: null,
    winner: null,
    log: 'Бот-ведущий: жду игроков. Включите камеру и микрофон, нажмите «Готов».',
    phaseEndsAt: 0,
    hostId: playerId,
    round: 0
  };
}

function onMafiaMessage(msg) {
  if (!msg || !msg.type) return;

  if (mafiaIsHost && mafiaState) {
    if (msg.type === 'join' || msg.type === 'hello') {
      if (msg.from) {
        if (!mafiaState.players[msg.from]) {
          mafiaState.players[msg.from] = makePlayerEntry(msg.from, msg.name);
          mafiaState.log = `Бот: ${msg.name || 'Игрок'} сел за стол`;
        } else {
          mafiaState.players[msg.from].name = msg.name || mafiaState.players[msg.from].name;
        }
        broadcastMafiaState();
      }
    }
    if (msg.type === 'ready' && msg.from && mafiaState.players[msg.from]) {
      mafiaState.players[msg.from].ready = !!msg.ready;
      broadcastMafiaState();
      maybeStartMafiaGame();
    }
    if (msg.type === 'done_speak' && msg.from === mafiaState.speakerId) {
      if (mafiaState.phase === 'defense') botNextDefenseOrVote();
      else botNextSpeakerOrPhase();
    }
    if (msg.type === 'vote' && (mafiaState.phase === 'vote' || mafiaState.phase === 'vote_runoff') && msg.from) {
      if (isAlive(msg.from)) {
        if (msg.skip) {
          if (mafiaState.phase === 'vote') {
            mafiaState.voteSkip[msg.from] = true;
            delete mafiaState.votes[msg.from];
          }
        } else if (msg.target) {
          if (msg.target === msg.from) return;
          // runoff: only candidates allowed
          if (mafiaState.phase === 'vote_runoff') {
            if (!(mafiaState.voteCandidates || []).includes(msg.target)) return;
          } else {
            if (!isAlive(msg.target)) return;
          }
          mafiaState.votes[msg.from] = msg.target;
          delete mafiaState.voteSkip[msg.from];
        }
        broadcastMafiaState();
      }
    }
    if (msg.type === 'night_kill' && mafiaState.phase === 'night' && msg.from && msg.target) {
      if (msg.from === mafiaState.chiefMafia && isAlive(msg.from) && isAlive(msg.target)) {
        if (msg.target !== msg.from && mafiaState.roles[msg.target] !== 'mafia') {
          mafiaState.nightTarget = msg.target;
          mafiaState.log = `Бот: главная мафия сделала выбор. Ждём конца ночи…`;
          broadcastMafiaState();
          // resolve immediately once chosen (or wait timer — resolve on timer for discussion)
        }
      }
    }
  }

  if (msg.type === 'state' && msg.state) {
    const incomingHost = String(msg.state.hostId || '');
    if (!incomingHost || msg.from !== incomingHost) return;
    if (mafiaExpectedHostId && msg.from !== mafiaExpectedHostId) return;
    if (mafiaState?.hostId && msg.from !== mafiaState.hostId) return;
    mafiaExpectedHostId = incomingHost;
    const rolesBackup = mafiaIsHost && mafiaState ? mafiaState.roles : null;
    const privatePeerIds = mafiaState?._mafiaPeerIds || [];
    const privatePeerNames = mafiaState?._mafiaPeerNames || [];
    const privateChief = mafiaState?._privateChiefMafia || null;
    mafiaState = msg.state;
    if (rolesBackup) mafiaState.roles = rolesBackup;
    mafiaState._mafiaPeerIds = privatePeerIds;
    mafiaState._mafiaPeerNames = privatePeerNames;
    mafiaState._privateChiefMafia = privateChief;
    applyMafiaStateView();
    syncMafiaPeers();
  }
  if (msg.type === 'private_role' && msg.to === playerId && msg.from === mafiaState?.hostId) {
    mafiaMyRole = msg.role;
    showToast('Ваша роль: ' + roleLabel(msg.role));
    applyMafiaStateView();
  }
  if (msg.type === 'mafia_peers' && msg.to === playerId && msg.from === mafiaState?.hostId && Array.isArray(msg.peers)) {
    mafiaState = mafiaState || {};
    mafiaState._mafiaPeerNames = msg.peers;
    mafiaState._mafiaPeerIds = Array.isArray(msg.peerIds) ? msg.peerIds.map(String) : [];
    mafiaState._privateChiefMafia = String(msg.chiefId || '');
    applyMafiaStateView();
  }

  if (isMediaSignal(msg)) {
    ensureMafiaMediaRoom().handleSignal(msg);
  }
}

function mafiaChiefId() {
  if (mafiaIsHost) return mafiaState?.chiefMafia || null;
  return mafiaState?._privateChiefMafia || null;
}

function isAlive(id) {
  return !!(mafiaState && mafiaState.alive && mafiaState.alive.includes(id));
}

function isSpectatorMe() {
  return !!(mafiaState && playerId && mafiaState.players[playerId] && (
    mafiaState.players[playerId].spectator || !isAlive(playerId)
  ));
}

function toggleMafiaReady() {
  if (!mafiaRoomId) {
    showToast('Сначала войдите за стол');
    return;
  }
  mafiaReady = !mafiaReady;
  const btn = document.getElementById('mafia-ready-btn');
  if (btn) btn.textContent = mafiaReady ? 'Не готов' : 'Готов';
  publishMafia({ type: 'ready', ready: mafiaReady });
  if (mafiaIsHost && mafiaState && mafiaState.players[playerId]) {
    mafiaState.players[playerId].ready = mafiaReady;
    broadcastMafiaState();
    maybeStartMafiaGame();
  }
}

async function toggleMafiaCamera() {
  const video = document.getElementById('mafia-local-video');
  const status = document.getElementById('mafia-cam-status');
  const btn = document.getElementById('mafia-cam-btn');
  if (mafiaLocalStream) {
    mafiaLocalStream.getTracks().forEach((t) => t.stop());
    mafiaLocalStream = null;
    closeAllMafiaPeers();
    if (video) video.srcObject = null;
    if (status) status.textContent = 'Камера/мик выкл';
    if (btn) btn.textContent = 'Включить камеру и микрофон';
    renderMafiaVideoGrid();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: true
    });
    mafiaLocalStream = stream;
    // start muted until policy allows
    stream.getAudioTracks().forEach((t) => { t.enabled = false; });
    if (video) {
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play().catch(() => {});
    }
    if (status) status.textContent = 'Камера+мик вкл · звук по фазам';
    if (btn) btn.textContent = 'Выключить медиа';
    applyMafiaMediaPolicy();
    publishMafia({ type: 'media-ready' });
    closeAllMafiaPeers();
    await syncMafiaPeers();
    renderMafiaVideoGrid();
    showToast('Медиа включено — ждём связи с игроками…');
  } catch (e) {
    console.warn(e);
    showToast('Нужен доступ к камере и микрофону');
  }
}

function setLocalAvEnabled(on) {
  if (!mafiaLocalStream) return;
  mafiaLocalStream.getAudioTracks().forEach((t) => { t.enabled = !!on; });
}

function setLocalVidEnabled(on) {
  if (!mafiaLocalStream) return;
  mafiaLocalStream.getVideoTracks().forEach((t) => { t.enabled = !!on; });
}

/** Media policy by phase + role + alive */
function applyMafiaMediaPolicy() {
  if (!mafiaLocalStream || !mafiaState) return;
  if (isSpectatorMe() || (mafiaState.players[playerId] && !isAlive(playerId) && mafiaState.phase !== 'lobby')) {
    setLocalAvEnabled(false);
    setLocalVidEnabled(false);
    applyMafiaPeerAudience([]);
    return;
  }

  const phase = mafiaState.phase;
  const role = mafiaMyRole;
  const amSpeaker = mafiaState.speakerId === playerId;

  if (phase === 'lobby') {
    setLocalVidEnabled(true);
    setLocalAvEnabled(false);
    applyMafiaPeerAudience(null);
    return;
  }
  if (phase === 'intro_free' || phase === 'day_free') {
    setLocalVidEnabled(true);
    setLocalAvEnabled(true);
    applyMafiaPeerAudience(null);
    return;
  }
  if (phase === 'intro_speak' || phase === 'day_speak' || phase === 'defense') {
    setLocalVidEnabled(true);
    setLocalAvEnabled(amSpeaker);
    applyMafiaPeerAudience(null);
    return;
  }
  if (phase === 'night') {
    if (role === 'mafia') {
      setLocalVidEnabled(true);
      setLocalAvEnabled(true);
      const peerIds = mafiaIsHost
        ? (mafiaState.alive || []).filter((id) => id !== playerId && mafiaState.roles?.[id] === 'mafia')
        : (mafiaState._mafiaPeerIds || []);
      applyMafiaPeerAudience(peerIds);
    } else {
      setLocalVidEnabled(false);
      setLocalAvEnabled(false);
      applyMafiaPeerAudience([]);
    }
    return;
  }
  // vote / end
  setLocalVidEnabled(true);
  setLocalAvEnabled(false);
  applyMafiaPeerAudience(null);
}

function applyMafiaPeerAudience(peerIds) {
  mafiaMediaRoom?.setSourceAudience('camera', peerIds).catch((error) => {
    console.warn('[mafia-media] audience', error);
  });
}

function renderMafiaSlots() {
  const el = document.getElementById('mafia-slots');
  if (!el) return;
  const players = mafiaState?.players ? Object.values(mafiaState.players) : [];
  if (!players.length) {
    el.innerHTML = '<div class="mafia-slot"><div class="s-name">Пусто</div><div class="s-st">Войдите за стол</div></div>';
    return;
  }
  el.innerHTML = players.map((p) => `
    <div class="mafia-slot ${p.ready ? 'ready' : ''}">
      <div class="s-name">${escapeHtml(p.name)}${p.id === playerId ? ' (вы)' : ''}</div>
      <div class="s-st">${p.ready ? '✓ Готов' : 'Ждёт…'}</div>
    </div>
  `).join('');
}

function maybeStartMafiaGame() {
  if (!mafiaIsHost || !mafiaState || mafiaState.phase !== 'lobby') return;
  const list = Object.values(mafiaState.players);
  if (list.length < MAFIA_MIN_PLAYERS) {
    mafiaState.log = `Бот: нужно минимум ${MAFIA_MIN_PLAYERS} игрока (сейчас ${list.length})`;
    broadcastMafiaState();
    return;
  }
  if (!list.every((p) => p.ready)) {
    mafiaState.log = 'Бот: жду, пока все нажмут «Готов»…';
    broadcastMafiaState();
    return;
  }
  botStartGame();
}

function botStartGame() {
  if (!mafiaIsHost || !mafiaState) return;
  const ids = Object.keys(mafiaState.players);
  const roles = {};
  const shuffled = ids.slice();
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const mafiaCount = Math.max(1, Math.floor(ids.length / 3));
  shuffled.forEach((id, i) => {
    roles[id] = i < mafiaCount ? 'mafia' : 'civilian';
  });
  mafiaState.roles = roles;
  mafiaState.alive = ids.slice();
  Object.values(mafiaState.players).forEach((p) => {
    p.alive = true;
    p.spectator = false;
  });
  mafiaState.round = 1;
  mafiaState.winner = null;
  mafiaState.votes = {};
  mafiaState.voteSkip = {};
  mafiaState.nightTarget = null;
  mafiaState.voteCandidates = null;

  // private roles
  ids.forEach((id) => {
    publishMafia({ type: 'private_role', to: id, role: roles[id] });
  });
  if (roles[playerId]) mafiaMyRole = roles[playerId];

  // Phase: intro speak queue
  mafiaState.speakQueue = ids.slice();
  mafiaState.speakIndex = 0;
  mafiaState.phase = 'intro_speak';
  mafiaState.speakerId = mafiaState.speakQueue[0] || null;
  mafiaState.phaseEndsAt = Date.now() + T_SPEAK;
  const spName = mafiaState.players[mafiaState.speakerId]?.name || '';
  mafiaState.log = `Бот: роли розданы. Знакомство — слово у ${spName} (1 мин).`;
  broadcastMafiaState();
}

function startMafiaHostLoop() {
  if (mafiaBotTimer) clearInterval(mafiaBotTimer);
  mafiaBotTimer = lifecycle.interval(() => {
    if (!mafiaIsHost || !mafiaState) return;
    if (mafiaState.phase === 'lobby' || mafiaState.phase === 'end') return;
    if (mafiaState.phaseEndsAt && Date.now() >= mafiaState.phaseEndsAt) {
      botOnTimer();
    }
  }, 400);
}

function botOnTimer() {
  if (!mafiaState) return;
  const p = mafiaState.phase;
  if (p === 'intro_speak' || p === 'day_speak') {
    botNextSpeakerOrPhase();
  } else if (p === 'intro_free') {
    botEnterNight();
  } else if (p === 'night') {
    botResolveNight();
  } else if (p === 'day_free') {
    botStartDaySpeak();
  } else if (p === 'defense') {
    botNextDefenseOrVote();
  } else if (p === 'vote' || p === 'vote_runoff') {
    botResolveVote();
  }
}

function botNextSpeakerOrPhase() {
  if (!mafiaState) return;
  mafiaState.speakIndex += 1;
  if (mafiaState.speakIndex >= mafiaState.speakQueue.length) {
    // end of sequential speaks
    if (mafiaState.phase === 'intro_speak') {
      mafiaState.phase = 'intro_free';
      mafiaState.speakerId = null;
      mafiaState.phaseEndsAt = Date.now() + T_FREE;
      mafiaState.log = 'Бот: общее обсуждение 5 минут. Камеры и микрофоны у всех включены.';
      broadcastMafiaState();
      return;
    }
    if (mafiaState.phase === 'day_speak') {
      mafiaState.phase = 'vote';
      mafiaState.speakerId = null;
      mafiaState.votes = {};
      mafiaState.voteSkip = {};
      mafiaState.voteCandidates = null;
      mafiaState.phaseEndsAt = Date.now() + T_VOTE;
      mafiaState.log = 'Бот: голосование! Выберите игрока или «Не буду голосовать».';
      broadcastMafiaState();
      return;
    }
  }
  mafiaState.speakerId = mafiaState.speakQueue[mafiaState.speakIndex];
  mafiaState.phaseEndsAt = Date.now() + T_SPEAK;
  const spName = mafiaState.players[mafiaState.speakerId]?.name || '';
  const label = mafiaState.phase === 'intro_speak' ? 'Знакомство' : 'Речь';
  mafiaState.log = `Бот: ${label} — слово у ${spName} (1 мин).`;
  broadcastMafiaState();
}

function botEnterNight() {
  const alive = mafiaState.alive.slice();
  const mafiaIds = alive.filter((id) => mafiaState.roles[id] === 'mafia');
  // pick chief
  mafiaState.chiefMafia = mafiaIds[Math.floor(Math.random() * mafiaIds.length)] || null;
  mafiaState.nightTarget = null;
  mafiaState.phase = 'night';
  mafiaState.speakerId = null;
  mafiaState.phaseEndsAt = Date.now() + T_NIGHT;
  const chiefName = mafiaState.players[mafiaState.chiefMafia]?.name || '—';
  mafiaState.log = `Бот: НОЧЬ. Мирные спят. Мафия, у вас 1 минута. Главный: ${chiefName} — только он выбирает жертву.`;
  broadcastMafiaState();
  // tell each mafia who their peers are
  mafiaIds.forEach((id) => {
    const peerIds = mafiaIds.filter((x) => x !== id);
    const peers = peerIds.map((x) => mafiaState.players[x]?.name || x);
    publishMafia({ type: 'mafia_peers', to: id, peers, peerIds, chiefId: mafiaState.chiefMafia });
  });
}

function botResolveNight() {
  let killed = mafiaState.nightTarget;
  if (!killed || !isAlive(killed)) {
    // mandatory victim — force random non-mafia if possible
    const pool = mafiaState.alive.filter((id) => mafiaState.roles[id] !== 'mafia');
    const pool2 = pool.length ? pool : mafiaState.alive.filter((id) => id !== mafiaState.chiefMafia);
    if (pool2.length) killed = pool2[Math.floor(Math.random() * pool2.length)];
  }
  if (killed && isAlive(killed)) {
    eliminatePlayer(killed, 'ночью');
    mafiaState.log = `Бот: Утро. Ночью погиб ${mafiaState.players[killed]?.name || 'игрок'}.`;
  } else {
    mafiaState.log = 'Бот: Утро. Ночью никто не погиб.';
  }
  mafiaState.nightTarget = null;
  mafiaState.chiefMafia = null;
  if (checkMafiaEnd()) return;

  mafiaState.phase = 'day_free';
  mafiaState.phaseEndsAt = Date.now() + T_FREE;
  mafiaState.log += ' Обсуждение 5 минут.';
  broadcastMafiaState();
}

function eliminatePlayer(id, reason) {
  mafiaState.alive = mafiaState.alive.filter((x) => x !== id);
  if (mafiaState.players[id]) {
    mafiaState.players[id].alive = false;
    mafiaState.players[id].spectator = true;
  }
}

function botStartDaySpeak() {
  mafiaState.speakQueue = mafiaState.alive.slice();
  mafiaState.speakIndex = 0;
  mafiaState.phase = 'day_speak';
  mafiaState.speakerId = mafiaState.speakQueue[0] || null;
  mafiaState.phaseEndsAt = Date.now() + T_SPEAK;
  const spName = mafiaState.players[mafiaState.speakerId]?.name || '';
  mafiaState.log = `Бот: убедите стол, что вы не мафия. Слово у ${spName} (1 мин).`;
  broadcastMafiaState();
}

function botResolveVote() {
  const counts = {};
  Object.values(mafiaState.votes).forEach((tid) => {
    counts[tid] = (counts[tid] || 0) + 1;
  });
  let ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  if (mafiaState.phase === 'vote_runoff') {
    if (!ranked.length) {
      mafiaState.log = 'Бот: переголосование не определило кандидата. Никто не изгнан.';
      mafiaState.votes = {};
      mafiaState.voteSkip = {};
      mafiaState.voteCandidates = null;
      botEnterNight();
      return;
    }
    const runoffTop = ranked[0][1];
    const runoffTied = ranked.filter(([, score]) => score === runoffTop);
    if (runoffTied.length > 1) {
      mafiaState.log = 'Бот: повторная ничья. Никто не изгнан.';
      mafiaState.votes = {};
      mafiaState.voteSkip = {};
      mafiaState.voteCandidates = null;
      botEnterNight();
      return;
    }
    const winner = ranked[0][0];
    eliminatePlayer(winner, 'голосованием');
    const wasMafia = mafiaState.roles[winner] === 'mafia';
    mafiaState.log = `Бот: изгнан ${mafiaState.players[winner]?.name || 'игрок'}.`;
    if (wasMafia) mafiaState.log += ' Это была мафия.';
    else mafiaState.log += ' Это был мирный.';
    mafiaState.votes = {};
    mafiaState.voteSkip = {};
    mafiaState.voteCandidates = null;
    if (checkMafiaEnd()) return;
    // continue game — night
    botEnterNight();
    return;
  }

  // first vote
  if (!ranked.length) {
    mafiaState.log = 'Бот: никто не получил голосов. Ночь…';
    botEnterNight();
    return;
  }
  const topScore = ranked[0][1];
  const tied = ranked.filter(([, n]) => n === topScore).map(([id]) => id);

  if (tied.length === 1) {
    // single leader → defense then eliminate (or defense then confirm?)
    // Rules: person with most votes gets 1 min defense, then eliminated
    // Reading again: after defense of the leader, bot removes the one with most votes
    // For single leader: defense 1 min then eliminate
    mafiaState.defenseTargets = tied;
    mafiaState.defenseIndex = 0;
    mafiaState.phase = 'defense';
    mafiaState.speakerId = tied[0];
    mafiaState.phaseEndsAt = Date.now() + T_DEFENSE;
    mafiaState._pendingEliminate = tied[0];
    mafiaState._pendingRunoff = false;
    mafiaState.log = `Бот: больше всего голосов у ${mafiaState.players[tied[0]]?.name}. Минута на защиту.`;
    broadcastMafiaState();
    return;
  }

  // tie → both defend, then runoff
  mafiaState.defenseTargets = tied;
  mafiaState.defenseIndex = 0;
  mafiaState.phase = 'defense';
  mafiaState.speakerId = tied[0];
  mafiaState.phaseEndsAt = Date.now() + T_DEFENSE;
  mafiaState._pendingEliminate = null;
  mafiaState._pendingRunoff = true;
  mafiaState.voteCandidates = tied;
  const names = tied.map((id) => mafiaState.players[id]?.name).join(' и ');
  mafiaState.log = `Бот: ничья между ${names}. Каждому по минуте на защиту.`;
  broadcastMafiaState();
}

function botNextDefenseOrVote() {
  mafiaState.defenseIndex += 1;
  if (mafiaState.defenseIndex < mafiaState.defenseTargets.length) {
    mafiaState.speakerId = mafiaState.defenseTargets[mafiaState.defenseIndex];
    mafiaState.phaseEndsAt = Date.now() + T_DEFENSE;
    mafiaState.log = `Бот: защита — слово у ${mafiaState.players[mafiaState.speakerId]?.name} (1 мин).`;
    broadcastMafiaState();
    return;
  }
  // defenses done
  if (mafiaState._pendingRunoff) {
    mafiaState.phase = 'vote_runoff';
    mafiaState.speakerId = null;
    mafiaState.votes = {};
    mafiaState.voteSkip = {};
    mafiaState.phaseEndsAt = Date.now() + T_VOTE;
    mafiaState.log = 'Бот: повторное голосование! Только двое кандидатов, голос обязателен.';
    broadcastMafiaState();
    return;
  }
  // single pending eliminate
  const id = mafiaState._pendingEliminate;
  mafiaState._pendingEliminate = null;
  if (id && isAlive(id)) {
    eliminatePlayer(id, 'голосованием');
    const wasMafia = mafiaState.roles[id] === 'mafia';
    mafiaState.log = `Бот: изгнан ${mafiaState.players[id]?.name || 'игрок'}.`;
    if (wasMafia) mafiaState.log += ' Это была мафия.';
    else mafiaState.log += ' Это был мирный.';
  }
  if (checkMafiaEnd()) return;
  botEnterNight();
}

function checkMafiaEnd() {
  if (!mafiaState) return false;
  const alive = mafiaState.alive || [];
  const mafiaAlive = alive.filter((id) => mafiaState.roles[id] === 'mafia').length;
  const civAlive = alive.length - mafiaAlive;
  if (mafiaAlive === 0) {
    mafiaState.phase = 'end';
    mafiaState.winner = 'civilian';
    mafiaState.speakerId = null;
    mafiaState.phaseEndsAt = 0;
    mafiaState.log = '🎉 Бот: победили мирные жители! Мафия уничтожена.';
    broadcastMafiaState();
    return true;
  }
  if (mafiaAlive >= civAlive) {
    mafiaState.phase = 'end';
    mafiaState.winner = 'mafia';
    mafiaState.speakerId = null;
    mafiaState.phaseEndsAt = 0;
    mafiaState.log = '😈 Бот: победила мафия!';
    broadcastMafiaState();
    return true;
  }
  return false;
}

function applyMafiaStateView() {
  if (!mafiaState) return;
  renderMafiaSlots();
  if (mafiaState.phase !== 'lobby') enterMafiaGameUI();

  const phaseEl = document.getElementById('mafia-phase');
  const logEl = document.getElementById('mafia-bot-log');
  if (logEl) logEl.textContent = mafiaState.log || '';
  if (phaseEl) {
    const map = {
      lobby: 'Лобби',
      intro_speak: 'Знакомство',
      intro_free: 'Общий стол',
      night: 'Ночь',
      day_free: 'Утро — обсуждение',
      day_speak: 'Речи',
      vote: 'Голосование',
      defense: 'Защита',
      vote_runoff: 'Переголосование',
      end: 'Итог'
    };
    phaseEl.textContent = map[mafiaState.phase] || mafiaState.phase;
  }
  updateMafiaTimerLabel();

  const badge = document.getElementById('mafia-role-badge');
  if (badge) {
    if (mafiaMyRole && mafiaState.phase !== 'lobby') {
      badge.classList.remove('hidden');
      let text = 'Роль: ' + roleLabel(mafiaMyRole);
      if (isSpectatorMe()) text = '👁 Наблюдатель';
      if (mafiaMyRole === 'mafia' && mafiaState.phase === 'night' && mafiaChiefId() === playerId) {
        text += ' · ВЫ ГЛАВНЫЙ';
      }
      badge.textContent = text;
    } else {
      badge.classList.add('hidden');
    }
  }

  renderMafiaVideoGrid();
  renderMafiaActions();
  applyMafiaMediaPolicy();
}

function enterMafiaGameUI() {
  mafiaInGame = true;
  mafiaOpen = false;
  document.getElementById('mafia-modal')?.classList.add('hidden');
  document.getElementById('mafia-game')?.classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}

function exitMafiaGameUI() {
  mafiaInGame = false;
  document.getElementById('mafia-game')?.classList.add('hidden');
  closeMafiaLobby();
}

function renderMafiaVideoGrid() {
  const grid = document.getElementById('mafia-video-grid');
  if (!grid || !mafiaState) return;
  const players = Object.values(mafiaState.players || {});
  grid.innerHTML = players.map((p) => {
    const alive = isAlive(p.id) || mafiaState.phase === 'lobby';
    const isMe = p.id === playerId;
    const isSpeaker = mafiaState.speakerId === p.id;
    const remote = mafiaRemoteStreams.get(p.id);
    const hasRemote = !isMe && !!remote;
    const hasLocal = isMe && !!mafiaLocalStream;
    // Night: civilians don't show their cam to others (track disabled); still show tile
    const showVid = hasLocal || hasRemote;
    return `
      <div class="mafia-tile ${alive ? 'alive' : 'dead'} ${isSpeaker ? 'speaker' : ''}" data-id="${p.id}">
        <div class="tile-fallback" style="${showVid ? 'display:none' : ''}">${alive ? '👤' : '💀'}</div>
        <video class="mafia-tile-vid" data-peer="${p.id}" style="${showVid ? '' : 'display:none'}" autoplay playsinline ${isMe ? 'muted' : ''}></video>
        <div class="tile-name">${escapeHtml(p.name)}${isMe ? ' (вы)' : ''}${isSpeaker ? ' 🎤' : ''}</div>
        ${alive ? '' : '<div class="tile-dead-tag">наблюдатель</div>'}
      </div>`;
  }).join('');

  // Attach streams
  players.forEach((p) => {
    const vid = grid.querySelector(`video[data-peer="${p.id}"]`);
    if (!vid) return;
    if (p.id === playerId && mafiaLocalStream) {
      vid.srcObject = mafiaLocalStream;
      vid.muted = true; // always mute self to avoid echo
      vid.play().catch(() => {});
    } else if (mafiaRemoteStreams.has(p.id)) {
      vid.srcObject = mafiaRemoteStreams.get(p.id);
      vid.muted = false; // hear others
      vid.volume = 1;
      vid.play().catch(() => {});
    }
  });
}

function renderMafiaActions() {
  const box = document.getElementById('mafia-actions');
  if (!box || !mafiaState) return;
  box.innerHTML = '';
  const meAlive = isAlive(playerId);
  const phase = mafiaState.phase;

  // Done speaking
  if (meAlive && mafiaState.speakerId === playerId &&
      (phase === 'intro_speak' || phase === 'day_speak' || phase === 'defense')) {
    const b = document.createElement('button');
    b.className = 'btn primary';
    b.textContent = 'Я закончил';
    b.onclick = () => {
      publishMafia({ type: 'done_speak' });
      if (mafiaIsHost) {
        if (mafiaState.phase === 'defense') botNextDefenseOrVote();
        else botNextSpeakerOrPhase();
      }
    };
    box.appendChild(b);
  }

  // Night: only chief mafia picks
  if (phase === 'night' && meAlive && mafiaMyRole === 'mafia') {
    if (mafiaChiefId() === playerId) {
      const hint = document.createElement('div');
      hint.style.cssText = 'width:100%;text-align:center;font-size:0.85rem;opacity:0.85';
      hint.textContent = 'Вы главный. Обязательно выберите жертву:';
      box.appendChild(hint);
      const knownMafia = mafiaIsHost
        ? new Set((mafiaState.alive || []).filter((id) => mafiaState.roles?.[id] === 'mafia'))
        : new Set([playerId, ...(mafiaState._mafiaPeerIds || [])]);
      mafiaState.alive.filter((id) => id !== playerId && !knownMafia.has(id)).forEach((id) => {
        const b = document.createElement('button');
        b.className = 'btn mafia-vote-btn';
        b.textContent = mafiaState.players[id]?.name || id;
        b.onclick = () => {
          publishMafia({ type: 'night_kill', target: id });
          if (mafiaIsHost) {
            mafiaState.nightTarget = id;
            mafiaState.log = `Бот: выбор сделан (${mafiaState.players[id]?.name}). Ждём конец ночи.`;
            broadcastMafiaState();
          }
          showToast('Жертва выбрана');
        };
        box.appendChild(b);
      });
    } else {
      const hint = document.createElement('div');
      hint.style.cssText = 'width:100%;text-align:center;font-size:0.85rem;opacity:0.85';
      const chief = mafiaState.players[mafiaChiefId()]?.name || 'главный';
      hint.textContent = `Обсудите с мафией. Выбор делает: ${chief}`;
      box.appendChild(hint);
    }
  }

  // Vote
  if ((phase === 'vote' || phase === 'vote_runoff') && meAlive) {
    const hint = document.createElement('div');
    hint.style.cssText = 'width:100%;text-align:center;font-size:0.85rem;opacity:0.85';
    hint.textContent = phase === 'vote_runoff' ? 'Обязательный голос за одного из двух:' : 'Ваш голос:';
    box.appendChild(hint);

    let options = [];
    if (phase === 'vote_runoff') {
      options = (mafiaState.voteCandidates || []).filter((id) => id !== playerId);
    } else {
      options = mafiaState.alive.filter((id) => id !== playerId);
    }
    options.forEach((id) => {
      const b = document.createElement('button');
      b.className = 'btn mafia-vote-btn';
      b.textContent = mafiaState.players[id]?.name || id;
      b.onclick = () => {
        publishMafia({ type: 'vote', target: id });
        if (mafiaIsHost) {
          mafiaState.votes[playerId] = id;
          delete mafiaState.voteSkip[playerId];
          broadcastMafiaState();
        }
        showToast('Голос учтён');
      };
      box.appendChild(b);
    });
    if (phase === 'vote') {
      const skip = document.createElement('button');
      skip.className = 'btn ghost';
      skip.textContent = 'Не буду голосовать';
      skip.onclick = () => {
        publishMafia({ type: 'vote', skip: true });
        if (mafiaIsHost) {
          mafiaState.voteSkip[playerId] = true;
          delete mafiaState.votes[playerId];
          broadcastMafiaState();
        }
      };
      box.appendChild(skip);
    }
  }

  if (phase === 'end') {
    const b = document.createElement('button');
    b.className = 'btn primary';
    b.textContent = 'В город';
    b.onclick = () => {
      leaveMafiaRoom();
      exitMafiaGameUI();
    };
    box.appendChild(b);
  }
}

function leaveMafiaRoom() {
  if (mafiaBotTimer) {
    clearInterval(mafiaBotTimer);
    mafiaBotTimer = null;
  }
  mafiaJoined = false;
  mafiaReady = false;
  mafiaIsHost = false;
  mafiaRoomId = null;
  mafiaExpectedHostId = null;
  mafiaState = null;
  mafiaMyRole = null;
  const room = mafiaRoomChannel;
  mafiaRoomChannel = null;
  room?.send({ type: 'leave' }).catch(() => {}).finally(() => room.close());
  mafiaMediaRoom?.close({ stopLocal: false });
  mafiaMediaRoom = null;
  mafiaRemoteStreams.clear();
  if (mafiaLocalStream) {
    mafiaLocalStream.getTracks().forEach((t) => t.stop());
    mafiaLocalStream = null;
  }
}


// ========== CINEMA ==========
const CINEMA_MAX = 4;
const CINEMA_TICKET_KEY = 'cityExplorer_cinemaTicket';

let cinemaRoomChannel = null;
let cinemaRoomId = null;
let cinemaIsHost = false;
let cinemaLocalStream = null;
let cinemaScreenStream = null;
let cinemaRemoteScreen = null;
let cinemaScreenHosts = new Set();
let cinemaState = null;
let cinemaMediaRoom = null;
let cinemaRemoteStreams = new Map();
let cinemaJoined = false;

function hasCinemaTicket() {
  try { return localStorage.getItem(CINEMA_TICKET_KEY) === '1'; }
  catch { return false; }
}

function setCinemaTicket(v) {
  try { localStorage.setItem(CINEMA_TICKET_KEY, v ? '1' : '0'); } catch {}
}


function applyCinemaScreenMode() {
  const screenVid = document.getElementById('cinema-screen');
  const ui = document.getElementById('cinema-screen-ui');
  const hint = document.getElementById('cinema-broadcast-hint');
  const hostPanel = document.getElementById('cinema-host-panel');

  if (cinemaIsHost) {
    if (hostPanel) hostPanel.classList.remove('hidden');
    if (cinemaScreenStream && screenVid) {
      screenVid.srcObject = cinemaScreenStream;
      screenVid.muted = true;
      screenVid.classList.add('showing');
      screenVid.play().catch(() => {});
      if (ui) ui.classList.add('hidden');
    } else {
      if (screenVid) screenVid.classList.remove('showing');
      if (ui) ui.classList.remove('hidden');
      if (hint) hint.textContent = 'Вы хост — откройте mover.uz и начните трансляцию';
    }
  } else {
    if (hostPanel) hostPanel.classList.add('hidden');
    if (cinemaRemoteScreen && screenVid) {
      screenVid.srcObject = cinemaRemoteScreen;
      screenVid.muted = false;
      screenVid.classList.add('showing');
      screenVid.play().catch(() => {});
      if (ui) ui.classList.add('hidden');
    } else {
      if (screenVid) screenVid.classList.remove('showing');
      if (ui) ui.classList.remove('hidden');
      if (hint) hint.textContent = 'Ожидание трансляции хоста…';
    }
  }
}


async function startHostFrameBroadcast() {
  if (!cinemaIsHost) return;
  if (!navigator.mediaDevices?.getDisplayMedia) {
    showToast('На этом устройстве трансляция экрана недоступна — отправьте ссылку');
    return;
  }
  try {
    showToast('Выберите вкладку или окно mover.uz');
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 20, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true
    });
    cinemaScreenStream = stream;
    stream.getTracks().forEach((t) => {
      try { if (t.kind === 'video') t.contentHint = 'detail'; } catch (e) {}
      t._isCinemaScreen = true;
    });
    stream.getVideoTracks()[0].onended = () => {
      stopHostFrameBroadcast();
      applyCinemaScreenMode();
      showToast('Трансляция остановлена');
    };
    applyCinemaScreenMode();
    cinemaScreenHosts.add(playerId);
    const media = ensureCinemaMediaRoom();
    await media.setLocalStream('screen', stream);
    await media.syncPeers(Object.keys(cinemaState?.players || {}).filter((id) => id !== playerId));
    await media.announce('screen');
    publishCinema({ type: 'screen-live', hostId: playerId });
    showToast('Трансляция запущена');
  } catch (e) {
    console.warn(e);
    showToast('Нужно разрешить демонстрацию экрана');
  }
}

async function stopHostFrameBroadcast() {
  await cinemaMediaRoom?.removeLocalStream('screen', { stop: false });
  if (cinemaScreenStream) {
    cinemaScreenStream.getTracks().forEach((t) => t.stop());
    cinemaScreenStream = null;
  }
  cinemaScreenHosts.delete(playerId);
  publishCinema({ type: 'screen-stopped', hostId: playerId });
}


function openCinemaLobby() {
  if (cinemaInRoom) return;
  cinemaOpen = true;
  document.getElementById('cinema-modal')?.classList.remove('hidden');
  document.getElementById('interact-hint')?.classList.add('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  updateCinemaTicketUI();
  renderCinemaSlots();
}

function closeCinemaLobby() {
  if (cinemaInRoom) return;
  cinemaOpen = false;
  document.getElementById('cinema-modal')?.classList.add('hidden');
}

function updateCinemaTicketUI() {
  const st = document.getElementById('cinema-ticket-status');
  const buy = document.getElementById('cinema-buy-btn');
  const enter = document.getElementById('cinema-enter-btn');
  const has = hasCinemaTicket();
  if (st) st.textContent = has ? 'есть ✓' : 'нет';
  if (buy) buy.style.display = has ? 'none' : '';
  if (enter) enter.disabled = !has || !cinemaJoined;
}

function setupCinemaUI() {
  document.getElementById('cinema-close')?.addEventListener('click', () => {
    leaveCinemaRoom();
    closeCinemaLobby();
  });
  document.getElementById('cinema-buy-btn')?.addEventListener('click', () => {
    setCinemaTicket(true);
    updateCinemaTicketUI();
    showToast('Демо-билет получен — оплата не требуется');
  });
  document.getElementById('cinema-join-btn')?.addEventListener('click', () => joinCinemaRoom());
  document.getElementById('cinema-cam-btn')?.addEventListener('click', toggleCinemaCamera);
  document.getElementById('cinema-enter-btn')?.addEventListener('click', enterCinemaHall);
  document.getElementById('cinema-leave-btn')?.addEventListener('click', () => {
    leaveCinemaRoom();
    exitCinemaHallUI();
  });
  document.getElementById('cinema-fs-btn')?.addEventListener('click', toggleCinemaFullscreen);
  document.getElementById('cinema-open-mover')?.addEventListener('click', () => {
    window.open('https://mover.uz', '_blank', 'noopener,noreferrer');
  });
  document.getElementById('cinema-start-broadcast')?.addEventListener('click', () => {
    startHostFrameBroadcast();
  });
}



async function connectCinemaRealtime(roomId) {
  if (!hasCloudAccount() || !supabaseClient) throw new Error('AUTH_REQUIRED');
  if (cinemaRoomChannel) await cinemaRoomChannel.close();
  cinemaRoomChannel = createRealtimeRoom({
    client: supabaseClient,
    topic: `room:cinema:${roomId}`,
    playerId,
    displayName: currentUser?.name,
    presence: { roomId, feature: 'cinema' },
    onMessage: onCinemaMessage,
    onPresence: (members) => {
      if (!cinemaIsHost || !cinemaState?.players) return;
      const active = new Set(members.map((member) => String(member.id || member.key)));
      let changed = false;
      for (const member of members) {
        const id = String(member.id || member.key || '');
        if (!id || cinemaState.players[id]) continue;
        if (Object.keys(cinemaState.players).length >= CINEMA_MAX) continue;
        cinemaState.players[id] = { id, name: member.name || 'Игрок' };
        changed = true;
      }
      for (const id of Object.keys(cinemaState.players)) {
        if (id !== playerId && !active.has(id)) {
          delete cinemaState.players[id];
          changed = true;
        }
      }
      if (changed) broadcastCinemaState();
    }
  });
  await cinemaRoomChannel.connect();
  return cinemaRoomChannel;
}

function publishCinema(msg) {
  if (!cinemaRoomChannel || !cinemaRoomId) return Promise.resolve(false);
  return cinemaRoomChannel.send(msg).catch((error) => {
    console.warn('cinema realtime send', error);
    return false;
  });
}

async function joinCinemaRoom() {
  if (!hasCloudAccount()) {
    showToast('Войдите в аккаунт, чтобы войти в онлайн-кинозал');
    return;
  }
  if (!hasCinemaTicket()) {
    showToast('Сначала получите бесплатный демо-билет');
    return;
  }
  ensurePlayerId();
  let code = (document.getElementById('cinema-room-code')?.value || '').trim().toUpperCase();
  if (!code) {
    code = 'C' + Math.random().toString(36).slice(2, 7).toUpperCase();
    cinemaIsHost = true;
  } else {
    cinemaIsHost = false;
  }
  cinemaRoomId = code;
  cinemaJoined = true;

  const info = document.getElementById('cinema-room-info');
  info?.classList.remove('hidden');
  const lab = document.getElementById('cinema-room-label');
  if (lab) lab.textContent = code + (cinemaIsHost ? ' (хост)' : '');

  try {
    await connectCinemaRealtime(code);

    if (cinemaIsHost) {
      cinemaState = {
        room: code,
        hostId: playerId,
        filmUrl: 'https://mover.uz',
        players: {
          [playerId]: { id: playerId, name: currentUser?.name || 'Игрок' }
        }
      };
      broadcastCinemaState();
    } else {
      publishCinema({ type: 'hello' });
    }
    publishCinema({ type: 'join' });
    updateCinemaTicketUI();
    renderCinemaSlots();
    showToast('Зал ' + code);
  } catch (e) {
    console.error(e);
    cinemaJoined = false;
    cinemaRoomId = null;
    showToast('Не удалось подключить защищённый зал');
  }
}

function broadcastCinemaState() {
  if (!cinemaIsHost || !cinemaState) return;
  publishCinema({ type: 'state', state: cinemaState });
}

function onCinemaMessage(msg) {
  if (!msg || !msg.type) return;

  if (cinemaIsHost && cinemaState) {
    if (msg.type === 'join' || msg.type === 'hello') {
      if (msg.from && !cinemaState.players[msg.from]) {
        if (Object.keys(cinemaState.players).length >= CINEMA_MAX) {
          publishCinema({ type: 'full', to: msg.from });
          return;
        }
        cinemaState.players[msg.from] = { id: msg.from, name: msg.name || 'Игрок' };
        broadcastCinemaState();
      } else if (msg.from && cinemaState.players[msg.from]) {
        cinemaState.players[msg.from].name = msg.name || cinemaState.players[msg.from].name;
        broadcastCinemaState();
      }
    }
  }

  if (msg.type === 'full' && msg.to === playerId) {
    showToast('Зал заполнен (макс. 4)');
  }
  if (msg.type === 'state' && msg.state) {
    cinemaState = msg.state;
    if (cinemaState.hostId === playerId) cinemaIsHost = true;
    renderCinemaSlots();
    renderCinemaViewers();
    syncCinemaPeers();
    const cnt = document.getElementById('cinema-count');
    if (cnt) cnt.textContent = String(Object.keys(cinemaState.players || {}).length);
    const title = document.getElementById('cinema-room-title');
    if (title) title.textContent = cinemaState.room || cinemaRoomId || '—';
  }

  if (isMediaSignal(msg)) {
    ensureCinemaMediaRoom().handleSignal(msg);
  }

  if (msg.type === 'screen-live' && msg.from && msg.from !== playerId) {
    cinemaScreenHosts.add(msg.from);
    showToast('Хост начал трансляцию…');
  }
  if (msg.type === 'screen-stopped' && msg.from) {
    cinemaScreenHosts.delete(msg.from);
    cinemaRemoteScreen = null;
    applyCinemaScreenMode();
  }

}

function renderCinemaSlots() {
  const el = document.getElementById('cinema-slots');
  if (!el) return;
  const players = cinemaState?.players ? Object.values(cinemaState.players) : [];
  const cnt = document.getElementById('cinema-count');
  if (cnt) cnt.textContent = String(players.length);
  if (!players.length) {
    el.innerHTML = '<div class="mafia-slot"><div class="s-name">Пусто</div><div class="s-st">Войдите в зал</div></div>';
    return;
  }
  el.innerHTML = players.map((p) => `
    <div class="mafia-slot ready">
      <div class="s-name">${escapeHtml(p.name)}${p.id === playerId ? ' (вы)' : ''}${p.id === cinemaState?.hostId ? ' · хост' : ''}</div>
      <div class="s-st">В зале</div>
    </div>
  `).join('');
  updateCinemaTicketUI();
}

async function toggleCinemaCamera() {
  const video = document.getElementById('cinema-local-video');
  const status = document.getElementById('cinema-cam-status');
  const btn = document.getElementById('cinema-cam-btn');
  if (cinemaLocalStream) {
    await cinemaMediaRoom?.removeLocalStream('camera', { stop: false });
    cinemaLocalStream.getTracks().forEach((t) => t.stop());
    cinemaLocalStream = null;
    if (!cinemaScreenStream) closeCinemaPeers();
    if (video) video.srcObject = null;
    if (status) status.textContent = 'Камера выкл';
    if (btn) btn.textContent = 'Включить камеру и микрофон';
    renderCinemaViewers();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: true
    });
    cinemaLocalStream = stream;
    if (video) {
      video.srcObject = stream;
      video.muted = true;
      await video.play().catch(() => {});
    }
    if (status) status.textContent = 'Камера + мик вкл';
    if (btn) btn.textContent = 'Выключить медиа';
    await syncCinemaPeers();
    renderCinemaViewers();
  } catch (e) {
    console.warn(e);
    showToast('Нужен доступ к камере и микрофону');
  }
}

function enterCinemaHall() {
  if (!hasCinemaTicket()) {
    showToast('Нужен демо-билет');
    return;
  }
  if (!cinemaJoined) {
    showToast('Сначала войдите в зал (код)');
    return;
  }
  cinemaInRoom = true;
  cinemaOpen = false;
  document.getElementById('cinema-modal')?.classList.add('hidden');
  document.getElementById('cinema-room')?.classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  applyCinemaScreenMode();
  renderCinemaViewers();
  syncCinemaPeers();
  if (cinemaIsHost) {
    showToast('Откройте mover.uz и нажмите «Начать трансляцию»');
  } else {
    showToast('Ждём трансляцию хоста');
  }
}

function exitCinemaHallUI() {
  cinemaInRoom = false;
  document.getElementById('cinema-room')?.classList.add('hidden');
  closeCinemaLobby();
}

function renderCinemaViewers() {
  const grid = document.getElementById('cinema-viewers');
  if (!grid) return;
  const players = cinemaState?.players ? Object.values(cinemaState.players) : [];
  grid.innerHTML = players.map((p) => {
    const isMe = p.id === playerId;
    const isHost = p.id === cinemaState?.hostId;
    return `
      <div class="cinema-viewer-tile ${isHost ? 'host-tile' : ''}" data-id="${p.id}">
        <video data-peer="${p.id}" autoplay playsinline ${isMe ? 'muted' : ''}></video>
        <div class="cv-name">${escapeHtml(p.name)}${isMe ? ' (вы)' : ''}${isHost ? ' · хост' : ''}</div>
      </div>`;
  }).join('');

  players.forEach((p) => {
    const vid = grid.querySelector(`video[data-peer="${p.id}"]`);
    if (!vid) return;
    if (p.id === playerId && cinemaLocalStream) {
      vid.srcObject = cinemaLocalStream;
      vid.muted = true;
      vid.play().catch(() => {});
    } else if (cinemaRemoteStreams.has(p.id)) {
      const raw = cinemaRemoteStreams.get(p.id);
      vid.srcObject = raw;
      vid.muted = false;
      vid.play().catch(() => {});
    }
  });
}

// --- Shared WebRTC room for camera, microphone and screen share ---
function ensureCinemaMediaRoom() {
  if (cinemaMediaRoom) return cinemaMediaRoom;
  cinemaMediaRoom = createMediaRoom({
    selfId: playerId,
    send: async (message) => publishCinema(message),
    getAccessToken: () => cloudSession?.access_token || '',
    onRemoteStream: ({ peerId, source, stream }) => {
      if (source === 'screen') {
        cinemaRemoteScreen = stream.getTracks().length ? stream : null;
        applyCinemaScreenMode();
        return;
      }
      if (stream.getTracks().length) cinemaRemoteStreams.set(peerId, stream);
      else cinemaRemoteStreams.delete(peerId);
      renderCinemaViewers();
    },
    onPeerState: ({ state }) => {
      if (state === 'failed') showToast('Восстанавливаем связь в кинозале…');
    },
    onError: (error, context) => console.warn('[cinema-media]', context, error)
  });
  return cinemaMediaRoom;
}

function closeCinemaPeers() {
  cinemaMediaRoom?.closePeers();
  cinemaRemoteStreams.clear();
  cinemaRemoteScreen = null;
}

async function syncCinemaPeers() {
  if (!cinemaJoined || (!cinemaLocalStream && !cinemaScreenStream)) return;
  const media = ensureCinemaMediaRoom();
  if (cinemaLocalStream) await media.setLocalStream('camera', cinemaLocalStream);
  if (cinemaScreenStream) await media.setLocalStream('screen', cinemaScreenStream);
  await media.syncPeers(Object.keys(cinemaState?.players || {}).filter((id) => id !== playerId));
  await media.announce(cinemaScreenStream ? 'screen' : 'camera');
}



function toggleCinemaFullscreen() {
  const el = document.getElementById('cinema-screen-wrap') || document.getElementById('cinema-screen');
  if (!el) return;
  const doc = document;
  if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.webkitEnterFullscreen;
    if (req) req.call(el).catch(() => showToast('Полный экран недоступен'));
  } else {
    const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
    if (exit) exit.call(doc);
  }
}

async function leaveCinemaRoom() {
  cinemaJoined = false;
  cinemaIsHost = false;
  cinemaRoomId = null;
  cinemaState = null;
  const room = cinemaRoomChannel;
  cinemaRoomChannel = null;
  room?.send({ type: 'leave' }).catch(() => {}).finally(() => room.close());
  await stopHostFrameBroadcast();
  cinemaMediaRoom?.close({ stopLocal: false });
  cinemaMediaRoom = null;
  cinemaRemoteStreams.clear();
  cinemaRemoteScreen = null;
  if (cinemaLocalStream) {
    cinemaLocalStream.getTracks().forEach((t) => t.stop());
    cinemaLocalStream = null;
  }
}


// ========== AVATURN ==========
async function openAvaturn() {
  const overlay = document.getElementById('avaturn-overlay');
  const container = document.getElementById('avaturn-sdk-container');
  if (!overlay || !container) {
    showToast('Avaturn UI не найден');
    return;
  }
  overlay.classList.remove('hidden');
  container.innerHTML = '<p style="color:#fff;padding:20px;text-align:center">Загрузка Avaturn…</p>';
  showToast('Открываем Avaturn…');

  let subdomain = 'demo';
  try {
    const cfg = await import('./config.js');
    if (cfg.AVATURN_SUBDOMAIN) subdomain = cfg.AVATURN_SUBDOMAIN;
  } catch {}

  const avaturnUrl = `https://${subdomain}.avaturn.dev`;

  const onExported = async (glbUrl) => {
    if (!glbUrl) {
      showToast('Не удалось получить модель');
      return;
    }
    let parsed;
    try { parsed = new URL(glbUrl); } catch { showToast('Некорректная ссылка аватара'); return; }
    if (parsed.protocol !== 'https:') { showToast('Аватар должен загружаться по HTTPS'); return; }
    const nextVersion = Number(currentUser?.avatarVersion || 1) + 1;
    let savedUrl = parsed.href;
    if (hasCloudAccount()) {
      try {
        showToast('Сохраняем аватар в облаке…');
        savedUrl = await authService.persistAvatar(cloudSession.user.id, parsed.href, nextVersion);
      } catch (error) {
        console.warn('avatar asset copy', error);
        showToast('Не удалось сохранить модель аватара в облаке');
        return;
      }
    }
    customAvatarUrl = savedUrl;
    if (currentUser) {
      currentUser.avatarUrl = savedUrl;
      currentUser.avatarVersion = nextVersion;
      try {
        if (hasCloudAccount()) await pushProfileToCloud();
        else saveGuestProfile(currentUser);
      } catch (error) {
        console.warn('avatar profile save', error);
        showToast('Аватар создан, но не сохранился в облаке');
        return;
      }
    }
    showToast('Аватар создан! Можно играть');
    closeAvaturn();
    try { stopCharacterPreview(); } catch {}
    try { startCharacterPreview(); } catch {}
  };

  // Listen postMessage fallback
  const onMsg = (event) => {
    try {
      const allowed = new Set([`https://${subdomain}.avaturn.dev`, `https://${subdomain}.avaturn.me`]);
      if (!allowed.has(event.origin)) return;
      if (avaturnFrameWindow && event.source !== avaturnFrameWindow) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      const url = data.url || data.avatarUrl || data?.detail?.url;
      if (typeof url === 'string' && url.startsWith('https://')) onExported(url);
    } catch {}
  };
  if (avaturnMessageHandler) window.removeEventListener('message', avaturnMessageHandler);
  avaturnMessageHandler = onMsg;
  window.addEventListener('message', onMsg);

  try {
    const { AvaturnSDK } = await import('https://cdn.jsdelivr.net/npm/@avaturn/sdk/dist/index.js');
    const sdk = new AvaturnSDK();
    avaturnSdk = sdk;
    container.innerHTML = '';
    await sdk.init(container, { url: avaturnUrl, iframeClassName: 'avaturn-iframe' });
    avaturnFrameWindow = container.querySelector('iframe')?.contentWindow || null;
    sdk.on('export', (data) => {
      console.log('Avaturn export', data);
      onExported(data?.url || data?.avatarUrl || null);
    });
  } catch (e) {
    console.error('Avaturn SDK failed, iframe fallback', e);
    // Direct iframe embed
    container.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.src = avaturnUrl;
    iframe.className = 'avaturn-iframe';
    iframe.allow = 'camera; microphone; clipboard-write';
    iframe.style.cssText = 'width:100%;height:100%;border:none;';
    container.appendChild(iframe);
    avaturnFrameWindow = iframe.contentWindow;
    showToast('Редактор открыт. После экспорта скачай GLB или закрой');
  }
}

function closeAvaturn() {
  document.getElementById('avaturn-overlay')?.classList.add('hidden');
  const container = document.getElementById('avaturn-sdk-container');
  if (container) container.innerHTML = '';
  avaturnSdk = null;
  avaturnFrameWindow = null;
  if (avaturnMessageHandler) {
    window.removeEventListener('message', avaturnMessageHandler);
    avaturnMessageHandler = null;
  }
}

window.__openAvaturn = (e) => { if (e) { e.preventDefault(); e.stopPropagation(); } openAvaturn(); };
function setupAvaturnUI() {
  const btn = document.getElementById('btn-avaturn');
  if (btn && !btn.dataset.avaturnBound) {
    btn.dataset.avaturnBound = '1';
    const go = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openAvaturn();
    };
    btn.addEventListener('click', go);
    btn.addEventListener('touchend', go, { passive: false });
  }
  const closeBtn = document.getElementById('avaturn-close');
  if (closeBtn && !closeBtn.dataset.avaturnBound) {
    closeBtn.dataset.avaturnBound = '1';
    closeBtn.addEventListener('click', closeAvaturn);
  }
}


// ========== MOBILE CONTROLS ==========
function isTouchDevice() {
  return (
    typeof window !== 'undefined' &&
    ('ontouchstart' in window ||
      (navigator && navigator.maxTouchPoints > 0) ||
      (window.matchMedia && window.matchMedia('(pointer: coarse)').matches))
  );
}

function setupMobileControls() {
  isMobile = isTouchDevice() || window.innerWidth < 900;
  const root = document.getElementById('mobile-controls');
  if (!root) {
    console.warn('mobile-controls element missing');
    return;
  }
  // Always show on touch / narrow screens
  if (isMobile) root.classList.remove('hidden');
  else {
    root.classList.add('hidden');
    return;
  }

  const joyZone = document.getElementById('joy-zone');
  const stick = document.getElementById('joy-stick');
  const lookZone = document.getElementById('look-zone');
  const maxR = 42;
  let joyId = null;
  let lookId = null;
  let lookLastX = 0;
  let lookLastY = 0;

  const setStick = (dx, dy) => {
    const len = Math.hypot(dx, dy) || 1;
    const c = Math.min(len, maxR);
    const nx = (dx / len) * c;
    const ny = (dy / len) * c;
    joyX = nx / maxR;
    joyY = ny / maxR;
    if (stick) stick.style.transform = 'translate(' + nx + 'px,' + ny + 'px)';
  };
  const resetStick = () => {
    joyX = 0;
    joyY = 0;
    if (stick) stick.style.transform = 'translate(0,0)';
  };

  const joyCenter = () => {
    const base = document.getElementById('joy-base');
    if (base) {
      const r = base.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    const r = joyZone.getBoundingClientRect();
    return { x: r.left + 88, y: r.bottom - 88 };
  };

  if (joyZone) {
    joyZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      joyId = t.identifier;
      const c = joyCenter();
      setStick(t.clientX - c.x, t.clientY - c.y);
    }, { passive: false });
    joyZone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier !== joyId) continue;
        const c = joyCenter();
        setStick(t.clientX - c.x, t.clientY - c.y);
      }
    }, { passive: false });
    const endJoy = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === joyId) {
          joyId = null;
          resetStick();
        }
      }
    };
    joyZone.addEventListener('touchend', endJoy);
    joyZone.addEventListener('touchcancel', endJoy);
  }

  if (lookZone) {
    lookZone.addEventListener('touchstart', (e) => {
      if (e.target.closest && e.target.closest('.mbtn')) return;
      const t = e.changedTouches[0];
      lookId = t.identifier;
      lookLastX = t.clientX;
      lookLastY = t.clientY;
    }, { passive: true });
    lookZone.addEventListener('touchmove', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier !== lookId) continue;
        const dx = t.clientX - lookLastX;
        const dy = t.clientY - lookLastY;
        lookLastX = t.clientX;
        lookLastY = t.clientY;
        yaw -= dx * 0.0055;
        pitch = Math.max(-0.85, Math.min(0.85, pitch - dy * 0.0055));
      }
    }, { passive: true });
    const endLook = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === lookId) lookId = null;
      }
    };
    lookZone.addEventListener('touchend', endLook);
    lookZone.addEventListener('touchcancel', endLook);
  }

  const bindHold = (id, press, release) => {
    const el = document.getElementById(id);
    if (!el) return;
    const down = (e) => { e.preventDefault(); el.classList.add('active'); press(); };
    const up = (e) => { e.preventDefault(); el.classList.remove('active'); release(); };
    el.addEventListener('touchstart', down, { passive: false });
    el.addEventListener('touchend', up, { passive: false });
    el.addEventListener('touchcancel', up, { passive: false });
  };
  bindHold('btn-jump', () => { keys.Space = true; }, () => { keys.Space = false; });
  bindHold('btn-sprint', () => { keys.ShiftLeft = true; }, () => { keys.ShiftLeft = false; });
  const btnE = document.getElementById('btn-interact');
  if (btnE) {
    const doInteract = (e) => {
      e.preventDefault();
      try {
        if (typeof tryOpenClubNearPlayer === 'function' && tryOpenClubNearPlayer()) return;
        if (window.__tryOpenClub && window.__tryOpenClub()) return;
        if (typeof isNearCinema === 'function' && isNearCinema()) { openCinemaLobby(); return; }
        if (typeof isNearMafia === 'function' && isNearMafia()) { openMafiaLobby(); return; }
        if (typeof isNearRestaurant === 'function' && isNearRestaurant() && !restaurantOpen) {
          openRestaurantMenu();
        }
      } catch (err) { console.warn(err); }
    };
    btnE.addEventListener('touchstart', doInteract, { passive: false });
    btnE.addEventListener('click', doInteract);
  }
  console.log('Mobile controls ready');
}


// ========== AUTH / CHARACTER ==========
// Passwords and authenticated sessions are handled only by Supabase Auth.
// Browser storage is reserved for the explicitly labelled guest profile.
const STORAGE_USERS = 'cityExplorer_users_v1';
const STORAGE_SESSION = 'cityExplorer_session_v1';
const STORAGE_GUEST = 'lifeInGame_guest_v1';

const CLOTHES_OPTIONS = [
  { id: 'default', name: 'Классика', icon: '👕', color: '#2a2a2a', unlocked: true },
  { id: 'none', name: 'Без одежды', icon: '🧍', color: '#c4a882', unlocked: true },
  { id: 'soon1', name: 'Куртка', icon: '🧥', color: '#5a4030', unlocked: false },
  { id: 'soon2', name: 'Костюм', icon: '👔', color: '#1a2840', unlocked: false },
  { id: 'soon3', name: 'Спорт', icon: '🏃', color: '#2d6b4a', unlocked: false },
  { id: 'soon4', name: 'Форма', icon: '🎖️', color: '#2a3a5a', unlocked: false },
];

// Mini preview scene for character select
let previewRenderer, previewScene, previewCamera, previewModel, previewMixer, previewRaf;
let previewYaw = 0.4;


function loadGuestProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_GUEST) || 'null');
    if (saved && typeof saved === 'object') return saved;

    // One-time migration: preserve the active legacy profile but permanently
    // remove old locally stored passwords.
    const session = JSON.parse(localStorage.getItem(STORAGE_SESSION) || 'null');
    const users = JSON.parse(localStorage.getItem(STORAGE_USERS) || '{}');
    const legacy = session?.name ? users[String(session.name).toLowerCase()] : null;
    if (legacy) {
      const { pass: _removedPassword, ...safeProfile } = legacy;
      localStorage.setItem(STORAGE_GUEST, JSON.stringify({ ...safeProfile, isGuest: true }));
      localStorage.removeItem(STORAGE_USERS);
      localStorage.removeItem(STORAGE_SESSION);
      return { ...safeProfile, isGuest: true };
    }
  } catch (error) {
    console.warn('guest profile migration', error);
  }
  try {
    localStorage.removeItem(STORAGE_USERS);
    localStorage.removeItem(STORAGE_SESSION);
  } catch {}
  return null;
}

function saveGuestProfile(user) {
  if (!user?.isGuest) return;
  const { pass: _removedPassword, ...safeProfile } = user;
  try { localStorage.setItem(STORAGE_GUEST, JSON.stringify(safeProfile)); }
  catch (error) { console.warn('guest profile save', error); }
}

function createGuestProfile() {
  const suffix = String(Math.floor(1000 + Math.random() * 9000));
  return {
    username: `guest_${suffix}`,
    name: `Гость ${suffix}`,
    gender: 'male',
    clothes: 'default',
    avatarUrl: null,
    isGuest: true
  };
}

async function loadCloudProfile(user, fallback = {}) {
  return authService?.loadProfile(user, fallback) || fallback;
}

async function initCloudAuth() {
  const mode = document.getElementById('auth-mode');
  try {
    authService = await createAuthService();
    if (!authService) {
      if (mode) mode.textContent = 'Облачный вход ещё не настроен · доступен гостевой режим';
      return;
    }
    supabaseClient = authService.client;
    const listener = authService.onAuthStateChange((event, session) => {
      cloudSession = session;
      if (event === 'PASSWORD_RECOVERY') showPasswordReset();
    });
    lifecycle.cleanup(() => listener?.data?.subscription?.unsubscribe());
    cloudSession = await authService.getSession();
    cloudEnabled = true;
    if (mode) mode.textContent = 'Защищённый облачный аккаунт · доступ с любого устройства';
  } catch (error) {
    console.warn('cloud auth unavailable', error);
    authService = null;
    supabaseClient = null;
    cloudEnabled = false;
    if (mode) mode.textContent = 'Облачный вход временно недоступен · доступен гостевой режим';
  }
}

function showScreen(id) {
  document.getElementById('screen-auth')?.classList.toggle('hidden', id !== 'auth');
  document.getElementById('screen-character')?.classList.toggle('hidden', id !== 'character');
}
function setAuthError(msg) {
  const el = document.getElementById('auth-error');
  if (el) el.textContent = msg || '';
}

function setAuthBusy(busy) {
  const card = document.getElementById('screen-auth');
  card?.classList.toggle('auth-busy', busy);
  card?.querySelectorAll('button, input').forEach((element) => {
    element.disabled = !!busy;
  });
}

function showAuthForm(name) {
  document.getElementById('form-register')?.classList.toggle('hidden', name !== 'register');
  document.getElementById('form-login')?.classList.toggle('hidden', name !== 'login');
  document.getElementById('form-password-reset')?.classList.toggle('hidden', name !== 'reset');
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === name);
    tab.classList.toggle('hidden', name === 'reset');
  });
}

function showPasswordReset() {
  showScreen('auth');
  showAuthForm('reset');
  setAuthError('Ссылка подтверждена. Теперь задайте новый пароль.');
}

async function setupMenu() {
  await initCloudAuth();
  return new Promise((resolve) => {
    try { setupAvaturnUI(); } catch (e) { console.warn('avaturn ui', e); }
    const menu = document.getElementById('menu');
    if (!menu) { resolve(); return; }
    try {

    // Tabs
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        showAuthForm(tab.dataset.tab === 'register' ? 'register' : 'login');
        setAuthError('');
      });
    });

    // Register
    document.getElementById('form-register')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = (document.getElementById('reg-username')?.value || '').trim();
      const displayName = (document.getElementById('reg-name')?.value || '').trim();
      const email = (document.getElementById('reg-email')?.value || '').trim();
      const pass = document.getElementById('reg-pass')?.value || '';
      const gender = document.querySelector('input[name="gender"]:checked')?.value || 'male';
      const consent = !!document.getElementById('reg-consent')?.checked;
      const validationError = validateRegistration({ username, displayName, email, password: pass, consent });
      if (validationError) { setAuthError(validationError); return; }
      if (!cloudEnabled) {
        setAuthError('Регистрация станет доступна после подключения Supabase. Сейчас можно войти как гость.');
        return;
      }
      try {
        setAuthBusy(true);
        setAuthError('Создаём защищённый аккаунт…');
        const data = await authService.register({ username, displayName, email, password: pass, gender });
        if (!data.session) {
          showAuthForm('login');
          document.getElementById('login-email').value = email;
          setAuthError('Аккаунт создан. Подтвердите email по ссылке в письме, затем войдите.');
          return;
        }
        cloudSession = data.session;
        playerId = data.user.id;
        currentUser = { username, name: displayName, gender, clothes: 'default', avatarUrl: null };
        await pushProfileToCloud();
        customAvatarUrl = null;
        setAuthError('');
        openCharacterScreen();
      } catch (error) {
        setAuthError(authErrorMessage(error));
      } finally {
        setAuthBusy(false);
      }
    });

    // Login
    document.getElementById('form-login')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = (document.getElementById('login-email')?.value || '').trim();
      const pass = document.getElementById('login-pass')?.value || '';
      if (!cloudEnabled) {
        setAuthError('Облачный вход не настроен. Используйте гостевой режим для просмотра города.');
        return;
      }
      try {
        setAuthBusy(true);
        setAuthError('Входим…');
        const data = await authService.login(email, pass);
        cloudSession = data.session;
        playerId = data.user.id;
        currentUser = await loadCloudProfile(data.user, { name: data.user.user_metadata?.name || 'Игрок' });
        selectedClothes = currentUser.clothes || 'default';
        customAvatarUrl = currentUser.avatarUrl || null;
        setAuthError('');
        openCharacterScreen();
      } catch (error) {
        setAuthError(authErrorMessage(error));
      } finally {
        setAuthBusy(false);
      }
    });

    document.getElementById('btn-forgot-password')?.addEventListener('click', async () => {
      const email = (document.getElementById('login-email')?.value || '').trim();
      if (!cloudEnabled) { setAuthError('Восстановление станет доступно после подключения Supabase.'); return; }
      if (!email) { setAuthError('Сначала введите email аккаунта.'); return; }
      try {
        setAuthBusy(true);
        await authService.requestPasswordReset(email);
        setAuthError('Письмо для восстановления отправлено. Проверьте входящие и папку «Спам».');
      } catch (error) {
        setAuthError(authErrorMessage(error));
      } finally {
        setAuthBusy(false);
      }
    });

    document.getElementById('form-password-reset')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = document.getElementById('reset-pass')?.value || '';
      if (password.length < 8) { setAuthError('Пароль должен содержать минимум 8 символов'); return; }
      try {
        setAuthBusy(true);
        await authService.updatePassword(password);
        cloudSession = await authService.getSession();
        currentUser = await loadCloudProfile(cloudSession?.user);
        setAuthError('Пароль обновлён.');
        openCharacterScreen();
      } catch (error) {
        setAuthError(authErrorMessage(error));
      } finally {
        setAuthBusy(false);
      }
    });

    document.getElementById('btn-guest')?.addEventListener('click', async () => {
      if (cloudSession?.user) {
        try { await authService?.signOut(); } catch {}
        cloudSession = null;
      }
      currentUser = loadGuestProfile() || createGuestProfile();
      currentUser.isGuest = true;
      selectedClothes = currentUser.clothes || 'default';
      customAvatarUrl = currentUser.avatarUrl || null;
      saveGuestProfile(currentUser);
      setAuthError('');
      openCharacterScreen();
    });

    document.getElementById('btn-back-auth')?.addEventListener('click', () => {
      showScreen('auth');
      setAuthError('');
    });

    document.getElementById('btn-start')?.addEventListener('click', () => {
      if (!currentUser) return;
      currentUser.clothes = selectedClothes;
      if (hasCloudAccount()) {
        pushProfileToCloud().catch((e) => console.warn('character save', e));
      } else {
        saveGuestProfile(currentUser);
      }
      stopCharacterPreview();
      menu.classList.add('hidden');
      resolve();
    });

    // Auto-login session → still show character select
    if (cloudEnabled && cloudSession?.user) {
      loadCloudProfile(cloudSession.user).then((user) => {
        currentUser = user;
        playerId = cloudSession.user.id;
        selectedClothes = user.clothes || 'default';
        customAvatarUrl = user.avatarUrl || null;
        openCharacterScreen();
      }).catch((error) => {
        console.warn('restore cloud profile', error);
        showScreen('auth');
      });
      return;
    }
    loadGuestProfile(); // migrates and scrubs any legacy locally stored passwords
    showScreen('auth');
    } catch (e) {
      console.error('setupMenu', e);
      showScreen('auth');
      resolve();
    }
  });
}

function openCharacterScreen() {
  showScreen('character');
  setupAvaturnUI();
  const nameEl = document.getElementById('char-name-display');
  const genderEl = document.getElementById('char-gender-display');
  if (nameEl) nameEl.textContent = currentUser?.name || '—';
  if (genderEl) genderEl.textContent = currentUser?.gender === 'female' ? 'Женщина' : 'Мужчина';

  const grid = document.getElementById('clothes-grid');
  if (grid) {
    grid.innerHTML = '';
    CLOTHES_OPTIONS.forEach((c) => {
      const card = document.createElement('div');
      card.className = 'cloth-card' + (c.id === selectedClothes ? ' selected' : '') + (c.unlocked ? '' : ' locked');
      card.innerHTML = `<div class="cloth-swatch" style="background:${c.color}"></div>${c.name}`;
      if (c.unlocked) {
        card.addEventListener('click', () => {
          selectedClothes = c.id;
          grid.querySelectorAll('.cloth-card').forEach((el) => el.classList.remove('selected'));
          card.classList.add('selected');
          applyPreviewClothing(selectedClothes);
        });
      }
      grid.appendChild(card);
    });
  }
  try {
    if (supportsWebGL()) startCharacterPreview();
    else {
      const stage = document.querySelector('.char-stage-label');
      if (stage) stage.textContent = '3D‑просмотр недоступен, профиль можно сохранить';
    }
  } catch (error) {
    console.warn('Character preview unavailable', error);
    const canvas = document.getElementById('char-preview');
    if (canvas) canvas.style.background = 'radial-gradient(circle at 50% 35%, #36558f, #10172b 70%)';
  }
  // Mobile: keep Play button visible
  setTimeout(() => {
    document.getElementById('btn-start')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, 200);
}

function stopCharacterPreview() {
  if (previewRaf) cancelAnimationFrame(previewRaf);
  previewRaf = 0;
  if (previewRenderer) {
    previewRenderer.dispose();
    previewRenderer = null;
  }
  previewModel = null;
  previewMixer = null;
}

function startCharacterPreview() {
  stopCharacterPreview();
  const canvas = document.getElementById('preview-canvas');
  if (!canvas) return;

  const w = canvas.clientWidth || 420;
  const h = canvas.clientHeight || 420;
  previewRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  previewRenderer.setSize(w, h, false);
  previewRenderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  previewRenderer.outputColorSpace = THREE.SRGBColorSpace;

  previewScene = new THREE.Scene();
  previewScene.background = new THREE.Color(0x141628);

  previewCamera = new THREE.PerspectiveCamera(30, w / h, 0.1, 50);
  previewCamera.position.set(0, 1.2, 3.4);

  previewScene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1.1));
  const key = new THREE.DirectionalLight(0xfff5e6, 1.2);
  key.position.set(2, 4, 3);
  previewScene.add(key);
  const fill = new THREE.DirectionalLight(0x88aaff, 0.35);
  fill.position.set(-3, 2, -2);
  previewScene.add(fill);

  // Floor disc
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(1.4, 48),
    new THREE.MeshStandardMaterial({ color: 0x1e2238, roughness: 0.85, metalness: 0.1 })
  );
  floor.rotation.x = -Math.PI / 2;
  previewScene.add(floor);

  const loader = new GLTFLoader();
  const previewUrl = customAvatarUrl || currentUser?.avatarUrl || 'models/model_idle.glb';
  loader.load(previewUrl, (gltf) => {
    previewModel = gltf.scene;
    previewModel.traverse((c) => {
      if (c.isMesh) {
        c.castShadow = false;
        c.receiveShadow = false;
      }
    });
    // Center & scale
    const box = new THREE.Box3().setFromObject(previewModel);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    previewModel.position.sub(center);
    previewModel.position.y += size.y / 2;
    const s = 1.7 / Math.max(size.y, 0.1);
    previewModel.scale.setScalar(s);
    previewScene.add(previewModel);

    if (gltf.animations?.length) {
      previewMixer = new THREE.AnimationMixer(previewModel);
      const act = previewMixer.clipAction(gltf.animations[0]);
      act.play();
    }
    applyPreviewClothing(selectedClothes);
  }, undefined, (err) => console.warn('Preview model failed', err));

  // Drag to rotate
  let dragging = false, lastX = 0;
  canvas.onpointerdown = (e) => { dragging = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); };
  canvas.onpointerup = () => { dragging = false; };
  canvas.onpointermove = (e) => {
    if (!dragging) return;
    previewYaw += (e.clientX - lastX) * 0.01;
    lastX = e.clientX;
  };

  const clockP = new THREE.Clock();
  const loop = () => {
    previewRaf = requestAnimationFrame(loop);
    const dt = clockP.getDelta();
    previewMixer?.update(dt);
    if (previewModel) previewModel.rotation.y = previewYaw;
    previewRenderer?.render(previewScene, previewCamera);
  };
  loop();
}

function applyPreviewClothing(id) {
  if (!previewModel) return;
  previewModel.traverse((o) => {
    if (!o.isMesh) return;
    const n = (o.name || '').toLowerCase();
    if (n.includes('look')) o.visible = id !== 'none';
  });
}


function collectClothingMeshes(root) {
  clothingMeshes = { look: [], shoes: [], body: [], hair: [] };
  if (!root) return;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const n = (o.name || '').toLowerCase();
    if (n.includes('look')) clothingMeshes.look.push(o);
    else if (n.includes('shoes')) clothingMeshes.shoes.push(o);
    else if (n.includes('body')) clothingMeshes.body.push(o);
    else if (n.includes('hair')) clothingMeshes.hair.push(o);
  });
}

function applyClothing(id) {
  // default = outfit on; none = hide look (clothes)
  const showLook = id !== 'none';
  clothingMeshes.look.forEach((m) => { m.visible = showLook; });
  // future outfits would swap textures/models here
}


// ========== INIT ==========
async function init() {
  try {
    // Menu first (registration / character)
    setLoading('Меню...');
    if (loadingEl) loadingEl.classList.add('hidden');
    await setupMenu();
    if (loadingEl) {
      loadingEl.classList.remove('hidden');
      setLoading('Инициализация движка...');
    }

    clock = new THREE.Clock();

    if (!supportsWebGL()) throw new Error('WEBGL_UNAVAILABLE');

    const canvas = document.getElementById('c');
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    const lowPowerDevice = window.innerWidth < 820 || Number(navigator.deviceMemory || 8) <= 4;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowPowerDevice ? 1.15 : 1.5));
    renderer.shadowMap.enabled = !lowPowerDevice;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8ec4f0);
    scene.fog = null;

    camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.15, 500);
    camera.position.set(0, 7, 10);

    setLoading('Настройка освещения...');
    setupLights();

    setLoading('Генерация города...');
    await new Promise(r => setTimeout(r, 40));
    await createCity();

    setLoading('Загрузка персонажа...');
    await loadPlayer();
    // Spawn on entertainment street
    if (player) {
      window.__playerRef = player;
      player.position.set(0, 0.22, -9.5);
      yaw = Math.PI; // face the central landmark and +Z entertainment street
    }
    clothingMeshes = { look: [], shoes: [], body: [], hair: [] };
    collectClothingMeshes(idleSkin);
    // append walk meshes without clearing
    if (walkSkin) {
      walkSkin.traverse((o) => {
        if (!o.isMesh) return;
        const n = (o.name || '').toLowerCase();
        if (n.includes('look')) clothingMeshes.look.push(o);
        else if (n.includes('shoes')) clothingMeshes.shoes.push(o);
        else if (n.includes('body')) clothingMeshes.body.push(o);
        else if (n.includes('hair')) clothingMeshes.hair.push(o);
      });
    }
    applyClothing(selectedClothes || currentUser?.clothes || 'default');
    // Show player name in HUD
    const infoH = document.querySelector('#info h1');
    if (infoH && currentUser) infoH.textContent = currentUser.name;

    setupEvents();
    setupRestaurantUI();
    setupMafiaUI();
    if (!playerId) {
      try { playerId = localStorage.getItem('ce_pid') || ('p_' + Math.random().toString(36).slice(2, 10)); localStorage.setItem('ce_pid', playerId); }
      catch { playerId = 'p_' + Math.random().toString(36).slice(2, 10); }
    }
    initClubs({
      get player() { return player; },
      get playerId() { return playerId; },
      get currentUser() { return currentUser; },
      get realtimeClient() { return supabaseClient; },
      getAccessToken: () => cloudSession?.access_token || '',
      isAuthenticated: hasCloudAccount,
      showToast,
      getZone(name) {
        if (name === 'speaking') return window.__speakingZone;
        if (name === 'chess') return window.__chessZone;
        if (name === 'monopoly') return window.__monopolyZone;
        return null;
      }
    });
    setupCinemaUI();
    setupMobileControls();
    setupAccountUI();
    setupCityGuide();
    const camBtn = document.getElementById('btn-cam-mode');
    if (camBtn) {
      camBtn.classList.remove('hidden');
      camBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleCameraMode();
      });
    }
    setupGovUI();
    initMultiplayer();

    // Прячем загрузку
    setTimeout(() => {
      if (loadingEl) loadingEl.classList.add('hidden');
      showToast(isMobile || isTouchDevice() ? 'Улица клубов: свайп — обзор' : 'Клик по экрану — мышь. WASD — ходьба. Кнопка «Вид» — сверху');
    }, 300);

    animate();
  } catch (err) {
    if (String(err?.message || err).includes('WEBGL')) {
      showWebGLFallback();
      return;
    }
    console.error('Init error:', err);
    setLoading('Ошибка: ' + (err.message || err));
    // Всё равно показываем сцену с fallback
    if (!player && scene) createFallbackPlayer();
    setupEvents();
    setTimeout(() => loadingEl && loadingEl.classList.add('hidden'), 1500);
    animate();
  }
}

// ========== LIGHTS ==========
function setupLights() {
  const hemi = new THREE.HemisphereLight(0xc9e8ff, 0x4b493b, 1.02);
  scene.add(hemi);

  const amb = new THREE.AmbientLight(0xfff7e9, 0.22);
  scene.add(amb);

  const sun = new THREE.DirectionalLight(0xffe5b5, 2.15);
  sun.position.set(-36, 58, -24);
  sun.castShadow = Boolean(renderer?.shadowMap?.enabled);
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 4;
  sun.shadow.camera.far = 150;
  sun.shadow.camera.left = -62;
  sun.shadow.camera.right = 62;
  sun.shadow.camera.top = 62;
  sun.shadow.camera.bottom = -62;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.025;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x8fcfff, 0.38);
  fill.position.set(-25, 15, -30);
  scene.add(fill);
}

// ========== CITY (Kenney industrial kit) ==========
const CITY_BUILDINGS = [
  'building-a', 'building-b', 'building-c', 'building-d', 'building-e',
  'building-f', 'building-g', 'building-h', 'building-i', 'building-j',
  'building-k', 'building-l', 'building-m', 'building-n', 'building-o',
  'building-p', 'building-q', 'building-r', 'building-s', 'building-t'
];



function loadNeighborhood() {
  const loader = new GLTFLoader();
  loader.load(
    'models/city/neighborhood.glb',
    (gltf) => {
      try {
        const src = gltf.scene;
        src.updateMatrixWorld(true);

        // Collect building roots only (keep a few for performance)
        const buildingNodes = [];
        const propNodes = [];
        src.traverse((c) => {
          const n = c.name || '';
          if (/^building[_-]?\d+/i.test(n) && c.children && c.children.length) {
            buildingNodes.push(c);
          }
          // light props (optional, max few)
          if (/^(Tree_\d+|fire hydrant|mail box)$/i.test(n)) {
            propNodes.push(c);
          }
        });

        // Prefer unique buildings by name prefix
        const uniq = [];
        const seen = new Set();
        for (const b of buildingNodes) {
          const key = (b.name || '').replace(/_.*/, '');
          if (seen.has(b.name)) continue;
          seen.add(b.name);
          uniq.push(b);
        }
        // Keep only 6 houses
        const keepBuildings = uniq.slice(0, 6);
        const keepProps = propNodes.slice(0, 4);

        const town = new THREE.Group();
        town.name = 'NeighborhoodLite';

        // Normalize each building to a reasonable height, then place on a grid
        const spots = [
          { x: -18, z: 0 },
          { x: -6, z: 0 },
          { x: 6, z: 0 },
          { x: 18, z: 0 },
          { x: -12, z: 16 },
          { x: 12, z: 16 }
        ];

        const houseHeight = 7.5;
        keepBuildings.forEach((node, i) => {
          if (i >= spots.length) return;
          const clone = node.clone(true);
          clone.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(clone);
          const size = new THREE.Vector3();
          box.getSize(size);
          const s = size.y > 0.01 ? houseHeight / size.y : 1;
          clone.scale.setScalar(s);
          clone.updateMatrixWorld(true);
          const box2 = new THREE.Box3().setFromObject(clone);
          const center = new THREE.Vector3();
          box2.getCenter(center);
          clone.position.x += spots[i].x - center.x;
          clone.position.z += spots[i].z - center.z;
          clone.position.y += -box2.min.y;
          clone.traverse((m) => {
            if (m.isMesh) {
              m.castShadow = true;
              m.receiveShadow = true;
              if (m.material && m.material.map) m.material.map.colorSpace = THREE.SRGBColorSpace;
            }
          });
          town.add(clone);
        });

        // A couple of trees as props
        keepProps.forEach((node, i) => {
          const clone = node.clone(true);
          clone.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(clone);
          const size = new THREE.Vector3();
          box.getSize(size);
          const s = size.y > 0.01 ? 4.5 / size.y : 1;
          clone.scale.setScalar(s);
          clone.updateMatrixWorld(true);
          const box2 = new THREE.Box3().setFromObject(clone);
          const px = (i % 2 === 0 ? -22 : 22);
          const pz = 8 + i * 3;
          const center = new THREE.Vector3();
          box2.getCenter(center);
          clone.position.x += px - center.x;
          clone.position.z += pz - center.z;
          clone.position.y += -box2.min.y;
          town.add(clone);
        });

        // === Generated asphalt + sidewalks (original roads were removed with terrain) ===
        const asphaltMat = new THREE.MeshStandardMaterial({
          color: 0x2e2e32,
          roughness: 0.92,
          metalness: 0.05
        });
        const curbMat = new THREE.MeshStandardMaterial({
          color: 0x8a8078,
          roughness: 0.88
        });
        const walkMat = new THREE.MeshStandardMaterial({
          color: 0xb0aaa0,
          roughness: 0.9
        });
        const lineMat = new THREE.MeshStandardMaterial({
          color: 0xe8e4d8,
          roughness: 0.7
        });

        // Main street through the mini block (along X)
        const road = new THREE.Mesh(new THREE.PlaneGeometry(52, 8), asphaltMat);
        road.rotation.x = -Math.PI / 2;
        road.position.set(0, 0.02, 8);
        road.receiveShadow = true;
        town.add(road);

        // Side street (along Z)
        const road2 = new THREE.Mesh(new THREE.PlaneGeometry(8, 36), asphaltMat);
        road2.rotation.x = -Math.PI / 2;
        road2.position.set(0, 0.021, 10);
        road2.receiveShadow = true;
        town.add(road2);

        // Sidewalks
        const sw1 = new THREE.Mesh(new THREE.PlaneGeometry(52, 3.2), walkMat);
        sw1.rotation.x = -Math.PI / 2;
        sw1.position.set(0, 0.03, 2.2);
        sw1.receiveShadow = true;
        town.add(sw1);
        const sw2 = new THREE.Mesh(new THREE.PlaneGeometry(52, 3.2), walkMat);
        sw2.rotation.x = -Math.PI / 2;
        sw2.position.set(0, 0.03, 13.8);
        sw2.receiveShadow = true;
        town.add(sw2);

        // Center line
        const line = new THREE.Mesh(new THREE.PlaneGeometry(48, 0.18), lineMat);
        line.rotation.x = -Math.PI / 2;
        line.position.set(0, 0.04, 8);
        town.add(line);

        // Curbs
        for (const z of [4.1, 11.9]) {
          const curb = new THREE.Mesh(new THREE.BoxGeometry(52, 0.12, 0.25), curbMat);
          curb.position.set(0, 0.06, z);
          town.add(curb);
        }

        // Place whole block north of club street
        town.position.set(0, 0, 28);
        scene.add(town);

        // Walk surfaces for height raycast (only our asphalt/sidewalk — cheap)
        walkMeshes = [road, road2, sw1, sw2];

        // Collisions for houses only
        town.updateMatrixWorld(true);
        town.children.forEach((ch) => {
          if (ch.isMesh) return; // skip roads
          const b = new THREE.Box3().setFromObject(ch);
          const h = b.max.y - b.min.y;
          if (h < 2) return;
          buildings.push({
            box: new THREE.Box3(
              new THREE.Vector3(b.min.x + 0.2, 0, b.min.z + 0.2),
              new THREE.Vector3(b.max.x - 0.2, Math.min(h, 10), b.max.z - 0.2)
            )
          });
        });

        console.log('[neighborhood] lite houses', keepBuildings.length, 'props', keepProps.length);
      } catch (e) {
        console.warn('neighborhood place', e);
      }
    },
    undefined,
    (err) => console.warn('neighborhood load failed', err)
  );
}


function createSoftCloudTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);

  const puffs = [
    [118, 145, 78], [184, 112, 94], [258, 126, 112],
    [334, 108, 86], [396, 145, 72], [235, 82, 72]
  ];
  puffs.forEach(([x, y, radius]) => {
    const gradient = context.createRadialGradient(x, y, radius * 0.12, x, y, radius);
    gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
    gradient.addColorStop(0.48, 'rgba(250,253,255,0.64)');
    gradient.addColorStop(1, 'rgba(244,250,255,0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function loadSkybox() {
  // The bundled sky.png is a cube-cross texture, not an equirectangular map.
  // A procedural atmosphere avoids the stretched seams and keeps the skyline
  // clean on both desktop and mobile GPUs.
  const sky = new Sky();
  sky.name = 'AtmosphericSky';
  sky.scale.setScalar(420);
  sky.material.depthWrite = false;
  const uniforms = sky.material.uniforms;
  uniforms.turbidity.value = 6.8;
  uniforms.rayleigh.value = 1.55;
  uniforms.mieCoefficient.value = 0.0045;
  uniforms.mieDirectionalG.value = 0.76;
  const sun = new THREE.Vector3();
  sun.setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - 38),
    THREE.MathUtils.degToRad(-122)
  );
  uniforms.sunPosition.value.copy(sun);
  sky.renderOrder = -1000;
  scene.add(sky);
  scene.background = new THREE.Color(0xa9d3ec);
  scene.environment = null;

  const cloudTexture = createSoftCloudTexture();
  const cloudData = [
    [-92, 58, -56, 46, 18, 0.5],
    [-28, 70, -118, 54, 20, 0.42],
    [62, 54, -102, 42, 16, 0.46],
    [116, 64, -28, 50, 19, 0.38],
    [96, 56, 72, 44, 17, 0.43],
    [18, 73, 126, 58, 21, 0.36],
    [-88, 62, 92, 48, 18, 0.4]
  ];
  const cloudLimit = window.innerWidth < 820 || Number(navigator.deviceMemory || 8) <= 4 ? 4 : cloudData.length;
  cloudData.slice(0, cloudLimit).forEach(([x, y, z, width, height, opacity], index) => {
    const material = new THREE.SpriteMaterial({
      map: cloudTexture,
      color: index % 2 ? 0xf6fbff : 0xffffff,
      transparent: true,
      opacity,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      rotation: (index - 3) * 0.035
    });
    const cloud = new THREE.Sprite(material);
    cloud.name = `SoftCloud-${index + 1}`;
    cloud.position.set(x, y, z);
    cloud.scale.set(width, height, 1);
    cloud.renderOrder = -900;
    scene.add(cloud);
  });

  if (camera) camera.far = Math.max(camera.far, 500);
  if (camera) camera.updateProjectionMatrix();
}


function placeBoundaryWalls() {
  const { minX, maxX, minZ, maxZ } = WORLD_BOUNDS;
  const h = 1.8;
  const t = 1.1;
  const hedgeMat = makeCityMaterial(0x285c46, { roughness: 0.98 });
  const capMat = makeCityMaterial(0xb7b1a6, { roughness: 0.9 });
  const walls = [
    { x: (minX + maxX) / 2, z: minZ - t / 2, w: maxX - minX + t * 2, d: t },
    { x: (minX + maxX) / 2, z: maxZ + t / 2, w: maxX - minX + t * 2, d: t },
    { x: minX - t / 2, z: (minZ + maxZ) / 2, w: t, d: maxZ - minZ + t * 2 },
    { x: maxX + t / 2, z: (minZ + maxZ) / 2, w: t, d: maxZ - minZ + t * 2 }
  ];
  for (const w of walls) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.w, h, w.d), hedgeMat);
    mesh.position.set(w.x, h / 2 - 0.2, w.z);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    scene.add(mesh);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w.w + 0.08, 0.12, w.d + 0.08), capMat);
    cap.position.set(w.x, h - 0.16, w.z);
    scene.add(cap);
  }

  // A lightweight skyline gives the compact social city depth without loading
  // the old multi-megabyte neighborhood model.
  const towerPositions = [
    [-69, 66, 12], [-55, 69, 18], [-39, 70, 14], [39, 69, 17], [58, 68, 25], [77, 66, 20],
    [-70, -58, 16], [-50, -60, 22], [-28, -62, 13], [55, -60, 19], [78, -59, 26], [102, -56, 16]
  ];
  const towerGeo = new RoundedBoxGeometry(8, 1, 7, 2, 0.35);
  const towers = new THREE.InstancedMesh(
    towerGeo,
    makeCityMaterial(0x26384a, { roughness: 0.76, metalness: 0.08 }),
    towerPositions.length
  );
  const dummy = new THREE.Object3D();
  towerPositions.forEach(([x, z, height], index) => {
    dummy.position.set(x, height / 2 - 0.2, z);
    dummy.scale.set(1 + (index % 3) * 0.18, height, 1 + ((index + 1) % 3) * 0.12);
    dummy.rotation.y = (index % 2) * 0.18;
    dummy.updateMatrix();
    towers.setMatrixAt(index, dummy.matrix);
  });
  scene.add(towers);

  const voidMat = new THREE.MeshBasicMaterial({ color: 0x284437 });
  const voidPlane = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), voidMat);
  voidPlane.rotation.x = -Math.PI / 2;
  voidPlane.position.y = -0.2;
  scene.add(voidPlane);
}

function isOnRoad(x, z) {
  // Main street strip along X
  if (Math.abs(z) < ROAD_HALF_W) return true;
  // Sidewalk in front of clubs is OK for a little grass, keep road only
  return false;
}

function isInsideWorld(x, z, margin = 0) {
  return (
    x >= WORLD_BOUNDS.minX + margin &&
    x <= WORLD_BOUNDS.maxX - margin &&
    z >= WORLD_BOUNDS.minZ + margin &&
    z <= WORLD_BOUNDS.maxZ - margin
  );
}

function clampToWorld(x, z, margin = 0.6) {
  return {
    x: THREE.MathUtils.clamp(x, WORLD_BOUNDS.minX + margin, WORLD_BOUNDS.maxX - margin),
    z: THREE.MathUtils.clamp(z, WORLD_BOUNDS.minZ + margin, WORLD_BOUNDS.maxZ - margin)
  };
}

function scatterGrassOnMap() {
  return; // disabled
  const loader = new GLTFLoader();
  loader.load(
    'models/city/grass.glb',
    (gltf) => {
      try {
        const src = gltf.scene;
        src.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(src);
        const size = new THREE.Vector3();
        box.getSize(size);
        // Normalize height ~0.45m
        const targetH = 0.45;
        const s0 = size.y > 0.01 ? targetH / size.y : 1;
        src.scale.setScalar(s0);
        src.traverse((c) => {
          if (c.isMesh) {
            c.castShadow = false;
            c.receiveShadow = true;
            if (c.material) {
              c.material = c.material.clone();
              c.material.roughness = 0.95;
            }
          }
        });

        const positions = [];
        const step = 3.2;
        for (let x = WORLD_BOUNDS.minX + 2; x <= WORLD_BOUNDS.maxX - 2; x += step) {
          for (let z = WORLD_BOUNDS.minZ + 2; z <= WORLD_BOUNDS.maxZ - 2; z += step) {
            if (isOnRoad(x, z)) continue;
            // jitter
            const jx = x + (Math.random() - 0.5) * 1.6;
            const jz = z + (Math.random() - 0.5) * 1.6;
            if (isOnRoad(jx, jz)) continue;
            if (!isInsideWorld(jx, jz, 1.5)) continue;
            positions.push([jx, jz, Math.random() * Math.PI * 2, 0.85 + Math.random() * 0.45]);
          }
        }
        // denser near club row (z ~ -12)
        for (let x = WORLD_BOUNDS.minX + 2; x <= WORLD_BOUNDS.maxX - 2; x += 2.2) {
          for (let z = -18; z <= -7; z += 2.2) {
            if (isOnRoad(x, z)) continue;
            const jx = x + (Math.random() - 0.5) * 1.1;
            const jz = z + (Math.random() - 0.5) * 1.1;
            if (isOnRoad(jx, jz)) continue;
            positions.push([jx, jz, Math.random() * Math.PI * 2, 0.9 + Math.random() * 0.5]);
          }
        }

        const maxN = Math.min(positions.length, 420);
        for (let i = 0; i < maxN; i++) {
          const [gx, gz, rot, sc] = positions[i];
          const g = src.clone(true);
          g.position.set(gx, 0, gz);
          g.rotation.y = rot;
          g.scale.multiplyScalar(sc);
          scene.add(g);
        }
        console.log('[grass] placed', maxN, 'patches');
      } catch (e) {
        console.warn('grass place', e);
      }
    },
    undefined,
    (err) => console.warn('grass load failed', err)
  );
}


const CITY_COLORS = Object.freeze({
  stone: 0xd8d0c0,
  paleStone: 0xeee8dc,
  midnight: 0x0b1729,
  glass: 0x75cdec,
  entertainment: 0x8b5cf6,
  restaurant: 0xf59e0b,
  government: 0x38bdf8,
  park: 0x34d399,
  education: 0x60a5fa,
  shopping: 0xec4899
});

function addWorldAnimator(callback) {
  if (typeof callback === 'function') worldAnimators.push(callback);
}

function makeCityMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.72,
    metalness: options.metalness ?? 0.05,
    transparent: Boolean(options.transparent),
    opacity: options.opacity ?? 1,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0
  });
}

function addPromenade(start, end, color, width = 7.4) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  const angle = Math.atan2(-dz, dx);
  const group = new THREE.Group();
  const paving = new THREE.Mesh(
    new RoundedBoxGeometry(length, 0.12, width, 3, 0.36),
    makeCityMaterial(0xbcb7ad, { roughness: 0.92 })
  );
  paving.position.y = 0.04;
  paving.receiveShadow = true;
  group.add(paving);

  for (const offset of [-width * 0.43, width * 0.43]) {
    const guide = new THREE.Mesh(
      new RoundedBoxGeometry(length - 0.8, 0.045, 0.17, 2, 0.06),
      makeCityMaterial(color, { emissive: color, emissiveIntensity: 0.42, roughness: 0.42 })
    );
    guide.position.set(0, 0.12, offset);
    group.add(guide);
  }

  group.position.set((start.x + end.x) / 2, 0, (start.z + end.z) / 2);
  group.rotation.y = angle;
  scene.add(group);
  walkMeshes.push(paving);
  return group;
}

function addDistrictGateway(label, x, z, color, subtitle = 'городской маршрут') {
  const group = new THREE.Group();
  const frame = makeCityMaterial(CITY_COLORS.midnight, { metalness: 0.42, roughness: 0.35 });
  const glow = makeCityMaterial(color, { emissive: color, emissiveIntensity: 0.7, roughness: 0.38 });
  for (const px of [-3.5, 3.5]) {
    const pillar = new THREE.Mesh(new RoundedBoxGeometry(0.45, 4.8, 0.58, 3, 0.15), frame);
    pillar.position.set(px, 2.4, 0);
    group.add(pillar);
    const foot = new THREE.Mesh(new CylinderGeometrySafe(0.58, 0.72, 0.28, 12), glow);
    foot.position.set(px, 0.14, 0);
    group.add(foot);
  }
  const arch = new THREE.Mesh(new RoundedBoxGeometry(7.5, 0.52, 0.58, 3, 0.16), frame);
  arch.position.y = 4.65;
  group.add(arch);
  const line = new THREE.Mesh(new RoundedBoxGeometry(6.7, 0.1, 0.64, 2, 0.04), glow);
  line.position.y = 4.43;
  group.add(line);

  const texture = makeSignTexture(label, subtitle, '#0b1729', '#ffffff');
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(5.8, 1.35),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true })
  );
  sign.position.set(0, 3.55, 0.32);
  group.add(sign);

  const nx = -x;
  const nz = -z;
  group.rotation.y = Math.atan2(nx, nz);
  group.position.set(x, 0, z);
  scene.add(group);
  return group;
}

function CylinderGeometrySafe(top, bottom, height, segments) {
  return new THREE.CylinderGeometry(top, bottom, height, segments);
}

function createSpawnPlaza() {
  const plaza = new THREE.Group();
  plaza.name = 'LifeInGameCentralPlaza';
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(15, 15.5, 0.24, 64),
    makeCityMaterial(CITY_COLORS.paleStone, { roughness: 0.84 })
  );
  base.position.y = 0.08;
  base.receiveShadow = true;
  plaza.add(base);
  walkMeshes.push(base);

  const inlay = new THREE.Mesh(
    new THREE.RingGeometry(8.2, 13.4, 64),
    makeCityMaterial(0xb8b2a8, { roughness: 0.9 })
  );
  inlay.rotation.x = -Math.PI / 2;
  inlay.position.y = 0.215;
  plaza.add(inlay);

  const pool = new THREE.Mesh(
    new THREE.CylinderGeometry(4.55, 4.8, 0.48, 48),
    makeCityMaterial(0x17283d, { metalness: 0.18, roughness: 0.35 })
  );
  pool.position.y = 0.28;
  plaza.add(pool);
  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(4.18, 4.18, 0.09, 48),
    makeCityMaterial(0x53c7e8, {
      transparent: true,
      opacity: 0.7,
      roughness: 0.16,
      metalness: 0.12,
      emissive: 0x1c8fb5,
      emissiveIntensity: 0.18
    })
  );
  water.position.y = 0.56;
  plaza.add(water);

  const landmark = new THREE.Group();
  landmark.position.y = 3.1;
  const crystalMat = makeCityMaterial(0x7dd3fc, {
    transparent: true,
    opacity: 0.86,
    roughness: 0.12,
    metalness: 0.26,
    emissive: 0x38bdf8,
    emissiveIntensity: 0.9
  });
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.82, 1), crystalMat);
  landmark.add(core);
  const orbitA = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.09, 8, 48), crystalMat);
  orbitA.rotation.x = Math.PI / 2;
  landmark.add(orbitA);
  const orbitB = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.07, 8, 40), crystalMat);
  orbitB.rotation.set(Math.PI / 2.8, 0, Math.PI / 3);
  landmark.add(orbitB);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.38, 1.55, 4.8, 20, 1, true),
    makeCityMaterial(0x38bdf8, {
      transparent: true,
      opacity: 0.11,
      emissive: 0x38bdf8,
      emissiveIntensity: 1,
      roughness: 0.2
    })
  );
  beam.position.y = -0.85;
  landmark.add(beam);
  plaza.add(landmark);

  const wordmark = new THREE.Mesh(
    new THREE.PlaneGeometry(6.8, 1.5),
    new THREE.MeshBasicMaterial({
      map: makeSignTexture('LIFE IN GAME', 'главная площадь', '#0b1729', '#ffffff'),
      transparent: true
    })
  );
  wordmark.position.set(0, 2.3, -4.82);
  wordmark.rotation.y = Math.PI;
  plaza.add(wordmark);

  scene.add(plaza);
  addWorldAnimator((time) => {
    landmark.rotation.y = time * 0.22;
    orbitB.rotation.z = Math.PI / 3 + time * 0.16;
    core.position.y = Math.sin(time * 1.25) * 0.18;
    water.material.opacity = 0.66 + Math.sin(time * 0.7) * 0.05;
  });
}

function createLandscape() {
  const treePositions = [
    [-13, -9], [-13, 9], [13, -9], [13, 9], [-8, 15], [8, 15], [-8, -15], [8, -15],
    [-7, 25], [7, 25], [-7, 34], [7, 34], [-31, 7], [-38, 9], [-45, 8], [-51, 4],
    [-31, -7], [-38, -9], [-45, -8], [-51, -4], [20, 19], [36, 20], [42, 26],
    [18, -22], [30, -30], [-18, -22], [-30, -30]
  ];
  const trunkGeo = new THREE.CylinderGeometry(0.2, 0.28, 2.2, 7);
  const crownGeo = new THREE.DodecahedronGeometry(1.35, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, makeCityMaterial(0x76513a, { roughness: 0.95 }), treePositions.length);
  const crowns = new THREE.InstancedMesh(crownGeo, makeCityMaterial(0x3c8b63, { roughness: 0.9 }), treePositions.length);
  const dummy = new THREE.Object3D();
  treePositions.forEach(([x, z], index) => {
    const scale = 0.88 + ((index * 17) % 11) / 36;
    dummy.position.set(x, 1.1, z);
    dummy.scale.set(scale, scale, scale);
    dummy.rotation.y = index * 0.73;
    dummy.updateMatrix();
    trunks.setMatrixAt(index, dummy.matrix);
    dummy.position.y = 3.15 * scale;
    dummy.scale.set(scale, scale * 1.12, scale);
    dummy.updateMatrix();
    crowns.setMatrixAt(index, dummy.matrix);
  });
  trunks.receiveShadow = true;
  trunks.castShadow = true;
  crowns.receiveShadow = true;
  crowns.castShadow = true;
  scene.add(trunks, crowns);

  const benchMat = makeCityMaterial(0x8b6346, { roughness: 0.72 });
  const benchFrame = makeCityMaterial(0x152033, { metalness: 0.52, roughness: 0.35 });
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const group = new THREE.Group();
    const seat = new THREE.Mesh(new RoundedBoxGeometry(2.25, 0.18, 0.62, 2, 0.07), benchMat);
    seat.position.y = 0.58;
    group.add(seat);
    for (const x of [-0.86, 0.86]) {
      const leg = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.58, 0.48, 2, 0.03), benchFrame);
      leg.position.set(x, 0.29, 0);
      group.add(leg);
    }
    group.position.set(Math.sin(angle) * 12, 0, Math.cos(angle) * 12);
    group.rotation.y = angle;
    scene.add(group);
  }
}

function createCityLights() {
  const positions = [
    [-10, 18], [10, 18], [-7, 28], [7, 28], [-29, 3], [-29, -3],
    [22, 10], [27, 15], [20, -18], [28, -27], [-20, -18], [-28, -27]
  ];
  const poleMat = makeCityMaterial(0x152033, { metalness: 0.58, roughness: 0.35 });
  const glowMat = makeCityMaterial(0xffe4ad, { emissive: 0xffc45c, emissiveIntensity: 1.8, roughness: 0.25 });
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.1, 3.5, 7);
  const headGeo = new THREE.SphereGeometry(0.18, 10, 7);
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, positions.length);
  const heads = new THREE.InstancedMesh(headGeo, glowMat, positions.length);
  const dummy = new THREE.Object3D();
  positions.forEach(([x, z], index) => {
    dummy.position.set(x, 1.75, z);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    poles.setMatrixAt(index, dummy.matrix);
    dummy.position.y = 3.5;
    dummy.updateMatrix();
    heads.setMatrixAt(index, dummy.matrix);
  });
  scene.add(poles, heads);
  [[-10, 18], [10, 18], [22, 10], [-29, 3]].forEach(([x, z]) => {
    const light = new THREE.PointLight(0xffd8a0, 0.45, 11, 2);
    light.position.set(x, 3.4, z);
    scene.add(light);
  });
}

function createFutureDistrict(x, z, label, subtitle, color) {
  const group = new THREE.Group();
  const terrace = new THREE.Mesh(
    new THREE.CylinderGeometry(8.7, 9.1, 0.28, 40),
    makeCityMaterial(0xcac5bb, { roughness: 0.9 })
  );
  terrace.position.y = 0.1;
  group.add(terrace);
  const pavilion = new THREE.Mesh(
    new THREE.TorusGeometry(4.1, 0.24, 10, 48, Math.PI),
    makeCityMaterial(color, { emissive: color, emissiveIntensity: 0.2, metalness: 0.25, roughness: 0.38 })
  );
  pavilion.rotation.set(Math.PI / 2, 0, 0);
  pavilion.position.y = 3.2;
  group.add(pavilion);
  for (const px of [-4.05, 4.05]) {
    const column = new THREE.Mesh(new RoundedBoxGeometry(0.32, 3.25, 0.32, 2, 0.1), makeCityMaterial(0x152033, { metalness: 0.5 }));
    column.position.set(px, 1.62, 0);
    group.add(column);
  }
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(5.3, 1.55),
    new THREE.MeshBasicMaterial({ map: makeSignTexture(label, subtitle, '#0b1729', '#ffffff'), transparent: true })
  );
  sign.position.set(0, 2.05, 0.35);
  group.add(sign);
  group.position.set(x, 0, z);
  const nx = -x;
  const nz = -z;
  group.rotation.y = Math.atan2(nx, nz);
  scene.add(group);
}

function createCity() {
  return new Promise((resolve) => {
    worldAnimators = [];
    const gw = WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX + 28;
    const gd = WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ + 28;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(gw, gd),
      makeCityMaterial(0x46624f, { roughness: 0.97 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(
      (WORLD_BOUNDS.minX + WORLD_BOUNDS.maxX) / 2,
      -0.08,
      (WORLD_BOUNDS.minZ + WORLD_BOUNDS.maxZ) / 2
    );
    ground.receiveShadow = true;
    scene.add(ground);
    walkMeshes = [ground];

    scene.fog = new THREE.Fog(0xa9c8d8, 82, 210);
    scene.background = new THREE.Color(0x8fc7e5);
    loadSkybox();
    placeBoundaryWalls();

    addPromenade({ x: 0, z: 15 }, { x: 0, z: 41 }, CITY_COLORS.entertainment, 8.2);
    addPromenade({ x: 10.7, z: 10.7 }, { x: 27, z: 27 }, CITY_COLORS.restaurant, 7.4);
    addPromenade({ x: 15, z: 0 }, { x: 34, z: 0 }, CITY_COLORS.government, 8);
    addPromenade({ x: -15, z: 0 }, { x: -35, z: 0 }, CITY_COLORS.park, 7.4);
    addPromenade({ x: 10.5, z: -10.5 }, { x: 25, z: -31 }, CITY_COLORS.education, 7.1);
    addPromenade({ x: -10.5, z: -10.5 }, { x: -25, z: -31 }, CITY_COLORS.shopping, 7.1);

    createSpawnPlaza();
    addDistrictGateway('РАЗВЛЕЧЕНИЯ', 0, 23, CITY_COLORS.entertainment, 'клубы и игры');
    addDistrictGateway('РЕСТОРАНЫ', 18, 18, CITY_COLORS.restaurant, 'встречи и кухня');
    addDistrictGateway('ГОСУДАРСТВО', 25, 0, CITY_COLORS.government, 'цифровые сервисы');
    addDistrictGateway('ПАРК', -25, 0, CITY_COLORS.park, 'спорт и отдых');
    addDistrictGateway('ОБУЧЕНИЕ', 17, -20, CITY_COLORS.education, 'новый квартал');
    addDistrictGateway('ШОПИНГ', -17, -20, CITY_COLORS.shopping, 'новый квартал');
    createLandscape();
    createCityLights();

    try { placeMafiaClubBuilding(); } catch (error) { console.warn('[city] mafia', error); }
    try { placeCinemaBuilding(); } catch (error) { console.warn('[city] cinema', error); }
    const clubConfigs = [
      {
        kind: 'speaking', w: 8.7, h: 6.6, d: 7.2,
        wall: 0xe6dfd2, accent: 0x2563eb, neon: 0x60a5fa,
        title: 'SPEAKING', subtitle: 'Language Club'
      },
      {
        kind: 'chess', w: 8.7, h: 6.3, d: 7.2,
        wall: 0xebe6dc, accent: 0x111827, neon: 0xf8fafc,
        title: 'ШАХМАТЫ', subtitle: 'Chess Club'
      },
      {
        kind: 'monopoly', w: 8.7, h: 6.6, d: 7.2,
        wall: 0xe5dfd1, accent: 0x059669, neon: 0x34d399,
        title: 'МОНОПОЛИЯ', subtitle: 'Board Game'
      }
    ];
    clubConfigs.forEach((config) => {
      const layout = CITY_LAYOUT.venues[config.kind];
      try { placeStreetClub({ ...config, x: layout.x, z: layout.z, rot: Math.PI }); }
      catch (error) { console.warn(`[city] ${config.kind}`, error); }
    });

    try { placeRestaurantBuilding(); } catch (error) { console.warn('[city] restaurant', error); }
    try {
      const governmentStreet = createGovernmentStreet(scene, buildings);
      if (Array.isArray(governmentStreet?.userData?.walkMeshes)) {
        walkMeshes.push(...governmentStreet.userData.walkMeshes);
      }
    } catch (error) { console.warn('[city] government', error); }

    createFutureDistrict(-42, 0, 'ПАРК И СПОРТ', 'открытое пространство', CITY_COLORS.park);
    createFutureDistrict(-29, -37, 'ШОПИНГ', 'следующий релиз', CITY_COLORS.shopping);
    createFutureDistrict(29, -37, 'ОБУЧЕНИЕ', 'следующий релиз', CITY_COLORS.education);

    console.log('[city] Life in Game radial city ready');
    resolve();
  });
}


function makeSignTexture(title, subtitle, bg = '#111', fg = '#fff') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 8;
  ctx.strokeRect(12, 12, 488, 232);
  ctx.fillStyle = fg;
  ctx.font = 'bold 64px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 256, 110, 460);
  ctx.font = '32px Arial, sans-serif';
  ctx.fillText(subtitle || '', 256, 180, 460);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function placeStreetClub(cfg) {
  const group = new THREE.Group();
  group.name = `Venue_${cfg.kind || cfg.title}`;
  const matWall = makeCityMaterial(cfg.wall, { roughness: 0.76 });
  const matAccent = makeCityMaterial(cfg.accent, { roughness: 0.42, metalness: 0.12 });
  const frameMat = makeCityMaterial(0x101b2d, { metalness: 0.48, roughness: 0.3 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(cfg.w, cfg.h, cfg.d, 4, 0.42), matWall);
  body.position.y = cfg.h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Deep glass facade, vertical fins and an oversized entrance make each venue
  // readable from the main promenade even on a small phone screen.
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x8bdcff,
    emissive: cfg.neon,
    emissiveIntensity: 0.09,
    metalness: 0.18,
    roughness: 0.14,
    transparent: true,
    opacity: 0.72,
    transmission: 0.08,
    clearcoat: 0.5
  });
  const glass = new THREE.Mesh(
    new RoundedBoxGeometry(cfg.w * 0.78, cfg.h * 0.56, 0.16, 3, 0.08),
    glassMat
  );
  glass.position.set(0, cfg.h * 0.47, cfg.d / 2 + 0.08);
  group.add(glass);
  for (const x of [-cfg.w * 0.28, 0, cfg.w * 0.28]) {
    const fin = new THREE.Mesh(new RoundedBoxGeometry(0.1, cfg.h * 0.54, 0.42, 2, 0.03), frameMat);
    fin.position.set(x, cfg.h * 0.47, cfg.d / 2 + 0.22);
    group.add(fin);
  }
  for (const y of [cfg.h * 0.29, cfg.h * 0.54]) {
    const rail = new THREE.Mesh(new RoundedBoxGeometry(cfg.w * 0.78, 0.08, 0.35, 2, 0.03), frameMat);
    rail.position.set(0, y, cfg.d / 2 + 0.2);
    group.add(rail);
  }

  const entrance = new THREE.Mesh(
    new RoundedBoxGeometry(2.35, 3.25, 0.22, 3, 0.1),
    makeCityMaterial(0x07111f, { roughness: 0.26, metalness: 0.32 })
  );
  entrance.position.set(0, 1.63, cfg.d / 2 + 0.24);
  group.add(entrance);
  for (const x of [-1.45, 1.45]) {
    const sideLight = new THREE.Mesh(new RoundedBoxGeometry(0.12, 2.7, 0.12, 2, 0.04), makeCityMaterial(cfg.neon, {
      emissive: cfg.neon,
      emissiveIntensity: 1.15,
      roughness: 0.3
    }));
    sideLight.position.set(x, 1.7, cfg.d / 2 + 0.38);
    group.add(sideLight);
  }

  const sideWing = new THREE.Mesh(
    new RoundedBoxGeometry(cfg.w * 0.34, cfg.h * 0.65, cfg.d * 0.9, 3, 0.28),
    matAccent
  );
  sideWing.position.set(-cfg.w * 0.39, cfg.h * 0.325, -cfg.d * 0.02);
  group.add(sideWing);

  const crown = new THREE.Mesh(new RoundedBoxGeometry(cfg.w + 0.35, 0.34, cfg.d + 0.35, 3, 0.12), frameMat);
  crown.position.y = cfg.h + 0.05;
  group.add(crown);
  const roofGarden = new THREE.Mesh(
    new RoundedBoxGeometry(cfg.w * 0.5, 0.42, cfg.d * 0.34, 3, 0.16),
    makeCityMaterial(0x2f7554, { roughness: 0.92 })
  );
  roofGarden.position.set(cfg.w * 0.16, cfg.h + 0.36, -cfg.d * 0.08);
  group.add(roofGarden);

  const canopy = new THREE.Mesh(new RoundedBoxGeometry(4.1, 0.24, 1.8, 3, 0.09), frameMat);
  canopy.position.set(0, 3.35, cfg.d / 2 + 0.88);
  group.add(canopy);
  for (const x of [-1.7, 1.7]) {
    const light = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 10, 8),
      makeCityMaterial(cfg.neon, { emissive: cfg.neon, emissiveIntensity: 2.2, roughness: 0.2 })
    );
    light.position.set(x, 3.17, cfg.d / 2 + 1.0);
    group.add(light);
  }

  const signTex = makeSignTexture(cfg.title, cfg.subtitle, '#0a0a0a', '#ffffff');
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(cfg.w * 0.7, 1.68),
    new THREE.MeshBasicMaterial({ map: signTex, transparent: true })
  );
  sign.position.set(0, cfg.h - 0.9, cfg.d / 2 + 0.38);
  group.add(sign);

  const neon = new THREE.Mesh(
    new RoundedBoxGeometry(cfg.w * 0.76, 0.13, 0.16, 2, 0.04),
    makeCityMaterial(cfg.neon, { emissive: cfg.neon, emissiveIntensity: 1.05, roughness: 0.3 })
  );
  neon.position.set(0, cfg.h - 0.03, cfg.d / 2 + 0.32);
  group.add(neon);

  const apron = new THREE.Mesh(
    new RoundedBoxGeometry(cfg.w * 0.72, 0.1, 3.2, 3, 0.28),
    makeCityMaterial(0xc9c3b8, { roughness: 0.9 })
  );
  apron.position.set(0, 0.03, cfg.d / 2 + 1.35);
  group.add(apron);

  group.position.set(cfg.x, 0, cfg.z);
  group.rotation.y = cfg.rot || 0;
  scene.add(group);

  const box = new THREE.Box3().setFromObject(body);
  box.min.y = 0;
  buildings.push({ box });

  const entranceLayout = CITY_LAYOUT.venues[cfg.kind];
  const interactionPosition = new THREE.Vector3(
    entranceLayout?.entranceX ?? cfg.x,
    0,
    entranceLayout?.entranceZ ?? cfg.z
  );
  if (cfg.kind === 'speaking') {
    window.__speakingZone = { position: interactionPosition, radius: 5.6, name: 'speaking' };
    console.log('[zone] speaking', cfg.x, cfg.z);
  } else if (cfg.kind === 'chess') {
    window.__chessZone = { position: interactionPosition, radius: 5.6, name: 'chess' };
    console.log('[zone] chess', cfg.x, cfg.z);
  } else if (cfg.kind === 'monopoly') {
    window.__monopolyZone = { position: interactionPosition, radius: 5.6, name: 'monopoly' };
    console.log('[zone] monopoly', cfg.x, cfg.z);
  } else if (cfg.kind === 'restaurant') {
    // restaurantZone set by loadRestaurantBuilding or here as fallback
    if (!restaurantZone) {
      restaurantZone = { position: new THREE.Vector3(cfg.x, 0, cfg.z), radius: 12, name: 'restaurant' };
    }
  }
  return group;
}


function addMesh(x, y, z, w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

function createTree(x, z) {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.2, 1.4, 6),
    new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.9 })
  );
  trunk.position.set(x, 0.7, z);
  trunk.castShadow = true;
  scene.add(trunk);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2d8a2a, roughness: 0.85 });
  for (const [oy, r] of [[1.9, 1.1], [2.6, 0.85], [3.1, 0.55]]) {
    const f = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), leafMat);
    f.position.set(x, oy, z);
    f.castShadow = true;
    scene.add(f);
  }
}

function placeCinemaBuilding() {
  const group = new THREE.Group();
  group.name = 'Cinema';
  const wall = makeCityMaterial(0xe8e1d5, { roughness: 0.72 });
  const frame = makeCityMaterial(0x111827, { metalness: 0.5, roughness: 0.28 });
  const cyan = makeCityMaterial(0x06b6d4, { emissive: 0x0891b2, emissiveIntensity: 0.85, roughness: 0.24 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(11.2, 7.4, 8.7, 5, 0.72), wall);
  body.position.y = 3.7;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const darkPortal = new THREE.Mesh(new RoundedBoxGeometry(7.7, 5.6, 0.35, 4, 0.3), frame);
  darkPortal.position.set(0, 3.1, 4.46);
  group.add(darkPortal);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(6.6, 2.6),
    new THREE.MeshBasicMaterial({
      map: makeSignTexture('КИНОТЕАТР', 'WATCH TOGETHER', '#06263a', '#dff8ff')
    })
  );
  screen.position.set(0, 4.35, 4.66);
  group.add(screen);

  const door = new THREE.Mesh(new RoundedBoxGeometry(2.5, 2.8, 0.2, 3, 0.1), makeCityMaterial(0x06111f, { metalness: 0.35, roughness: 0.25 }));
  door.position.set(0, 1.4, 4.66);
  group.add(door);
  const marquee = new THREE.Mesh(new RoundedBoxGeometry(8.5, 0.32, 2.3, 3, 0.12), cyan);
  marquee.position.set(0, 3.18, 5.42);
  group.add(marquee);

  for (const x of [-4.35, 4.35]) {
    const fin = new THREE.Mesh(new RoundedBoxGeometry(0.42, 5.8, 0.8, 3, 0.15), frame);
    fin.position.set(x, 3.0, 4.25);
    group.add(fin);
  }
  const roofRing = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.18, 10, 48), cyan);
  roofRing.position.y = 8.05;
  roofRing.rotation.x = Math.PI / 2;
  group.add(roofRing);
  const roofCore = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 10), cyan);
  roofCore.position.y = 8.05;
  group.add(roofCore);

  const layout = CITY_LAYOUT.venues.cinema;
  group.position.set(layout.x, 0, layout.z);
  group.rotation.y = Math.PI;
  scene.add(group);

  const box = new THREE.Box3().setFromObject(body);
  box.min.y = 0;
  buildings.push({ box });
  cinemaZone = {
    position: new THREE.Vector3(layout.entranceX, 0, layout.entranceZ),
    radius: 6,
    name: 'cinema'
  };
  addWorldAnimator((time) => {
    roofRing.rotation.z = time * 0.35;
    roofCore.position.y = 8.05 + Math.sin(time * 1.4) * 0.12;
  });
  console.log('Cinema placed at', layout.x, layout.z);
}

function placeMafiaClubBuilding() {
  const group = new THREE.Group();
  group.name = 'MafiaClub';
  const wall = makeCityMaterial(0x161225, { roughness: 0.68, metalness: 0.08 });
  const frame = makeCityMaterial(0x070a12, { metalness: 0.58, roughness: 0.28 });
  const violet = makeCityMaterial(0x7c3aed, { emissive: 0x6d28d9, emissiveIntensity: 0.8, roughness: 0.28 });
  const red = makeCityMaterial(0xef4444, { emissive: 0xdc2626, emissiveIntensity: 1.25, roughness: 0.25 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(11.4, 7.7, 9.1, 5, 0.58), wall);
  body.position.y = 3.85;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  for (const x of [-4.15, 4.15]) {
    const wing = new THREE.Mesh(new RoundedBoxGeometry(2.1, 6.2, 8.2, 4, 0.42), violet);
    wing.position.set(x, 3.1, 0.15);
    wing.rotation.z = x < 0 ? -0.055 : 0.055;
    group.add(wing);
  }
  const front = new THREE.Mesh(new RoundedBoxGeometry(7.6, 5.9, 0.38, 4, 0.22), frame);
  front.position.set(0, 3.05, 4.7);
  group.add(front);
  const door = new THREE.Mesh(new RoundedBoxGeometry(2.4, 3.2, 0.18, 3, 0.09), makeCityMaterial(0x03050a, { roughness: 0.26, metalness: 0.42 }));
  door.position.set(0, 1.6, 4.92);
  group.add(door);

  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(6.4, 1.65),
    new THREE.MeshBasicMaterial({ map: makeSignTexture('МАФИЯ', 'SOCIAL CLUB', '#160c24', '#f4e8ff') })
  );
  sign.position.set(0, 5.55, 4.93);
  group.add(sign);
  for (const x of [-3.0, 3.0]) {
    const slash = new THREE.Mesh(new RoundedBoxGeometry(0.16, 4.8, 0.2, 2, 0.04), red);
    slash.position.set(x, 3.0, 4.96);
    slash.rotation.z = x < 0 ? 0.22 : -0.22;
    group.add(slash);
  }
  const canopy = new THREE.Mesh(new RoundedBoxGeometry(5.2, 0.28, 2.0, 3, 0.1), frame);
  canopy.position.set(0, 3.45, 5.58);
  group.add(canopy);
  const roofBeacon = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.1, 8, 32), red);
  roofBeacon.position.y = 8.35;
  roofBeacon.rotation.x = Math.PI / 2;
  group.add(roofBeacon);

  const layout = CITY_LAYOUT.venues.mafia;
  group.position.set(layout.x, 0, layout.z);
  group.rotation.y = Math.PI;
  scene.add(group);

  const box = new THREE.Box3().setFromObject(body);
  box.min.y = 0;
  buildings.push({ box });
  mafiaZone = {
    position: new THREE.Vector3(layout.entranceX, 0, layout.entranceZ),
    radius: 6,
    name: 'mafia'
  };
  addWorldAnimator((time) => {
    roofBeacon.rotation.z = time * -0.42;
    roofBeacon.material.emissiveIntensity = 1.05 + Math.sin(time * 2.1) * 0.28;
  });
  console.log('Mafia club placed at', layout.x, layout.z);
}

function placeRestaurantBuilding() {
  const group = new THREE.Group();
  group.name = 'SkylineRestaurant';
  const stone = makeCityMaterial(0xeee4d3, { roughness: 0.7 });
  const terracotta = makeCityMaterial(0xc95f34, { roughness: 0.56, metalness: 0.04 });
  const frame = makeCityMaterial(0x172334, { roughness: 0.28, metalness: 0.46 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x8ed8ed,
    roughness: 0.1,
    metalness: 0.12,
    transparent: true,
    opacity: 0.7,
    transmission: 0.12,
    clearcoat: 0.5
  });

  const base = new THREE.Mesh(new RoundedBoxGeometry(12.6, 6.3, 9.8, 5, 0.72), stone);
  base.position.y = 3.15;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);
  const terrace = new THREE.Mesh(new RoundedBoxGeometry(8.4, 2.6, 8.0, 4, 0.55), terracotta);
  terrace.position.set(1.65, 6.05, -0.25);
  group.add(terrace);

  const facade = new THREE.Mesh(new RoundedBoxGeometry(9.8, 4.3, 0.22, 4, 0.12), glass);
  facade.position.set(0, 3.0, 5.02);
  group.add(facade);
  for (const x of [-3.6, -1.2, 1.2, 3.6]) {
    const fin = new THREE.Mesh(new RoundedBoxGeometry(0.09, 4.2, 0.38, 2, 0.03), frame);
    fin.position.set(x, 3.0, 5.2);
    group.add(fin);
  }
  const door = new THREE.Mesh(new RoundedBoxGeometry(2.5, 3.15, 0.2, 3, 0.1), frame);
  door.position.set(0, 1.58, 5.26);
  group.add(door);
  const canopy = new THREE.Mesh(new RoundedBoxGeometry(5.6, 0.25, 2.2, 3, 0.1), terracotta);
  canopy.position.set(0, 3.42, 6.0);
  group.add(canopy);

  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(7.2, 1.8),
    new THREE.MeshBasicMaterial({ map: makeSignTexture('SKYLINE', 'RESTAURANT & LOUNGE', '#3a160d', '#fff4e8') })
  );
  sign.position.set(0, 5.3, 5.25);
  group.add(sign);

  const pergolaTop = new THREE.Mesh(new RoundedBoxGeometry(7.2, 0.22, 5.6, 3, 0.08), frame);
  pergolaTop.position.set(1.65, 8.05, -0.2);
  group.add(pergolaTop);
  for (const [x, z] of [[-1.65, -2.4], [4.95, -2.4], [-1.65, 2.0], [4.95, 2.0]]) {
    const post = new THREE.Mesh(new RoundedBoxGeometry(0.16, 2.15, 0.16, 2, 0.04), frame);
    post.position.set(x, 7.0, z);
    group.add(post);
  }
  const garden = new THREE.Mesh(new RoundedBoxGeometry(5.4, 0.42, 1.0, 3, 0.16), makeCityMaterial(0x34845a, { roughness: 0.94 }));
  garden.position.set(1.65, 7.45, -3.6);
  group.add(garden);

  const layout = CITY_LAYOUT.venues.restaurant;
  group.position.set(layout.x, 0, layout.z);
  group.rotation.y = -Math.PI * 0.75;
  scene.add(group);
  const box = new THREE.Box3().setFromObject(base);
  box.min.y = 0;
  buildings.push({ box });

  const diningMat = makeCityMaterial(0xa77750, { roughness: 0.68 });
  const baseMat = makeCityMaterial(0x152033, { metalness: 0.48, roughness: 0.36 });
  [[20.8, 29.8], [22.8, 32.2], [25.2, 34.0]].forEach(([x, z]) => {
    const table = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.12, 16), diningMat);
    table.position.set(x, 0.82, z);
    scene.add(table);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.13, 0.78, 8), baseMat);
    leg.position.set(x, 0.42, z);
    scene.add(leg);
  });

  restaurantZone = {
    position: new THREE.Vector3(layout.entranceX, 0, layout.entranceZ),
    radius: 6.2,
    name: 'restaurant'
  };
  console.log('Restaurant placed at', layout.x, layout.z);
}

function loadRestaurantBuilding(loader) {
  return new Promise((resolve) => {
    loader.load('models/city/restaurant.glb', (gltf) => {
      try {
        const model = gltf.scene;
        model.name = 'RestaurantBuilding';
        model.traverse((c) => {
          if (c.isMesh) {
            c.castShadow = true;
            c.receiveShadow = true;
          }
        });
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        // Target ~10m tall restaurant
        const targetH = 5.5;
        const s = size.y > 0.01 ? targetH / size.y : 4;
        model.scale.setScalar(s);
        box.setFromObject(model);
        // NE — restaurants street
        const x = 30, z = 30;
        model.position.set(x, -box.min.y, z);
        model.rotation.y = Math.PI * 0.75;
        scene.add(model);

        box.setFromObject(model);
        box.min.x += 0.3; box.max.x -= 0.3;
        box.min.z += 0.3; box.max.z -= 0.3;
        box.min.y = 0;
        buildings.push({ box });

        // Interaction zone center
        const center = new THREE.Vector3();
        box.getCenter(center);
        restaurantZone = {
          position: new THREE.Vector3(center.x, 0, center.z),
          radius: 8,
          name: 'restaurant'
        };

        // Small sign marker
        try {
          const signTex = makeSignTexture('РЕСТОРАН', 'Skyline', '#431407', '#ffedd5');
          const sign = new THREE.Mesh(
            new THREE.PlaneGeometry(8, 2),
            new THREE.MeshStandardMaterial({
              map: signTex, emissiveMap: signTex, emissive: 0xffffff, emissiveIntensity: 0.45
            })
          );
          sign.position.set(x, 6.2, z + Math.max(3, (box.max.z - box.min.z) * 0.5 + 0.3));
          scene.add(sign);
        } catch (e) {}

        console.log('Restaurant placed at', x, z);
      } catch (e) {
        console.warn('Restaurant place error', e);
      }
      resolve();
    }, undefined, (err) => {
      console.warn('Restaurant load failed', err);
      try {
        placeStreetClub({
          x: 30, z: 30, rot: Math.PI * 0.75,
          w: 7, h: 5.5, d: 6.5,
          wall: 0x3f2a1a, accent: 0xc2410c, neon: 0xfb923c,
          title: 'РЕСТОРАН', subtitle: 'Skyline',
          kind: 'restaurant'
        });
      } catch (e) {}
      resolve();
    });
  });
}


// ========== ANIMATION RETARGET (reference models → any avatar) ==========
function normalizeBoneName(name) {
  return String(name || '')
    .replace(/^mixamorig/i, '')
    .replace(/^Armature\|/i, '')
    .replace(/^armature\|/i, '')
    .replace(/^Bone_/i, '')
    .replace(/[:|.\s]/g, '')
    .toLowerCase();
}

function collectTargetBones(root) {
  const map = new Map(); // normalized -> real name
  root.traverse((o) => {
    if (o.isSkinnedMesh && o.skeleton && o.skeleton.bones) {
      o.skeleton.bones.forEach((b) => {
        const n = normalizeBoneName(b.name);
        if (n && !map.has(n)) map.set(n, b.name);
      });
    }
    if (o.isBone) {
      const n = normalizeBoneName(o.name);
      if (n && !map.has(n)) map.set(n, o.name);
    }
  });
  return map;
}

function retargetClip(sourceClip, targetRoot) {
  if (!sourceClip || !targetRoot) return null;
  try {
    const boneMap = collectTargetBones(targetRoot);
    if (!boneMap.size) return null;
    const tracks = [];
    for (const track of sourceClip.tracks) {
      const parts = track.name.split('.');
      if (parts.length < 2) continue;
      const prop = parts.pop();
      const nodeName = parts.join('.');
      const targetName = boneMap.get(normalizeBoneName(nodeName));
      if (!targetName) continue;
      const cloned = track.clone();
      cloned.name = targetName + '.' + prop;
      tracks.push(cloned);
    }
    if (!tracks.length) {
      console.warn('Retarget: no matching bones for', sourceClip.name, 'target bones', [...boneMap.keys()].slice(0, 12));
      return null;
    }
    const clip = new THREE.AnimationClip(
      (sourceClip.name || 'retarget') + '_rt',
      sourceClip.duration,
      tracks
    );
    return makeInPlaceClip(clip);
  } catch (e) {
    console.warn('retargetClip failed', e);
    return null;
  }
}

function loadReferenceClips() {
  if (refClipsReady) return refClipsReady;
  refClipsReady = new Promise((resolve) => {
    const loader = new GLTFLoader();
    const asset = (f) => {
      try { return new URL('models/' + f, window.location.href).href; }
      catch { return 'models/' + f; }
    };
    let left = 2;
    const done = () => { left--; if (left <= 0) resolve(); };
    loader.load(asset('model_idle.glb'), (g) => {
      refIdleClips = (g.animations || []).map((c) => makeInPlaceClip(c));
      console.log('Ref idle clips', refIdleClips.map((c) => c.name));
      done();
    }, undefined, done);
    loader.load(asset('model_walk.glb'), (g) => {
      refWalkClips = (g.animations || []).map((c) => makeInPlaceClip(c));
      console.log('Ref walk clips', refWalkClips.map((c) => c.name));
      done();
    }, undefined, done);
  });
  return refClipsReady;
}

function pickBestClip(clips, prefer) {
  if (!clips || !clips.length) return null;
  const lower = prefer.map((p) => p.toLowerCase());
  for (const p of lower) {
    const found = clips.find((c) => (c.name || '').toLowerCase().includes(p));
    if (found) return found;
  }
  return clips[0];
}

function makeInPlaceClip(sourceClip) {
  try {
    const clip = sourceClip.clone();
    for (const track of clip.tracks) {
      const n = track.name || '';
      if (n.indexOf('Hips') === -1 || n.indexOf('position') === -1) continue;
      if (track.getValueSize() !== 3) continue;
      const baseX = track.values[0];
      const baseZ = track.values[2];
      for (let i = 0; i < track.values.length; i += 3) {
        track.values[i] = baseX;
        track.values[i + 2] = baseZ;
      }
    }
    return clip;
  } catch (e) {
    console.warn('makeInPlaceClip failed', e);
    return sourceClip;
  }
}

function loadPlayer() {
  return new Promise((resolve) => {
    player = new THREE.Group();
    player.name = 'PlayerRoot';
    player.rotation.y = Math.PI;
    scene.add(player);

    let finished = false;
    const finish = () => {
      if (finished) return false;
      finished = true;
      previousPlanarPosition.copy(player.position);
      resolve();
      return true;
    };

    const loader = new GLTFLoader();
    let loaded = 0;
    const need = 2;
    const checkDone = () => {
      loaded++;
      if (loaded >= need) {
        // Start showing idle model
        if (idleSkin) idleSkin.visible = true;
        if (walkSkin) walkSkin.visible = false;
        skin = idleSkin;
        if (idleMixer && idleAction) {
          idleAction.setEffectiveWeight(1);
          idleAction.play();
          idleMixer.update(0);
        }
        finish();
      }
    };

    const timeout = setTimeout(() => {
      if (!finish()) return;
      console.warn('Model loading timed out');
      if (!idleSkin && !walkSkin) createFallbackPlayer();
    }, 45000);

    function setupSkin(gltf, kind, opts = {}) {
      const model = gltf.scene;
      model.name = kind === 'idle' ? 'IdleSkin' : 'WalkSkin';
      model.scale.setScalar(1);
      model.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      const bounds = new THREE.Box3().setFromObject(model);
      const groundY = Number.isFinite(bounds.min.y) ? -bounds.min.y : 0;
      model.position.y = groundY;
      player.add(model);

      const ownClips = (gltf.animations || []).map((c) => makeInPlaceClip(c));
      const isCustom = !!opts.custom;

      if (kind === 'idle') {
        idleSkin = model;
        skinGroundOffset = groundY;
        idleMixer = new THREE.AnimationMixer(model);
        // Custom: prefer own idle, else retarget from reference
        let clip = pickBestClip(ownClips, ['idle', 'wait', 'stand', 'breath']);
        if (!clip && isCustom && refIdleClips.length) {
          clip = retargetClip(refIdleClips[0], model);
        }
        if (!clip && ownClips.length) clip = ownClips[0];
        if (clip) {
          idleAction = idleMixer.clipAction(clip);
          idleAction.setLoop(THREE.LoopRepeat, Infinity);
          idleAction.setEffectiveWeight(1);
          idleAction.play();
          idleMixer.update(0.05);
        } else {
          console.warn('No idle clip for player');
        }
        console.log('Idle skin ready custom=', isCustom, 'clip=', clip?.name);
      } else {
        walkSkin = model;
        model.visible = false;
        walkMixer = new THREE.AnimationMixer(model);
        // Custom: ALWAYS prefer retargeted walk from our model_walk.glb
        let clip = null;
        if (isCustom && refWalkClips.length) {
          clip = retargetClip(pickBestClip(refWalkClips, ['walk', 'run', 'locomotion']) || refWalkClips[0], model);
        }
        if (!clip) {
          clip = pickBestClip(ownClips, ['walk', 'run', 'locomotion']);
        }
        if (!clip && ownClips.length) clip = ownClips[0];
        if (!clip && refWalkClips.length) {
          clip = retargetClip(refWalkClips[0], model);
        }
        if (clip) {
          walkAction = walkMixer.clipAction(clip);
          walkAction.setLoop(THREE.LoopRepeat, Infinity);
          walkAction.setEffectiveWeight(1);
          walkAction.play();
        } else {
          console.warn('No walk clip for player');
        }
        console.log('Walk skin ready custom=', isCustom, 'clip=', clip?.name);
      }
      checkDone();
    }

    const asset = (file) => {
      try { return new URL('models/' + file, window.location.href).href; }
      catch { return 'models/' + file; }
    };

    // On weak mobile load walk first (has anim); idle second
    // Custom Avaturn avatar overrides default models
    const useCustom = customAvatarUrl || currentUser?.avatarUrl || null;
    if (useCustom) {
      console.log('Loading custom avatar', useCustom);
      // Ensure reference walk/idle clips are ready before binding
      loadReferenceClips().then(() => {
        loader.load(useCustom, (g) => {
          setupSkin(g, 'idle', { custom: true });
          try {
            const walkGltf = {
              scene: SkeletonUtils.clone(g.scene),
              animations: g.animations || []
            };
            setupSkin(walkGltf, 'walk', { custom: true });
          } catch (err) {
            console.warn('Walk clone failed', err);
            checkDone();
          }
        }, undefined, (e) => {
          console.error('Custom avatar failed', e);
          showToast('Свой аватар не загрузился — стандартный');
          loader.load(asset('model_idle.glb'), (g) => setupSkin(g, 'idle'), undefined, () => checkDone());
          loader.load(asset('model_walk.glb'), (g) => setupSkin(g, 'walk'), undefined, () => checkDone());
        });
      });
    } else {
      const idleUrl = asset('model_idle.glb');
      const walkUrl = asset('model_walk.glb');
      const plainUrl = asset('model.glb');

      loader.load(idleUrl, (g) => setupSkin(g, 'idle'), undefined, (e) => {
        console.error('Idle model failed', e);
        loader.load(plainUrl, (g2) => setupSkin(g2, 'idle'), undefined, () => checkDone());
      });
      loader.load(walkUrl, (g) => setupSkin(g, 'walk'), undefined, (e) => {
        console.error('Walk model failed', e);
        checkDone();
      });
    }
  });
}

function createFallbackPlayer() {
  if (!player) {
    player = new THREE.Group();
    player.rotation.y = Math.PI;
    scene.add(player);
  }
  if (player.getObjectByName('FallbackAvatar')) return;
  const fallback = new THREE.Group();
  fallback.name = 'FallbackAvatar';
  const material = new THREE.MeshStandardMaterial({ color: 0x4776e6, roughness: 0.72 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.9, 6, 12), material);
  body.position.y = 0.78;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 12, 8), material);
  head.position.y = 1.55;
  fallback.add(body, head);
  player.add(fallback);
}

function setupEvents() {
  if (eventsController) return;
  eventsController = new AbortController();
  const eventOptions = { signal: eventsController.signal };

  window.addEventListener('resize', () => {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }, eventOptions);
  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      if (!event.repeat) keys.Space = true;
      event.preventDefault();
      return;
    }
    // Club / interact — always available when in world
    if (event.code === 'KeyE' && !event.repeat) {
      const menu = document.getElementById('menu');
      if (menu && !menu.classList.contains('hidden')) { keys[event.code] = true; return; }
      if (mafiaInGame || mafiaOpen || cinemaInRoom || cinemaOpen || restaurantOpen || isGovModalOpen()) {
        keys[event.code] = true;
        return;
      }
      const overlayOpen = ['club-lobby', 'speaking-room', 'chess-room', 'monopoly-room']
        .some((id) => {
          const el = document.getElementById(id);
          return el && !el.classList.contains('hidden');
        });
      if (overlayOpen) { keys[event.code] = true; return; }
      try {
        if (typeof tryOpenGovNearPlayer === 'function' && tryOpenGovNearPlayer(player)) {
          event.preventDefault();
          return;
        }
      } catch (err) { console.warn('gov open', err); }
      try {
        if (typeof tryOpenClubNearPlayer === 'function' && tryOpenClubNearPlayer()) {
          event.preventDefault();
          return;
        }
      } catch (err) { console.warn('club open', err); }
      if (isNearCinema()) { openCinemaLobby(); event.preventDefault(); return; }
      if (isNearMafia()) { openMafiaLobby(); event.preventDefault(); return; }
      if (isNearRestaurant()) { openRestaurantMenu(); event.preventDefault(); return; }
    }
    keys[event.code] = true;
  }, eventOptions);
  document.addEventListener('keyup', (event) => {
    keys[event.code] = false;
  }, eventOptions);

  const canvas = renderer.domElement;
  canvas.style.touchAction = 'none';

  function canCaptureMouse() {
    const menu = document.getElementById('menu');
    if (menu && !menu.classList.contains('hidden')) return false;
    if (restaurantOpen || mafiaOpen || mafiaInGame || cinemaOpen || cinemaInRoom) return false;
    const cr = document.getElementById('cinema-room');
    if (cr && !cr.classList.contains('hidden')) return false;
    return true;
  }

  function tryPointerLock() {
    if (!canCaptureMouse() || cameraMode === 'diablo') return;
    try {
      const p = canvas.requestPointerLock && canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) {}
  }

  function screenToGround(clientX, clientY) {
    if (!camera || !renderer) return null;
    const rect = canvas.getBoundingClientRect();
    _mouseNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    _mouseNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    _raycaster.setFromCamera(_mouseNDC, camera);
    const ok = _raycaster.ray.intersectPlane(_groundPlane, _hitPoint);
    return ok ? _hitPoint.clone() : null;
  }

  // Diablo: LMB click-to-move. Follow mode: click = pointer lock
  canvas.addEventListener('click', (e) => {
    if (!canCaptureMouse()) return;
    if (cameraMode === 'diablo') {
      if (e.button !== 0 && e.button !== undefined) return;
      const hit = screenToGround(e.clientX, e.clientY);
      if (hit) {
        const c = clampToWorld(hit.x, hit.z, 1);
        hit.x = c.x; hit.z = c.z;
        moveTarget = hit;
        freeCam = false;
      }
      return;
    }
    tryPointerLock();
  }, eventOptions);

  canvas.addEventListener('mousedown', (e) => {
    if (!canCaptureMouse()) return;
    if (cameraMode === 'diablo') {
      // MMB or RMB = free pan over map
      if (e.button === 1 || e.button === 2) {
        mmbDown = true;
        freeCam = true;
        e.preventDefault();
      }
      return;
    }
    if (e.button === 0 || e.button === 2) {
      rmbDown = true;
      tryPointerLock();
    }
  }, eventOptions);

  window.addEventListener('mouseup', (e) => {
    rmbDown = false;
    mmbDown = false;
  }, eventOptions);

  canvas.addEventListener('contextmenu', (e) => {
    if (canCaptureMouse()) e.preventDefault();
  }, eventOptions);

  document.addEventListener('pointerlockchange', () => {
    isLocked = document.pointerLockElement === canvas;
  }, eventOptions);

  document.addEventListener('mousemove', (event) => {
    if (!canCaptureMouse()) return;

    // Diablo free pan: drag map (no rotate-in-place)
    if (cameraMode === 'diablo' && mmbDown) {
      const pan = 0.045;
      // Pan relative to camera yaw
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      camFocus.x += (-event.movementX * rx + event.movementY * fx) * pan;
      camFocus.z += (-event.movementX * rz + event.movementY * fz) * pan;
      const c = clampToWorld(camFocus.x, camFocus.z, 1.5);
      camFocus.x = c.x; camFocus.z = c.z;
      freeCam = true;
      return;
    }

    if (cameraMode === 'diablo') return; // no rotate-on-mouse in diablo unless panning

    if (!(isLocked || rmbDown)) return;
    const sens = MOUSE_SENS * 1.35;
    yaw -= event.movementX * sens;
    pitch = Math.max(-0.9, Math.min(0.9, pitch - event.movementY * sens));
  }, eventOptions);

  // Wheel zoom in diablo
  canvas.addEventListener('wheel', (e) => {
    if (cameraMode !== 'diablo' || !canCaptureMouse()) return;
    e.preventDefault();
    // store zoom on camera userData
    const z = camera.userData.diabloDist ?? 12;
    camera.userData.diabloDist = THREE.MathUtils.clamp(z + e.deltaY * 0.01, 8, 28);
    const h = camera.userData.diabloHeight ?? 13;
    camera.userData.diabloHeight = THREE.MathUtils.clamp(h + e.deltaY * 0.012, 8, 30);
  }, { ...eventOptions, passive: false });

  window.addEventListener('blur', () => {
    keys = {};
  }, eventOptions);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) keys = {};
    fixedTimeAccumulator = 0;
    if (clock) clock.getDelta();
  }, eventOptions);
  window.addEventListener('beforeunload', dispose, { once: true, signal: eventsController.signal });
}

function dispose() {
  if (isDisposed) return;
  isDisposed = true;
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  lifecycle.clear();
  eventsController?.abort();
  eventsController = null;
  try { closeAvaturn(); } catch (error) { console.warn('avaturn cleanup', error); }
  try { stopCharacterPreview(); } catch (error) { console.warn('preview cleanup', error); }
  try { leaveMafiaRoom(); } catch (error) { console.warn('mafia cleanup', error); }
  try { leaveCinemaRoom(); } catch (error) { console.warn('cinema cleanup', error); }
  try { disposeSocialUI(); } catch (error) { console.warn('social cleanup', error); }
  try { disposeClubs(); } catch (error) { console.warn('clubs cleanup', error); }
  p2pSend = null;
  cityRoom?.close().catch(() => {});
  cityRoom = null;
  for (const [, entry] of remotePlayers) {
    try { scene?.remove(entry.group); } catch {}
  }
  remotePlayers.clear();
  playerMixer?.stopAllAction();
  renderer?.dispose();
}

function moveToward(value, target, maxDelta) {
  if (Math.abs(target - value) <= maxDelta) return target;
  return value + Math.sign(target - value) * maxDelta;
}

function rotateBoneLocal(name, x = 0, y = 0, z = 0) {
  const bone = skinBones[name];
  if (!bone) return;
  if (x) bone.rotateX(x);
  if (y) bone.rotateY(y);
  if (z) bone.rotateZ(z);
}

function updateLocomotionPose(dt, actualDistance) {
  const locomotionTarget = THREE.MathUtils.smoothstep(currentSpeed, 0.08, 0.4);
  const runTarget = THREE.MathUtils.smoothstep(
    currentSpeed,
    PLAYER_SPEED * 0.9,
    PLAYER_SPRINT * 0.75
  );
  walkBlend = THREE.MathUtils.damp(walkBlend, locomotionTarget, STEP_BLEND_DAMPING, dt);
  runBlend = THREE.MathUtils.damp(runBlend, runTarget, STEP_BLEND_DAMPING, dt);

  if (!isGrounded) locomotionState = 'air';
  else if (currentSpeed < 0.06 && walkBlend < 0.06) locomotionState = 'idle';
  else locomotionState = runBlend > 0.45 ? 'run' : 'walk';

  const isMoving = walkBlend > 0.2;

  // Switch visible model
  if (idleSkin && walkSkin) {
    idleSkin.visible = !isMoving;
    walkSkin.visible = isMoving;
    skin = isMoving ? walkSkin : idleSkin;
  }

  // Update the active mixer
  try {
    if (isMoving && walkMixer && walkAction) {
      const baseRate = THREE.MathUtils.lerp(0.9, 1.4, runBlend);
      const speedFactor = THREE.MathUtils.clamp(
        currentSpeed / Math.max(PLAYER_SPEED, 0.01),
        0.5,
        1.6
      );
      walkAction.timeScale = baseRate * speedFactor;
      walkAction.setEffectiveWeight(1);
      walkMixer.update(dt);
    } else if (idleMixer && idleAction) {
      idleAction.timeScale = 1;
      idleAction.setEffectiveWeight(1);
      idleMixer.update(dt);
    }
  } catch (e) {
    console.warn('locomotion', e);
  }
}

function sampleGroundHeight(x, z) {
  // Default world plane
  let y = 0;
  if (!walkMeshes.length) return y;
  try {
    _groundRay.set(new THREE.Vector3(x, 80, z), _groundDown);
    _groundRay.far = 120;
    const hits = _groundRay.intersectObjects(walkMeshes, false);
    if (hits && hits.length) {
      // pick highest surface under the player (stand on roads, not under)
      let best = hits[0].point.y;
      for (let i = 1; i < hits.length; i++) {
        if (hits[i].point.y > best) best = hits[i].point.y;
      }
      y = best;
    }
  } catch (e) {}
  return y;
}

function updatePlayer(dt) {
  if (!player) return;

    let inputX =
    (keys.KeyD || keys.ArrowRight ? 1 : 0) +
    (keys.KeyA || keys.ArrowLeft ? -1 : 0);
  let inputForward =
    (keys.KeyW || keys.ArrowUp ? 1 : 0) +
    (keys.KeyS || keys.ArrowDown ? -1 : 0);

  // Mobile joystick (joyY forward is negative screen-down)
  if (Math.abs(joyX) > 0.05 || Math.abs(joyY) > 0.05) {
    inputX += joyX;
    inputForward += -joyY;
  }

  // Diablo click-to-move (Dota-style)
  if (cameraMode === 'diablo' && moveTarget && player) {
    const dx = moveTarget.x - player.position.x;
    const dz = moveTarget.z - player.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.45) {
      moveTarget = null;
    } else {
      // Move in world space toward target (override WASD if no keys)
      if (Math.abs(inputX) < 0.05 && Math.abs(inputForward) < 0.05) {
        const isoYaw = Math.PI / 4;
        const fwd = new THREE.Vector3(-Math.sin(isoYaw), 0, -Math.cos(isoYaw));
        const right = new THREE.Vector3(Math.cos(isoYaw), 0, -Math.sin(isoYaw));
        const worldDir = new THREE.Vector3(dx, 0, dz).normalize();
        inputForward = worldDir.dot(fwd);
        inputX = worldDir.dot(right);
      } else {
        moveTarget = null; // manual input cancels click-move
      }
    }
  }

  inputX = THREE.MathUtils.clamp(inputX, -1, 1);
  inputForward = THREE.MathUtils.clamp(inputForward, -1, 1);
  const hasInput = Math.abs(inputX) > 0.05 || Math.abs(inputForward) > 0.05;
  const sprint = Boolean(keys.ShiftLeft || keys.ShiftRight);

  if (cameraMode === 'diablo') {
    const isoYaw = Math.PI / 4;
    cameraForwardVector.set(-Math.sin(isoYaw), 0, -Math.cos(isoYaw));
    cameraRightVector.set(Math.cos(isoYaw), 0, -Math.sin(isoYaw));
  } else {
    cameraForwardVector.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    cameraRightVector.set(Math.cos(yaw), 0, -Math.sin(yaw));
  }
  desiredMoveDirection
    .set(0, 0, 0)
    .addScaledVector(cameraForwardVector, inputForward)
    .addScaledVector(cameraRightVector, inputX);
  if (desiredMoveDirection.lengthSq() > 1) desiredMoveDirection.normalize();

  if (hasInput) {
    const targetYaw = Math.atan2(desiredMoveDirection.x, desiredMoveDirection.z);
    targetTurnQuaternion.setFromAxisAngle(Y_AXIS, targetYaw);
    const turnRate = PLAYER_TURN_SPEED * (sprint ? 0.82 : 1);
    player.quaternion.rotateTowards(targetTurnQuaternion, turnRate * dt);
  }

  characterForward
    .copy(MODEL_FORWARD)
    .applyQuaternion(player.quaternion)
    .setY(0)
    .normalize();

  const alignment = hasInput ? desiredMoveDirection.dot(characterForward) : 0;
  const alignedSpeedFactor = hasInput
    ? THREE.MathUtils.smoothstep(alignment, 0.12, 0.92)
    : 0;
  const targetSpeed = (sprint ? PLAYER_SPRINT : PLAYER_SPEED) * alignedSpeedFactor;
  const speedChange = targetSpeed > currentSpeed ? PLAYER_ACCELERATION : PLAYER_BRAKING;
  currentSpeed = moveToward(currentSpeed, targetSpeed, speedChange * dt);

  if (keys.Space && isGrounded) {
    velocityY = JUMP_FORCE;
    isGrounded = false;
    keys.Space = false;
  }
  if (!isGrounded) velocityY -= GRAVITY * dt;

  // Ground height: raycast onto neighborhood / world meshes
  const groundY = sampleGroundHeight(player.position.x, player.position.z);
  const nextY = player.position.y + velocityY * dt;
  if (nextY <= groundY + 0.02) {
    player.position.y = groundY;
    velocityY = 0;
    isGrounded = true;
  } else {
    player.position.y = nextY;
    isGrounded = false;
  }

  previousPlanarPosition.set(player.position.x, 0, player.position.z);
  const intendedDistance = currentSpeed * dt;
  movementStep.copy(characterForward).multiplyScalar(intendedDistance);
  candidatePosition.copy(player.position).add(movementStep);

  if (!collides(candidatePosition) && isInsideWorld(candidatePosition.x, candidatePosition.z, 0.5)) {
    player.position.x = candidatePosition.x;
    player.position.z = candidatePosition.z;
  } else {
    candidatePosition.copy(player.position);
    candidatePosition.x += movementStep.x;
    if (!collides(candidatePosition) && isInsideWorld(candidatePosition.x, candidatePosition.z, 0.5)) {
      player.position.x = candidatePosition.x;
    }

    candidatePosition.copy(player.position);
    candidatePosition.z += movementStep.z;
    if (!collides(candidatePosition) && isInsideWorld(candidatePosition.x, candidatePosition.z, 0.5)) {
      player.position.z = candidatePosition.z;
    }
  }
  // Hard clamp — never leave playable zone
  {
    const c = clampToWorld(player.position.x, player.position.z, 0.7);
    player.position.x = c.x;
    player.position.z = c.z;
  }

  const actualDistance = previousPlanarPosition.distanceTo(
    candidatePosition.set(player.position.x, 0, player.position.z)
  );
  if (intendedDistance > 0.0001 && actualDistance < intendedDistance * 0.2) {
    currentSpeed = moveToward(currentSpeed, 0, PLAYER_BRAKING * 2 * dt);
  }

  updateLocomotionPose(dt, actualDistance);
}

function collides(pos) {
  const r = 0.38;
  const pbox = new THREE.Box3(
    new THREE.Vector3(pos.x - r, 0.15, pos.z - r),
    new THREE.Vector3(pos.x + r, 1.65, pos.z + r)
  );
  for (const b of buildings) {
    if (pbox.intersectsBox(b.box)) return true;
  }
  return false;
}

function updateCamera(dt) {
  if (!player || !camera) return;
  if (cameraMode === 'diablo') {
    // Soft follow player unless user is free-panning the map
    if (!freeCam) {
      camFocus.lerp(
        new THREE.Vector3(player.position.x, 0, player.position.z),
        1 - Math.pow(0.002, dt)
      );
    }
    // Keep focus inside world
    {
      const c = clampToWorld(camFocus.x, camFocus.z, 1.5);
      camFocus.x = c.x;
      camFocus.z = c.z;
    }
    const dist = Math.min(camera.userData.diabloDist ?? 12, 16);
    const height = Math.min(camera.userData.diabloHeight ?? 13, 16);
    const isoYaw = Math.PI / 4;
    const ox = Math.sin(isoYaw) * dist;
    const oz = Math.cos(isoYaw) * dist;
    const target = new THREE.Vector3(
      camFocus.x + ox,
      height,
      camFocus.z + oz
    );
    // Clamp camera position so it never flies outside walls
    const cc = clampToWorld(target.x, target.z, 0.2);
    target.x = cc.x;
    target.z = cc.z;
    camera.position.lerp(target, 1 - Math.pow(0.001, dt));
    camera.lookAt(camFocus.x, 0.2, camFocus.z);
    return;
  }
  const offset = new THREE.Vector3(
    Math.sin(yaw) * CAMERA_DIST * Math.cos(pitch),
    CAMERA_HEIGHT + Math.sin(pitch) * CAMERA_DIST * 0.55,
    Math.cos(yaw) * CAMERA_DIST * Math.cos(pitch)
  );
  const target = player.position.clone().add(offset);
  const cc = clampToWorld(target.x, target.z, 0.3);
  target.x = cc.x;
  target.z = cc.z;
  // Keep camera from going too high above zone edge
  target.y = THREE.MathUtils.clamp(target.y, 1.2, 12);
  camera.position.lerp(target, 1 - Math.pow(0.0008, dt));
  camera.lookAt(player.position.x, player.position.y + 1.5, player.position.z);
}

function toggleCameraMode() {
  cameraMode = cameraMode === 'diablo' ? 'follow' : 'diablo';
  const btn = document.getElementById('btn-cam-mode');
  if (btn) btn.textContent = cameraMode === 'diablo' ? 'Вид: 3D' : 'Вид: сверху';
  moveTarget = null;
  freeCam = false;
  if (player) camFocus.set(player.position.x, 0, player.position.z);
  if (cameraMode === 'diablo') {
    try { document.exitPointerLock?.(); } catch (e) {}
    isLocked = false;
    showToast('Сверху: ЛКМ — идти · ПКМ/колёсико — обзор карты · колёсико — зум');
  } else {
    showToast('Обычная камера: клик + мышь');
  }
}

function animate() {
  if (isDisposed) return;
  animationFrameId = requestAnimationFrame(animate);
  try {
    const frameDelta = Math.min(clock.getDelta(), MAX_FRAME_DELTA);
    fixedTimeAccumulator += frameDelta;
    let fixedSteps = 0;
    while (fixedTimeAccumulator >= FIXED_STEP && fixedSteps < MAX_FIXED_STEPS) {
      updatePlayer(FIXED_STEP);
      fixedTimeAccumulator -= FIXED_STEP;
      fixedSteps++;
    }
    if (fixedSteps === MAX_FIXED_STEPS) fixedTimeAccumulator = 0;

    updateCamera(frameDelta);

    fpsFrames++;
    fpsAccum += frameDelta;
    if (fpsAccum >= 0.5) {
      if (fpsEl) fpsEl.textContent = `FPS: ${Math.round(fpsFrames / fpsAccum)}`;
      fpsFrames = 0;
      fpsAccum = 0;
    }

    updateInteractHint();
    updateRemotePlayers(frameDelta);
    const elapsed = clock.elapsedTime || 0;
    worldAnimators.forEach((update) => update(elapsed, frameDelta));
    updateCityGuide(typeof performance !== 'undefined' ? performance.now() : Date.now());
    renderer.render(scene, camera);
  } catch (err) {
    console.error('Frame error:', err);
  }
}

function showToast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2600);
}

// Старт
init();
