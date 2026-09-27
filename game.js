import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const canvas = $('#world');
  const mapCanvas = $('#minimap');
  const mapCtx = mapCanvas.getContext('2d');
  const ui = {
    hud: $('#hud'), quest: $('#quest-card'), map: $('#map-card'), bottom: $('#bottom-hud'),
    intro: $('#intro-overlay'), pause: $('#pause-overlay'), ending: $('#ending-overlay'),
    toast: $('#toast'), prompt: $('#interaction-prompt'), promptCopy: $('#interaction-copy'),
    count: $('#relic-count'), questCopy: $('#quest-copy'), objective: $('#objective-distance'),
    stamina: $('#stamina-fill'), hearts: $('#hearts'), flash: $('#flash'), announcer: $('#announcer'),
  };

  const WORLD_HALF = 160;
  const WATER_LEVEL = 0.18;
  const start = new THREE.Vector3(-112, 0, 67);
  const shrinePoint = { x: 0, z: 0 };
  const relics = [
    { x: -70, z: 42, title: 'The Meadow Light', found: false },
    { x: 91, z: -11, title: 'The Windward Light', found: false },
    { x: 78, z: 103, title: 'The Last Light', found: false },
  ];
  const lakes = [
    { x: -45, z: -43, rx: 13, rz: 8 },
    { x: 70, z: -59, rx: 16, rz: 11 },
    { x: 39, z: 75, rx: 12, rz: 9 },
  ];
  const road = [
    [-116, 73], [-99, 58], [-83, 49], [-65, 41], [-42, 34], [-23, 22], [-14, 8],
    [0, 0], [21, -5], [43, -9], [64, 3], [76, 24], [80, 47], [78, 75], [78, 105],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z));
  const obstructions = [];
  const enemies = [];
  const particles = [];
  const held = new Set();
  const touchHeld = new Set();

  let scene;
  let camera;
  let renderer;
  let orbit;
  let player;
  let playerRig;
  let shrineGlow;
  let shrineRing;
  let relicMeshes = [];
  let relicLights = [];
  let slashArc;
  let skyLight;
  let sunLight;
  let sunDisc;
  let running = false;
  let paused = false;
  let finished = false;
  let mapOpen = true;
  let gameSeconds = 0;
  let worldMinutes = 8 * 60 + 40;
  let stamina = 100;
  let health = 5;
  let playerInvulnerable = 0;
  let strikeCooldown = 0;
  let interaction = null;
  let toastTimer = 0;
  let flashTimer = 0;
  let lastFrame = performance.now();
  let audio = null;
  let mouseDown = null;
  let screenShake = 0;

  const mat = (color, roughness = 1, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
  const mats = {
    grass: [mat('#75975b'), mat('#7f9d62'), mat('#709057'), mat('#87a56a')],
    path: mat('#b9a77b'), pathEdge: mat('#918260'), stone: mat('#888875'), stoneDark: mat('#626c5c'),
    bark: mat('#594a36'), foliage: [mat('#3f6748'), mat('#4e754d'), mat('#5e8151'), mat('#496a4c')],
    skin: mat('#d5af83'), hair: mat('#bd8e4d'), tunic: mat('#547f59'), tunicLight: mat('#729361'),
    cape: mat('#7d3e39'), leather: mat('#76573b'), boot: mat('#4c4b39'), gold: mat('#d9b964', .34, { metalness: .35 }),
    water: new THREE.MeshPhysicalMaterial({ color: '#558c88', roughness: .2, metalness: .04, transparent: true, opacity: .9, clearcoat: .9 }),
    crystal: new THREE.MeshPhysicalMaterial({ color: '#ffe5a0', emissive: '#f1c963', emissiveIntensity: 1.8, roughness: .12, metalness: .15, transmission: .18 }),
    enemy: mat('#884638'), enemyLight: mat('#b06443'), enemyEye: mat('#f4d883', .3, { emissive: '#e4a746', emissiveIntensity: .55 }),
  };

  function seeded(x, z, salt = 0) {
    const n = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43758.5453123;
    return n - Math.floor(n);
  }

  function smoothstep(a, b, value) {
    const t = THREE.MathUtils.clamp((value - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function terrainHeight(x, z) {
    const edge = Math.max(Math.abs(x), Math.abs(z));
    let height = Math.sin(x * .033) * Math.cos(z * .028) * 1.4
      + Math.sin((x + z) * .057) * .48
      + Math.cos((x - z) * .021) * .52;
    const ridge = smoothstep(103, 153, edge);
    height += ridge * ridge * (7 + 17 * (.55 + .45 * Math.sin(x * .045 + z * .033)));

    for (const lake of lakes) {
      const d = Math.hypot((x - lake.x) / lake.rx, (z - lake.z) / lake.rz);
      if (d < 1.08) return WATER_LEVEL - .72 + Math.max(0, d - .78) * .12;
      if (d < 1.55) {
        const blend = smoothstep(1.08, 1.55, d);
        height = THREE.MathUtils.lerp(WATER_LEVEL - .72, height, blend);
      }
    }
    return height;
  }

  function isNearRoad(x, z, margin = 6) {
    for (let i = 0; i < road.length - 1; i++) {
      const a = road[i]; const b = road[i + 1];
      const abx = b.x - a.x; const abz = b.z - a.z;
      const t = THREE.MathUtils.clamp(((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz), 0, 1);
      if (Math.hypot(x - a.x - abx * t, z - a.z - abz * t) < margin) return true;
    }
    return false;
  }

  function inWater(x, z, padding = 0) {
    return lakes.some((lake) => ((x - lake.x) / (lake.rx + padding)) ** 2 + ((z - lake.z) / (lake.rz + padding)) ** 2 < 1);
  }

  function setupRenderer() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  function setupScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color('#bfd6d5');
    scene.fog = new THREE.FogExp2('#bfd6d5', .0048);
    camera = new THREE.PerspectiveCamera(57, window.innerWidth / window.innerHeight, .1, 360);
    camera.position.set(start.x, terrainHeight(start.x, start.z) + 7, start.z + 11);

    orbit = new OrbitControls(camera, canvas);
    orbit.target.set(start.x, terrainHeight(start.x, start.z) + 1.35, start.z);
    orbit.enableDamping = true;
    orbit.dampingFactor = .075;
    orbit.enablePan = false;
    orbit.minDistance = 5.2;
    orbit.maxDistance = 15.5;
    orbit.minPolarAngle = .46;
    orbit.maxPolarAngle = 1.34;
    orbit.update();

    skyLight = new THREE.HemisphereLight('#e4f0eb', '#66724f', 1.4);
    scene.add(skyLight);
    sunLight = new THREE.DirectionalLight('#ffe6b3', 2.45);
    sunLight.position.set(-76, 115, -48);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.left = -72; sunLight.shadow.camera.right = 72;
    sunLight.shadow.camera.top = 72; sunLight.shadow.camera.bottom = -72;
    sunLight.shadow.camera.near = 1; sunLight.shadow.camera.far = 260;
    sunLight.shadow.bias = -.00015;
    sunLight.target.position.set(0, 0, 0);
    scene.add(sunLight, sunLight.target);
    sunDisc = new THREE.Mesh(new THREE.SphereGeometry(5, 18, 12), new THREE.MeshBasicMaterial({ color: '#fff1c4' }));
    sunDisc.position.set(-102, 105, -195); scene.add(sunDisc);

    buildTerrain();
    buildRoad();
    buildWater();
    buildFarHills();
    buildDecorations();
    buildRuins();
    buildShrine();
    buildRelics();
    buildPlayer();
    buildEnemies();
    buildSkyDetails();
    buildMap();
  }

  function buildTerrain() {
    const divisions = 144;
    const size = WORLD_HALF * 2;
    const positions = [];
    const colors = [];
    const indices = [];
    const colorA = new THREE.Color('#78975e');
    const colorB = new THREE.Color('#90a86b');
    for (let iz = 0; iz <= divisions; iz++) {
      for (let ix = 0; ix <= divisions; ix++) {
        const x = -WORLD_HALF + (ix / divisions) * size;
        const z = -WORLD_HALF + (iz / divisions) * size;
        const h = terrainHeight(x, z);
        positions.push(x, h, z);
        const noise = seeded(ix, iz, 23) * .55 + (Math.sin(x * .17 + z * .11) + 1) * .12;
        const color = colorA.clone().lerp(colorB, THREE.MathUtils.clamp(noise + Math.max(h, 0) * .012, 0, 1));
        colors.push(color.r, color.g, color.b);
      }
    }
    for (let z = 0; z < divisions; z++) {
      for (let x = 0; x < divisions; x++) {
        const a = z * (divisions + 1) + x;
        const b = a + divisions + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    const ground = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: false }));
    ground.receiveShadow = true; ground.name = 'rolling meadow'; scene.add(ground);

    const edge = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), mat('#879277'));
    edge.rotation.x = -Math.PI / 2; edge.position.y = -1.2; edge.position.z = 0; scene.add(edge);
  }

  function buildRoad() {
    const curve = new THREE.CatmullRomCurve3(road);
    const segments = 420;
    const vertices = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const center = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t).setY(0).normalize();
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
      const width = 2.65 + .24 * Math.sin(t * Math.PI * 31);
      center.y = terrainHeight(center.x, center.z) + .045;
      const left = center.clone().addScaledVector(side, width);
      const right = center.clone().addScaledVector(side, -width);
      vertices.push(left.x, left.y, left.z, right.x, right.y, right.z);
      uvs.push(t * 55, 0, t * 55, 1);
      if (i < segments) {
        const a = i * 2; const b = a + 2;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, mats.path);
    mesh.receiveShadow = true; scene.add(mesh);
  }

  function buildWater() {
    lakes.forEach((lake, index) => {
      const shore = new THREE.Mesh(new THREE.CircleGeometry(1, 48), mat('#a7a274'));
      shore.rotation.x = -Math.PI / 2;
      shore.position.set(lake.x, WATER_LEVEL - .2, lake.z);
      shore.scale.set(lake.rx * 1.26, lake.rz * 1.26, 1); shore.receiveShadow = true; scene.add(shore);
      const water = new THREE.Mesh(new THREE.CircleGeometry(1, 64), mats.water);
      water.rotation.x = -Math.PI / 2;
      water.position.set(lake.x, WATER_LEVEL, lake.z);
      water.scale.set(lake.rx, lake.rz, 1); water.userData.lakeIndex = index; water.name = 'still water'; scene.add(water);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1, .035, 5, 72), mat('#c2c49a', .4, { transparent: true, opacity: .34 }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(lake.x, WATER_LEVEL + .03, lake.z); ring.scale.set(lake.rx * .82, lake.rz * .82, 1); scene.add(ring);
    });
  }

  function buildFarHills() {
    const colors = ['#84957d', '#929d83', '#768972', '#9ca38c'];
    for (let i = 0; i < 34; i++) {
      const angle = i / 34 * Math.PI * 2;
      const radius = 179 + seeded(i, 4, 11) * 15;
      const height = 23 + seeded(i, 2, 4) * 28;
      const width = 14 + seeded(i, 8, 9) * 25;
      const hill = new THREE.Mesh(new THREE.ConeGeometry(width, height, 5 + Math.floor(seeded(i, 3, 7) * 3), 1), mat(colors[i % colors.length]));
      hill.position.set(Math.cos(angle) * radius, height * .42 - 4, Math.sin(angle) * radius);
      hill.rotation.y = seeded(i, 2, 10) * Math.PI;
      hill.castShadow = true; hill.receiveShadow = true; scene.add(hill);
    }
  }

  function addInstances(geometry, material, items, transformFor, { shadows = false, colors: tint = false } = {}) {
    if (!items.length) return null;
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const dummy = new THREE.Object3D();
    items.forEach((item, index) => {
      const spec = transformFor(item, index);
      dummy.position.set(spec.x, spec.y, spec.z);
      dummy.rotation.set(spec.rx || 0, spec.ry || 0, spec.rz || 0);
      dummy.scale.set(spec.sx ?? 1, spec.sy ?? 1, spec.sz ?? 1);
      dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
      if (tint && spec.color) mesh.setColorAt(index, new THREE.Color(spec.color));
    });
    mesh.castShadow = shadows; mesh.receiveShadow = shadows;
    mesh.computeBoundingSphere(); scene.add(mesh);
    return mesh;
  }

  function buildDecorations() {
    const trees = []; const rocks = []; const bushes = []; const flowers = []; const grasses = [];
    for (let i = 0; i < 2100; i++) {
      const x = -WORLD_HALF + 7 + seeded(i, 3, 1) * (WORLD_HALF * 2 - 14);
      const z = -WORLD_HALF + 7 + seeded(i, 9, 2) * (WORLD_HALF * 2 - 14);
      if (Math.max(Math.abs(x), Math.abs(z)) > 137 || isNearRoad(x, z, 7) || inWater(x, z, 5)) continue;
      if (Math.hypot(x - shrinePoint.x, z - shrinePoint.z) < 17) continue;
      if (relics.some((relic) => Math.hypot(x - relic.x, z - relic.z) < 5.8)) continue;
      const kind = seeded(i, 15, 3);
      const scale = .64 + seeded(i, 2, 8) * .8;
      const object = { x, z, scale, hue: seeded(i, 18, 4), rot: seeded(i, 1, 9) * Math.PI * 2 };
      if (kind > .77) { trees.push(object); obstructions.push({ x, z, radius: .75 * scale }); }
      else if (kind > .60) { rocks.push(object); obstructions.push({ x, z, radius: .62 * scale }); }
      else if (kind > .40) bushes.push(object);
      else flowers.push(object);
    }

    const trunkGeometry = new THREE.CylinderGeometry(.19, .32, 2.9, 6, 1);
    addInstances(trunkGeometry, mats.bark, trees, (tree) => ({ x: tree.x, y: terrainHeight(tree.x, tree.z) + 1.43 * tree.scale, z: tree.z, sx: tree.scale, sy: tree.scale, sz: tree.scale, ry: tree.rot }), { shadows: true });
    const canopyGeometry = new THREE.IcosahedronGeometry(1.55, 1);
    const canopyMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .98, flatShading: true });
    const mainCanopy = addInstances(canopyGeometry, canopyMat, trees, (tree) => ({ x: tree.x, y: terrainHeight(tree.x, tree.z) + 3.25 * tree.scale, z: tree.z, sx: tree.scale, sy: 1.05 * tree.scale, sz: tree.scale, ry: tree.rot, color: ['#3f6748','#4e754d','#5e8151','#496a4c'][Math.floor(tree.hue * 4)] }), { shadows: true, colors: true });
    const clumpsA = trees.filter((_, index) => index % 3 !== 1);
    addInstances(canopyGeometry, canopyMat, clumpsA, (tree, i) => ({ x: tree.x + (i % 2 ? -.76 : .76) * tree.scale, y: terrainHeight(tree.x, tree.z) + 2.92 * tree.scale, z: tree.z + .28 * tree.scale, sx: .67 * tree.scale, sy: .72 * tree.scale, sz: .72 * tree.scale, color: ['#466c49','#57794e','#53734d'][i % 3] }), { shadows: true, colors: true });

    const rockGeometry = new THREE.DodecahedronGeometry(.78, 0);
    addInstances(rockGeometry, mat('#898875'), rocks, (rock) => ({ x: rock.x, y: terrainHeight(rock.x, rock.z) + .32 * rock.scale, z: rock.z, sx: 1.15 * rock.scale, sy: .75 * rock.scale, sz: .88 * rock.scale, rx: rock.rot * .4, ry: rock.rot }), { shadows: true });
    const bushGeometry = new THREE.IcosahedronGeometry(.72, 1);
    const bushMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 1 });
    addInstances(bushGeometry, bushMaterial, bushes, (bush) => ({ x: bush.x, y: terrainHeight(bush.x, bush.z) + .53 * bush.scale, z: bush.z, sx: 1.2 * bush.scale, sy: .78 * bush.scale, sz: bush.scale, ry: bush.rot, color: ['#597b50','#688453','#4e714b'][Math.floor(bush.hue * 3)] }), { shadows: true, colors: true });

    const flowerGeometry = new THREE.SphereGeometry(.105, 5, 4);
    const flowerMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#735c25', emissiveIntensity: .12, roughness: .6 });
    addInstances(flowerGeometry, flowerMaterial, flowers, (flower) => ({ x: flower.x, y: terrainHeight(flower.x, flower.z) + .12, z: flower.z, sx: .82 + flower.scale * .2, sy: 1, sz: 1, color: ['#f2d990','#eee6bb','#eab6a0','#d6c7e6'][Math.floor(flower.hue * 4)] }), { colors: true });

    for (let i = 0; i < 1350; i++) {
      const x = -WORLD_HALF + seeded(i, 24, 34) * WORLD_HALF * 2;
      const z = -WORLD_HALF + seeded(i, 25, 54) * WORLD_HALF * 2;
      if (isNearRoad(x, z, 3.4) || inWater(x, z, 2)) continue;
      grasses.push({ x, z, angle: seeded(i, 26, 9) * Math.PI, scale: .65 + seeded(i, 27, 6) * .85 });
    }
    const grassGeometry = new THREE.BufferGeometry();
    grassGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-.12,0,0, 0,.48,0, .12,0,0], 3));
    grassGeometry.setIndex([0,1,2]); grassGeometry.computeVertexNormals();
    addInstances(grassGeometry, new THREE.MeshStandardMaterial({ color: '#64884f', side: THREE.DoubleSide, roughness: 1 }), grasses, (blade) => ({ x: blade.x, y: terrainHeight(blade.x, blade.z), z: blade.z, sx: blade.scale, sy: blade.scale, sz: blade.scale, ry: blade.angle }));
  }

  function stoneBlock(x, z, width, height, depth, material = mats.stone, rotation = 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, terrainHeight(x, z) + height / 2, z);
    mesh.rotation.y = rotation; mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
    return mesh;
  }

  function buildRuins() {
    const ruins = [
      { x: -36, z: -5, a: -.25 }, { x: 54, z: 48, a: .44 }, { x: -89, z: -53, a: .1 },
    ];
    ruins.forEach((ruin, index) => {
      for (let i = 0; i < 4; i++) {
        const angle = i * Math.PI / 2 + ruin.a;
        const x = ruin.x + Math.cos(angle) * 2.8;
        const z = ruin.z + Math.sin(angle) * 2.8;
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(.33, .45, 2.1 + (i % 2) * .5, 6), mats.stoneDark);
        pillar.position.set(x, terrainHeight(x, z) + 1.05, z); pillar.rotation.z = i % 2 ? .04 : -.04;
        pillar.castShadow = true; pillar.receiveShadow = true; scene.add(pillar);
      }
      stoneBlock(ruin.x, ruin.z, 4.2, .34, 4.2, mats.stone);
      if (index === 1) {
        const broken = new THREE.Mesh(new THREE.BoxGeometry(4.6, .35, .55), mats.stoneDark);
        broken.position.set(ruin.x + 1, terrainHeight(ruin.x, ruin.z) + 2.1, ruin.z); broken.rotation.z = .24; broken.rotation.y = ruin.a; broken.castShadow = true; scene.add(broken);
      }
    });
  }

  function buildShrine() {
    const group = new THREE.Group();
    group.position.set(shrinePoint.x, terrainHeight(shrinePoint.x, shrinePoint.z), shrinePoint.z);
    scene.add(group);
    const add = (geometry, material, x, y, z, scale = [1,1,1], rotY = 0) => {
      const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x,y,z); mesh.scale.set(...scale); mesh.rotation.y = rotY;
      mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh;
    };
    add(new THREE.CylinderGeometry(8.8, 9.4, .7, 12), mats.stoneDark, 0, .35, 0);
    add(new THREE.CylinderGeometry(7.1, 8, .6, 12), mats.stone, 0, .96, 0);
    add(new THREE.CylinderGeometry(5.4, 6.5, .28, 12), mat('#a39a76'), 0, 1.38, 0);
    for (const x of [-4.2, 4.2]) for (const z of [-2.2, 2.2]) {
      add(new THREE.BoxGeometry(.72, 4.3, .72), mats.stoneDark, x, 3.58, z);
      add(new THREE.BoxGeometry(1.12, .38, 1.12), mats.stone, x, 5.86, z);
      add(new THREE.BoxGeometry(.9, .3, .9), mats.gold, x, 6.19, z);
    }
    add(new THREE.BoxGeometry(10.5, .75, 6.7), mats.stone, 0, 6.34, 0);
    add(new THREE.ConeGeometry(6.8, 2.7, 4), mats.stoneDark, 0, 8.0, 0, [1,1,1], Math.PI / 4);
    const gate = new THREE.Mesh(new THREE.TorusGeometry(1.7, .12, 8, 48), mat('#9f9873', .48, { emissive: '#c4a85e', emissiveIntensity: .1 }));
    gate.position.set(0, 3.55, -2.62); gate.castShadow = true; group.add(gate); shrineRing = gate;
    const doorway = add(new THREE.CircleGeometry(1.53, 32), new THREE.MeshBasicMaterial({ color: '#152b27' }), 0, 3.55, -2.58);
    doorway.material.side = THREE.DoubleSide;
    shrineGlow = new THREE.PointLight('#f3d47b', .3, 15, 2); shrineGlow.position.set(0, 3.7, -1.6); group.add(shrineGlow);
    add(new THREE.OctahedronGeometry(.62, 0), mats.gold, 0, 3.6, -2.4, [1, 1.55, .45]);
    const rune = new THREE.Mesh(new THREE.TorusGeometry(10, .045, 4, 100), mat('#dec77d', .6, { transparent: true, opacity: .35 }));
    rune.rotation.x = -Math.PI / 2; rune.position.y = .09; group.add(rune);
  }

  function buildRelics() {
    relicMeshes = []; relicLights = [];
    relics.forEach((relic, index) => {
      const group = new THREE.Group();
      group.position.set(relic.x, terrainHeight(relic.x, relic.z), relic.z);
      scene.add(group);
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(.74, .98, .58, 7), mats.stoneDark);
      plinth.position.y = .29; plinth.castShadow = true; plinth.receiveShadow = true; group.add(plinth);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(.78, .74, .15, 7), mats.gold);
      cap.position.y = .64; cap.castShadow = true; group.add(cap);
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(.64, 0), mats.crystal);
      crystal.position.y = 1.54; crystal.scale.set(.76, 1.3, .76); crystal.castShadow = true; group.add(crystal);
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(.22, 0), new THREE.MeshBasicMaterial({ color: '#fff5d1' }));
      core.position.y = 1.54; group.add(core);
      const halo = new THREE.Mesh(new THREE.TorusGeometry(1.08, .035, 5, 48), mat('#f0d27b', .35, { emissive: '#cfa63d', emissiveIntensity: .65, transparent: true, opacity: .82 }));
      halo.rotation.x = -Math.PI / 2; halo.position.y = .81; group.add(halo);
      const light = new THREE.PointLight('#ffe394', 5.1, 15, 2); light.position.y = 2.0; group.add(light);
      const label = makeSpriteLabel(`LOST LIGHT 0${index + 1}`);
      label.position.y = 3.0; label.scale.set(5.2, .85, 1); group.add(label);
      relicMeshes.push({ group, crystal, halo, core, relic, label }); relicLights.push(light);
    });
  }

  function makeSpriteLabel(text) {
    const labelCanvas = document.createElement('canvas'); labelCanvas.width = 512; labelCanvas.height = 96;
    const c = labelCanvas.getContext('2d');
    c.fillStyle = 'rgba(22, 38, 33, .68)'; c.beginPath(); c.roundRect(9, 12, 494, 72, 10); c.fill();
    c.strokeStyle = 'rgba(231, 210, 143, .55)'; c.lineWidth = 2; c.stroke();
    c.fillStyle = '#f0dc9b'; c.font = '500 29px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 256, 49);
    const texture = new THREE.CanvasTexture(labelCanvas); texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    return sprite;
  }

  function makeMesh(geometry, material, parent, x, y, z, cast = true) {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.castShadow = cast; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }

  function buildPlayer() {
    player = new THREE.Group();
    player.position.set(start.x, terrainHeight(start.x, start.z), start.z);
    player.name = 'wanderer'; scene.add(player);
    playerRig = { legs: [], arms: [], sword: null, cape: null, torso: null };
    const bootGeo = new THREE.CylinderGeometry(.19, .2, .27, 7);
    const legGeo = new THREE.CylinderGeometry(.17, .2, .68, 7);
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.position.set(side * .25, .9, 0); player.add(pivot);
      makeMesh(legGeo, mats.tunic, pivot, 0, -.28, 0);
      makeMesh(bootGeo, mats.boot, pivot, 0, -.69, -.07);
      playerRig.legs.push(pivot);
    }
    playerRig.torso = makeMesh(new THREE.CapsuleGeometry(.43, .8, 4, 8), mats.tunic, player, 0, 1.57, 0);
    const chest = makeMesh(new THREE.SphereGeometry(.44, 8, 6), mats.tunicLight, player, 0, 1.79, -.015);
    chest.scale.set(1.12, .82, .77);
    const belt = makeMesh(new THREE.CylinderGeometry(.44, .43, .16, 8), mats.leather, player, 0, 1.13, 0);
    belt.rotation.y = .18;
    const buckle = makeMesh(new THREE.BoxGeometry(.18, .15, .07), mats.gold, player, 0, 1.13, -.43, false);
    const cape = makeMesh(new THREE.ConeGeometry(.57, 1.1, 5), mats.cape, player, 0, 1.36, .32);
    cape.rotation.x = Math.PI; cape.rotation.y = .2; playerRig.cape = cape;
    makeMesh(new THREE.SphereGeometry(.38, 9, 7), mats.skin, player, 0, 2.48, 0);
    makeMesh(new THREE.SphereGeometry(.4, 8, 6), mats.hair, player, 0, 2.6, .16).scale.set(1.08, .72, .86);
    const cap = makeMesh(new THREE.ConeGeometry(.38, .74, 5), mats.tunic, player, 0, 3.02, .04);
    cap.rotation.z = -.13; cap.rotation.x = -.1;
    makeMesh(new THREE.SphereGeometry(.12, 6, 5), mats.tunicLight, player, -.08, 2.74, .42).scale.set(1, .45, 1.3);
    for (const side of [-1, 1]) {
      const eye = makeMesh(new THREE.SphereGeometry(.035, 5, 4), mat('#38463c'), player, side * .12, 2.5, -.35, false);
      eye.scale.set(1, .8, .5);
      const arm = new THREE.Group(); arm.position.set(side * .53, 2.02, -.01); player.add(arm);
      makeMesh(new THREE.CapsuleGeometry(.13, .55, 3, 6), mats.tunic, arm, 0, -.25, 0).rotation.z = side * -.1;
      makeMesh(new THREE.SphereGeometry(.15, 6, 5), mats.skin, arm, side * .02, -.59, -.05);
      playerRig.arms.push(arm);
    }
    const sword = new THREE.Group(); sword.position.set(.72, 1.43, -.25); sword.rotation.x = -.12; sword.rotation.z = -.1; player.add(sword);
    makeMesh(new THREE.BoxGeometry(.1, .78, .14), mat('#d5d7c4', .28, { metalness: .52 }), sword, 0, .49, -.02, false);
    makeMesh(new THREE.BoxGeometry(.13, .09, .3), mats.gold, sword, 0, .1, .04, false);
    makeMesh(new THREE.CylinderGeometry(.07, .07, .32, 6), mats.leather, sword, 0, -.09, .04, false);
    playerRig.sword = sword;
  }

  function createEnemyModel(position, index) {
    const group = new THREE.Group();
    group.position.set(position.x, terrainHeight(position.x, position.z), position.z);
    group.name = 'wild guardian'; scene.add(group);
    const torso = makeMesh(new THREE.CapsuleGeometry(.45, .68, 3, 7), mats.enemy, group, 0, 1.15, 0);
    torso.rotation.z = -.06;
    makeMesh(new THREE.SphereGeometry(.39, 7, 6), mats.enemyLight, group, 0, 1.84, -.02);
    const snout = makeMesh(new THREE.ConeGeometry(.19, .62, 5), mats.enemy, group, 0, 1.72, -.4);
    snout.rotation.x = Math.PI / 2;
    for (const side of [-1, 1]) {
      const horn = makeMesh(new THREE.ConeGeometry(.14, .53, 5), mats.gold, group, side * .31, 2.07, -.02);
      horn.rotation.z = side * -.42;
      makeMesh(new THREE.SphereGeometry(.07, 6, 4), mats.enemyEye, group, side * .16, 1.91, -.35, false);
    }
    const legs = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.position.set(side * .23, .75, 0); group.add(pivot);
      makeMesh(new THREE.CylinderGeometry(.12, .17, .64, 6), mats.enemy, pivot, 0, -.31, 0);
      legs.push(pivot);
    }
    const club = makeMesh(new THREE.CylinderGeometry(.13, .2, 1.2, 5), mats.leather, group, .7, 1.0, -.2);
    club.rotation.z = -.5;
    return { group, legs, club, torso, hp: 2, maxHp: 2, x: position.x, z: position.z, homeX: position.x, homeZ: position.z, speed: 2.8 + index % 2 * .25, phase: index * 1.73, alert: false, attackTimer: 0, flash: 0, bar: null };
  }

  function buildEnemies() {
    const positions = [
      { x: -61, z: 37 }, { x: 84, z: -17 }, { x: 73, z: 97 }, { x: -33, z: -28 }, { x: 42, z: 31 },
    ];
    positions.forEach((position, index) => enemies.push(createEnemyModel(position, index)));
  }

  function buildSkyDetails() {
    for (let i = 0; i < 7; i++) {
      const cloud = new THREE.Group();
      const x = -115 + i * 37; const z = -115 - (i % 3) * 22; const y = 35 + seeded(i, 2, 99) * 16;
      for (let j = 0; j < 4; j++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 6), new THREE.MeshBasicMaterial({ color: '#edf1e8', transparent: true, opacity: .34, depthWrite: false }));
        puff.position.set(j * 1.6, Math.sin(j * 2) * .35, (j % 2) * .6);
        puff.scale.set(3.8 + (j % 2), 1.2, 2.0); cloud.add(puff);
      }
      cloud.position.set(x, y, z); scene.add(cloud);
    }
  }

  function buildMap() {
    // A small parchment-like map is drawn in screen space; the playable world remains fully 3D.
    drawMinimap();
  }

  function worldToMap(x, z) {
    return [(x + WORLD_HALF) / (WORLD_HALF * 2) * mapCanvas.width, (z + WORLD_HALF) / (WORLD_HALF * 2) * mapCanvas.height];
  }

  function drawMinimap() {
    if (!mapCtx || !player) return;
    const w = mapCanvas.width; const h = mapCanvas.height;
    mapCtx.clearRect(0, 0, w, h);
    mapCtx.fillStyle = '#80966a'; mapCtx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) {
      const value = seeded(x, y, 72);
      mapCtx.fillStyle = value > .76 ? 'rgba(204,193,145,.23)' : 'rgba(54,78,52,.08)'; mapCtx.fillRect(x, y, 8, 8);
    }
    lakes.forEach((lake) => {
      const [x, y] = worldToMap(lake.x, lake.z);
      mapCtx.fillStyle = '#67928a'; mapCtx.beginPath(); mapCtx.ellipse(x, y, lake.rx / (WORLD_HALF * 2) * w, lake.rz / (WORLD_HALF * 2) * h, 0, 0, Math.PI * 2); mapCtx.fill();
    });
    mapCtx.beginPath();
    road.forEach((point, index) => { const [x, y] = worldToMap(point.x, point.z); if (index === 0) mapCtx.moveTo(x, y); else mapCtx.lineTo(x, y); });
    mapCtx.strokeStyle = 'rgba(230,217,174,.73)'; mapCtx.lineWidth = 3; mapCtx.stroke();
    const shrineMap = worldToMap(shrinePoint.x, shrinePoint.z);
    mapCtx.fillStyle = '#b8a66e'; mapCtx.beginPath(); mapCtx.arc(...shrineMap, 4.3, 0, Math.PI * 2); mapCtx.fill();
    relics.forEach((relic) => { if (!relic.found) { const [x, y] = worldToMap(relic.x, relic.z); mapCtx.fillStyle = '#f5d67f'; mapCtx.beginPath(); mapCtx.arc(x, y, 3, 0, Math.PI * 2); mapCtx.fill(); } });
    enemies.forEach((enemy) => { const [x, y] = worldToMap(enemy.x, enemy.z); mapCtx.fillStyle = '#c66a4f'; mapCtx.fillRect(x - 1.3, y - 1.3, 2.6, 2.6); });
    const [px, py] = worldToMap(player.position.x, player.position.z);
    mapCtx.fillStyle = '#fff2ce'; mapCtx.shadowColor = '#fff2ce'; mapCtx.shadowBlur = 7; mapCtx.beginPath(); mapCtx.arc(px, py, 3.3, 0, Math.PI * 2); mapCtx.fill(); mapCtx.shadowBlur = 0;
    $('#map-coords').textContent = `${Math.round(player.position.x)} · ${Math.round(player.position.z)}`;
  }

  function unlockAudio() {
    if (audio) { if (audio.context.state === 'suspended') audio.context.resume(); return; }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const master = context.createGain(); master.gain.value = .07; master.connect(context.destination);
    const low = context.createOscillator(); const high = context.createOscillator();
    const lowGain = context.createGain(); const highGain = context.createGain();
    low.type = 'sine'; high.type = 'triangle'; low.frequency.value = 110; high.frequency.value = 164.81;
    lowGain.gain.value = .2; highGain.gain.value = .028; low.connect(lowGain).connect(master); high.connect(highGain).connect(master);
    low.start(); high.start(); audio = { context, master };
  }

  function chime(frequency = 660, duration = .24, kind = 'sine', volume = .1) {
    if (!audio) return;
    const { context, master } = audio;
    const oscillator = context.createOscillator(); const gain = context.createGain();
    oscillator.type = kind; oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    gain.gain.setValueAtTime(volume, context.currentTime); gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + duration);
    oscillator.connect(gain).connect(master); oscillator.start(); oscillator.stop(context.currentTime + duration);
  }

  function showToast(message, duration = 2300) {
    ui.toast.textContent = message; ui.toast.classList.add('show'); ui.announcer.textContent = message;
    toastTimer = duration;
  }

  function setStarted() {
    try { unlockAudio(); audio?.context.resume(); } catch { /* Audio is optional. */ }
    running = true; paused = false; lastFrame = performance.now();
    ui.intro.hidden = true; ui.hud.hidden = false; ui.quest.hidden = false; ui.bottom.hidden = false;
    ui.map.hidden = !mapOpen; $('#mobile-controls').hidden = false;
    showToast('THE QUIET MEADOW  ·  A WORLD WAITS', 2600);
  }

  function resetGame() {
    player.position.set(start.x, terrainHeight(start.x, start.z), start.z);
    player.rotation.set(0, 0, 0); player.visible = true;
    relics.forEach((relic) => { relic.found = false; });
    relicMeshes.forEach((item) => { item.group.visible = true; });
    enemies.forEach((enemy) => scene.remove(enemy.group)); enemies.length = 0; buildEnemies();
    health = 5; stamina = 100; finished = false; paused = false; running = true;
    shrineRing.material.color.set('#9f9873'); shrineGlow.intensity = .3;
    ui.ending.hidden = true; ui.pause.hidden = true; ui.intro.hidden = true;
    ui.hud.hidden = false; ui.quest.hidden = false; ui.bottom.hidden = false; ui.map.hidden = !mapOpen;
    $('#mobile-controls').hidden = false;
    orbit.target.set(start.x, player.position.y + 1.35, start.z); orbit.update();
    updateQuestUi(); chime(440, .35, 'triangle', .08);
  }

  function setPaused(value) {
    if (!running || finished) return;
    paused = value; ui.pause.hidden = !paused; lastFrame = performance.now();
    if (audio) audio.master.gain.setTargetAtTime(paused ? .018 : .07, audio.context.currentTime, .1);
  }

  function updateQuestUi() {
    const found = relics.filter((relic) => relic.found).length;
    ui.count.textContent = `${found} / 3`;
    relics.forEach((relic, index) => $(`#relic-${index}`).classList.toggle('found', relic.found));
    if (found === 3) {
      ui.questCopy.textContent = 'The shrine is awake. Follow the old road back to its light.';
      $('#quest-title').textContent = 'Return to the Shrine';
    } else {
      ui.questCopy.textContent = found === 0 ? 'Find the three lost lights to awaken the ancient shrine.' : `${3 - found} lost light${found === 2 ? '' : 's'} still wait${found === 2 ? 's' : ''} beyond the old road.`;
      $('#quest-title').textContent = 'The Sleeping Shrine';
    }
  }

  function moveBlocked(x, z, radius = .56) {
    if (Math.max(Math.abs(x), Math.abs(z)) > 149 || inWater(x, z, radius * .8)) return true;
    for (const obstacle of obstructions) {
      if (Math.abs(x - obstacle.x) > 2.2 || Math.abs(z - obstacle.z) > 2.2) continue;
      if (Math.hypot(x - obstacle.x, z - obstacle.z) < obstacle.radius + radius) return true;
    }
    return false;
  }

  function moveOnGround(object, dx, dz, radius) {
    const x = object.position.x; const z = object.position.z;
    if (!moveBlocked(x + dx, z, radius)) object.position.x += dx;
    if (!moveBlocked(object.position.x, z + dz, radius)) object.position.z += dz;
    object.position.y = terrainHeight(object.position.x, object.position.z);
  }

  function getMoveInput() {
    const x = (held.has('d') || held.has('arrowright') || touchHeld.has('right') ? 1 : 0) - (held.has('a') || held.has('arrowleft') || touchHeld.has('left') ? 1 : 0);
    const y = (held.has('s') || held.has('arrowdown') || touchHeld.has('down') ? 1 : 0) - (held.has('w') || held.has('arrowup') || touchHeld.has('up') ? 1 : 0);
    return new THREE.Vector2(x, y).clampLength(0, 1);
  }

  function updatePlayer(dt) {
    const input = getMoveInput();
    const moving = input.lengthSq() > .001;
    const runningFast = (held.has('shift') || touchHeld.has('run')) && stamina > .5 && moving;
    stamina = THREE.MathUtils.clamp(stamina + dt * (moving ? 8 : 18), 0, 100);
    if (runningFast) stamina = Math.max(0, stamina - dt * 23);

    const forward = new THREE.Vector3(); camera.getWorldDirection(forward); forward.y = 0; forward.normalize();
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const direction = forward.multiplyScalar(-input.y).addScaledVector(right, input.x);
    if (moving) direction.normalize();
    const speed = runningFast ? 10.4 : 6.1;
    if (moving) {
      const slow = strikeCooldown > .38 ? .68 : 1;
      moveOnGround(player, direction.x * speed * slow * dt, direction.z * speed * slow * dt, .58);
      const targetAngle = Math.atan2(direction.x, -direction.z);
      player.rotation.y = dampAngle(player.rotation.y, targetAngle, 13, dt);
      const gait = gameSeconds * (runningFast ? 12 : 8.2);
      playerRig.legs.forEach((leg, index) => { leg.rotation.x = Math.sin(gait + index * Math.PI) * (runningFast ? .68 : .42); });
      playerRig.arms[0].rotation.x = Math.sin(gait + Math.PI) * .22;
      if (strikeCooldown < .35) playerRig.arms[1].rotation.x = Math.sin(gait) * .18;
      playerRig.cape.rotation.x = Math.PI + Math.sin(gait * .5) * .07;
    } else {
      playerRig.legs.forEach((leg) => { leg.rotation.x = THREE.MathUtils.damp(leg.rotation.x, 0, 10, dt); });
      playerRig.arms.forEach((arm) => { arm.rotation.x = THREE.MathUtils.damp(arm.rotation.x, 0, 8, dt); });
      player.position.y = terrainHeight(player.position.x, player.position.z);
    }

    if (strikeCooldown > .38) {
      const swing = (strikeCooldown - .38) / .28;
      playerRig.arms[1].rotation.x = -Math.sin(swing * Math.PI) * 1.7;
      playerRig.sword.rotation.z = -.1 - Math.sin(swing * Math.PI) * 1.15;
    } else {
      playerRig.sword.rotation.z = THREE.MathUtils.damp(playerRig.sword.rotation.z, -.1, 9, dt);
    }
    strikeCooldown = Math.max(0, strikeCooldown - dt);
    playerInvulnerable = Math.max(0, playerInvulnerable - dt);
    player.visible = !(playerInvulnerable > 0 && Math.floor(gameSeconds * 15) % 2 === 0);
  }

  function dampAngle(current, target, lambda, dt) {
    const delta = THREE.MathUtils.euclideanModulo(target - current + Math.PI, Math.PI * 2) - Math.PI;
    return current + delta * (1 - Math.exp(-lambda * dt));
  }

  function updateCamera(dt) {
    const desired = new THREE.Vector3(player.position.x, player.position.y + 1.34, player.position.z);
    orbit.target.lerp(desired, 1 - Math.exp(-6 * dt));
    screenShake = Math.max(0, screenShake - dt * 4);
    orbit.update();
  }

  function updateEnemies(dt) {
    const playerPoint = player.position;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const enemy = enemies[i];
      enemy.attackTimer = Math.max(0, enemy.attackTimer - dt);
      enemy.flash = Math.max(0, enemy.flash - dt);
      const dx = playerPoint.x - enemy.x; const dz = playerPoint.z - enemy.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 16) enemy.alert = true;
      if (enemy.alert && distance > 1.8) {
        const dirX = dx / Math.max(distance, .001); const dirZ = dz / Math.max(distance, .001);
        const factor = distance < 3.2 ? .28 : 1;
        const candidateX = enemy.x + dirX * enemy.speed * factor * dt;
        const candidateZ = enemy.z + dirZ * enemy.speed * factor * dt;
        if (!moveBlocked(candidateX, candidateZ, .5)) { enemy.x = candidateX; enemy.z = candidateZ; }
        enemy.group.rotation.y = Math.atan2(dirX, -dirZ);
      } else if (!enemy.alert) {
        const wander = gameSeconds * .32 + enemy.phase;
        const tx = enemy.homeX + Math.cos(wander) * 1.5;
        const tz = enemy.homeZ + Math.sin(wander * .7) * 1.1;
        const deltaX = tx - enemy.x; const deltaZ = tz - enemy.z; const length = Math.hypot(deltaX, deltaZ);
        if (length > .2 && !moveBlocked(enemy.x + deltaX / length * dt, enemy.z + deltaZ / length * dt, .45)) {
          enemy.x += deltaX / length * dt; enemy.z += deltaZ / length * dt;
        }
      }
      enemy.group.position.set(enemy.x, terrainHeight(enemy.x, enemy.z) + Math.sin(gameSeconds * 3 + enemy.phase) * .035, enemy.z);
      enemy.legs.forEach((leg, index) => { leg.rotation.x = enemy.alert ? Math.sin(gameSeconds * 11 + index * Math.PI) * .45 : Math.sin(gameSeconds * 2 + enemy.phase + index) * .08; });
      enemy.club.rotation.x = enemy.alert ? Math.sin(gameSeconds * 3 + enemy.phase) * .3 : .05;
      if (enemy.flash > 0) enemy.torso.material = mats.enemyLight;
      else enemy.torso.material = mats.enemy;
      if (distance < 2.05 && enemy.attackTimer <= 0 && playerInvulnerable <= 0) {
        enemy.attackTimer = 1.22; health -= 1; playerInvulnerable = 1.1; screenShake = .28;
        chime(145, .16, 'sawtooth', .13); showToast('A WANDERER STRIKES  ·  KEEP YOUR DISTANCE', 1700);
        if (health <= 0) recoverPlayer();
      }
      if (enemy.hp <= 0) {
        createBurst(enemy.x, terrainHeight(enemy.x, enemy.z) + 1.1, enemy.z, '#e5bd78', 17);
        scene.remove(enemy.group); enemies.splice(i, 1); chime(326, .18, 'triangle', .075);
      }
    }
  }

  function recoverPlayer() {
    health = 5; stamina = 100; player.position.set(start.x, terrainHeight(start.x, start.z), start.z); playerInvulnerable = 1.7;
    orbit.target.set(start.x, player.position.y + 1.3, start.z); orbit.update();
    showToast('YOU CATCH YOUR BREATH BACK AT THE MEADOW', 2600);
  }

  function strike() {
    if (!running || paused || finished || strikeCooldown > 0) return;
    strikeCooldown = .72; playerRig.arms[1].rotation.x = -1.65;
    chime(245, .12, 'triangle', .055);
    const facing = new THREE.Vector3(Math.sin(player.rotation.y), 0, -Math.cos(player.rotation.y));
    let hit = false;
    enemies.forEach((enemy) => {
      const to = new THREE.Vector3(enemy.x - player.position.x, 0, enemy.z - player.position.z);
      const distance = to.length();
      if (distance < 3.2 && (distance < .01 || to.normalize().dot(facing) > -.05)) {
        enemy.hp -= 1; enemy.flash = .18; enemy.alert = true; hit = true;
        createBurst(enemy.x, terrainHeight(enemy.x, enemy.z) + 1.45, enemy.z, '#f0d49b', 8);
      }
    });
    if (hit) { chime(410, .13, 'square', .04); screenShake = .12; }
    createSlashArc(facing);
  }

  function createSlashArc(facing) {
    if (slashArc) { scene.remove(slashArc); slashArc.geometry.dispose(); slashArc.material.dispose(); }
    const curve = new THREE.EllipseCurve(0, 0, 1.8, 1.15, -.82, .82, false, 0);
    const points = curve.getPoints(22).map((p) => new THREE.Vector3(p.x, 0, p.y));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: '#fff1c7', transparent: true, opacity: .92 });
    slashArc = new THREE.Line(geometry, material);
    slashArc.position.set(player.position.x + facing.x * 1.1, player.position.y + 1.36, player.position.z + facing.z * 1.1);
    slashArc.rotation.y = player.rotation.y; slashArc.userData.life = .2; scene.add(slashArc);
  }

  function createBurst(x, y, z, color, count) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3); const velocities = [];
    for (let i = 0; i < count; i++) {
      positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
      const direction = new THREE.Vector3(Math.random() - .5, Math.random(), Math.random() - .5).normalize().multiplyScalar(1.2 + Math.random() * 2.2);
      velocities.push(direction);
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color, size: .12, transparent: true, opacity: 1, depthWrite: false, sizeAttenuation: true });
    const points = new THREE.Points(geometry, material); scene.add(points);
    particles.push({ points, velocities, life: .8, maxLife: .8 });
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const particle = particles[i]; particle.life -= dt;
      const positions = particle.points.geometry.attributes.position.array;
      for (let j = 0; j < particle.velocities.length; j++) {
        const velocity = particle.velocities[j];
        positions[j * 3] += velocity.x * dt; positions[j * 3 + 1] += velocity.y * dt; positions[j * 3 + 2] += velocity.z * dt;
        velocity.y -= 2.1 * dt; velocity.multiplyScalar(.99);
      }
      particle.points.geometry.attributes.position.needsUpdate = true;
      particle.points.material.opacity = Math.max(0, particle.life / particle.maxLife);
      if (particle.life <= 0) { scene.remove(particle.points); particle.points.geometry.dispose(); particle.points.material.dispose(); particles.splice(i, 1); }
    }
    if (slashArc) {
      slashArc.userData.life -= dt; slashArc.material.opacity = THREE.MathUtils.clamp(slashArc.userData.life / .2, 0, 1);
      if (slashArc.userData.life <= 0) { scene.remove(slashArc); slashArc.geometry.dispose(); slashArc.material.dispose(); slashArc = null; }
    }
  }

  function updateInteraction() {
    interaction = null;
    for (const relic of relics) {
      if (!relic.found && Math.hypot(relic.x - player.position.x, relic.z - player.position.z) < 2.8) { interaction = { type: 'relic', relic }; break; }
    }
    if (!interaction && Math.hypot(shrinePoint.x - player.position.x, shrinePoint.z - player.position.z) < 7.2) interaction = { type: 'shrine' };
    ui.prompt.hidden = !interaction;
    if (interaction) ui.promptCopy.textContent = interaction.type === 'relic' ? `Gather ${interaction.relic.title}` : relics.every((relic) => relic.found) ? 'Enter the awakened shrine' : 'The shrine is still sleeping';
  }

  function interact() {
    if (!interaction) return;
    if (interaction.type === 'relic') {
      const relic = interaction.relic;
      if (relic.found) return;
      relic.found = true;
      const item = relicMeshes.find((candidate) => candidate.relic === relic);
      if (item) item.group.visible = false;
      createBurst(relic.x, terrainHeight(relic.x, relic.z) + 1.5, relic.z, '#ffe9a7', 38);
      [784, 988].forEach((note, index) => setTimeout(() => chime(note, .42, 'sine', .12), index * 130));
      flashScreen(); updateQuestUi(); showToast(`${relic.title.toUpperCase()}  ·  LIGHT RESTORED`, 2400);
      if (relics.every((entry) => entry.found)) showToast('ALL THREE LIGHTS ANSWER  ·  RETURN TO THE SHRINE', 3400);
      return;
    }
    if (!relics.every((relic) => relic.found)) { showToast('THREE LOST LIGHTS ARE NEEDED TO WAKE THE SHRINE', 2400); chime(190, .3, 'triangle', .055); return; }
    finished = true; shrineGlow.intensity = 6.7; shrineRing.material.color.set('#f4d27c');
    shrineRing.material.emissive = new THREE.Color('#bf983f'); shrineRing.material.emissiveIntensity = 1.2;
    createBurst(shrinePoint.x, terrainHeight(shrinePoint.x, shrinePoint.z) + 4, shrinePoint.z, '#ffe6a0', 84);
    [523.25, 659.25, 783.99, 1046.5].forEach((note, index) => setTimeout(() => chime(note, .7, 'sine', .11), index * 165));
    flashScreen(); setTimeout(() => { ui.ending.hidden = false; }, 1050);
  }

  function updateRelics(dt) {
    relicMeshes.forEach((item, index) => {
      if (!item.group.visible) return;
      item.crystal.rotation.y += .7 * dt;
      item.crystal.position.y = 1.53 + Math.sin(gameSeconds * 1.7 + index) * .18;
      item.core.position.y = item.crystal.position.y;
      item.halo.rotation.z += .23 * dt;
      item.group.position.y = terrainHeight(item.relic.x, item.relic.z);
      item.label.quaternion.copy(camera.quaternion);
      relicLights[index].intensity = 4.6 + Math.sin(gameSeconds * 2 + index) * .65;
    });
    shrineGlow.intensity = relics.every((relic) => relic.found) ? 1.8 + Math.sin(gameSeconds * 2.2) * .3 : .3;
  }

  function updateTime(dt) {
    worldMinutes = (worldMinutes + dt * .75) % 1440;
    const hour = Math.floor(worldMinutes / 60); const minute = Math.floor(worldMinutes % 60);
    $('#time-label').textContent = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    const phase = (worldMinutes / 1440) * Math.PI * 2;
    const daylight = .45 + .55 * Math.max(0, Math.sin(phase - .5));
    sunLight.intensity = .9 + daylight * 1.7; skyLight.intensity = .65 + daylight * .95;
    const warmth = new THREE.Color('#f8c882').lerp(new THREE.Color('#fff5da'), daylight);
    sunLight.color.copy(warmth);
    const darkness = THREE.MathUtils.clamp(1 - daylight, 0, .65);
    scene.fog.color.setRGB(.75 - darkness * .28, .84 - darkness * .31, .84 - darkness * .21);
    scene.background.copy(scene.fog.color);
  }

  function updateHud(dt) {
    stamina = THREE.MathUtils.clamp(stamina, 0, 100);
    ui.stamina.style.width = `${stamina}%`;
    [...ui.hearts.children].forEach((heart, index) => heart.classList.toggle('empty', index >= health));
    const target = relics.find((relic) => !relic.found) || shrinePoint;
    const distance = Math.round(Math.hypot(target.x - player.position.x, target.z - player.position.z));
    ui.objective.textContent = relics.every((relic) => relic.found) ? `SHRINE  ·  ${distance} m` : `NEAREST LIGHT  ·  ${distance} m`;
    const regions = [
      { x: -112, z: 67, radius: 40, name: 'The Quiet Meadow' },
      { x: 0, z: 0, radius: 30, name: 'The Old Shrine Road' },
      { x: 91, z: -11, radius: 31, name: 'Windward Rise' },
      { x: 78, z: 103, radius: 34, name: 'Far Lantern Fields' },
    ];
    const region = regions.find((area) => Math.hypot(player.position.x - area.x, player.position.z - area.z) < area.radius);
    $('#location-name').textContent = region?.name || 'The Wide Green';
    toastTimer = Math.max(0, toastTimer - dt * 1000); if (toastTimer === 0) ui.toast.classList.remove('show');
    flashTimer = Math.max(0, flashTimer - dt); ui.flash.classList.toggle('active', flashTimer > 0);
  }

  function flashScreen() { flashTimer = .24; }

  function animate(now) {
    requestAnimationFrame(animate);
    const dt = Math.min(.035, Math.max(0, (now - lastFrame) / 1000)); lastFrame = now;
    if (running && !paused && !finished) {
      gameSeconds += dt; updatePlayer(dt); updateEnemies(dt); updateInteraction(); updateRelics(dt); updateTime(dt); updateHud(dt);
      if (Math.floor(gameSeconds * 3) !== Math.floor((gameSeconds - dt) * 3)) drawMinimap();
      updateCamera(dt); updateParticles(dt);
    } else {
      updateRelics(dt); updateParticles(dt);
      relicMeshes.forEach((item) => { item.label.quaternion.copy(camera.quaternion); });
      orbit.update();
    }
    renderer.render(scene, camera);
  }

  function keydown(event) {
    const key = event.key.toLowerCase();
    if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(key)) event.preventDefault();
    if (key === 'escape') { setPaused(!paused); return; }
    if (key === 'm' && running && !paused) { mapOpen = !mapOpen; ui.map.hidden = !mapOpen || innerWidth <= 760; showToast(mapOpen ? 'FIELD MAP OPEN' : 'FIELD MAP CLOSED', 900); return; }
    held.add(key);
    if (key === ' ' && !event.repeat) strike();
    if ((key === 'e' || key === 'enter') && !event.repeat) interact();
  }

  function keyup(event) { held.delete(event.key.toLowerCase()); }

  function bindTouchControls() {
    document.querySelectorAll('[data-move]').forEach((button) => {
      const direction = button.dataset.move;
      const startTouch = (event) => { event.preventDefault(); touchHeld.add(direction); button.setPointerCapture?.(event.pointerId); };
      const stopTouch = (event) => { event.preventDefault(); touchHeld.delete(direction); };
      button.addEventListener('pointerdown', startTouch); button.addEventListener('pointerup', stopTouch);
      button.addEventListener('pointercancel', stopTouch); button.addEventListener('lostpointercapture', stopTouch);
    });
    $('#mobile-attack').addEventListener('pointerdown', (event) => { event.preventDefault(); strike(); });
    $('#mobile-use').addEventListener('pointerdown', (event) => { event.preventDefault(); interact(); });
    const runButton = $('#mobile-run');
    const runStart = (event) => { event.preventDefault(); touchHeld.add('run'); runButton.setPointerCapture?.(event.pointerId); };
    const runStop = (event) => { event.preventDefault(); touchHeld.delete('run'); };
    runButton.addEventListener('pointerdown', runStart); runButton.addEventListener('pointerup', runStop);
    runButton.addEventListener('pointercancel', runStop); runButton.addEventListener('lostpointercapture', runStop);

    canvas.addEventListener('pointerdown', (event) => { mouseDown = { x: event.clientX, y: event.clientY, button: event.button, type: event.pointerType }; });
    canvas.addEventListener('pointerup', (event) => {
      if (!mouseDown || !running || paused || finished || event.button !== 0) { mouseDown = null; return; }
      const distance = Math.hypot(event.clientX - mouseDown.x, event.clientY - mouseDown.y);
      if (distance < 6 && mouseDown.button === 0) strike();
      mouseDown = null;
    });
    canvas.addEventListener('pointercancel', () => { mouseDown = null; });
  }

  $('#start-button').addEventListener('click', setStarted);
  $('#resume-button').addEventListener('click', () => setPaused(false));
  $('#again-button').addEventListener('click', resetGame);
  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  window.addEventListener('blur', () => { held.clear(); touchHeld.clear(); });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75)); renderer.setSize(window.innerWidth, window.innerHeight, false);
    ui.map.hidden = !mapOpen || innerWidth <= 760;
  });

  try {
    setupRenderer(); setupScene(); bindTouchControls();
    if (innerWidth <= 760) ui.map.hidden = true;
    updateQuestUi(); drawMinimap(); requestAnimationFrame(animate);
  } catch (error) {
    console.error('Unable to initialize the 3D world:', error);
    const copy = $('.intro-copy');
    copy.textContent = 'This 3D adventure needs a browser with WebGL enabled. Try a current desktop browser or enable hardware acceleration.';
    $('#start-button').disabled = true;
    $('#start-button').style.opacity = '.45';
  }
})();
