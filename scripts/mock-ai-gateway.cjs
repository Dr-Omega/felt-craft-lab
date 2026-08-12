/**
 * Minimal local mock AI Gateway for Electron AI smoke (no paid providers).
 * Endpoints: /api/health, /api/session/token, ASR/QA/TTS with Bearer session.
 */
const http = require('node:http')
const crypto = require('node:crypto')

const PORT = Number(process.env.MOCK_AI_GATEWAY_PORT || 0)

// In-memory record of the last 16 QA /api/qa/ask calls. Used by the
// acceptance script to assert that the second / third calls actually
// carried the previous turns as history (not just an empty array).
const qaCallLog = []

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function issueToken(installationId) {
  const exp = Math.floor(Date.now() / 1000) + 3600
  const payload = b64url(
    JSON.stringify({ installationId, iat: exp - 3600, exp, jti: crypto.randomBytes(8).toString('hex') })
  )
  const sig = b64url(crypto.createHmac('sha256', 'mock-smoke-hmac').update(payload).digest())
  return { token: `${payload}.${sig}`, expiresAt: exp, installationId }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function hasAuth(req) {
  const auth = req.headers.authorization || ''
  const iid = req.headers['x-felt-installation-id'] || ''
  return Boolean(auth.startsWith('Bearer ') && iid)
}

function send(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  })
  res.end(body)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1`)
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, { ok: true, service: 'mock-ai-gateway' })
    }
    if (req.method === 'GET' && url.pathname === '/api/_mock/qa-calls') {
      // Debug endpoint: returns the last QA calls (with question + history).
      // Used only by the acceptance script to verify that history is
      // actually flowing through the chain — not part of any real protocol.
      return send(res, 200, { ok: true, calls: qaCallLog.slice() })
    }
    if (req.method === 'POST' && url.pathname === '/api/session/token') {
      const raw = await readBody(req)
      const data = JSON.parse(raw.toString('utf8') || '{}')
      const installationId = String(data.installationId || '')
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          installationId
        )
      ) {
        return send(res, 400, {
          ok: false,
          error: { code: 'INVALID_ARGUMENT', message: 'bad installationId', retryable: false }
        })
      }
      return send(res, 200, { ok: true, result: issueToken(installationId.toLowerCase()) })
    }
    if (req.method === 'POST' && url.pathname === '/api/asr/transcribe') {
      if (!hasAuth(req)) {
        return send(res, 401, {
          ok: false,
          error: { code: 'INVALID_ARGUMENT', message: '会话无效', retryable: true }
        })
      }
      await readBody(req)
      return send(res, 200, {
        ok: true,
        result: {
          transcript: '晚上会亮吗？',
          provider: 'qwen_cloud_http',
          durationMs: 12,
          requestId: 'mock-asr'
        }
      })
    }
    if (req.method === 'POST' && url.pathname === '/api/qa/ask') {
      if (!hasAuth(req)) {
        return send(res, 401, {
          ok: false,
          error: { code: 'INVALID_ARGUMENT', message: '会话无效', retryable: true }
        })
      }
      const raw = await readBody(req)
      const data = JSON.parse(raw.toString('utf8') || '{}')
      const question = typeof data.question === 'string' ? data.question.trim() : ''
      const history = Array.isArray(data.history) ? data.history : []
      const validHistory = history.every((entry) =>
        entry && (entry.role === 'user' || entry.role === 'assistant') && typeof entry.content === 'string'
      )
      if (!validHistory || history.length > 12) {
        return send(res, 400, {
          ok: false,
          error: { code: 'INVALID_ARGUMENT', message: 'bad history', retryable: false }
        })
      }
      // Branched deterministic answers. The acceptance script uses these
      // exact question strings to drive a coherent multi-turn conversation
      // (so the screenshots stop looking like a broken product).
      const answer = (() => {
        if (question === '你叫什么名字？') return '我叫莲花河灯呀！'
        if (question === '那你平时会在哪里？') return '我会漂在水面上，晚上亮起来很好看。'
        if (question === '你晚上会亮吗？') return '会呀，点亮以后我会在水面上发光。'
        return '我在这里呢。'
      })()
      qaCallLog.push({ question, historyLength: history.length, history: history.slice(), answer, at: Date.now() })
      if (qaCallLog.length > 16) qaCallLog.shift()
      return send(res, 200, {
        ok: true,
        result: {
          answer,
          safetyAction: 'allow',
          requestId: 'mock-qa'
        }
      })
    }
    if (req.method === 'POST' && url.pathname === '/api/tts/synthesize') {
      if (!hasAuth(req)) {
        return send(res, 401, {
          ok: false,
          error: { code: 'INVALID_ARGUMENT', message: '会话无效', retryable: true }
        })
      }
      await readBody(req)
      const audioBase64 = Buffer.from('ID3mock-dynamic-tts').toString('base64')
      return send(res, 200, {
        ok: true,
        result: {
          audioBase64,
          cacheHit: false,
          requestId: 'abcd1234abcd1234abcd1234abcd1234'
        }
      })
    }
    send(res, 404, {
      ok: false,
      error: { code: 'UNKNOWN', message: 'not found', retryable: false }
    })
  } catch (error) {
    send(res, 500, {
      ok: false,
      error: { code: 'UNKNOWN', message: String(error), retryable: true }
    })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : PORT
  process.stdout.write(`MOCK_AI_GATEWAY_READY port=${port}\n`)
})
