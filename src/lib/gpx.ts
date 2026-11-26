import type { TrackPoint, Trip } from './types';

function esc(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}

/** GPX 1.1 export of a trip, with laps as waypoints. */
export function toGpx(trip: Trip, points: TrackPoint[], name: string): string {
  const segs: TrackPoint[][] = [];
  for (const p of points) {
    if (!segs.length || segs[segs.length - 1][0].s !== p.s) segs.push([]);
    segs[segs.length - 1].push(p);
  }
  const wpts = trip.laps
    .filter((l) => l.lat != null && l.lon != null)
    .map((l) => `  <wpt lat="${l.lat}" lon="${l.lon}"><name>${l.auto ? 'Split' : 'Lap'} ${l.n}</name></wpt>`)
    .join('\n');
  const trk = segs
    .map(
      (seg) =>
        `    <trkseg>\n${seg
          .map(
            (p) =>
              `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">${p.alt != null ? `<ele>${p.alt.toFixed(1)}</ele>` : ''}<time>${new Date(p.t).toISOString()}</time><extensions><speed>${p.spd.toFixed(2)}</speed></extensions></trkpt>`,
          )
          .join('\n')}\n    </trkseg>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Fury" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name><time>${new Date(trip.startedAt).toISOString()}</time></metadata>
${wpts}
  <trk>
    <name>${esc(name)}</name>
${trk}
  </trk>
</gpx>
`;
}
