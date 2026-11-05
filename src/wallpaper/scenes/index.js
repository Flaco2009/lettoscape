// Scene registry. New scene: create a file and register it here.
import bergsee from './bergsee.js';
import camping from './camping.js';
import firewatch from './firewatch.js';
import schloss from './schloss.js';
import lichtung from './lichtung.js';
import jaegerhuette from './jaegerhuette.js';
import muehle from './muehle.js';
import bahnhof from './bahnhof.js';
import kapelle from './kapelle.js';
import leuchtturm from './leuchtturm.js';

export const scenes = {
  bergsee:      { name: 'Mountain Lake', shader: bergsee },
  camping:      { name: 'Campsite', shader: camping },
  firewatch:    { name: 'Fire Watchtower', shader: firewatch },
  schloss:      { name: 'Abandoned Castle', shader: schloss },
  lichtung:     { name: 'Forest Clearing', shader: lichtung },
  jaegerhuette: { name: 'Hunter's Cabin', shader: jaegerhuette },
  muehle:       { name: 'Old Mill by the Creek', shader: muehle },
  bahnhof:      { name: 'Abandoned Station', shader: bahnhof },
  kapelle:      { name: 'Chapel at the Forest Edge', shader: kapelle },
  leuchtturm:   { name: 'Lighthouse on the Coast', shader: leuchtturm },
};
