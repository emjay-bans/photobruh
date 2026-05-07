const soundManager = {
  enabled: true,
  volume: 0.7,

  sounds: {
    click: new Audio("public/assets/sounds/click.mp3"),
    tick: new Audio("public/assets/sounds/tick.mp3"),
    shutter: new Audio("public/assets/sounds/shutter.mp3"),
    delete: new Audio("public/assets/sounds/delete.mp3"),
    success: new Audio("public/assets/sounds/success.mp3"),
    error: new Audio("public/assets/sounds/error.mp3")
  },

  init() {
    Object.values(this.sounds).forEach(sound => {
      sound.preload = "auto";
      sound.volume = this.volume;
    });
  },

  play(name) {
    if (!this.enabled || !this.sounds[name]) return;

    const sound = this.sounds[name];
    sound.currentTime = 0;
    sound.play().catch(() => {});
  },

  setVolume(value) {
    this.volume = value;
    Object.values(this.sounds).forEach(sound => {
      sound.volume = value;
    });
  },

  toggle() {
    this.enabled = !this.enabled;
  }
};

soundManager.init();

const muteBtn = document.getElementById("muteBtn");

muteBtn.addEventListener("click", () => {
  soundManager.toggle();
  muteBtn.textContent = soundManager.enabled ? "Sound: On" : "Sound: Off";
});

if (document.getElementById("volumeSlider")) {
  document.getElementById("volumeSlider").addEventListener("input", (e) => {
    soundManager.setVolume(e.target.value / 100);
  });
}
