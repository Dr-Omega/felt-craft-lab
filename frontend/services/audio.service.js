/**
 * 浏览器可直接用的 AudioService（无打包也可跑 demo）
 * 与 audio.service.ts 行为一致；依赖同目录 audio-url.js（可选）。
 */
(function (global) {
  function getHowl() {
    if (!global.Howl) {
      throw new Error("Howler.js 未加载");
    }
    return global.Howl;
  }

  function toPlayable(url) {
    if (global.toPlayableAudioUrl) return global.toPlayableAudioUrl(url);
    // 内联兜底：非 Electron 时把 felt-resource 映射到 /generated-audio/
    if (
      typeof url === "string" &&
      url.indexOf("felt-resource://audio/") === 0 &&
      !(global.window && global.window.electronAPI)
    ) {
      return "/generated-audio/" + url.slice("felt-resource://audio/".length);
    }
    return url;
  }

  function HowlerAudioService() {
    this.primary = null;
    this.effect = null;
    this.effectsEnabled = true;
  }

  HowlerAudioService.prototype.play = async function (url, channel) {
    channel = channel || "primary";
    if (!url) return;
    if (channel === "effect" && !this.effectsEnabled) return;
    var playable = toPlayable(url);

    try {
      if (channel === "primary") {
        this.stop("primary");
        this.primary = this._create(playable);
        await this._play(this.primary);
        return;
      }
      this.stop("effect");
      this.effect = this._create(playable);
      await this._play(this.effect);
    } catch (e) {
      console.warn("[AudioService] play failed:", url, "→", playable, e);
    }
  };

  HowlerAudioService.prototype.stop = function (channel) {
    if (!channel || channel === "primary") this._dispose("primary");
    if (!channel || channel === "effect") this._dispose("effect");
  };

  HowlerAudioService.prototype.setEffectsEnabled = function (enabled) {
    this.effectsEnabled = !!enabled;
    if (!this.effectsEnabled) this.stop("effect");
  };

  HowlerAudioService.prototype._create = function (url) {
    var Howl = getHowl();
    return new Howl({
      src: [url],
      html5: true,
      preload: true,
    });
  };

  HowlerAudioService.prototype._play = function (sound) {
    return new Promise(function (resolve) {
      var settled = false;
      var done = function () {
        if (settled) return;
        settled = true;
        resolve();
      };
      sound.on("end", done);
      sound.on("loaderror", done);
      sound.on("playerror", done);
      try {
        sound.play();
      } catch (e) {
        done();
      }
    });
  };

  HowlerAudioService.prototype._dispose = function (channel) {
    var cur = channel === "primary" ? this.primary : this.effect;
    if (!cur) return;
    try {
      cur.stop();
      cur.unload();
    } catch (e) {}
    if (channel === "primary") this.primary = null;
    else this.effect = null;
  };

  global.HowlerAudioService = HowlerAudioService;
})(typeof window !== "undefined" ? window : globalThis);
