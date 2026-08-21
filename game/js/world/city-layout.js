export const CITY_LAYOUT = Object.freeze({
  bounds: Object.freeze({ minX: -78, maxX: 118, minZ: -64, maxZ: 74 }),
  plazaRadius: 15,
  venues: Object.freeze({
    mafia: Object.freeze({ x: -22, z: 47, entranceX: -22, entranceZ: 40.8, label: 'Мафия' }),
    speaking: Object.freeze({ x: -11, z: 43, entranceX: -11, entranceZ: 38.4, label: 'Speaking Club' }),
    chess: Object.freeze({ x: 0, z: 43, entranceX: 0, entranceZ: 38.4, label: 'Шахматы' }),
    monopoly: Object.freeze({ x: 11, z: 43, entranceX: 11, entranceZ: 38.4, label: 'Монополия' }),
    cinema: Object.freeze({ x: 22, z: 47, entranceX: 22, entranceZ: 40.8, label: 'Кинотеатр' }),
    restaurant: Object.freeze({ x: 30, z: 30, entranceX: 24.8, entranceZ: 24.8, label: 'Ресторан Skyline' }),
    government: Object.freeze({ x: 38, z: 0, entranceX: 30, entranceZ: 0, label: 'Государственная улица' }),
    sport: Object.freeze({ x: -42, z: 0, entranceX: -34, entranceZ: 0, label: 'Парк и спорт' }),
    education: Object.freeze({ x: 29, z: -37, entranceX: 23, entranceZ: -29, label: 'Обучение' }),
    shopping: Object.freeze({ x: -29, z: -37, entranceX: -23, entranceZ: -29, label: 'Шопинг' })
  })
});

export const CITY_DESTINATIONS = Object.freeze([
  Object.freeze({ id: 'spawn', label: 'Главная площадь', x: 0, z: 0 }),
  Object.freeze({ id: 'entertainment', label: 'Развлечения', x: 0, z: 39 }),
  Object.freeze({ id: 'restaurant', label: 'Ресторан', x: 25, z: 25 }),
  Object.freeze({ id: 'government', label: 'Государство', x: 31, z: 0 }),
  Object.freeze({ id: 'sport', label: 'Парк', x: -35, z: 0 })
]);

export function worldToMinimap(x, z, bounds = CITY_LAYOUT.bounds) {
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const depth = Math.max(1, bounds.maxZ - bounds.minZ);
  return {
    left: Math.max(0, Math.min(100, ((x - bounds.minX) / width) * 100)),
    top: Math.max(0, Math.min(100, ((bounds.maxZ - z) / depth) * 100))
  };
}

export function districtAt(x, z) {
  const distance = Math.hypot(x, z);
  if (distance <= 18) return 'Главная площадь';
  if (z >= 27 && Math.abs(x) <= 29) return 'Улица развлечений';
  if (x >= 17 && z >= 14) return 'Ресторанный квартал';
  if (x >= 24 && Math.abs(z) < 20) return 'Государственная улица';
  if (x <= -22 && Math.abs(z) < 22) return 'Парк и спорт';
  if (z <= -20 && x >= 0) return 'Квартал обучения';
  if (z <= -20) return 'Торговый квартал';
  return 'Городской бульвар';
}

export function distanceToDestination(position, destination) {
  if (!position || !destination) return Infinity;
  return Math.hypot(Number(position.x) - destination.x, Number(position.z) - destination.z);
}
