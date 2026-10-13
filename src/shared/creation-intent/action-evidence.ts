/** Bare repeated sounds are not a drawable action. Keep names/phrases untouched. */
export function isSoundOnlyAction(value: string): boolean {
  const text = value.replace(/[\s，。！？、,.!?~～]/g, '')
  return /^(?:哒|嗒|嘟|啦|咚|叮|喵|汪){2,}$/.test(text)
}
