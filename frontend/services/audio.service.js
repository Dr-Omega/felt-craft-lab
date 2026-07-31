/**
 * 浏览器可直接用的 AudioService（无打包也可跑 demo）
 * 与 audio.service.ts 行为一致。
 */
(function (global) {
  function getHowl() {
    if (!global.Howl) {
      throw new Error("Howler.js 未加载");
    }
    return global.Howl;
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

    try {
      if (channel === "primary") {
        this.stop("primary");
        this.primary = this._create(url);
        await this._play(this.primary);
        return;
      }
      this.stop("effect");
      this.effect = this._create(url);
      await this._play(this.effect);
    } catch (e) {
      console.warn("[AudioService] play failed:", url, e);
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
    return new Howl({ src: [url], html5: true, preload: true });
  };

  HowlerAudioService.prototype._play = function (sound) {
    return new Promise(function (resolve) {
      var settled = false;
      function done() {
        if (settled) return;
        settled = true;
        resolve();
      }
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
    var current = channel === "primary" ? this.primary : this.effect;
    if (!current) return;
    try {
      current.stop();
      current.unload();
    } catch (e) {}
    if (channel === "primary") this.primary = null;
    else this.effect = null;
  };

  global.HowlerAudioService = HowlerAudioService;
  global.audioService = new HowlerAudioService();
})(typeof window !== "undefined" ? window : globalThis);
