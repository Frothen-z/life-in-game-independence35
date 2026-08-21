/**
 * Government Street — ministries, agencies, khokimiyat (gov.uz style cards)
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const GOV_BUILDINGS = [
  {
    id: 'cabinet',
    nameRu: 'Кабинет Министров Республики Узбекистан',
    nameUz: 'Oʻzbekiston Respublikasi Vazirlar Mahkamasi',
    shortName: 'Кабинет Министров',
    type: 'Правительство',
    leader: 'Арипов Абдулла Нигматович — Премьер-министр',
    phones: ['+998 71 239-86-76'],
    phoneTrust: '',
    website: 'https://gov.uz/ru',
    email: '',
    social: {},
    address: 'г. Ташкент, площадь Мустакиллик',
    hours: 'По официальному графику',
    description: 'Высший исполнительный орган. Руководство экономикой, социальной сферой, исполнение законов.',
    govUrl: 'https://gov.uz/ru',
    mapQuery: 'House of the Government Tashkent',
    color: 0x1a3a6e,
    accent: 0xd4a017
  },
  {
    id: 'miit',
    nameRu: 'Министерство инвестиций, промышленности и торговли',
    nameUz: 'Investitsiyalar, sanoat va savdo vazirligi',
    shortName: 'МИПТ / MIIT',
    type: 'Министерство',
    leader: 'Кудратов Лазиз Шавкатович',
    phones: [
      '+998 71 238-50-90',
      '+998 71 238-51-90 (Девонхона)',
      '+998 71 238-51-16 (Матбуот)'
    ],
    phoneTrust: '+998 71 238-50-05',
    website: 'https://gov.uz/miit/',
    email: 'info@miit.uz',
    social: {
      twitter: 'https://twitter.com/MIIT_Uz',
      facebook: 'https://facebook.com/miit.uz',
      instagram: 'https://instagram.com/mift.uz',
      telegram: 'https://t.me/miit_uz'
    },
    address: '100029, г. Ташкент, ул. Ислом Каримов, 1',
    hours: 'Пн–Пт: 09:00 – 18:00',
    description: 'Инвестиции, промышленность и торговля Республики Узбекистан.',
    govUrl: 'https://gov.uz/miit/',
    mapQuery: 'Islom Karimov street 1 Tashkent Ministry of Investment',
    color: 0x1a4060,
    accent: 0x4a9fd4
  },
  {
    id: 'mineconom',
    nameRu: 'Министерство экономики и финансов',
    nameUz: 'Iqtisodiyot va moliya vazirligi',
    shortName: 'Минэкономфин',
    type: 'Министерство',
    leader: 'По данным gov.uz',
    phones: [],
    phoneTrust: '',
    website: 'https://gov.uz/ru',
    email: '',
    social: {},
    address: 'г. Ташкент',
    hours: 'Пн–Пт: 09:00 – 18:00',
    description: 'Экономическая и бюджетная политика, макроэкономика и финансы.',
    govUrl: 'https://gov.uz/ru',
    mapQuery: 'Ministry of Economy and Finance Tashkent',
    color: 0x1e4d3a,
    accent: 0xc9a227
  },
  {
    id: 'digital',
    nameRu: 'Министерство цифровых технологий',
    nameUz: 'Raqamli texnologiyalar vazirligi',
    shortName: 'Минцифры',
    type: 'Министерство',
    leader: 'По данным gov.uz',
    phones: [],
    phoneTrust: '',
    website: 'https://gov.uz/ru',
    email: '',
    social: {},
    address: 'г. Ташкент',
    hours: 'Пн–Пт: 09:00 – 18:00',
    description: 'Цифровизация госуслуг, IT-инфраструктура, электронное правительство.',
    govUrl: 'https://gov.uz/ru',
    mapQuery: 'Ministry of Digital Technologies Tashkent',
    color: 0x0d3d5c,
    accent: 0x3dbbff
  },
  {
    id: 'health',
    nameRu: 'Министерство здравоохранения',
    nameUz: 'Sogʻliqni saqlash vazirligi',
    shortName: 'Минздрав',
    type: 'Министерство',
    leader: 'По данным gov.uz',
    phones: ['1003', '+998 71 241-16-34'],
    phoneTrust: '1003',
    website: 'https://ssv.uz',
    email: 'info@minzdrav.uz',
    social: {},
    address: '100011, г. Ташкент, ул. Навои, 4',
    hours: 'Пн–Пт: 09:00 – 18:00',
    description: 'Охрана здоровья населения и организация медицинской помощи.',
    govUrl: 'https://gov.uz/ru',
    mapQuery: 'Navoi street 4 Tashkent Ministry of Health',
    color: 0x1a5c4a,
    accent: 0x4fd1a5
  },
  {
    id: 'justice',
    nameRu: 'Министерство юстиции',
    nameUz: 'Adliya vazirligi',
    shortName: 'Минюст',
    type: 'Министерство',
    leader: 'По данным gov.uz',
    phones: [],
    phoneTrust: '',
    website: 'https://www.minjust.uz',
    email: '',
    social: {},
    address: 'г. Ташкент',
    hours: 'Пн–Пт: 09:00 – 18:00',
    description: 'Правовая политика, нотариат, регистрация ННО, правовая экспертиза.',
    govUrl: 'https://gov.uz/ru',
    mapQuery: 'Ministry of Justice Tashkent Uzbekistan',
    color: 0x3a2a1a,
    accent: 0xd4b896
  },
  {
    id: 'mfa',
    nameRu: 'Министерство иностранных дел',
    nameUz: 'Tashqi ishlar vazirligi',
    shortName: 'МИД',
    type: 'Министерство',
    leader: 'По данным gov.uz',
    phones: [],
    phoneTrust: '',
    website: 'https://www.mfa.uz',
    email: '',
    social: {},
    address: 'г. Ташкент',
    hours: 'Пн–Пт: 09:00 – 18:00',
    description: 'Внешняя политика, дипломатия и консульские вопросы.',
    govUrl: 'https://gov.uz/ru',
    mapQuery: 'Ministry of Foreign Affairs Tashkent',
    color: 0x1a2a4a,
    accent: 0x6a9fd4
  },
  {
    id: 'tax',
    nameRu: 'Налоговый комитет',
    nameUz: 'Soliq qoʻmitasi',
    shortName: 'Налоговый комитет',
    type: 'Комитет',
    leader: 'По данным gov.uz',
    phones: [],
    phoneTrust: '',
    website: 'https://soliq.uz',
    email: '',
    social: {},
    address: 'г. Ташкент',
    hours: 'Пн–Пт: 09:00 – 18:00',
    description: 'Администрирование налогов и сборов, налоговый контроль.',
    govUrl: 'https://gov.uz/ru',
    mapQuery: 'Tax Committee Tashkent Uzbekistan',
    color: 0x4a2a2a,
    accent: 0xe07050
  },
  {
    id: 'customs',
    nameRu: 'Таможенный комитет',
    nameUz: 'Bojxona qoʻmitasi',
    shortName: 'Таможня',
    type: 'Комитет',
    leader: 'По данным gov.uz',
    phones: [],
    phoneTrust: '',
    website: 'https://customs.uz',
    email: '',
    social: {},
    address: 'г. Ташкент',
    hours: 'Посты — круглосуточно',
    description: 'Таможенный контроль и внешнеторговые процедуры.',
    govUrl: 'https://gov.uz/ru',
    mapQuery: 'Customs Committee Tashkent',
    color: 0x2a3a2a,
    accent: 0x70b070
  },
  {
    id: 'khokimiyat',
    nameRu: 'Хокимият города Ташкента',
    nameUz: 'Toshkent shahar hokimligi',
    shortName: 'Хокимият',
    type: 'Хокимият',
    leader: 'Хоким города',
    phones: [],
    phoneTrust: '',
    website: 'https://tashkent.uz',
    email: '',
    social: {},
    address: 'г. Ташкент',
    hours: 'Пн–Пт, приём граждан по графику',
    description: 'Местная исполнительная власть города Ташкента.',
    govUrl: 'https://gov.uz/ru',
    mapQuery: 'Tashkent city hokimiyat',
    color: 0x2a3550,
    accent: 0xf0c040
  },
  {
    id: 'invest',
    nameRu: 'Агентство по привлечению иностранных инвестиций',
    nameUz: 'Xorijiy investitsiyalarni jalb etish agentligi',
    shortName: 'Агентство инвестиций',
    type: 'Агентство',
    leader: 'По данным gov.uz',
    phones: ['+998 71 202-02-10'],
    phoneTrust: '+998 71 202-02-10',
    website: 'https://gov.uz/investmiit',
    email: 'uzipa@invest.gov.uz',
    social: {},
    address: '100060, г. Ташкент, ул. А. Темур, 13',
    hours: 'Пн–Пт: 09:00 – 18:00',
    description: 'Привлечение иностранных инвестиций и сопровождение инвесторов.',
    govUrl: 'https://gov.uz/investmiit',
    mapQuery: 'Amir Temur street 13 Tashkent investment agency',
    color: 0x1a4040,
    accent: 0x40d0c0
  }
];

let govZones = [];
let govOpen = false;
let sceneRef = null;
let buildingsRef = null;

export function isGovModalOpen() {
  return govOpen;
}

export function createGovernmentStreet(scene, buildings) {
  try {
    if (!scene) {
      console.warn('[gov] no scene');
      return null;
    }
    sceneRef = scene;
    buildingsRef = buildings;
    govZones = [];

    const group = new THREE.Group();
    group.name = 'GovernmentStreet';

    // A straight east-facing civic boulevard. Buildings alternate on both
    // sides, so every entrance is visible from one continuous pedestrian axis.
    const originX = 38;
    const spacingX = 12.6;
    const boulevardLength = 88;
    const boulevardCenterX = 69;
    const boulevard = new THREE.Mesh(
      new RoundedBoxGeometry(boulevardLength, 0.11, 9.2, 3, 0.36),
      new THREE.MeshStandardMaterial({ color: 0xbab6ae, roughness: 0.93 })
    );
    boulevard.position.set(boulevardCenterX, 0.04, 0);
    boulevard.receiveShadow = true;
    group.add(boulevard);
    const walkableSurfaces = [boulevard];

    const civicBlue = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.32,
      roughness: 0.35
    });
    for (const z of [-3.8, 3.8]) {
      const guide = new THREE.Mesh(new RoundedBoxGeometry(boulevardLength - 2, 0.05, 0.16, 2, 0.04), civicBlue);
      guide.position.set(boulevardCenterX, 0.12, z);
      group.add(guide);
    }
    const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0xd7d1c6, roughness: 0.9 });
    for (const z of [-7.4, 7.4]) {
      const walk = new THREE.Mesh(new RoundedBoxGeometry(boulevardLength, 0.12, 4.2, 3, 0.32), sidewalkMat);
      walk.position.set(boulevardCenterX, 0.05, z);
      walk.receiveShadow = true;
      group.add(walk);
      walkableSurfaces.push(walk);
    }

    const list = Array.isArray(GOV_BUILDINGS) ? GOV_BUILDINGS : [];
    list.forEach((info, i) => {
      try {
        const col = Math.floor(i / 2);
        const northSide = i % 2 === 0;
        const x = originX + col * spacingX;
        const z = northSide ? 13 : -13;

        const b = makeGovBuilding(info);
        b.position.set(x, 0, z);
        b.rotation.y = northSide ? Math.PI : 0;
        group.add(b);
        b.updateMatrixWorld(true);

        if (buildings && Array.isArray(buildings)) {
          const box = new THREE.Box3().setFromObject(b);
          box.min.y = 0;
          buildings.push({ box });
        }

        govZones.push({
          id: info.id,
          info,
          position: new THREE.Vector3(x, 0, northSide ? 8.1 : -8.1),
          radius: 5.8
        });

        const sign = makeSign(info.shortName || info.nameRu, info.accent);
        sign.position.set(x, 0, northSide ? 8.1 : -8.1);
        sign.rotation.y = northSide ? Math.PI : 0;
        group.add(sign);
      } catch (err) {
        console.warn('[gov] building failed', info && info.id, err);
      }
    });

    const title = makeSign('УЛИЦА ГОСУДАРСТВА', 0x5ec8ff);
    title.position.set(28, 0, 0);
    title.rotation.y = Math.PI / 2;
    title.scale.set(1.4, 1.25, 1);
    group.add(title);

    // Civic gateway at the district entrance.
    const gateMat = new THREE.MeshStandardMaterial({ color: 0x10253b, roughness: 0.42, metalness: 0.3 });
    for (const zz of [-6, 6]) {
      const pillar = new THREE.Mesh(new RoundedBoxGeometry(0.75, 6, 0.75, 3, 0.18), gateMat);
      pillar.position.set(27.2, 3, zz);
      group.add(pillar);
    }
    const lintel = new THREE.Mesh(new RoundedBoxGeometry(0.78, 0.65, 13.1, 3, 0.16), gateMat);
    lintel.position.set(27.2, 6.1, 0);
    group.add(lintel);

    // The collision/height system consumes these exact meshes. Keeping the
    // references on the group prevents the avatar from standing on the lower
    // terrain plane and visually sinking into the raised civic boulevard.
    group.userData.walkMeshes = walkableSurfaces;

    // Reuse the approved lamp from the original city kit instead of placing
    // trees in front of civic facades. Loading is intentionally non-blocking.
    addGovernmentLanterns(group);

    scene.add(group);
    console.log('[gov] OK buildings', list.length, 'zones', govZones.length);
    return group;
  } catch (e) {
    console.error('[gov] createGovernmentStreet FATAL', e);
    return null;
  }
}

function addGovernmentLanterns(group) {
  const positions = [];
  for (let x = 34; x <= 104; x += 10) {
    positions.push([x, -5.8], [x, 5.8]);
  }

  const addWarmLights = () => {
    positions.forEach(([x, z], index) => {
      if (index % 4 !== 0) return;
      const light = new THREE.PointLight(0xffd69a, 0.58, 15, 2);
      light.position.set(x, 3.65, z);
      group.add(light);
    });
  };

  const loader = new GLTFLoader();
  loader.load(
    'models/city/env/lantern.glb',
    (gltf) => {
      try {
        const source = gltf.scene;
        source.updateMatrixWorld(true);
        const sourceBox = new THREE.Box3().setFromObject(source);
        const sourceSize = new THREE.Vector3();
        sourceBox.getSize(sourceSize);
        source.scale.setScalar(sourceSize.y > 0.01 ? 4.25 / sourceSize.y : 1);
        source.updateMatrixWorld(true);

        const scaledBox = new THREE.Box3().setFromObject(source);
        const yOffset = 0.11 - scaledBox.min.y;
        source.traverse((child) => {
          if (!child.isMesh) return;
          child.castShadow = true;
          child.receiveShadow = true;
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          materials.forEach((material) => {
            if (!material || !/lamp|lampe|light|glass/i.test(material.name || '')) return;
            material.emissive = new THREE.Color(0xffe2a7);
            material.emissiveIntensity = 0.72;
            material.needsUpdate = true;
          });
        });

        positions.forEach(([x, z]) => {
          const lamp = source.clone(true);
          lamp.position.set(x, yOffset, z);
          lamp.rotation.y = z > 0 ? Math.PI : 0;
          group.add(lamp);
        });
        addWarmLights();
      } catch (error) {
        console.warn('[gov] lantern setup failed', error);
        addFallbackGovernmentLanterns(group, positions);
        addWarmLights();
      }
    },
    undefined,
    (error) => {
      console.warn('[gov] lantern load failed', error);
      addFallbackGovernmentLanterns(group, positions);
      addWarmLights();
    }
  );
}

function addFallbackGovernmentLanterns(group, positions) {
  const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x182231, metalness: 0.62, roughness: 0.34 });
  const glowMaterial = new THREE.MeshStandardMaterial({
    color: 0xffe2a7,
    emissive: 0xffc861,
    emissiveIntensity: 1.5,
    roughness: 0.28
  });
  positions.forEach(([x, z]) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 3.55, 8), poleMaterial);
    pole.position.set(x, 1.88, z);
    pole.castShadow = true;
    group.add(pole);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), glowMaterial);
    head.position.set(x, 3.67, z);
    group.add(head);
  });
}


function makeGovBuilding(info) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xe7e1d6,
    roughness: 0.74,
    metalness: 0.04
  });
  const sideMat = new THREE.MeshStandardMaterial({
    color: (info && info.color) || 0x1a3a5c,
    roughness: 0.58,
    metalness: 0.12
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x8bd5eb,
    roughness: 0.12,
    metalness: 0.18,
    transparent: true,
    opacity: 0.72,
    transmission: 0.08,
    clearcoat: 0.45
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: (info && info.accent) || 0xd4a017,
    emissive: (info && info.accent) || 0xd4a017,
    emissiveIntensity: 0.12,
    roughness: 0.42,
    metalness: 0.16
  });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x132238, roughness: 0.3, metalness: 0.46 });

  const h = 8.8 + ((info && info.type) === 'Правительство' ? 2.2 : 0);
  const body = new THREE.Mesh(new RoundedBoxGeometry(10.1, h, 7.8, 4, 0.48), bodyMat);
  body.position.y = h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  const side = new THREE.Mesh(new RoundedBoxGeometry(2.0, h * 0.82, 7.3, 3, 0.34), sideMat);
  side.position.set(-4.3, h * 0.41, 0);
  g.add(side);

  const glass = new THREE.Mesh(new RoundedBoxGeometry(7.3, h * 0.62, 0.17, 3, 0.08), glassMat);
  glass.position.set(0.65, h * 0.48, 3.96);
  g.add(glass);
  for (const x of [-1.7, 0.4, 2.5]) {
    const fin = new THREE.Mesh(new RoundedBoxGeometry(0.09, h * 0.6, 0.38, 2, 0.03), frameMat);
    fin.position.set(x, h * 0.48, 4.08);
    g.add(fin);
  }
  for (let floor = 1; floor <= 3; floor++) {
    const band = new THREE.Mesh(new RoundedBoxGeometry(7.4, 0.07, 0.34, 2, 0.02), frameMat);
    band.position.set(0.65, (h * floor) / 4, 4.07);
    g.add(band);
  }

  const roof = new THREE.Mesh(new RoundedBoxGeometry(10.4, 0.38, 8.1, 3, 0.12), frameMat);
  roof.position.y = h + 0.05;
  g.add(roof);

  const canopy = new THREE.Mesh(new RoundedBoxGeometry(4.4, 0.24, 1.8, 3, 0.09), accentMat);
  canopy.position.set(0.7, 3.15, 4.82);
  g.add(canopy);

  const door = new THREE.Mesh(
    new RoundedBoxGeometry(2.35, 3.0, 0.16, 3, 0.08),
    frameMat
  );
  door.position.set(0.7, 1.5, 4.02);
  g.add(door);

  if (info && info.id === 'cabinet') {
    for (const ox of [-2.4, 3.8]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, h * 0.68, 10), accentMat);
      col.position.set(ox, h * 0.34, 4.13);
      g.add(col);
    }
  }

  const podium = new THREE.Mesh(new RoundedBoxGeometry(8.3, 0.18, 2.2, 3, 0.16), new THREE.MeshStandardMaterial({ color: 0xc8c2b8, roughness: 0.9 }));
  podium.position.set(0.55, 0.07, 4.75);
  g.add(podium);

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 4, 6),
    new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.6 })
  );
  pole.position.set(3.6, h + 1.5, 0.5);
  g.add(pole);
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 0.8),
    new THREE.MeshStandardMaterial({ color: 0x0099b5, side: THREE.DoubleSide })
  );
  flag.position.set(4.3, h + 2.6, 0.5);
  g.add(flag);

  return g;
}

function makeSign(text, accentHex) {
  const g = new THREE.Group();
  const w = Math.min(6.2, 0.32 * String(text || '').length + 1.6);
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.95, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x111820, roughness: 0.7 })
  );
  board.position.y = 2.45;
  g.add(board);

  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.09, 0.13),
    new THREE.MeshStandardMaterial({
      color: accentHex || 0x5ec8ff,
      emissive: accentHex || 0x5ec8ff,
      emissiveIntensity: 0.3
    })
  );
  strip.position.y = 2.95;
  g.add(strip);

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#111820';
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#f0f4f8';
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(text || ''), 256, 64, 480);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(0.5, w - 0.2), 0.72),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    );
    label.position.set(0, 2.45, 0.08);
    g.add(label);
  } catch (e) {
    console.warn('sign texture', e);
  }

  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.1, 2.3, 6),
    new THREE.MeshStandardMaterial({ color: 0x333338 })
  );
  post.position.y = 1.15;
  g.add(post);
  return g;
}

export function getNearGov(player) {
  if (!player) return null;
  let best = null;
  let bestD = Infinity;
  for (const z of govZones) {
    const dx = player.position.x - z.position.x;
    const dz = player.position.z - z.position.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d <= z.radius && d < bestD) {
      bestD = d;
      best = z;
    }
  }
  return best;
}

export function govHintText(player) {
  const z = getNearGov(player);
  if (!z) return null;
  return `Нажми <kbd>E</kbd> — ${z.info.shortName}`;
}

export function tryOpenGovNearPlayer(player) {
  if (govOpen) return false;
  const z = getNearGov(player);
  if (!z) return false;
  openGovCard(z.info);
  return true;
}

export function openGovCard(info) {
  govOpen = true;
  const modal = document.getElementById('gov-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  document.getElementById('interact-hint')?.classList.add('hidden');
  if (document.pointerLockElement) document.exitPointerLock();

  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val || '—';
  };

  setText('gov-title', info.nameRu);
  setText('gov-title-uz', info.nameUz || '');
  setText('gov-type', info.type);
  setText('gov-leader', info.leader);

  // phones
  const phoneEl = document.getElementById('gov-phones');
  if (phoneEl) {
    const list = (info.phones || []).filter(Boolean);
    phoneEl.innerHTML = list.length
      ? list.map((p) => `<a href="tel:${p.replace(/[^\d+]/g, '')}">${p}</a>`).join('<br>')
      : '—';
  }
  setText('gov-trust', info.phoneTrust || '—');

  // website
  const webEl = document.getElementById('gov-website');
  if (webEl) {
    const url = info.website || info.govUrl || 'https://gov.uz/ru';
    webEl.innerHTML = `<a href="${url}" target="_blank" rel="noopener">${url.replace(/^https?:\/\//, '')}</a>
      <a class="gov-chip" href="${url}" target="_blank" rel="noopener">Веб-сайтга ўтиш</a>`;
  }

  const mailEl = document.getElementById('gov-email');
  if (mailEl) {
    mailEl.innerHTML = info.email
      ? `<a href="mailto:${info.email}">${info.email}</a>`
      : '—';
  }

  // social
  const soc = info.social || {};
  const socEl = document.getElementById('gov-social');
  if (socEl) {
    const icons = [
      ['twitter', 'X', soc.twitter],
      ['linkedin', 'in', soc.linkedin],
      ['facebook', 'f', soc.facebook],
      ['telegram', 'TG', soc.telegram],
      ['instagram', 'IG', soc.instagram]
    ];
    const links = icons.filter((x) => x[2]);
    socEl.innerHTML = links.length
      ? links.map(([k, label, href]) =>
          `<a class="gov-soc" href="${href}" target="_blank" rel="noopener" title="${k}">${label}</a>`
        ).join('')
      : '<span class="gov-muted">—</span>';
  }

  setText('gov-address', info.address);
  setText('gov-hours', info.hours);
  setText('gov-desc', info.description);

  const portal = document.getElementById('gov-link');
  if (portal) {
    portal.href = info.govUrl || info.website || 'https://gov.uz/ru';
  }

  // map embed via OSM
  const mapFrame = document.getElementById('gov-map');
  if (mapFrame) {
    const q = encodeURIComponent(info.mapQuery || info.address || 'Tashkent');
    mapFrame.src = `https://maps.google.com/maps?q=${q}&z=15&output=embed`;
  }
  const mapLink = document.getElementById('gov-map-link');
  if (mapLink) {
    const q = encodeURIComponent(info.mapQuery || info.address || 'Tashkent');
    mapLink.href = `https://www.google.com/maps/search/?api=1&query=${q}`;
  }
}

export function closeGovCard() {
  govOpen = false;
  document.getElementById('gov-modal')?.classList.add('hidden');
}

export function setupGovUI() {
  document.getElementById('gov-close')?.addEventListener('click', closeGovCard);
  document.getElementById('gov-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'gov-modal') closeGovCard();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && govOpen) closeGovCard();
  });
}
