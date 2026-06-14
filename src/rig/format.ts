// Спільний формат рігу: його експортує редактор (rig.html) і читає гра.
// Cutout-скелет: дерево кісток, кожна тримає одну картинку-частину; анімації —
// ключі обертання/зсуву на кістках.

export interface RigPart {
  name: string;
  image: string; // ім'я файлу PNG (ключ у атласі гри)
  parent: string | null; // ім'я батьківської кістки
  z: number; // порядок малювання (більший = ближче до камери)
  pivotX: number; // точка обертання/кріплення в просторі картинки (0..1)
  pivotY: number;
  x: number; // bind-зсув від півота батька (у системі батька)
  y: number;
  rotation: number; // bind-кут, градуси
}

export interface Keyframe {
  t: number; // час у секундах
  rotation: number;
  x: number;
  y: number;
}

export interface Clip {
  name: string;
  duration: number; // секунди
  loop: boolean;
  tracks: Record<string, Keyframe[]>; // ім'я кістки -> ключі
}

export interface RigDoc {
  version: 1;
  parts: RigPart[];
  clips: Clip[];
}

export function emptyRig(): RigDoc {
  return { version: 1, parts: [], clips: [] };
}

// Лінійна вибірка треку в момент t (повертає {rotation,x,y}).
export function sampleTrack(track: Keyframe[], t: number): { rotation: number; x: number; y: number } {
  if (track.length === 0) return { rotation: 0, x: 0, y: 0 };
  if (t <= track[0].t) return { rotation: track[0].rotation, x: track[0].x, y: track[0].y };
  const last = track[track.length - 1];
  if (t >= last.t) return { rotation: last.rotation, x: last.x, y: last.y };
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i];
    const b = track[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = (t - a.t) / (b.t - a.t || 1);
      return {
        rotation: a.rotation + (b.rotation - a.rotation) * f,
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
      };
    }
  }
  return { rotation: last.rotation, x: last.x, y: last.y };
}
