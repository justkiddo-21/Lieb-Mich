// The edit: which scene plays when. Boundaries are anchored to lyric lines and the analysed
// sections, snapped to the beat grid, so they follow the aligned data (data/lyrics.json,
// data/audio.json). Plates are described in docs/TREATMENT.md.
import type { TimelineEntry } from './engine/engine';
import type { SceneClass } from './engine/scene';
import type { Lyrics } from './engine/lyrics';
import type { AudioData } from './engine/audio';

// Scene modules are discovered lazily so a missing/broken scene never breaks the build.
const modules = import.meta.glob<{ default: SceneClass }>('./scenes/*.ts');
const scene = (name: string) => () => {
  const m = modules[`./scenes/${name}.ts`];
  return m ? m() : Promise.reject(new Error(`scene module not found: scenes/${name}.ts`));
};

export function makeTimeline(ly: Lyrics, au: AudioData): TimelineEntry[] {
  /** Cut on the last beat at/before the first word of the matching line (never after the word). */
  const cut = (q: string, nth = 0, tol = 0.02) => {
    const s = ly.get(q, nth).words[0]!.start;
    return au.timeOfBeat(Math.floor(au.beatAt(s + tol)));
  };
  const sec = (name: string) => {
    const s = au.sections.find((x) => x.name === name);
    if (!s) throw new Error(`section not found: ${name}`);
    return s;
  };
  // the last chorus line ("Nur so macht Liebe sinn") of the 4th chorus gets the climax
  const lastLine = ly.find('Nur so macht Liebe sinn').length - 1;

  const b = {
    panther: cut('Ich verzehr mich'),
    // the pre-choruses cut a beat after their section starts: the verse's last word ("liegen") is
    // still ringing on the downbeat, and the raven's vortex snaps in on "Sanft" a beat later
    pre1: au.timeOfBeat(Math.round(au.beatAt(sec('pre1').start)) + 1),
    ch1: sec('chorus1').start,
    orbit: sec('interlude').start,
    telemetry: cut('Ja doch ich folg Dir'),
    pre2: au.timeOfBeat(Math.round(au.beatAt(sec('pre2').start)) + 1),
    ch2: sec('chorus2').start,
    brk: sec('break').start,
    ch3: sec('chorus3').start,
    climax: ly.get('Nur so macht Liebe sinn', lastLine).words[0]!.start - 0.03, // on the word: a beat of black before it reads as a glitch
    outro: sec('outro').start,
    end: au.duration,
  };

  const E = (id: string, file: string, start: number, end: number, extra: Partial<TimelineEntry> = {}): TimelineEntry =>
    ({ id, load: scene(file), start, end, ...extra });

  return [
    E('boot_seq', 'boot_seq', 0, b.panther),
    E('panther', 'panther', b.panther, b.pre1),
    E('raven1', 'raven', b.pre1, b.ch1, { params: { wind: 1 } }),
    E('chorus1', 'chorus_slam', b.ch1, b.orbit, { params: { level: 1 } }),
    E('orbit', 'orbit', b.orbit, b.telemetry),
    E('telemetry', 'telemetry', b.telemetry, b.pre2),
    E('raven2', 'raven', b.pre2, b.ch2, { params: { wind: 1.8 } }),
    E('chorus2', 'chorus_slam', b.ch2, b.brk, { params: { level: 2 } }),
    E('search', 'search', b.brk, b.ch3),
    E('chorus3', 'chorus_slam', b.ch3, b.climax, { params: { level: 3 } }),
    E('climax', 'climax', b.climax, b.outro),
    E('flatline', 'flatline', b.outro, b.end),
  ];
}
