// Guided tour: golden hour over the bay -> blue hour in the centre -> neon night,
// ending on the Skytree. Each stop flies in, then slowly orbits while the caption shows.

export const TOUR = [
  { id: 'panorama', hour: 16.85, hold: 7, orbit: 1.2, intro: true },
  { id: 'rainbow', hour: 17.05, hold: 8, orbit: 2.0 },
  { id: 'tokyotower', hour: 17.25, hold: 9, orbit: 3.0 },
  { id: 'azabudai', hour: 17.38, hold: 6, orbit: 2.5 },
  { id: 'palace', hour: 17.5, hold: 7, orbit: 1.6 },
  { id: 'tokyostation', hour: 17.62, hold: 7, orbit: 2.2 },
  { id: 'ginza', hour: 17.85, hold: 7, orbit: 2.4 },
  { id: 'tocho', hour: 18.1, hold: 8, orbit: 2.4 },
  { id: 'kabukicho', hour: 18.35, hold: 8, orbit: 3.0 },
  { id: 'shibuya', hour: 18.6, hold: 9, orbit: 3.4 },
  { id: 'akihabara', hour: 18.9, hold: 7, orbit: 3.0 },
  { id: 'asakusa', hour: 19.1, hold: 7, orbit: 2.6 },
  { id: 'skytree', hour: 19.35, hold: 10, orbit: 2.4 },
  { id: 'panorama', hour: 19.8, hold: 10, orbit: 1.2, outro: true },
];

export class Tour {
  constructor(app, director, places, ui) {
    this.app = app;
    this.director = director;
    this.places = new Map(places.map((p) => [p.id, p]));
    this.ui = ui;
    this.active = false;
    this.i = 0;
    this.timer = 0;
    this.phase = 'idle';
  }

  start(from = 0) {
    this.active = true;
    this.i = from;
    this.director.setMode('tour');
    this.ui.setTourActive(true);
    this._go();
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.phase = 'idle';
    this.app.env.timeScale = 0;
    this.ui.setTourActive(false);
    this.ui.hideCaption();
    this.director.anim = null;
    this.director.hold = null;
    this.director.setMode('orbit');
  }

  _go() {
    const step = TOUR[this.i];
    const place = this.places.get(step.id);
    this.phase = 'flying';
    this.ui.hideCaption();
    // move the clock towards this stop's hour during the flight
    this.fromHour = this.app.env.hours;
    this.toHour = step.hour;
    this.flightT = 0;
    this.director.flyTo(place, {
      hold: true,
      orbitSpeed: step.orbit,
      duration: this.i === 0 ? 3.5 : undefined,
      onArrive: () => {
        this.phase = 'holding';
        this.timer = step.hold;
        this.ui.showCaption(place, step, this.i, TOUR.length);
      },
    });
    this.flightDur = this.director.anim ? this.director.anim.duration : 3;
  }

  update(dt) {
    if (!this.active) return;
    if (this.phase === 'flying') {
      this.flightT = Math.min(1, this.flightT + dt / this.flightDur);
      let a = this.fromHour, b = this.toHour;
      if (b < a - 12) b += 24;
      this.app.env.setHours(a + (b - a) * this.flightT);
    } else if (this.phase === 'holding') {
      // let the clock creep forward a little while holding
      this.app.env.setHours(this.app.env.hours + dt * 0.004);
      this.timer -= dt;
      if (this.timer <= 0) {
        this.i++;
        if (this.i >= TOUR.length) this.stop();
        else this._go();
      }
    }
  }

  next() { if (this.active && this.i < TOUR.length - 1) { this.i++; this._go(); } }
  prev() { if (this.active && this.i > 0) { this.i--; this._go(); } }
}
