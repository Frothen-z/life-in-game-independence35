export const CITY_LAYOUT = Object.freeze({
  bounds: Object.freeze({ minX: -62, maxX: 62, minZ: -70, maxZ: 96 }),
  venues: Object.freeze({
    spawn: Object.freeze({ x: 0, z: -48, label: 'Стартовая площадь' }),
    round1: Object.freeze({ x: 0, z: -28, label: '1 раунд' }),
    waiting: Object.freeze({ x: 41, z: 18, label: 'Зал ожидания' })
  })
});

export const CITY_DESTINATIONS = Object.freeze([
  Object.freeze({ id: 'spawn', label: 'Стартовая площадь', x: 0, z: -48 }),
  Object.freeze({ id: 'round1', label: '1 раунд', x: 0, z: -28 })
]);

export function districtAt(x, z) {
  if (x > 31 && z > 4 && z < 34) return 'Зал ожидания';
  if (z < -34) return 'Стартовая площадь';
  if (z < -20) return 'Вход в Раунд 1';
  if (z <= 76) return 'Арена Раунда 1';
  return 'Финиш Раунда 1';
}

export function worldToMinimap(x, z, bounds = CITY_LAYOUT.bounds) {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxZ - bounds.minZ;
  return {
    x: ((x - bounds.minX) / width) * 100,
    y: ((bounds.maxZ - z) / height) * 100
  };
}

export function distanceToDestination(position, destination) {
  if (!position || !destination) return Infinity;
  const dx = (position.x || 0) - destination.x;
  const dz = (position.z || 0) - destination.z;
  return Math.sqrt(dx * dx + dz * dz);
}
