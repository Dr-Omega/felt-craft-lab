const THEME_DEFINITIONS = [
  theme("animals", "动物", [
    sticker("sticker_animal_swallow_001", "燕子"), sticker("sticker_ape_001", "猿子"),
    sticker("sticker_cuckoo_001", "杜鹃"), sticker("sticker_wild_goose_001", "大雁"),
  ], [level("animals-riverbank-001", "河岸动物", "background_animal_riverbank_001.png", 585)]),
  theme("autumn", "秋天", [
    sticker("sticker_fallen_leaf_001", "落叶"), sticker("sticker_maple_leaf_001", "枫叶"),
    sticker("sticker_persimmon_001", "柿子"),
  ], [
    level("autumn-field-dusk-001", "秋日黄昏", "background_autumn_field_dusk_001.png", 585),
    level("autumn-ginkgo-path-001", "银杏小路", "background_autumn_ginkgo_path_001.png", 585),
  ]),
  theme("brush_ink_painting", "笔墨书画", [
    sticker("sticker_calligraphy_brush_001", "毛笔"), sticker("sticker_inkstone_001", "砚台"),
  ], [level("brush-ink-study-desk-001", "书房桌案", "background_study_desk_001.png", 583)]),
  theme("chinese_tea_culture", "中国茶文化", [
    sticker("sticker_teacup_001", "茶杯"), sticker("sticker_teapot_001", "茶壶"),
  ], [level("tea-classical-room-001", "古典茶室", "background_classical_tea_room_001.png", 585)]),
  theme("dragon_boat_festival", "端午节", [
    sticker("sticker_mugwort_001", "艾草"), sticker("sticker_sachet_001", "香囊"),
    sticker("sticker_zongzi_001", "粽子"),
  ], [level("dragon-boat-race-001", "龙舟竞渡", "background_dragon_boat_race_001.png", 585)]),
  theme("lantern_festival", "元宵节", [
    sticker("sticker_flower_lantern_001", "花灯"), sticker("sticker_tangyuan_001", "汤圆"),
  ], [
    level("lantern-street-001", "元宵灯街", "background_lantern_street_001.png", 583),
    level("lantern-river-001", "河畔花灯", "background_river_lantern_001.png", 585),
  ]),
  theme("mid_autumn_festival", "中秋节", [
    sticker("sticker_moon_001", "月亮", "crescent"), sticker("sticker_rabbit_001", "玉兔", "rabbit"),
    sticker("sticker_mooncake_001", "月饼", "scallop"),
  ], [
    level("mid-autumn-lake-001", "中秋湖面", "background_lake_moon_001.png", 583, "mid-autumn-lake"),
    level("mid-autumn-osmanthus-001", "桂花明月", "background_osmanthus_moon_001.png", 583),
  ]),
  theme("plants", "中国植物", [
    sticker("sticker_bamboo_001", "竹子"), sticker("sticker_chrysanthemum_001", "菊花"),
    sticker("sticker_osmanthus_001", "桂花"), sticker("sticker_pine_001", "松树"),
    sticker("sticker_plant_lotus_001", "荷花"), sticker("sticker_plant_plum_001", "梅花"),
    sticker("sticker_wutong_001", "梧桐"),
  ], [level("plants-pastoral-courtyard-001", "田园庭院", "background_pastoral_courtyard_001.png", 583)]),
  theme("qingming_festival", "清明节", [
    sticker("sticker_kite_001", "风筝"), sticker("sticker_oil_paper_umbrella_001", "油纸伞"),
    sticker("sticker_qingtuan_001", "青团"), sticker("sticker_swallow_001", "燕子"),
    sticker("sticker_willow_leaf_001", "柳叶"),
  ], [
    level("qingming-kite-meadow-001", "清明风筝", "background_kite_meadow_001.png", 583),
    level("qingming-willow-riverbank-001", "柳岸春水", "background_willow_riverbank_001.png", 585),
  ]),
  theme("spring", "春天", [
    sticker("sticker_peach_blossom_001", "桃花"), sticker("sticker_willow_branch_001", "柳枝"),
  ], [level("spring-meadow-001", "春日草地", "background_spring_meadow_001.png", 585)]),
  theme("spring_festival", "春节", [
    sticker("sticker_dumpling_001", "饺子"), sticker("sticker_firecracker_001", "鞭炮"),
    sticker("sticker_fu_001", "福字"), sticker("sticker_lantern_001", "灯笼"),
    sticker("sticker_red_envelope_001", "红包"), sticker("sticker_window_flower_001", "窗花"),
  ], [
    level("spring-festival-couplet-gate-001", "春联大门", "background_couplet_gate_001.png", 581),
    level("spring-festival-snow-window-001", "雪景花窗", "background_snow_window_001.png", 583),
  ]),
  theme("summer", "夏天", [
    sticker("sticker_lotus_001", "荷花"), sticker("sticker_palm_fan_001", "蒲扇"),
    sticker("sticker_small_boat_001", "小船"), sticker("sticker_watermelon_001", "西瓜"),
  ], [
    level("summer-courtyard-001", "夏日庭院", "background_summer_courtyard_001.png", 583),
    level("summer-lotus-pond-001", "夏日荷塘", "background_summer_lotus_pond_001.png", 583),
  ]),
  theme("traditional_folk_music", "传统民乐", [
    sticker("sticker_bamboo_flute_001", "竹笛"), sticker("sticker_guzheng_001", "古筝"),
    sticker("sticker_wooden_fish_001", "木鱼"),
  ], [level("folk-music-elegant-hall-001", "民乐雅堂", "background_elegant_hall_001.png", 585)]),
  theme("traditional_opera", "传统戏曲", [
    sticker("sticker_folding_fan_001", "折扇"), sticker("sticker_small_drum_001", "小鼓"),
  ], [level("opera-stage-001", "古戏台", "background_ancient_opera_stage_001.png", 583)]),
  theme("winter", "冬天", [
    sticker("sticker_plum_blossom_001", "梅花"), sticker("sticker_snowflake_001", "雪花"),
  ], [level("winter-snowman-field-001", "雪人原野", "background_winter_snowman_field_001.png", 583)]),
];

const MID_AUTUMN_LAKE_PLACEMENTS = {
  sticker_moon_001: placement({ x: 145, y: 90, width: 200, height: 200, zIndex: 1 }, { minX: 185, minY: 110, maxX: 305, maxY: 230 }, 24),
  sticker_rabbit_001: placement({ x: 168, y: 5, width: 155, height: 205, zIndex: 2 }, { minX: 205, minY: 95, maxX: 285, maxY: 225 }, 18),
  sticker_mooncake_001: placement({ x: 550, y: 390, width: 130, height: 124, zIndex: 1 }, { minX: 555, minY: 405, maxX: 675, maxY: 505 }, 24),
};

const BACKGROUND_LAYOUTS = {
  "animals-riverbank-001": [[0.18, 0.26], [0.78, 0.7], [0.48, 0.3], [0.42, 0.68]],
  "autumn-field-dusk-001": [[0.2, 0.7], [0.76, 0.68], [0.5, 0.76]],
  "autumn-ginkgo-path-001": [[0.18, 0.64], [0.82, 0.62], [0.5, 0.73]],
  "brush-ink-study-desk-001": [[0.63, 0.61], [0.34, 0.67]],
  "tea-classical-room-001": [[0.47, 0.66], [0.67, 0.62]],
  "dragon-boat-race-001": [[0.2, 0.67], [0.8, 0.66], [0.5, 0.74]],
  "lantern-street-001": [[0.5, 0.74], [0.76, 0.68]],
  "lantern-river-001": [[0.3, 0.68], [0.7, 0.72]],
  "mid-autumn-osmanthus-001": [[0.39, 0.24], [0.68, 0.55], [0.78, 0.76]],
  "plants-pastoral-courtyard-001": [[0.12, 0.76], [0.2, 0.35], [0.32, 0.27], [0.84, 0.74], [0.5, 0.82], [0.42, 0.33], [0.2, 0.68]],
  "qingming-kite-meadow-001": [[0.72, 0.23], [0.16, 0.73], [0.52, 0.78], [0.86, 0.69], [0.34, 0.3]],
  "qingming-willow-riverbank-001": [[0.75, 0.28], [0.17, 0.72], [0.5, 0.72], [0.82, 0.69], [0.34, 0.33]],
  "spring-meadow-001": [[0.3, 0.7], [0.72, 0.65]],
  "spring-festival-couplet-gate-001": [[0.15, 0.7], [0.86, 0.7], [0.5, 0.53], [0.2, 0.27], [0.8, 0.27], [0.5, 0.78]],
  "spring-festival-snow-window-001": [[0.17, 0.72], [0.83, 0.72], [0.5, 0.52], [0.2, 0.28], [0.8, 0.28], [0.5, 0.76]],
  "summer-courtyard-001": [[0.18, 0.71], [0.42, 0.68], [0.67, 0.7], [0.85, 0.67]],
  "summer-lotus-pond-001": [[0.18, 0.67], [0.78, 0.31], [0.55, 0.74], [0.34, 0.57]],
  "folk-music-elegant-hall-001": [[0.22, 0.68], [0.64, 0.58], [0.42, 0.7]],
  "opera-stage-001": [[0.35, 0.68], [0.68, 0.69]],
  "winter-snowman-field-001": [[0.28, 0.68], [0.73, 0.66]],
};

const LEVELS = new Map(
  THEME_DEFINITIONS.flatMap((themeDefinition) =>
    themeDefinition.levels.map((levelDefinition) => {
      const placements = levelDefinition.layout === "mid-autumn-lake"
        ? MID_AUTUMN_LAKE_PLACEMENTS
        : createPlacements(
            themeDefinition.stickers,
            levelDefinition.height,
            BACKGROUND_LAYOUTS[levelDefinition.levelId],
          );
      return [levelDefinition.levelId, createLevel(themeDefinition, levelDefinition, placements)];
    }),
  ),
);

function theme(themeId, themeName, stickers, levels) { return { themeId, themeName, stickers, levels }; }
function sticker(stickerId, name, outlineShape = "asset") { return { stickerId, name, outlineShape }; }
function level(levelId, name, backgroundFileName, height, layout = "auto") { return { levelId, name, backgroundFileName, height, layout }; }
function placement(placeholder, targetArea, tolerance) { return { placeholder: { ...placeholder, rotation: 0 }, targetArea, tolerance }; }

function createLevel(themeDefinition, levelDefinition, placements) {
  return {
    levelId: levelDefinition.levelId,
    themeId: themeDefinition.themeId,
    themeName: themeDefinition.themeName,
    name: levelDefinition.name,
    backgroundAssetUrl: `/assets/${themeDefinition.themeId}/backgrounds/${levelDefinition.backgroundFileName}`,
    canvasBounds: { minX: 0, minY: 0, maxX: 1024, maxY: levelDefinition.height },
    stickers: themeDefinition.stickers.map((item) => {
      const currentPlacement = placements[item.stickerId];
      return {
        stickerId: item.stickerId,
        name: item.name,
        stickerAssetUrl: `/assets/${themeDefinition.themeId}/stickers/${item.stickerId}.png`,
        targetArea: currentPlacement.targetArea,
        tolerance: currentPlacement.tolerance,
        placeholder: {
          ...currentPlacement.placeholder,
          outlineAssetUrl: `/assets/${themeDefinition.themeId}/stickers/${item.stickerId}.png`,
          outlineShape: item.outlineShape,
          outlineStyle: { renderMode: "silhouette-dashed", color: "#557D78", dashLength: 9, gapLength: 7, lineWidth: 3.5, fillOpacity: 0.08 },
        },
      };
    }),
  };
}

function createPlacements(stickers, height, centers) {
  return Object.fromEntries(stickers.map((item, index) => [item.stickerId, createPlacement(item, index, stickers.length, height, centers)]));
}

function createPlacement(item, index, count, height, centers) {
  const [centerX, centerY] = centers?.[index] ?? layoutCenters(count)[index];
  const center = { x: centerX, y: centerY };
  const baseSize = count <= 2 ? 154 : count === 3 ? 142 : count <= 4 ? 126 : 108;
  const size = Math.round(baseSize * naturalScale(item.stickerId));
  const width = item.outlineShape === "rabbit" ? size * 0.82 : size;
  const boxHeight = item.outlineShape === "rabbit" ? size * 1.18 : size;
  const targetRadius = Math.max(34, Math.round(size * 0.3));
  const targetX = Math.round(center.x * 1024);
  const targetY = Math.round(center.y * height);
  return placement(
    {
      x: Math.round(targetX - width / 2), y: Math.round(targetY - boxHeight / 2),
      width: Math.round(width), height: Math.round(boxHeight), zIndex: index + 1,
    },
    { minX: targetX - targetRadius, minY: targetY - targetRadius, maxX: targetX + targetRadius, maxY: targetY + targetRadius },
    24,
  );
}

function naturalScale(stickerId) {
  if (/mugwort|sachet|kite/.test(stickerId)) return 1.28;
  if (/small_boat/.test(stickerId)) return 1.2;
  if (/bamboo|pine|wutong/.test(stickerId)) return 1.28;
  if (/brush|flute|branch|bamboo|willow|firecracker|fan|umbrella|goose|swallow/.test(stickerId)) return 1.2;
  if (/ape|cuckoo|pine|wutong|boat|teapot|guzheng|drum|lantern/.test(stickerId)) return 1.08;
  if (/leaf|snowflake|blossom|osmanthus|chrysanthemum|mugwort|sachet/.test(stickerId)) return 0.78;
  if (/qingtuan|tangyuan|mooncake|watermelon|dumpling|inkstone|teacup|go_/.test(stickerId)) return 0.88;
  return 1;
}

function layoutCenters(count) {
  const layouts = {
    1: [[0.5, 0.62]],
    2: [[0.29, 0.63], [0.71, 0.63]],
    3: [[0.19, 0.64], [0.5, 0.57], [0.81, 0.64]],
    4: [[0.2, 0.3], [0.8, 0.3], [0.27, 0.72], [0.73, 0.72]],
    5: [[0.18, 0.29], [0.5, 0.25], [0.82, 0.29], [0.32, 0.72], [0.68, 0.72]],
    6: [[0.18, 0.28], [0.5, 0.24], [0.82, 0.28], [0.18, 0.72], [0.5, 0.68], [0.82, 0.72]],
    7: [[0.14, 0.25], [0.38, 0.22], [0.62, 0.22], [0.86, 0.25], [0.25, 0.72], [0.5, 0.68], [0.75, 0.72]],
  };
  return (layouts[count] ?? layouts[7]).map(([x, y]) => ({ x, y }));
}

export function getLevel(levelId) { return LEVELS.get(levelId) ?? null; }
export function listLevels() { return [...LEVELS.values()]; }
export function toPublicLevel(level, completedStickerIds = new Set()) {
  return {
    ...structuredClone(level),
    stickers: level.stickers.map((item) => ({ ...structuredClone(item), isCompleted: completedStickerIds.has(item.stickerId) })),
  };
}
