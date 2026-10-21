/** Presentation choices are visit-local, not persisted attributes of a work. */
export function excerptLineMix(count: number, random: () => number = Math.random): Array<1 | 2> {
  if (!count) return []
  if (count === 1) return [random() < .5 ? 1 : 2]
  const min = Math.max(1, Math.ceil(count / 4)), max = Math.min(count - 1, Math.floor(count * 3 / 4))
  const ones = min + Math.floor(random() * (max - min + 1))
  const first: 1 | 2 = random() < .5 ? 1 : 2
  const rest: Array<1 | 2> = [...Array<1>(ones - 1).fill(1), ...Array<2>(count - ones - 1).fill(2)]
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]
  }
  return [first, first === 1 ? 2 : 1, ...rest]
}
export function plazaAvatarIndex(userId: string): number {
  return [...userId].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 0) % 3
}
export function plazaAvatarCrop(index: number): Record<string, string> {
  const [x,y,size] = [[1564,48,264],[1576,61,280],[1573,62,272]][index] ?? [1564,48,264]
  return { width:`${1920/size*100}%`, height:`${1080/size*100}%`, left:`${-x/size*100}%`, top:`${-y/size*100}%` }
}
