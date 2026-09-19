/**
 * 浏览器 demo 专用 AnimationService（含 CDN 示例 Lottie，仅 demo）
 * 正式实现：src/renderer/src/services/animation.service.ts
 */
(function (global) {
  var DEFAULT_LOTTIE_MAP = {
    collect: "https://assets1.lottiefiles.com/packages/lf20_jbrw3hcz.json",
    save: "https://assets1.lottiefiles.com/packages/lf20_jbrw3hcz.json",
    loading: "https://assets9.lottiefiles.com/packages/lf20_p8bfn5to.json",
  };

  function getLottie() {
    if (!global.lottie) throw new Error("lottie-web 未加载");
    return global.lottie;
  }

  function LottieAnimationService(map) {
    this.map = Object.assign({}, DEFAULT_LOTTIE_MAP, map || {});
    this.running = {};
    this.overlayHosts = {};
  }

  LottieAnimationService.prototype.setResourceMap = function (map) {
    this.map = Object.assign({}, this.map, map || {});
  };

  LottieAnimationService.prototype.play = async function (eventKey, target) {
    var path = this.map[eventKey];
    if (!path) {
      console.warn("[AnimationService] unknown eventKey:", eventKey);
      return;
    }
    this.stop(eventKey);
    var host = this._resolveHost(eventKey, target);
    var loop = eventKey === "loading";
    try {
      var anim = getLottie().loadAnimation({
        container: host,
        renderer: "svg",
        loop: loop,
        autoplay: true,
        path: path,
      });
      this.running[eventKey] = anim;
      if (loop) return;
      var self = this;
      await new Promise(function (resolve) {
        var done = false;
        function finish() {
          if (done) return;
          done = true;
          self.stop(eventKey);
          resolve();
        }
        anim.addEventListener("complete", finish);
        setTimeout(finish, 4000);
      });
    } catch (e) {
      console.warn("[AnimationService] play failed:", eventKey, e);
      this._cleanupHost(eventKey);
    }
  };

  LottieAnimationService.prototype.stop = function (eventKey) {
    var self = this;
    if (!eventKey) {
      Object.keys(this.running).forEach(function (k) {
        self.stop(k);
      });
      return;
    }
    var anim = this.running[eventKey];
    if (anim) {
      try {
        anim.stop();
        anim.destroy();
      } catch (e) {}
      delete this.running[eventKey];
    }
    this._cleanupHost(eventKey);
  };

  LottieAnimationService.prototype._resolveHost = function (eventKey, target) {
    if (target) return target;
    var host = this.overlayHosts[eventKey];
    if (host && document.body.contains(host)) return host;
    host = document.createElement("div");
    host.dataset.animKey = eventKey;
    host.style.cssText =
      "position:fixed;right:24px;bottom:24px;width:120px;height:120px;z-index:9999;pointer-events:none;";
    document.body.appendChild(host);
    this.overlayHosts[eventKey] = host;
    return host;
  };

  LottieAnimationService.prototype._cleanupHost = function (eventKey) {
    var host = this.overlayHosts[eventKey];
    if (!host || !host.dataset.animKey) return;
    try {
      host.remove();
    } catch (e) {}
    delete this.overlayHosts[eventKey];
  };

  global.LottieAnimationService = LottieAnimationService;
  global.animationService = new LottieAnimationService();
  global.DEFAULT_LOTTIE_MAP = DEFAULT_LOTTIE_MAP;
})(typeof window !== "undefined" ? window : globalThis);
