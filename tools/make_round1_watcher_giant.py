from pathlib import Path

path = Path('game/js/main.js')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        'new THREE.PlaneGeometry(16, 3.6)',
        'new THREE.PlaneGeometry(12.8, 3.0)',
        'question board size'
    ),
    (
        'round1QuestionBoard.position.set(0, 14.2, 73.5);\n  round1QuestionBoard.rotation.y = Math.PI;',
        'round1QuestionBoard.position.set(12.5, 9.4, 55.5);\n  round1QuestionBoard.rotation.y = Math.PI * 0.88;',
        'question board move aside'
    ),
    (
        'round1Doll.position.set(0, 0, 71.5);\n  round1Doll.scale.setScalar(1.16);',
        '''round1Doll.position.set(0, 0.25, 70.5);\n  // Monumental watcher: visible from the start line above every answer board.\n  round1Doll.scale.setScalar(3.55);\n\n  const watcherKey = new THREE.SpotLight(0xfff1d6, 3.2, 145, Math.PI / 5.5, 0.42, 1.15);\n  watcherKey.position.set(-14, 35, 43);\n  watcherKey.target.position.set(0, 15, 70.5);\n  arena.add(watcherKey);\n  arena.add(watcherKey.target);\n\n  const watcherRim = new THREE.PointLight(0x8fd8ff, 1.25, 62, 2);\n  watcherRim.position.set(10, 22, 74);\n  arena.add(watcherRim);''',
        'giant watcher and lighting'
    )
]

for old, new, label in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 occurrence, got {count}')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
print('Giant Round 1 watcher patch applied')
