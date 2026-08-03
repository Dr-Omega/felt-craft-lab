/**
 * 浏览器脚本版 audio-url（挂到 global，供 demo 使用）
 */
(function (global) {
  var FELT_AUDIO_PREFIX = "felt-resource://audio/";

  function isFeltResourceAudioRef(url) {
    return typeof url === "string" && url.indexOf(FELT_AUDIO_PREFIX) === 0;
  }

  function feltAudioRelativePath(url) {
    if (!isFeltResourceAudioRef(url)) return null;
    var rel = url.slice(FELT_AUDIO_PREFIX.length).replace(/^\/+/, "");
    if (!rel || rel.indexOf("..") >= 0 || rel.indexOf("\\") >= 0) return null;
    return rel;
  }

  function isElectronRenderer() {
    try {
      return Boolean(
        (typeof window !== "undefined" && window.electronAPI) ||
          global.electronAPI
      );
    } catch (e) {
      return false;
    }
  }

  function toPlayableAudioUrl(url, options) {
    options = options || {};
    if (!url) return "";
    var rel = feltAudioRelativePath(url);
    if (rel) {
      var useHttp = options.forceHttpFallback === true || !isElectronRenderer();
      if (!useHttp) return url;
      var base = String(options.httpFallbackBase || "").replace(/\/$/, "");
      return base + "/generated-audio/" + rel;
    }
    return url;
  }

  global.isFeltResourceAudioRef = isFeltResourceAudioRef;
  global.feltAudioRelativePath = feltAudioRelativePath;
  global.isElectronRenderer = isElectronRenderer;
  global.toPlayableAudioUrl = toPlayableAudioUrl;
})(typeof window !== "undefined" ? window : globalThis);
