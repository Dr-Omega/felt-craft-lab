/** Display names only; stable theme IDs continue to own permissions and storage. */
export const THEME_NAMES: Readonly<Record<string, string>> = {
  mid_autumn_festival: '中秋', spring_festival: '春节', lantern_festival: '元宵',
  dragon_boat_festival: '端午', qingming_festival: '清明',
  spring: '春天', summer: '夏天', autumn: '秋天', winter: '冬天',
  traditional_folk_music: '传统民乐', brush_ink_painting: '笔墨书画',
  traditional_opera: '传统戏曲', chinese_tea_culture: '中国茶文化',
  plants: '中国植物', animals: '动物'
}

export function themeLabel(themeId: string): string {
  return THEME_NAMES[themeId] ?? themeId
}
