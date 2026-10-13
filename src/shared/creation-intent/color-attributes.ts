/** Attributes also contain size/shape; they must not all be displayed as colors. */
export function colorAttributes(attributes: readonly string[] = []): string[] {
  return attributes.map(value => value.trim()).filter(value =>
    /色|黑白|黑|白|红|橙|黄|绿|青|蓝|紫|粉|棕|褐|灰|金|银/.test(value)
  )
}
