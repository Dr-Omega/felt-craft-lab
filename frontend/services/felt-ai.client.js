/**
 * 给 SXY 的轻量 HTTP 封装（可选）
 * 基址默认 http://127.0.0.1:8788，可按联调环境改。
 *
 * 用法示例：
 *   const api = new FeltAiClient();
 *   const asr = await api.transcribe(blob);
 *   const qa  = await api.ask({ question, asset });
 *   const tts = await api.synthesize(answerText);
 */

export class FeltAiClient {
  constructor(baseUrl = "http://127.0.0.1:8788") {
    this.baseUrl = String(baseUrl).replace(/\/$/, "");
  }

  async health() {
    return this.getJson("/api/health");
  }

  /** @param {Blob} audioBlob */
  async transcribe(audioBlob, options = {}) {
    const form = new FormData();
    form.append("file", audioBlob, options.filename || "recording.webm");
    if (options.language) form.append("language", options.language);
    if (options.sessionId) form.append("sessionId", options.sessionId);
    if (options.provider) form.append("provider", options.provider);
    const res = await fetch(`${this.baseUrl}/api/asr/transcribe`, {
      method: "POST",
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

  async getJson(path) {
    const res = await fetch(`${this.baseUrl}${path}`);
    return res.json();
  }

  async postJson(path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    return res.json();
  }
}

export default FeltAiClient;
