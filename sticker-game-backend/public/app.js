const board = document.querySelector("#board");
const tray = document.querySelector("#stickerTray");
const statusText = document.querySelector("#statusText");
const levelSelect = document.querySelector("#levelSelect");
const themeLabel = document.querySelector("#themeLabel");
const levelLabel = document.querySelector("#levelLabel");
const celebration = document.querySelector("#celebration");
const celebrationVideo = document.querySelector("#celebrationVideo");
const closeCelebration = document.querySelector("#closeCelebration");
const narrationPlayer = new Audio();
narrationPlayer.preload = "auto";
let session;
let level;
let pointerDrag;
let activeDragStickerId;
let narrationRun = 0;
let narrationActive = false;
let narrationStickerId;
let cancelNarrationWait;
let guideTimer;
let guideAnimation;
let pendingCelebrationUrl;
let loadAttempt = 0;
let selectedLevelId = "mid-autumn-lake-001";
let availableLevels = [];
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

levelSelect.addEventListener("change", () => {
  selectedLevelId = levelSelect.value;
  loadAttempt = 0;
  startGame();
});
closeCelebration.addEventListener("click", () => { celebration.hidden = true; celebrationVideo.pause(); });

loadLevelCatalog();

async function loadLevelCatalog() {
  setStatus("正在加载关卡列表...");
  try {
    const response = await fetch("/api/levels");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    availableLevels = (await response.json()).levels;
    renderLevelOptions();
    await startGame();
  } catch {
    setStatus("关卡列表加载失败，请刷新页面重试");
  }
}

function renderLevelOptions() {
  levelSelect.replaceChildren();
  const groups = new Map();
  for (const item of availableLevels) {
    if (!groups.has(item.themeId)) groups.set(item.themeId, { name: item.themeName, levels: [] });
    groups.get(item.themeId).levels.push(item);
  }
  for (const [themeId, group] of groups) {
    const optionGroup = document.createElement("optgroup");
    optionGroup.label = group.name;
    optionGroup.dataset.themeId = themeId;
    for (const item of group.levels) {
      const option = document.createElement("option");
      option.value = item.levelId;
      option.textContent = item.name;
      optionGroup.append(option);
    }
    levelSelect.append(optionGroup);
  }
  if (!availableLevels.some((item) => item.levelId === selectedLevelId)) {
    selectedLevelId = availableLevels[0]?.levelId;
  }
  levelSelect.value = selectedLevelId;
}

async function startGame() {
  stopGuidanceAnimation();
  stopNarration();
  pendingCelebrationUrl = null;
  celebration.hidden = true;
  levelSelect.disabled = true;
  setStatus("正在准备关卡...");
  try {
    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ levelId: selectedLevelId }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    session = await response.json();
    level = session.level;
    loadAttempt = 0;
    tray.scrollTop = 0;
    render();
  } catch {
    loadAttempt += 1;
    setStatus(loadAttempt < 4 ? `关卡连接失败，正在重试（${loadAttempt}/3）...` : "关卡连接失败，请点击“重新开始”重试");
    if (loadAttempt < 4) setTimeout(startGame, 1000);
  } finally {
    levelSelect.disabled = false;
  }
}

function render() {
  stopGuidanceAnimation();
  board.style.backgroundImage = `url("${level.backgroundAssetUrl}")`;
  board.style.aspectRatio = `${level.canvasBounds.maxX} / ${level.canvasBounds.maxY}`;
  tray.dataset.themeId = level.themeId;
  board.replaceChildren();
  tray.replaceChildren();
  setStatus(session.allFinished ? "这一关已经完成" : "把贴纸拖到对应的虚线轮廓里");
  themeLabel.textContent = `主题 ID：${level.themeId}`;
  levelLabel.textContent = `${level.themeName} · ${level.name}`;

  for (const sticker of level.stickers) {
    if (sticker.isCompleted) {
      renderPlacedSticker(sticker);
    } else {
      renderPlaceholder(sticker);
      renderTraySticker(sticker);
    }
  }

  scheduleGuidanceAnimation();
}

function findStickerById(stickerId) {
  return level?.stickers.find((sticker) => sticker.stickerId === stickerId);
}

function renderPlaceholder(sticker) {
  const outlineShape = sticker.placeholder.outlineShape ?? "asset";
  if (outlineShape !== "crescent") {
    const preview = document.createElement("img");
    preview.className = "shape-guide-preview";
    preview.src = sticker.placeholder.outlineAssetUrl;
    preview.alt = "";
    placeElement(preview, sticker.placeholder);
    board.append(preview);
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("placeholder", "shape-placeholder");
  svg.dataset.stickerId = sticker.stickerId;
  svg.setAttribute("viewBox", "0 0 220 220");
  svg.setAttribute("aria-label", "贴纸目标轮廓");

  if (outlineShape === "crescent") {
    appendOutlinePath(svg, "M142 16C80 18 37 68 40 128c4 62 66 100 125 69 20-10 36-28 44-49-28 20-64 19-89-1-34-27-44-73-23-108 11-18 27-22 45-23Z");
  } else if (outlineShape === "rabbit") {
    appendOutlinePath(svg, "M70 72C48 45 42 10 61 6c22-5 34 37 41 65 7-28 19-70 41-65 20 5 13 41-9 68 28 12 45 38 42 70-2 24-12 44-29 57 18 20 13 48-8 59-14 8-27 4-37-8-12 13-27 16-42 8-22-12-25-40-7-59-18-15-28-37-26-62 2-31 18-55 43-67Z");
  } else if (outlineShape === "scallop") {
    appendOutlinePath(svg, createScallopedPath(110, 110, 83, 74, 12));
  } else {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", "28");
    rect.setAttribute("y", "28");
    rect.setAttribute("width", "164");
    rect.setAttribute("height", "164");
    rect.setAttribute("rx", "48");
    rect.classList.add("outline-path");
    svg.append(rect);
  }

  placeElement(svg, sticker.placeholder);
  board.append(svg);
}

function createScallopedPath(cx, cy, outerRadius, innerRadius, lobes) {
  const points = Array.from({ length: lobes * 2 }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI) / lobes;
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    return {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    };
  });
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const start = midpoint(points.at(-1), points[0]);
  const commands = [`M${start.x} ${start.y}`];
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    const end = midpoint(point, next);
    commands.push(`Q${point.x} ${point.y} ${end.x} ${end.y}`);
  });
  return `${commands.join(" ")}Z`;
}

function appendOutlinePath(svg, pathData) {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathData);
  path.classList.add("outline-path");
  svg.append(path);
}

function renderPlacedSticker(sticker) {
  const image = document.createElement("img");
  image.className = "placed-sticker";
  image.src = sticker.stickerAssetUrl;
  image.alt = sticker.name ?? sticker.stickerId;
  placeElement(image, sticker.placeholder);
  board.append(image);
}

function renderTraySticker(sticker) {
  const card = document.createElement("div");
  card.className = "sticker-card";
  card.dataset.stickerId = sticker.stickerId;
  const image = document.createElement("img");
  image.src = sticker.stickerAssetUrl;
  image.alt = sticker.name ?? sticker.stickerId;
  card.append(image);
  card.addEventListener("dragstart", (event) => {
    if (!isStickerUnlocked(sticker.stickerId)) {
      event.preventDefault();
      return;
    }
    beginStickerInteraction(sticker);
    activeDragStickerId = sticker.stickerId;
    event.dataTransfer.setData("text/sticker-id", sticker.stickerId);
    event.dataTransfer.effectAllowed = "move";
  });
  card.addEventListener("dragend", () => {
    activeDragStickerId = null;
    clearProximityHighlight();
    scheduleGuidanceAnimation(3200);
  });
  card.addEventListener("pointerdown", (event) => startPointerDrag(event, sticker));
  tray.append(card);
  refreshStickerLocks();
}

board.addEventListener("dragover", (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  const stickerId = event.dataTransfer.getData("text/sticker-id") || activeDragStickerId;
  updateProximityHighlight(stickerId, event.clientX, event.clientY);
});
board.addEventListener("dragleave", () => clearProximityHighlight());
board.addEventListener("drop", async (event) => {
  event.preventDefault();
  const stickerId = event.dataTransfer.getData("text/sticker-id") || activeDragStickerId;
  if (!stickerId) return;
  activeDragStickerId = null;
  clearProximityHighlight();
  await submitPlacement(stickerId, event.clientX, event.clientY);
});

function updateProximityHighlight(stickerId, clientX, clientY) {
  const sticker = findStickerById(stickerId);
  if (!sticker) return;
  const bounds = board.getBoundingClientRect();
  const x = ((clientX - bounds.left) / bounds.width) * level.canvasBounds.maxX;
  const y = ((clientY - bounds.top) / bounds.height) * level.canvasBounds.maxY;
  const area = sticker.targetArea;
  const near = x >= area.minX - 70 && x <= area.maxX + 70 && y >= area.minY - 70 && y <= area.maxY + 70;
  const target = board.querySelector(`[data-sticker-id="${stickerId}"]`);
  target?.classList.toggle("is-near", near);
}

function clearProximityHighlight() {
  board.querySelectorAll(".is-near").forEach((element) => element.classList.remove("is-near"));
}

function startPointerDrag(event, sticker) {
  if (event.pointerType === "mouse") return;
  if (!isStickerUnlocked(sticker.stickerId)) return;
  event.preventDefault();
  beginStickerInteraction(sticker);
  const ghost = document.createElement("img");
  ghost.className = "drag-ghost";
  ghost.src = sticker.stickerAssetUrl;
  ghost.alt = "";
  document.body.append(ghost);
  pointerDrag = { pointerId: event.pointerId, stickerId: sticker.stickerId, ghost };
  movePointerGhost(event.clientX, event.clientY);
  updateProximityHighlight(sticker.stickerId, event.clientX, event.clientY);
  event.currentTarget.setPointerCapture(event.pointerId);
}

window.addEventListener("pointermove", (event) => {
  if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
  event.preventDefault();
  movePointerGhost(event.clientX, event.clientY);
  updateProximityHighlight(pointerDrag.stickerId, event.clientX, event.clientY);
}, { passive: false });

window.addEventListener("pointerup", async (event) => {
  if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
  const { stickerId, ghost } = pointerDrag;
  pointerDrag = null;
  ghost.remove();
  clearProximityHighlight();
  await submitPlacement(stickerId, event.clientX, event.clientY);
});

window.addEventListener("pointercancel", () => {
  pointerDrag?.ghost.remove();
  pointerDrag = null;
  clearProximityHighlight();
  scheduleGuidanceAnimation(3200);
});

function movePointerGhost(clientX, clientY) {
  pointerDrag.ghost.style.left = `${clientX}px`;
  pointerDrag.ghost.style.top = `${clientY}px`;
}

async function submitPlacement(stickerId, clientX, clientY) {
  const bounds = board.getBoundingClientRect();
  const x = ((clientX - bounds.left) / bounds.width) * level.canvasBounds.maxX;
  const y = ((clientY - bounds.top) / bounds.height) * level.canvasBounds.maxY;
  const response = await fetch(`/api/sessions/${session.playSessionId}/placements`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stickerId, x, y }),
  });
  const result = await response.json();
  if (!response.ok) return setStatus(result.error?.message ?? "提交失败");
  if (result.outOfBound) {
    setStatus("还在画布外，再试一次");
    scheduleGuidanceAnimation(1800);
    return;
  }
  if (!result.success) {
    setStatus("位置不太对，再试一次");
    scheduleGuidanceAnimation(1800);
    return;
  }
  session = await (await fetch(`/api/sessions/${session.playSessionId}`)).json();
  level = session.level;
  render();
  if (result.justFinished) {
    if (narrationActive) {
      pendingCelebrationUrl = result.celebration.assetUrl;
    } else {
      showCelebration(result.celebration.assetUrl);
    }
  }
}

function beginStickerInteraction(sticker) {
  if (!isStickerUnlocked(sticker.stickerId)) return;
  stopGuidanceAnimation();
  void playStickerNarration(sticker);
}

function stopNarration() {
  narrationRun += 1;
  narrationActive = false;
  narrationStickerId = null;
  cancelNarrationWait?.();
  cancelNarrationWait = null;
  narrationPlayer.pause();
  narrationPlayer.removeAttribute("src");
  narrationPlayer.load();
}

async function playStickerNarration(sticker) {
  stopNarration();
  const run = narrationRun;
  const clips = sticker.narrationAudio?.map((clip) => clip.assetUrl).filter(Boolean) ?? [];
  narrationActive = clips.length > 0;
  narrationStickerId = clips.length > 0 ? sticker.stickerId : null;
  refreshStickerLocks();

  for (const assetUrl of clips) {
    if (run !== narrationRun) return;
    narrationPlayer.src = assetUrl;
    const finished = waitForNarrationEnd(run);
    try {
      await narrationPlayer.play();
      await finished;
    } catch {
      cancelNarrationWait?.();
    }
  }

  if (run === narrationRun) {
    narrationActive = false;
    narrationStickerId = null;
    refreshStickerLocks();
    if (pendingCelebrationUrl) {
      const celebrationUrl = pendingCelebrationUrl;
      pendingCelebrationUrl = null;
      showCelebration(celebrationUrl);
      return;
    }
    scheduleGuidanceAnimation(900);
  }
}

function waitForNarrationEnd(run) {
  return new Promise((resolve) => {
    const finish = () => {
      narrationPlayer.removeEventListener("ended", finish);
      narrationPlayer.removeEventListener("error", finish);
      if (cancelNarrationWait === finish) cancelNarrationWait = null;
      resolve();
    };
    cancelNarrationWait = finish;
    narrationPlayer.addEventListener("ended", finish, { once: true });
    narrationPlayer.addEventListener("error", finish, { once: true });
    if (run !== narrationRun) finish();
  });
}

function scheduleGuidanceAnimation(delay = 900) {
  clearTimeout(guideTimer);
  if (!level || session?.allFinished || pointerDrag || activeDragStickerId || narrationActive || reduceMotion.matches) return;
  guideTimer = setTimeout(runGuidanceAnimation, delay);
}

function stopGuidanceAnimation() {
  clearTimeout(guideTimer);
  guideTimer = null;
  guideAnimation?.cancel();
  guideAnimation = null;
  document.querySelector(".guide-drag")?.remove();
  board.querySelectorAll(".is-guiding").forEach((element) => element.classList.remove("is-guiding"));
}

function runGuidanceAnimation() {
  if (narrationActive) return;
  const sticker = level.stickers.find((item) => !item.isCompleted);
  if (!sticker || document.hidden) return scheduleGuidanceAnimation(2400);
  const cardImage = tray.querySelector(`[data-sticker-id="${sticker.stickerId}"] img`);
  const target = board.querySelector(`[data-sticker-id="${sticker.stickerId}"]`);
  if (!cardImage || !target) return scheduleGuidanceAnimation(1600);

  const from = cardImage.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  const guide = document.createElement("div");
  guide.className = "guide-drag";
  guide.setAttribute("aria-hidden", "true");
  const image = document.createElement("img");
  image.src = sticker.stickerAssetUrl;
  image.alt = "";
  const touchCue = document.createElement("span");
  touchCue.className = "guide-touch-cue";
  guide.append(image, touchCue);
  document.body.append(guide);
  target.classList.add("is-guiding");

  const fromX = from.left + from.width / 2;
  const fromY = from.top + from.height / 2;
  const toX = to.left + to.width / 2;
  const toY = to.top + to.height / 2;
  guideAnimation = guide.animate([
    { left: `${fromX}px`, top: `${fromY}px`, opacity: 0, transform: "translate(-50%, -50%) scale(.76)" },
    { left: `${fromX}px`, top: `${fromY}px`, opacity: 1, transform: "translate(-50%, -50%) scale(1)", offset: .16 },
    { left: `${fromX}px`, top: `${fromY}px`, opacity: 1, transform: "translate(-50%, -50%) scale(1)", offset: .3 },
    { left: `${toX}px`, top: `${toY}px`, opacity: 1, transform: "translate(-50%, -50%) scale(1.04)", offset: .82 },
    { left: `${toX}px`, top: `${toY}px`, opacity: 0, transform: "translate(-50%, -50%) scale(.9)" },
  ], { duration: 2700, easing: "cubic-bezier(.35,.02,.2,1)", fill: "forwards" });

  const animation = guideAnimation;
  animation.finished.then(() => {
    if (guideAnimation !== animation) return;
    guideAnimation = null;
    guide.remove();
    target.classList.remove("is-guiding");
    scheduleGuidanceAnimation(2200);
  }).catch(() => {});
}

function getUnlockedStickerId() {
  if (!level) return null;
  if (narrationActive) {
    const narrationSticker = findStickerById(narrationStickerId);
    return narrationSticker && !narrationSticker.isCompleted ? narrationStickerId : null;
  }
  return level.stickers.find((sticker) => !sticker.isCompleted)?.stickerId ?? null;
}

function isStickerUnlocked(stickerId) {
  return stickerId === getUnlockedStickerId();
}

function refreshStickerLocks() {
  const unlockedStickerId = getUnlockedStickerId();
  tray.querySelectorAll(".sticker-card").forEach((card) => {
    const unlocked = card.dataset.stickerId === unlockedStickerId;
    card.classList.toggle("is-locked", !unlocked);
    card.draggable = unlocked;
    card.setAttribute("aria-disabled", String(!unlocked));
  });
}

function placeElement(element, box) {
  element.style.left = `${(box.x / level.canvasBounds.maxX) * 100}%`;
  element.style.top = `${(box.y / level.canvasBounds.maxY) * 100}%`;
  element.style.width = `${(box.width / level.canvasBounds.maxX) * 100}%`;
  element.style.height = `${(box.height / level.canvasBounds.maxY) * 100}%`;
  element.style.transform = `rotate(${box.rotation ?? 0}deg)`;
  element.style.zIndex = box.zIndex ?? 1;
}

function showCelebration(url) {
  stopGuidanceAnimation();
  stopNarration();
  celebrationVideo.src = url;
  celebration.hidden = false;
  celebrationVideo.play().catch(() => {});
}

function setStatus(message) { statusText.textContent = message; }
