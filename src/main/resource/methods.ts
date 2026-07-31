export const FELT_RESOURCE_ALLOWED_METHODS = ['GET', 'HEAD', 'OPTIONS'] as const
export const FELT_RESOURCE_ALLOW_HEADER = FELT_RESOURCE_ALLOWED_METHODS.join(', ')

const ALLOWED_METHOD_SET = new Set<string>(FELT_RESOURCE_ALLOWED_METHODS)

export function isFeltResourceMethodAllowed(method: string): boolean {
  return ALLOWED_METHOD_SET.has(method.toUpperCase())
}

export function methodNotAllowedResponse(): Response {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: {
      Allow: FELT_RESOURCE_ALLOW_HEADER,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': FELT_RESOURCE_ALLOW_HEADER,
      'content-type': 'text/plain; charset=utf-8'
    }
  })
}
