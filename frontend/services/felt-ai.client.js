/**
 * 浏览器 Demo 用轻量 HTTP 封装（非正式 Electron 路径）。
 * 正式页面请用 window.electronAPI.ai.*。
 *
 * 付费接口需短期 Session Token：本客户端会自动申请并缓存。
 */

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim()
  );
}

export class FeltAiClient {
  constructor(baseUrl = "http://127.0.0.1:8788") {
    this.baseUrl = String(baseUrl).replace(/\/$/, "");
    this._installationId = null;
    this._token = null;
    this._expiresAt = 0;
  }

  async health() {
    return this.getJson("/api/health");
  }

  /** @param {Blob} audioBlob */
  async transcribe(audioBlob, options = {}) {
    await this.ensureSession();
    const form = new FormData();
    form.append("file", audioBlob, options.filename || "recording.webm");
    if (options.language) form.append("language", options.language);
    if (options.sessionId) form.append("sessionId", options.sessionId);
    if (options.provider) form.append("provider", options.provider);
    const res = await fetch(`${this.baseUrl}/api/asr/transcribe`, {
      method: "POST",
      headers: this.authHeaders(),
      body: form,
    });
    return res.json();
  }

  async ask({ question, asset, provider }) {
    return this.postJson("/api/qa/ask", { question, asset, provider });
  }

  async synthesize(text, voicePurpose = "qa_answer", provider) {
    return this.postJson("/api/tts/synthesize", {
      text,
      voicePurpose,
      provider,
    });
  }

  /** 把相对 audioUrl 拼成可播放绝对地址 */
  resolveAudioUrl(audioUrl) {
    if (!audioUrl) return "";
    if (/^https?:\/\//i.test(audioUrl)) return audioUrl;
    return `${this.baseUrl}${audioUrl.startsWith("/") ? "" : "/"}${audioUrl}`;
  }

  authHeaders() {
    if (!this._token || !this._installationId) return {};
    return {
      Authorization: `Bearer ${this._token}`,
      "X-Felt-Installation-Id": this._installationId,
    };
  }

  async ensureSession(force = false) {
    const now = Math.floor(Date.now() / 1000);
    if (!force && this._token && this._expiresAt > now + 60) return;
    if (!this._installationId || !isUuid(this._installationId)) {
      this._installationId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : "00000000-0000-4000-8000-000000000001";
    }
    const res = await fetch(`${this.baseUrl}/api/session/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installationId: this._installationId }),
    });
    const body = await res.json();
    if (!body?.ok || !body.result?.token) {
      throw new Error("session token issue failed");
    }
    this._token = body.result.token;
    this._expiresAt = Number(body.result.expiresAt) || now + 3000;
  }

  async getJson(path) {
    const res = await fetch(`${this.baseUrl}${path}`);
    return res.json();
  }

  async postJson(path, body) {
    await this.ensureSession();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.authHeaders(),
      },
      body: JSON.stringify(body || {}),
    });
    if (res.status === 401) {
      await this.ensureSession(true);
      const retry = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify(body || {}),
      });
      return retry.json();
    }
    return res.json();
  }
}

export default FeltAiClient;
