import type { GenerationSpecPatch, GenerationSubject } from '../contracts/generation-spec'
import type { CreationIntentParseInput, CreationIntentParser } from './parser'
import { resolveAssetRoleFromText } from './role-resolver'

/** Characters / motifs first; held props later so plan cards list them as companions. */
const KNOWN_SUBJECTS = [
  '玉兔',
  '兔子',
  '熊猫',
  '小猫',
  '小狗',
  '小熊',
  '小青蛙',
  '青蛙',
  '小鹿',
  '鲸鱼',
  '蝴蝶',
  '鲤鱼',
  '小鸟',
  '鸭子',
  '荷花',
  '莲花',
  '花朵',
  '月亮',
  '太阳',
  '星星',
  '云朵',
  '茶壶',
  '灯笼',
  '月饼',
  '皮球',
  '足球',
  '篮球',
  '西瓜',
  '苹果',
  '萝卜',
  '扇子',
  '围巾',
  '帽子',
  '花环',
  '书包',
  '房子',
  '大树'
]
const KNOWN_COLORS = [
  '黑白',
  '白色',
  '金色',
  '红色',
  '粉色',
  '绿色',
  '蓝色',
  '黄色',
  '橙色',
  '紫色',
  '黑色',
  '灰色',
  '棕色'
]
/** Longer relation phrases first; simple verbs last. */
const ACTION_PATTERNS = [
  /坐在地上抱着[^，。！？]{0,12}/,
  /坐着抱着[^，。！？]{0,12}/,
  /抱着[^，。！？]{0,12}/,
  /捧着[^，。！？]{0,12}/,
  /举着[^，。！？]{0,12}/,
  /抬着[^，。！？]{0,12}/,
  /戴着[^，。！？]{0,12}/,
  /追着[^，。！？]{0,12}/,
  /追[^，。！？]{0,8}/,
  /看着[^，。！？]{0,12}/,
  /坐在[^，。！？]{0,12}/,
  /漂在[^，。！？]{0,12}/,
  /放在[^，。！？]{0,12}/,
  /跟着[^，。！？]{0,12}/,
  /一起[^，。！？]{0,12}/,
  /抱着?/,
  /抬着?/,
  /坐着?/,
  /站着?/,
  /捧着?/,
  /举着?/,
  /笑着?/,
  /跑着?/
]
const FORBIDDEN_PATTERN = /(?:不要|别|不能有|禁止)\s*([^，。！？]+)/
const REQUIRED_PATTERN = /(?:必须有|一定要有|还要有|再加上)\s*([^，。！？]+)/
const ADD_SUBJECT_PATTERN =
  /(?:再加(?:一个|一只|一条|一朵)?|加上(?:一个|一只)?|还要(?:一个|一只|一条)?)\s*([^\s，。！？的]{1,8})/
const ENVIRONMENT_STRIP = /(?:做|画|生成)?(?:一个|一张)?/g

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
}

function findAll(source: string, dictionary: readonly string[]): string[] {
  return unique(dictionary.filter((item) => source.includes(item)))
}

function subjectsFrom(text: string): GenerationSubject[] {
  const found = KNOWN_SUBJECTS.map((name) => ({ name, index: text.indexOf(name) }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index)

  const fromDict = found.map((item, index) => {
    const previous = found[index - 1]
    const segmentStart = previous ? previous.index + previous.name.length : 0
    const segment = text.slice(segmentStart, item.index + item.name.length)
    const attributes = findAll(segment, KNOWN_COLORS)
    return attributes.length ? { name: item.name, attributes } : { name: item.name }
  })

  const added: GenerationSubject[] = []
  const addMatch = text.match(ADD_SUBJECT_PATTERN)
  if (addMatch?.[1]) {
    const name = addMatch[1].replace(/^(一个|一只|一条|一朵)/, '').trim()
    if (name && !fromDict.some((subject) => subject.name === name) && !KNOWN_SUBJECTS.includes(name)) {
      // Unknown short noun from「再加一个X」— still record it.
      if (name.length <= 8) added.push({ name })
    } else if (name && !fromDict.some((subject) => subject.name === name)) {
      const attrs = findAll(addMatch[0], KNOWN_COLORS)
      added.push(attrs.length ? { name, attributes: attrs } : { name })
    }
  }

  return [...fromDict, ...added]
}

function actionFrom(text: string): string | undefined {
  let best = ''
  for (const pattern of ACTION_PATTERNS) {
    const match = text.match(pattern)
    if (!match?.[0]) continue
    const phrase = match[0].replace(/^一起/, '一起').trim()
    if (phrase.length > best.length) best = phrase
  }
  return best || undefined
}

function forbiddenFrom(text: string): string[] | undefined {
  const match = text.match(FORBIDDEN_PATTERN)
  if (!match?.[1]) return undefined
  const items = match[1]
    .split(/[和与、,，]/)
    .map((item) => item.trim())
    .filter(Boolean)
  return items.length ? unique(items) : undefined
}

function requiredFrom(text: string): string[] | undefined {
  const match = text.match(REQUIRED_PATTERN)
  if (!match?.[1]) return undefined
  const items = match[1]
    .split(/[和与、,，]/)
    .map((item) => item.trim())
    .filter(Boolean)
  return items.length ? unique(items) : undefined
}

function environmentFrom(text: string): string | undefined {
  const cleaned = text.replace(ENVIRONMENT_STRIP, '').replace(/背景|底图|场景画/g, '').trim()
  return cleaned.length ? cleaned.slice(0, 80) : undefined
}

export class LocalCreationIntentParser implements CreationIntentParser {
  async parse(input: CreationIntentParseInput): Promise<GenerationSpecPatch> {
    const text = input.text.trim()
    const decided = input.lockedRole
      ? { role: input.lockedRole }
      : resolveAssetRoleFromText(text)
    const patch: GenerationSpecPatch = {}
    if (decided.role) patch.assetRole = decided.role

    const content: NonNullable<GenerationSpecPatch['content']> = {}
    const subjects = subjectsFrom(text)
    if (subjects.length) content.primarySubjects = subjects

    // Keep preferredColors only when they are not already attached to subjects.
    const attached = new Set(
      subjects.flatMap((subject) => subject.attributes ?? []).map((item) => item.trim())
    )
    const colors = findAll(text, KNOWN_COLORS).filter((color) => !attached.has(color))
    if (colors.length) content.preferredColors = colors

    const action = actionFrom(text)
    if (action) content.actionOrRelationship = action

    const forbidden = forbiddenFrom(text)
    if (forbidden) content.forbiddenElements = forbidden

    const required = requiredFrom(text)
    if (required) content.requiredElements = required

    const place = placeFrom(text)
    if (place) content.environmentDescription = place

    if (decided.role === 'background' && !content.environmentDescription) {
      const environment = environmentFrom(text)
      if (environment) content.environmentDescription = environment
    }

    bindPendingField(content, text, input.pendingField)

    if (Object.keys(content).length) patch.content = content
    return patch
  }
}

const PLACE_PATTERN = /(?:在)?(地上|草地上|水上|天上|桌子上|月亮上|花园里|院子里)/

function placeFrom(text: string): string | undefined {
  const match = text.match(PLACE_PATTERN)
  return match?.[1]
}

function bindPendingField(
  content: NonNullable<GenerationSpecPatch['content']>,
  text: string,
  pendingField: string | null | undefined
): void {
  if (!pendingField || !text) return
  if (pendingField === 'content.primarySubjects' && !content.primarySubjects?.length) {
    content.primarySubjects = [{ name: text.slice(0, 20) }]
    return
  }
  if (pendingField === 'content.actionOrRelationship' && !content.actionOrRelationship) {
    content.actionOrRelationship = text.slice(0, 40)
    return
  }
  if (
    (pendingField === 'content.preferredColors' || pendingField === 'content.subjectColors') &&
    !content.preferredColors?.length
  ) {
    const known = findAll(text, KNOWN_COLORS)
    // Never dump a non-color utterance (e.g.「坐在地上」) into preferredColors.
    if (known.length) content.preferredColors = known
    return
  }
  if (pendingField === 'content.requiredElements' && !content.requiredElements?.length) {
    content.requiredElements = text
      .split(/[和与、,，]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 6)
    return
  }
  if (pendingField === 'content.environmentDescription' && !content.environmentDescription) {
    content.environmentDescription = text.slice(0, 80)
  }
}
