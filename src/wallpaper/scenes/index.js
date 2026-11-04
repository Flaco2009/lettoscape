// Szenen-Register. Neue Szene: Datei anlegen und hier eintragen.
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
  bergsee:      { name: 'Bergsee', shader: bergsee },
  camping:      { name: 'Camping-Platz', shader: camping },
  firewatch:    { name: 'Feuerwachturm', shader: firewatch },
  schloss:      { name: 'Verlassenes Schloss', shader: schloss },
  lichtung:     { name: 'Waldlichtung', shader: lichtung },
  jaegerhuette: { name: 'Jägerhütte', shader: jaegerhuette },
  muehle:       { name: 'Alte Mühle am Bach', shader: muehle },
  bahnhof:      { name: 'Verlassener Bahnhof', shader: bahnhof },
  kapelle:      { name: 'Waldrand-Kapelle', shader: kapelle },
  leuchtturm:   { name: 'Leuchtturm an der Küste', shader: leuchtturm },
};
