(() => {
  'use strict';

  const canvas = document.querySelector('#world');
  const ctx = canvas.getContext('2d');
  const minimap = document.querySelector('#minimap');
  const mapCtx = minimap.getContext('2d');
  const $ = (selector) => document.querySelector(selector);
  const world = { width: 4096, height: 3072, tile: 42 };
  const colors = {
    grass: ['#879d68', '#8ba16b', '#849a64', '#8da36d', '#879d66'],
    ground: '#b19f73', pathEdge: '#8d805e', path: '#baa982', water: '#638e85', deepWater: '#497970',
  };
  const relics = [
    { x: 926, y: 736, title: 'The Meadow Light', found: false },
    { x: 2945, y: 735, title: 'The Windward Light', found: false },
    { x: 3014, y: 2354, title: 'The Last Light', found: false },
  ];
  const shrine = { x: 2050, y: 1534, radius: 78, awake: false };
  const startPoint = { x: 480, y: 465 };
  const lakes = [
    { x: 1600, y: 400, rx: 210, ry: 122 },
    { x: 3520, y: 1560, rx: 254, ry: 190 },
    { x: 1170, y: 2250, rx: 190, ry: 138 },
  ];
  const obstacles = [];
  const decorations = [];
  const enemies = [];
  const pathPoints = [
    { x: 450, y: 430 }, { x: 700, y: 630 }, { x: 940, y: 820 }, { x: 1290, y: 890 },
    { x: 1510, y: 1190 }, { x: 1810, y: 1340 }, { x: 2060, y: 1500 }, { x: 2350, y: 1630 },
    { x: 2650, y: 1940 }, { x: 2890, y: 2260 }, { x: 3100, y: 2460 },
  ];

  const ui = {
    hud: $('#hud'), quest: $('#quest-card'), map: $('#map-card'), bottom: $('#bottom-hud'),
    intro: $('#intro-overlay'), pause: $('#pause-overlay'), ending: $('#ending-overlay'),
    toast: $('#toast'), prompt: $('#interaction-prompt'), promptCopy: $('#interaction-copy'),
    count: $('#relic-count'), questCopy: $('#quest-copy'), objective: $('#objective-distance'),
    stamina: $('#stamina-fill'), hearts: $('#hearts'), flash: $('#flash'), announcer: $('#announcer'),
  };

  let screen = { width: innerWidth, height: innerHeight, dpr: 1 };
  let camera = { x: startPoint.x, y: startPoint.y };
  let player = makePlayer();
  let keys = new Set();
  let touchKeys = new Set();
  let effects = [];
  let particles = [];
  let running = false;
  let paused = false;
  let finished = false;
  let lastFrame = performance.now();
  let elapsed = 0;
  let worldTime = 8 * 60 + 40;
  let attackCooldown = 0;
  let toastTimeout = null;
  let audio = null;
  let mapOpen = true;
  let screenShake = 0;

  function makePlayer() {
    return { x: startPoint.x, y: startPoint.y, vx: 0, vy: 0, facingX: 1, facingY: 0, speed: 188, stamina: 100, health: 5, attack: 0, invulnerable: 0, stride: 0 };
  }

  function seeded(x, y, salt = 0) {
    const n = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453123;
    return n - Math.floor(n);
  }

  function inPath(x, y, margin = 1) {
    for (let i = 0; i < pathPoints.length - 1; i++) {
      const a = pathPoints[i];
      const b = pathPoints[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
      const d = Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
      if (d < 43 * margin) return true;
    }
    return false;
  }

  function inLake(x, y, extra = 0) {
    return lakes.some((lake) => ((x - lake.x) / (lake.rx + extra)) ** 2 + ((y - lake.y) / (lake.ry + extra)) ** 2 < 1);
  }

  function buildWorld() {
    // Deterministic foliage gives the map a lived-in feel while keeping every visit reproducible.
    for (let i = 0; i < 520; i++) {
      const x = 80 + seeded(i, 3, 1) * (world.width - 160);
      const y = 90 + seeded(i, 9, 2) * (world.height - 180);
      if (inPath(x, y, 1.65) || inLake(x, y, 40) || Math.hypot(x - shrine.x, y - shrine.y) < 150) continue;
      const n = seeded(i, 15, 3);
      const type = n > 0.78 ? 'tree' : n > 0.47 ? 'bush' : n > 0.18 ? 'rock' : 'flowers';
      const size = type === 'tree' ? 19 + seeded(i, 4, 8) * 11 : type === 'rock' ? 8 + seeded(i, 8, 8) * 10 : 7 + seeded(i, 2, 8) * 8;
      const object = { x, y, type, size, variant: seeded(i, 18, 4), phase: seeded(i, 1, 9) * Math.PI * 2 };
      decorations.push(object);
      if (type === 'tree' || type === 'rock') obstacles.push({ x, y, radius: type === 'tree' ? size * .48 : size * .68, type });
    }
    // Small ruins and glimmering fireflies make the central trail read from a distance.
    for (let i = 0; i < 76; i++) {
      const t = seeded(i, 7, 17);
      const p = pathPoints[Math.floor(t * (pathPoints.length - 1))];
      const offset = (seeded(i, 12, 31) - .5) * 160;
      const offsetY = (seeded(i, 13, 31) - .5) * 120;
      const x = p.x + offset;
      const y = p.y + offsetY;
      if (inLake(x, y, 0)) continue;
      decorations.push({ x, y, type: seeded(i, 4, 19) > .4 ? 'flowers' : 'rock', size: 5 + seeded(i, 1, 18) * 7, variant: seeded(i, 6, 12), phase: seeded(i, 4, 11) * 6.28 });
    }
    const enemySpots = [
      { x: 1058, y: 783 }, { x: 2796, y: 814 }, { x: 3074, y: 2240 },
      { x: 1770, y: 900 }, { x: 2460, y: 1814 },
    ];
    enemySpots.forEach((point, i) => enemies.push({
      x: point.x, y: point.y, homeX: point.x, homeY: point.y, hp: 2, maxHp: 2,
      radius: 15, speed: 66 + (i % 2) * 8, phase: seeded(i, 5, 42) * 6.28,
      alert: false, attackTimer: 0, wander: seeded(i, 11, 12) * 6.28, flash: 0,
    }));
  }

  function resize() {
    screen = { width: innerWidth, height: innerHeight, dpr: Math.min(devicePixelRatio || 1, 2) };
    canvas.width = Math.round(screen.width * screen.dpr);
    canvas.height = Math.round(screen.height * screen.dpr);
    canvas.style.width = `${screen.width}px`;
    canvas.style.height = `${screen.height}px`;
    ctx.setTransform(screen.dpr, 0, 0, screen.dpr, 0, 0);
  }

  function showToast(message, duration = 2300) {
    ui.toast.textContent = message;
    ui.toast.classList.add('show');
    ui.announcer.textContent = message;
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => ui.toast.classList.remove('show'), duration);
  }

  function unlockAudio() {
    if (audio) { if (audio.context.state === 'suspended') audio.context.resume(); return; }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = .075;
    master.connect(context.destination);
    const low = context.createOscillator();
    const high = context.createOscillator();
    const lowGain = context.createGain();
    const highGain = context.createGain();
    low.type = 'sine'; high.type = 'triangle';
    low.frequency.value = 110; high.frequency.value = 164.81;
    lowGain.gain.value = .21; highGain.gain.value = .035;
    low.connect(lowGain).connect(master); high.connect(highGain).connect(master);
    low.start(); high.start();
    audio = { context, master, low, high };
  }

  function chime(frequency = 660, duration = .24, kind = 'sine', volume = .12) {
    if (!audio) return;
    const { context, master } = audio;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = kind;
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    gain.gain.setValueAtTime(volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + duration);
    oscillator.connect(gain).connect(master);
    oscillator.start(); oscillator.stop(context.currentTime + duration);
  }

  function setStarted() {
    unlockAudio();
    if (audio) audio.context.resume();
    running = true; paused = false;
    ui.intro.hidden = true; ui.pause.hidden = true;
    ui.hud.hidden = false; ui.quest.hidden = false; ui.map.hidden = !mapOpen; ui.bottom.hidden = false;
    $('#mobile-controls').hidden = false;
    lastFrame = performance.now();
    showToast('THE QUIET MEADOW  ·  A WORLD WAITS', 3000);
  }

  function resetGame() {
    player = makePlayer();
    relics.forEach((relic) => { relic.found = false; });
    decorations.length = 0;
    obstacles.length = 0;
    enemies.splice(0, enemies.length);
    buildWorld();
    shrine.awake = false;
    effects = []; particles = [];
    finished = false; paused = false; running = true;
    ui.ending.hidden = true;
    ui.intro.hidden = true;
    ui.pause.hidden = true;
    ui.hud.hidden = false; ui.quest.hidden = false; ui.map.hidden = !mapOpen; ui.bottom.hidden = false;
    $('#mobile-controls').hidden = false;
    updateQuestUi();
    chime(440, .35, 'triangle', .08);
  }

  function setPaused(value) {
    if (!running || finished) return;
    paused = value;
    ui.pause.hidden = !paused;
    if (audio) {
      const gain = paused ? .018 : .075;
      audio.master.gain.setTargetAtTime(gain, audio.context.currentTime, .1);
    }
    lastFrame = performance.now();
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

  function cameraPoint() {
    return { x: screen.width / 2 - camera.x, y: screen.height / 2 - camera.y };
  }

  function pathAt(x, y) {
    for (let i = 0; i < pathPoints.length - 1; i++) {
      const a = pathPoints[i]; const b = pathPoints[i + 1];
      const t = Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2)));
      if (Math.hypot(x - a.x - (b.x - a.x) * t, y - a.y - (b.y - a.y) * t) < 35) return true;
    }
    return false;
  }

  function isBlocked(x, y, radius = 12) {
    if (x < 28 || y < 28 || x > world.width - 28 || y > world.height - 28 || inLake(x, y, radius + 2)) return true;
    for (const obstacle of obstacles) {
      if (Math.abs(obstacle.x - x) > 55 || Math.abs(obstacle.y - y) > 55) continue;
      if (Math.hypot(obstacle.x - x, obstacle.y - y) < obstacle.radius + radius) return true;
    }
    return false;
  }

  function moveEntity(entity, dx, dy, radius) {
    const nextX = entity.x + dx;
    if (!isBlocked(nextX, entity.y, radius)) entity.x = nextX;
    const nextY = entity.y + dy;
    if (!isBlocked(entity.x, nextY, radius)) entity.y = nextY;
  }

  function update(dt) {
    elapsed += dt;
    worldTime = (worldTime + dt * 1.4) % (24 * 60);
    attackCooldown = Math.max(0, attackCooldown - dt);
    player.attack = Math.max(0, player.attack - dt);
    player.invulnerable = Math.max(0, player.invulnerable - dt);
    player.stamina = Math.min(100, player.stamina + dt * (isMoving() ? 9 : 18));
    screenShake = Math.max(0, screenShake - dt * 16);

    let dx = (keys.has('d') || keys.has('arrowright') || touchKeys.has('right') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') || touchKeys.has('left') ? 1 : 0);
    let dy = (keys.has('s') || keys.has('arrowdown') || touchKeys.has('down') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') || touchKeys.has('up') ? 1 : 0);
    const magnitude = Math.hypot(dx, dy);
    if (magnitude > 0) { dx /= magnitude; dy /= magnitude; player.facingX = dx; player.facingY = dy; }
    const wantsRun = (keys.has('shift') || touchKeys.has('run')) && player.stamina > 1 && magnitude > 0;
    const speed = player.speed * (wantsRun ? 1.68 : 1) * (player.attack > 0 ? .74 : 1);
    if (wantsRun) player.stamina = Math.max(0, player.stamina - dt * 25);
    if (magnitude > 0) {
      player.stride += dt * (wantsRun ? 13 : 8);
      moveEntity(player, dx * speed * dt, dy * speed * dt, 12);
    }

    updateEnemies(dt);
    updateParticles(dt);
    updateEffects(dt);
    updateInteraction();
    camera.x += (player.x - camera.x) * Math.min(1, dt * 5.3);
    camera.y += (player.y - camera.y) * Math.min(1, dt * 5.3);
    if (elapsed % .15 < dt) drawMinimap();
    updateHud();
  }

  function isMoving() { return ['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].some((key) => keys.has(key) || touchKeys.has(key)); }

  function updateEnemies(dt) {
    for (let i = enemies.length - 1; i >= 0; i--) {
      const enemy = enemies[i];
      enemy.flash = Math.max(0, enemy.flash - dt);
      enemy.attackTimer = Math.max(0, enemy.attackTimer - dt);
      const distance = Math.hypot(player.x - enemy.x, player.y - enemy.y);
      if (distance < 245) enemy.alert = true;
      if (enemy.alert && distance > 30) {
        const dx = (player.x - enemy.x) / distance; const dy = (player.y - enemy.y) / distance;
        const factor = distance < 76 ? .35 : 1;
        moveEntity(enemy, dx * enemy.speed * factor * dt, dy * enemy.speed * factor * dt, enemy.radius);
      } else if (!enemy.alert) {
        enemy.wander += dt * .42;
        const targetX = enemy.homeX + Math.cos(enemy.wander) * 35;
        const targetY = enemy.homeY + Math.sin(enemy.wander * .8) * 23;
        const dist = Math.hypot(targetX - enemy.x, targetY - enemy.y);
        if (dist > 2) moveEntity(enemy, (targetX - enemy.x) / dist * 17 * dt, (targetY - enemy.y) / dist * 17 * dt, enemy.radius);
      }
      if (distance < 37 && enemy.attackTimer <= 0 && player.invulnerable <= 0) {
        enemy.attackTimer = 1.15;
        player.health -= 1;
        player.invulnerable = 1.05;
        screenShake = 7;
        chime(138, .17, 'sawtooth', .15);
        showToast('A WANDERER STRIKES  ·  KEEP YOUR DISTANCE', 1500);
        if (player.health <= 0) recoverPlayer();
      }
      if (enemy.hp <= 0) {
        burst(enemy.x, enemy.y, '#d6a362', 14, 1.1);
        enemies.splice(i, 1);
        chime(310, .17, 'triangle', .08);
      }
    }
  }

  function recoverPlayer() {
    player.x = startPoint.x; player.y = startPoint.y; player.health = 5; player.stamina = 100; player.invulnerable = 1.4;
    showToast('YOU CATCH YOUR BREATH BACK AT THE MEADOW', 2600);
  }

  function updateInteraction() {
    let nearby = null;
    for (const relic of relics) {
      if (!relic.found && Math.hypot(relic.x - player.x, relic.y - player.y) < 65) { nearby = { type: 'relic', item: relic }; break; }
    }
    if (!nearby && Math.hypot(shrine.x - player.x, shrine.y - player.y) < 100) nearby = { type: 'shrine' };
    if (nearby) {
      ui.prompt.hidden = false;
      ui.promptCopy.textContent = nearby.type === 'relic' ? `Gather ${nearby.item.title}` : shrine.awake ? 'Enter the awakened shrine' : 'The shrine is still sleeping';
      window.nearbyAction = nearby;
    } else {
      ui.prompt.hidden = true;
      window.nearbyAction = null;
    }
  }

  function interact() {
    const action = window.nearbyAction;
    if (!action) return;
    if (action.type === 'relic') {
      if (action.item.found) return;
      action.item.found = true;
      burst(action.item.x, action.item.y, '#ffe38b', 38, 1.7);
      chime(784, .45, 'sine', .14); setTimeout(() => chime(988, .55, 'sine', .09), 105);
      flash();
      updateQuestUi();
      showToast(`${action.item.title.toUpperCase()}  ·  LIGHT RESTORED`, 2600);
      if (relics.every((relic) => relic.found)) showToast('ALL THREE LIGHTS ANSWER  ·  RETURN TO THE SHRINE', 3500);
      return;
    }
    if (action.type === 'shrine') {
      if (!relics.every((relic) => relic.found)) { showToast('THREE LOST LIGHTS ARE NEEDED TO WAKE THE SHRINE', 2300); chime(190, .3, 'triangle', .06); return; }
      shrine.awake = true;
      finished = true;
      burst(shrine.x, shrine.y, '#fbe28e', 70, 2.5);
      [523.25, 659.25, 783.99, 1046.5].forEach((note, i) => setTimeout(() => chime(note, .75, 'sine', .12), i * 155));
      flash();
      setTimeout(() => { ui.ending.hidden = false; }, 1050);
    }
  }

  function strike() {
    if (!running || paused || finished || attackCooldown > 0) return;
    attackCooldown = .48; player.attack = .28;
    chime(236, .11, 'triangle', .06);
    const fx = player.facingX; const fy = player.facingY;
    const originX = player.x + fx * 23; const originY = player.y + fy * 23;
    effects.push({ type: 'slash', x: originX, y: originY, life: .22, maxLife: .22, angle: Math.atan2(fy, fx) });
    let hit = false;
    enemies.forEach((enemy) => {
      const ex = enemy.x - player.x; const ey = enemy.y - player.y;
      const distance = Math.hypot(ex, ey);
      const dot = distance ? (ex * fx + ey * fy) / distance : 1;
      if (distance < 87 && dot > -.05) { enemy.hp -= 1; enemy.flash = .18; enemy.alert = true; hit = true; burst(enemy.x, enemy.y, '#f4d293', 7, .8); }
    });
    if (hit) { chime(390, .12, 'square', .04); screenShake = 2.5; }
  }

  function burst(x, y, color, amount, force) {
    for (let i = 0; i < amount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (22 + Math.random() * 75) * force;
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: .45 + Math.random() * .8, maxLife: .45 + Math.random() * .8, radius: 1 + Math.random() * 3, color, gravity: -.17 });
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.pow(.94, dt * 60); p.vy *= Math.pow(.94, dt * 60);
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function updateEffects(dt) {
    for (let i = effects.length - 1; i >= 0; i--) { effects[i].life -= dt; if (effects[i].life <= 0) effects.splice(i, 1); }
  }

  function flash() { ui.flash.classList.remove('active'); void ui.flash.offsetWidth; ui.flash.classList.add('active'); }

  function updateHud() {
    ui.stamina.style.width = `${player.stamina}%`;
    [...ui.hearts.children].forEach((heart, index) => heart.classList.toggle('empty', index >= player.health));
    const target = relics.find((relic) => !relic.found) || shrine;
    const distance = Math.round(Math.hypot(target.x - player.x, target.y - player.y) / 10) / 100;
    ui.objective.textContent = relics.every((relic) => relic.found) ? `SHRINE  ·  ${distance.toFixed(2)} km` : `NEAREST LIGHT  ·  ${distance.toFixed(2)} km`;
    const minute = Math.floor(worldTime) % 60; const hour = Math.floor(worldTime / 60);
    $('#time-label').textContent = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    const regions = [
      { x: 480, y: 450, r: 500, name: 'The Quiet Meadow' },
      { x: 2050, y: 1534, r: 560, name: 'The Old Shrine Road' },
      { x: 2940, y: 730, r: 440, name: 'Windward Rise' },
      { x: 3020, y: 2350, r: 480, name: 'Far Lantern Fields' },
    ];
    const region = regions.find((area) => Math.hypot(player.x - area.x, player.y - area.y) < area.r);
    $('#location-name').textContent = region ? region.name : 'The Wide Green';
  }

  function draw() {
    const now = performance.now();
    const dt = Math.min(.034, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    if (running && !paused && !finished) update(dt);
    renderWorld();
    requestAnimationFrame(draw);
  }

  function renderWorld() {
    const shakeX = screenShake ? (Math.random() - .5) * screenShake : 0;
    const shakeY = screenShake ? (Math.random() - .5) * screenShake : 0;
    ctx.setTransform(screen.dpr, 0, 0, screen.dpr, 0, 0);
    ctx.clearRect(0, 0, screen.width, screen.height);
    const cam = cameraPoint();
    const sx = cam.x + shakeX; const sy = cam.y + shakeY;
    drawGround(sx, sy);
    ctx.save(); ctx.translate(sx, sy);
    drawPaths();
    drawLakes();
    drawCliffs();
    drawShrine();
    drawRelics();
    const visibleDecor = decorations.filter((object) => Math.abs(object.x - camera.x) < screen.width / 2 + 90 && Math.abs(object.y - camera.y) < screen.height / 2 + 90);
    const visibleEnemies = enemies.filter((enemy) => Math.abs(enemy.x - camera.x) < screen.width / 2 + 80 && Math.abs(enemy.y - camera.y) < screen.height / 2 + 80);
    const actors = [...visibleDecor.map((item) => ({ ...item, orderY: item.y + (item.type === 'tree' ? item.size * .5 : 2), actor: 'decor' })), ...visibleEnemies.map((item) => ({ ...item, orderY: item.y + 12, actor: 'enemy' })), { ...player, orderY: player.y + 12, actor: 'player' }];
    actors.sort((a, b) => a.orderY - b.orderY);
    for (const actor of actors) {
      if (actor.actor === 'decor') drawDecoration(actor);
      else if (actor.actor === 'enemy') drawEnemy(actor);
      else drawPlayer(actor);
    }
    drawEffects(); drawParticles();
    ctx.restore();
    drawLightAndTime();
    if (running && elapsed % .4 < .034) drawMinimap();
  }

  function drawGround(sx, sy) {
    ctx.fillStyle = '#82985f'; ctx.fillRect(0, 0, screen.width, screen.height);
    const tile = world.tile;
    const left = Math.max(0, Math.floor((camera.x - screen.width / 2) / tile) - 1);
    const right = Math.min(world.width / tile, Math.ceil((camera.x + screen.width / 2) / tile) + 1);
    const top = Math.max(0, Math.floor((camera.y - screen.height / 2) / tile) - 1);
    const bottom = Math.min(world.height / tile, Math.ceil((camera.y + screen.height / 2) / tile) + 1);
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const px = sx + x * tile; const py = sy + y * tile;
        const index = Math.floor(seeded(x, y, 4) * colors.grass.length);
        ctx.fillStyle = colors.grass[index]; ctx.fillRect(px, py, tile + 1, tile + 1);
        const detail = seeded(x, y, 9);
        if (detail > .18) {
          ctx.globalAlpha = .11 + detail * .1;
          ctx.fillStyle = detail > .72 ? '#d3c38a' : '#526c4b';
          const ox = seeded(x, y, 10) * tile; const oy = seeded(x, y, 11) * tile;
          ctx.beginPath(); ctx.ellipse(px + ox, py + oy, 3 + detail * 9, 1.8 + detail * 4, detail * 3, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }
    // The meadow edge dissolves into distant, pale hills.
    const margin = 130;
    const worldLeft = sx; const worldTop = sy;
    const edgeX = Math.min(worldLeft, worldLeft + world.width);
    if (edgeX > -margin) { const gradient = ctx.createLinearGradient(Math.max(0, edgeX), 0, Math.max(0, edgeX) + margin, 0); gradient.addColorStop(0, 'rgba(196,190,148,.9)'); gradient.addColorStop(1, 'rgba(196,190,148,0)'); ctx.fillStyle = gradient; ctx.fillRect(Math.max(0, edgeX), 0, margin, screen.height); }
    if (worldLeft + world.width < screen.width + margin) { const start = worldLeft + world.width; const gradient = ctx.createLinearGradient(start, 0, start + margin, 0); gradient.addColorStop(0, 'rgba(196,190,148,0)'); gradient.addColorStop(1, 'rgba(196,190,148,.9)'); ctx.fillStyle = gradient; ctx.fillRect(start, 0, margin, screen.height); }
    if (worldTop + world.height < screen.height + margin) { const start = worldTop + world.height; const gradient = ctx.createLinearGradient(0, start, 0, start + margin); gradient.addColorStop(0, 'rgba(196,190,148,0)'); gradient.addColorStop(1, 'rgba(196,190,148,.9)'); ctx.fillStyle = gradient; ctx.fillRect(0, start, screen.width, margin); }
  }

  function drawPaths() {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(pathPoints[0].x, pathPoints[0].y);
    for (let i = 1; i < pathPoints.length - 1; i++) {
      const midX = (pathPoints[i].x + pathPoints[i + 1].x) / 2;
      const midY = (pathPoints[i].y + pathPoints[i + 1].y) / 2;
      ctx.quadraticCurveTo(pathPoints[i].x, pathPoints[i].y, midX, midY);
    }
    const last = pathPoints[pathPoints.length - 1]; ctx.lineTo(last.x, last.y);
    ctx.strokeStyle = 'rgba(86, 78, 56, .19)'; ctx.lineWidth = 91; ctx.stroke();
    ctx.strokeStyle = colors.path; ctx.lineWidth = 78; ctx.stroke();
    ctx.strokeStyle = 'rgba(219, 207, 165, .2)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 18]); ctx.stroke(); ctx.setLineDash([]);
    for (let i = 0; i < pathPoints.length - 1; i++) {
      const a = pathPoints[i]; const b = pathPoints[i + 1];
      ctx.beginPath(); ctx.moveTo(a.x + 24, a.y - 19); ctx.lineTo(b.x + 24, b.y - 19);
      ctx.strokeStyle = 'rgba(232, 221, 183, .1)'; ctx.lineWidth = 1; ctx.stroke();
    }
  }

  function drawLakes() {
    lakes.forEach((lake, index) => {
      ctx.save(); ctx.translate(lake.x, lake.y);
      ctx.fillStyle = 'rgba(52, 69, 56, .2)'; ctx.beginPath(); ctx.ellipse(0, 9, lake.rx + 14, lake.ry + 13, -.12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#a9ab79'; ctx.beginPath(); ctx.ellipse(0, 0, lake.rx + 7, lake.ry + 7, -.12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = colors.water; ctx.beginPath(); ctx.ellipse(0, 0, lake.rx, lake.ry, -.12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(196, 215, 180, .15)'; ctx.beginPath(); ctx.ellipse(-lake.rx * .22, -lake.ry * .2, lake.rx * .58, lake.ry * .26, -.22, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 4; i++) {
        ctx.beginPath(); ctx.ellipse(Math.sin(elapsed * .3 + i + index) * 13, -15 + i * 20, 21 + i * 7, 2.2, -.12, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(227, 230, 196, ${.16 - i * .025})`; ctx.fill();
      }
      ctx.restore();
    });
  }

  function drawCliffs() {
    // Broad stepped hills frame the walkable basin and double as landmarks.
    const hills = [
      { x: 250, y: 1560, rx: 240, ry: 330 }, { x: 1490, y: 2680, rx: 440, ry: 185 },
      { x: 3680, y: 345, rx: 360, ry: 250 }, { x: 3600, y: 2700, rx: 300, ry: 210 },
      { x: 930, y: 1560, rx: 120, ry: 85 }, { x: 2560, y: 1000, rx: 155, ry: 94 },
    ];
    hills.forEach((hill, index) => {
      ctx.fillStyle = 'rgba(49, 65, 47, .16)'; ctx.beginPath(); ctx.ellipse(hill.x + 14, hill.y + 23, hill.rx + 8, hill.ry + 7, -.13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#718456'; ctx.beginPath(); ctx.ellipse(hill.x, hill.y, hill.rx, hill.ry, -.13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = index % 2 ? '#798b59' : '#748757'; ctx.beginPath(); ctx.ellipse(hill.x - 6, hill.y - 8, hill.rx * .76, hill.ry * .76, -.13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(202, 192, 145, .15)'; ctx.beginPath(); ctx.ellipse(hill.x - hill.rx * .24, hill.y - hill.ry * .28, hill.rx * .43, hill.ry * .18, -.2, 0, Math.PI * 2); ctx.fill();
    });
  }

  function drawDecoration(item) {
    const sway = Math.sin(elapsed * 1.7 + item.phase) * 1.1;
    if (item.type === 'tree') {
      const s = item.size;
      ctx.fillStyle = 'rgba(31, 48, 35, .23)'; ctx.beginPath(); ctx.ellipse(item.x + s * .35, item.y + s * .56, s * .9, s * .42, -.18, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#62583d'; ctx.fillRect(item.x - s * .15, item.y - s * .05, s * .3, s * .75);
      ctx.fillStyle = item.variant > .55 ? '#435f46' : '#4b6849'; ctx.beginPath(); ctx.arc(item.x + sway, item.y - s * .48, s * .65, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = item.variant > .55 ? '#55734c' : '#58764d'; ctx.beginPath(); ctx.arc(item.x - s * .25 + sway, item.y - s * .39, s * .47, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(171, 184, 113, .33)'; ctx.beginPath(); ctx.ellipse(item.x - s * .12 + sway, item.y - s * .75, s * .34, s * .14, -.45, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(29, 48, 35, .25)'; ctx.beginPath(); ctx.arc(item.x + s * .25, item.y - s * .18, s * .24, 0, Math.PI * 2); ctx.fill();
    } else if (item.type === 'bush') {
      ctx.fillStyle = 'rgba(29, 48, 35, .18)'; ctx.beginPath(); ctx.ellipse(item.x + 4, item.y + 4, item.size * .9, item.size * .47, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#60784c'; ctx.beginPath(); ctx.arc(item.x - item.size * .28, item.y, item.size * .52, 0, Math.PI * 2); ctx.arc(item.x + item.size * .24, item.y - 2, item.size * .57, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#7f965a'; ctx.beginPath(); ctx.arc(item.x - item.size * .14, item.y - 5, item.size * .26, 0, Math.PI * 2); ctx.fill();
    } else if (item.type === 'rock') {
      const s = item.size;
      ctx.fillStyle = 'rgba(28, 42, 33, .2)'; ctx.beginPath(); ctx.ellipse(item.x + 5, item.y + 5, s * .9, s * .48, .1, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = item.variant > .5 ? '#777968' : '#8c8a72'; ctx.beginPath(); ctx.ellipse(item.x, item.y, s * .77, s * .56, item.variant * 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(224, 216, 181, .27)'; ctx.beginPath(); ctx.ellipse(item.x - s * .22, item.y - s * .17, s * .32, s * .13, -.4, 0, Math.PI * 2); ctx.fill();
    } else {
      const colors = ['#f2d889', '#e8c5a1', '#e6e0b0', '#d5bd81'];
      for (let i = 0; i < 3; i++) {
        const px = item.x + (i - 1) * 4 + Math.sin(item.phase + i) * 1.5;
        const py = item.y + Math.cos(item.phase + i) * 1.7;
        ctx.strokeStyle = 'rgba(57, 88, 53, .65)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, py + 5); ctx.lineTo(px, py - 1); ctx.stroke();
        ctx.fillStyle = colors[(i + Math.floor(item.variant * 4)) % colors.length]; ctx.beginPath(); ctx.arc(px, py - 2, 2.1, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function drawShrine() {
    const glow = shrine.awake ? .75 + Math.sin(elapsed * 4) * .18 : .2 + Math.sin(elapsed * 1.5) * .04;
    const x = shrine.x; const y = shrine.y;
    ctx.fillStyle = 'rgba(27, 45, 38, .26)'; ctx.beginPath(); ctx.ellipse(x + 9, y + 46, 101, 35, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#706e56'; ctx.beginPath(); ctx.ellipse(x, y + 30, 92, 37, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#929078'; ctx.beginPath(); ctx.ellipse(x, y + 21, 80, 29, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6f725d'; ctx.beginPath(); ctx.ellipse(x, y + 19, 60, 22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4a5948'; ctx.fillRect(x - 37, y - 27, 10, 59); ctx.fillRect(x + 27, y - 27, 10, 59);
    ctx.fillStyle = '#777964'; ctx.fillRect(x - 45, y - 35, 90, 13);
    ctx.fillStyle = '#909078'; ctx.beginPath(); ctx.moveTo(x - 48, y - 34); ctx.lineTo(x, y - 60); ctx.lineTo(x + 48, y - 34); ctx.closePath(); ctx.fill();
    ctx.fillStyle = `rgba(246, 211, 113, ${glow})`; ctx.shadowColor = '#ffdb79'; ctx.shadowBlur = shrine.awake ? 27 : 9;
    ctx.beginPath(); ctx.ellipse(x, y - 14, 7, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    for (let i = 0; i < 3; i++) {
      const angle = elapsed * (shrine.awake ? .75 : .23) + i * 2.094;
      const px = x + Math.cos(angle) * (shrine.awake ? 84 : 73);
      const py = y + 2 + Math.sin(angle) * 26;
      ctx.fillStyle = `rgba(250, 224, 146, ${.45 + glow * .5})`; ctx.shadowColor = '#f7d77d'; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(px, py, shrine.awake ? 3 : 1.9, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    }
    if (!shrine.awake) {
      ctx.strokeStyle = 'rgba(219, 207, 158, .24)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 7]); ctx.beginPath(); ctx.ellipse(x, y + 5, 113, 45, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  function drawRelics() {
    relics.forEach((relic, index) => {
      if (relic.found) return;
      const pulse = .82 + Math.sin(elapsed * 2.5 + index * 2) * .14;
      const lift = Math.sin(elapsed * 1.9 + index) * 4;
      ctx.fillStyle = 'rgba(255, 226, 142, .15)'; ctx.beginPath(); ctx.ellipse(relic.x, relic.y + 16, 28 * pulse, 9 * pulse, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(252, 222, 138, ${.35 + pulse * .2})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(relic.x, relic.y + 16, 24 * pulse, 7 * pulse, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.save(); ctx.translate(relic.x, relic.y - 8 + lift); ctx.rotate(Math.PI / 4 + Math.sin(elapsed * .7) * .06);
      ctx.shadowColor = '#ffe29a'; ctx.shadowBlur = 20 * pulse;
      ctx.fillStyle = '#fff0bb'; ctx.fillRect(-6, -6, 12, 12);
      ctx.fillStyle = '#f5d47c'; ctx.fillRect(-3, -3, 6, 6);
      ctx.shadowBlur = 0; ctx.restore();
      for (let i = 0; i < 3; i++) {
        const a = elapsed * .8 + i * 2.09 + index;
        ctx.fillStyle = `rgba(255, 237, 186, ${.45 + Math.sin(elapsed * 2 + i) * .2})`; ctx.beginPath(); ctx.arc(relic.x + Math.cos(a) * 20, relic.y - 6 + Math.sin(a) * 12, 1.5, 0, Math.PI * 2); ctx.fill();
      }
    });
  }

  function drawPlayer(actor) {
    const moving = isMoving();
    const bob = moving ? Math.sin(player.stride) * (keys.has('shift') ? 2.1 : 1.3) : Math.sin(elapsed * 2.2) * .7;
    const facing = Math.atan2(player.facingY, player.facingX);
    const blink = player.invulnerable > 0 && Math.floor(elapsed * 14) % 2 === 0;
    if (blink) return;
    ctx.save(); ctx.translate(actor.x, actor.y + bob);
    ctx.fillStyle = 'rgba(31, 48, 38, .32)'; ctx.beginPath(); ctx.ellipse(3, 11, 14, 7, .08, 0, Math.PI * 2); ctx.fill();
    // Short green cloak and tunic, drawn as a tiny painterly game sprite.
    ctx.fillStyle = '#6f3735'; ctx.beginPath(); ctx.moveTo(-10, -4); ctx.lineTo(-14, 9); ctx.lineTo(0, 6); ctx.lineTo(10, 9); ctx.lineTo(7, -5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c4aa73'; ctx.beginPath(); ctx.ellipse(0, 2, 8, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4d7853'; ctx.beginPath(); ctx.ellipse(-1, -2, 8, 10, -.1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d7bd84'; ctx.beginPath(); ctx.arc(0, -10, 6.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e4d2a0'; ctx.beginPath(); ctx.moveTo(-8, -12); ctx.lineTo(0, -19); ctx.lineTo(9, -12); ctx.lineTo(2, -13); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#44563e'; ctx.beginPath(); ctx.ellipse(0, -12, 8, 3, 0, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#29352d'; ctx.beginPath(); ctx.arc(2, -10, 1, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#514e3d'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-4, 9); ctx.lineTo(-6 + Math.sin(player.stride) * 1.7, 14); ctx.moveTo(5, 9); ctx.lineTo(6 - Math.sin(player.stride) * 1.7, 14); ctx.stroke();
    ctx.save(); ctx.rotate(facing); ctx.strokeStyle = '#ded2a8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(7, -1); ctx.lineTo(16, -3); ctx.stroke(); ctx.strokeStyle = '#8f7452'; ctx.beginPath(); ctx.moveTo(7, -3); ctx.lineTo(7, 2); ctx.stroke(); ctx.restore();
    if (player.attack > 0) { ctx.strokeStyle = `rgba(255, 244, 207, ${player.attack / .28})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 32, facing - .88, facing + .88); ctx.stroke(); }
    ctx.restore();
  }

  function drawEnemy(enemy) {
    const wobble = Math.sin(elapsed * 4 + enemy.phase) * 1.4;
    ctx.save(); ctx.translate(enemy.x, enemy.y + wobble);
    ctx.fillStyle = 'rgba(36, 42, 34, .28)'; ctx.beginPath(); ctx.ellipse(3, 11, 16, 7, 0, 0, Math.PI * 2); ctx.fill();
    if (enemy.alert) {
      ctx.fillStyle = '#ecd48a'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('!', 0, -25);
    }
    ctx.fillStyle = enemy.flash > 0 ? '#f8e7bc' : '#803e32'; ctx.beginPath(); ctx.ellipse(0, 1, 12, 14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#9a5940'; ctx.beginPath(); ctx.ellipse(0, -8, 11, 8, -.08, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e9c580'; ctx.beginPath(); ctx.arc(-3, -7, 2, 0, Math.PI * 2); ctx.arc(4, -7, 2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#482f2a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-4, 6); ctx.lineTo(4, 6); ctx.stroke();
    ctx.strokeStyle = '#c2a375'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(9, -1); ctx.lineTo(16, 5); ctx.stroke();
    ctx.fillStyle = 'rgba(36, 39, 32, .48)'; ctx.fillRect(-13, -23, 26, 3);
    ctx.fillStyle = '#d78458'; ctx.fillRect(-13, -23, 26 * Math.max(0, enemy.hp / enemy.maxHp), 3);
    ctx.restore();
  }

  function drawEffects() {
    effects.forEach((effect) => {
      const progress = effect.life / effect.maxLife;
      ctx.save(); ctx.translate(effect.x, effect.y); ctx.rotate(effect.angle);
      ctx.strokeStyle = `rgba(255, 244, 206, ${progress * .9})`; ctx.lineWidth = 3 * progress;
      ctx.beginPath(); ctx.arc(0, 0, 43 - (1 - progress) * 11, -.85, .85); ctx.stroke();
      ctx.strokeStyle = `rgba(224, 195, 129, ${progress * .6})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, 51, -.62, .62); ctx.stroke(); ctx.restore();
    });
  }

  function drawParticles() {
    particles.forEach((p) => {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife); ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = 5;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  }

  function drawLightAndTime() {
    const progress = (worldTime / (24 * 60)) * Math.PI * 2;
    const warmth = .02 + Math.max(0, Math.sin(progress - .6)) * .045;
    ctx.fillStyle = `rgba(249, 211, 130, ${warmth})`; ctx.fillRect(0, 0, screen.width, screen.height);
    const light = ctx.createRadialGradient(screen.width * .74, screen.height * .1, 0, screen.width * .74, screen.height * .1, Math.max(screen.width, screen.height) * .8);
    light.addColorStop(0, 'rgba(255, 241, 199, .06)'); light.addColorStop(1, 'rgba(255, 241, 199, 0)'); ctx.fillStyle = light; ctx.fillRect(0, 0, screen.width, screen.height);
  }

  function drawMinimap() {
    if (!mapCtx) return;
    const width = minimap.width; const height = minimap.height;
    mapCtx.clearRect(0, 0, width, height);
    mapCtx.fillStyle = '#728758'; mapCtx.fillRect(0, 0, width, height);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 23; x++) {
      const n = seeded(x, y, 72); mapCtx.fillStyle = n > .78 ? 'rgba(171,176,125,.2)' : 'rgba(52,80,53,.08)'; mapCtx.fillRect(x * 8, y * 8, 8, 8);
    }
    lakes.forEach((lake) => { mapCtx.fillStyle = '#638f86'; mapCtx.beginPath(); mapCtx.ellipse(lake.x / world.width * width, lake.y / world.height * height, lake.rx / world.width * width, lake.ry / world.height * height, 0, 0, Math.PI * 2); mapCtx.fill(); });
    mapCtx.beginPath(); mapCtx.moveTo(pathPoints[0].x / world.width * width, pathPoints[0].y / world.height * height);
    pathPoints.slice(1).forEach((point) => mapCtx.lineTo(point.x / world.width * width, point.y / world.height * height));
    mapCtx.strokeStyle = 'rgba(218, 202, 154, .45)'; mapCtx.lineWidth = 3; mapCtx.stroke();
    mapCtx.fillStyle = '#b1a77e'; mapCtx.beginPath(); mapCtx.arc(shrine.x / world.width * width, shrine.y / world.height * height, 4, 0, Math.PI * 2); mapCtx.fill();
    relics.forEach((relic) => { if (!relic.found) { mapCtx.fillStyle = '#f6d47c'; mapCtx.beginPath(); mapCtx.arc(relic.x / world.width * width, relic.y / world.height * height, 2.7, 0, Math.PI * 2); mapCtx.fill(); } });
    enemies.forEach((enemy) => { mapCtx.fillStyle = '#cf7251'; mapCtx.fillRect(enemy.x / world.width * width - 1.5, enemy.y / world.height * height - 1.5, 3, 3); });
    const px = player.x / world.width * width; const py = player.y / world.height * height;
    mapCtx.fillStyle = '#fff4cf'; mapCtx.shadowColor = '#fff4cf'; mapCtx.shadowBlur = 7; mapCtx.beginPath(); mapCtx.arc(px, py, 3.5, 0, Math.PI * 2); mapCtx.fill(); mapCtx.shadowBlur = 0;
    mapCtx.strokeStyle = 'rgba(255, 245, 212, .75)'; mapCtx.lineWidth = 1; mapCtx.beginPath(); mapCtx.arc(px, py, 6, 0, Math.PI * 2); mapCtx.stroke();
    $('#map-coords').textContent = `${Math.round(player.x / world.width * 100)} · ${Math.round(player.y / world.height * 100)}`;
  }

  function keydown(event) {
    const key = event.key.toLowerCase();
    if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(key)) event.preventDefault();
    if (key === 'escape') { setPaused(!paused); return; }
    if (key === 'm' && running && !paused) { mapOpen = !mapOpen; ui.map.hidden = !mapOpen || innerWidth <= 760; showToast(mapOpen ? 'FIELD MAP OPEN' : 'FIELD MAP CLOSED', 900); return; }
    keys.add(key);
    if (key === ' ' && !event.repeat) strike();
    if ((key === 'e' || key === 'enter') && !event.repeat) interact();
  }

  function keyup(event) { keys.delete(event.key.toLowerCase()); }

  function bindTouchControls() {
    const directions = document.querySelectorAll('[data-move]');
    directions.forEach((button) => {
      const direction = button.dataset.move;
      const keyForDirection = { up: 'w', down: 's', left: 'a', right: 'd' }[direction];
      const start = (event) => { event.preventDefault(); touchKeys.add(direction); touchKeys.add(keyForDirection); button.setPointerCapture?.(event.pointerId); };
      const stop = (event) => { event.preventDefault(); touchKeys.delete(direction); touchKeys.delete(keyForDirection); };
      button.addEventListener('pointerdown', start); button.addEventListener('pointerup', stop); button.addEventListener('pointercancel', stop); button.addEventListener('lostpointercapture', stop);
    });
    $('#mobile-attack').addEventListener('pointerdown', (event) => { event.preventDefault(); strike(); });
    $('#mobile-use').addEventListener('pointerdown', (event) => { event.preventDefault(); interact(); });
    const runButton = $('#mobile-run');
    const startRun = (event) => { event.preventDefault(); touchKeys.add('run'); runButton.setPointerCapture?.(event.pointerId); };
    const stopRun = (event) => { event.preventDefault(); touchKeys.delete('run'); };
    runButton.addEventListener('pointerdown', startRun); runButton.addEventListener('pointerup', stopRun); runButton.addEventListener('pointercancel', stopRun); runButton.addEventListener('lostpointercapture', stopRun);
    canvas.addEventListener('pointerdown', (event) => {
      if (!running || paused || event.pointerType === 'touch') return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left - screen.width / 2;
      const y = event.clientY - rect.top - screen.height / 2;
      const angle = Math.atan2(y, x);
      player.facingX = Math.cos(angle); player.facingY = Math.sin(angle); strike();
    });
  }

  $('#start-button').addEventListener('click', setStarted);
  $('#resume-button').addEventListener('click', () => setPaused(false));
  $('#again-button').addEventListener('click', resetGame);
  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('resize', () => { resize(); ui.map.hidden = !mapOpen || innerWidth <= 760; });
  bindTouchControls();
  buildWorld(); resize(); drawMinimap();
  requestAnimationFrame(draw);
})();
