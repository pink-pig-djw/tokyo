// Shibuya: the Scramble Crossing and the buildings around it (see ./kit.js and
// tools/districts/shibuya.json). Heroes: Shibuya Scramble Square, QFRONT (Q's EYE), SHIBUYA109,
// MAGNET, Hikarie, Mark City East / West, Shibuya Stream, Cerulean Tower, Infos Tower and the
// Ginza line station; street: the five crosswalks (one diagonal), Hachiko square, the Ginza line
// viaduct into Mark City, the Center Gai gate, the LED screens and the sign streets.
import {
  scrambleSquare, qfront, shibuya109, hikarie, markCity, stream, cerulean, infosTower, magnet, jrStation,
} from './shibuya-heroes.js';
import { crossing, hachikoSquare, ginzaViaduct, ginzaStation, centerGaiGate, screens, signStreets } from './shibuya-street.js';
import { pointIn, ringDist } from './shibuya-util.js';

export default {
  build(kit, d) {
    const H = Object.fromEntries(d.heroes.map((h) => [h.key, h]));
    const S = Object.fromEntries(d.screens.map((s) => [s.key, s]));
    const street = (t) => d.street.find((s) => s.type === t);
    const center = d.center && d.center.x != null ? d.center : { x: -5380.9, z: 2274.5 };

    // keep-out test for crowds and trees: hero footprints plus added circles
    const rings = d.heroes.flatMap((h) => h.rings).concat(street('scramble_crossing')?.obstacles || []);
    const circles = [];
    const blockers = (x, z, r = 0.5) => rings.some((R) => pointIn(R, x, z) || ringDist(R, x, z) < r)
      || circles.some(([cx, cz, cr]) => Math.hypot(x - cx, z - cz) < cr + r);
    blockers.add = (x, z, r) => circles.push([x, z, r]);
    for (const [x, z, r] of street('scramble_crossing')?.keepout || []) blockers.add(x, z, r);

    if (H.scramble_square) scrambleSquare(kit, H.scramble_square);
    if (H.qfront) qfront(kit, H.qfront, S);
    if (H.shibuya109) shibuya109(kit, H.shibuya109, center);
    if (H.magnet) magnet(kit, H.magnet);
    if (H.hikarie) hikarie(kit, H.hikarie);
    const via = street('ginza_line_viaduct');
    if (H.markcity_east) markCity(kit, H.markcity_east, 19, via && via.portal);
    if (H.markcity_west) markCity(kit, H.markcity_west, 20, null);
    if (H.stream) stream(kit, H.stream);
    if (H.cerulean) cerulean(kit, H.cerulean);
    if (H.infos_tower) infosTower(kit, H.infos_tower);
    if (H.jr_station) jrStation(kit, H.jr_station);
    if (H.ginza_station) ginzaStation(kit, H.ginza_station, via);
    ginzaViaduct(kit, via);

    crossing(kit, d, blockers);
    hachikoSquare(kit, street('hachiko_square'), blockers);
    centerGaiGate(kit, street('center_gai_gate'));
    // the big crossing screens often run one campaign in sync (Q's EYE main screen uses seed 7)
    const SYNC = { ekimae_vision: 7, shibuhachi_hit_vision: 7, synchro7_w: 23, synchro7_s: 23, synchro7_wall: 23 };
    screens(kit, d.screens, new Set(['qs_eye', 'coke_vision']), SYNC);
    signStreets(kit, d.signStreets || []);
  },
};
