// The United States as dots, for the customer map on the home page (CustomerMap.tsx). Pure: no DOM, no React.
//
// The dots sit on a honeycomb grid: one unit apart along a row, rows 0.866 apart, every second row moved half a
// unit across. `ROWS` says which places on each row are land, as runs of columns ("3-39" is columns 3 to 39).
// Every dot knows the big city it is nearest to and how strongly that city lights it (`glow`, 0 to 1), so the
// map can glow where people are and each city can breathe by itself.

const ROWS = [
  "3-39",
  "0 3-41 43 46",
  "1-2 4-48",
  "1-49",
  "2-51 71-72",
  "1-51 70-72",
  "2-52 70-72",
  "1-53 69-72",
  "2-54 64-73",
  "1-53 62-72",
  "2-54 62-70",
  "1-53 58-69",
  "1-54 59-68",
  "1-53 57-68",
  "2-53 55-70",
  "1-67",
  "1-67",
  "1-64",
  "2-64",
  "2-63",
  "2-63",
  "2-62",
  "4-61",
  "3-61",
  "4-62",
  "4-62",
  "5-62",
  "5-61",
  "7-60",
  "8-58",
  "10-58",
  "10-56",
  "15-56",
  "17-20 24-55",
  "25-55",
  "26-54",
  "26-45 51 53-55",
  "27 31-37 43-44 53-55",
  "32-36 54-56",
  "32-35 54-56",
  "33-35 54-56",
  "33-34 54-56",
  "34-35 55-57",
  "56",
];

/** The drawing's own coordinate box (an SVG viewBox). */
export const MAP_VIEW = { x: -2, y: 0, w: 77, h: 41 };

const Y0 = 2.6;
const DY = 0.866;

const rowY = (row: number) => Math.round((Y0 + row * DY) * 100) / 100;
const rowShift = (row: number) => (row % 2 ? 0.5 : 0);

/** Where a real place falls on the grid, moved onto the nearest dot. Good to about one dot. */
export function place(lon: number, lat: number): { x: number; y: number } {
  const row = Math.min(ROWS.length - 1, Math.max(0, Math.round((49 - lat) * 1.79)));
  const shift = rowShift(row);
  return { x: Math.round((lon + 124.5) * 1.252 + 1 - shift) + shift, y: rowY(row) };
}

// Big metro areas and how strongly each one glows.
const CITIES: [lon: number, lat: number, weight: number][] = [
  [-74.0, 40.7, 1], // New York
  [-118.2, 34.0, 1], // Los Angeles
  [-87.6, 41.9, 0.9], // Chicago
  [-97.7, 30.3, 0.9], // Austin
  [-122.4, 37.8, 0.9], // San Francisco
  [-105.0, 39.7, 0.8], // Denver
  [-96.8, 32.8, 0.75], // Dallas
  [-84.4, 33.7, 0.8], // Atlanta
  [-80.2, 25.8, 0.85], // Miami
  [-122.3, 47.6, 0.75], // Seattle
  [-71.1, 42.4, 0.7], // Boston
  [-112.1, 33.4, 0.65], // Phoenix
  [-93.3, 45.0, 0.6], // Minneapolis
];

const SPREAD = 2.6; // how far a city's glow reaches, in dots

/** The same small "random" number for the same dot every time, so the server and the browser draw one map. */
function grain(x: number, y: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

export const CITY_COUNT = CITIES.length;

export type MapDot = {
  x: number;
  y: number;
  /** how strongly the nearest big city lights this dot, 0..1 */
  glow: number;
  /** which city that is (an index below CITY_COUNT) */
  city: number;
  /** this dot's own fixed number, 0..1, for giving each dot its own timing */
  grain: number;
};

export function mapDots(): MapDot[] {
  const cities = CITIES.map(([lon, lat, weight]) => ({ ...place(lon, lat), weight }));
  const dots: MapDot[] = [];
  ROWS.forEach((runs, row) => {
    const y = rowY(row);
    for (const run of runs.split(" ")) {
      const [from, to = from] = run.split("-").map(Number);
      for (let col = from; col <= to; col++) {
        const x = col + rowShift(row);
        let glow = 0;
        let city = 0;
        cities.forEach((c, k) => {
          const d2 = (x - c.x) ** 2 + (y - c.y) ** 2;
          const g = c.weight * Math.exp(-d2 / (2 * SPREAD * SPREAD));
          if (g > glow) {
            glow = g;
            city = k;
          }
        });
        dots.push({ x, y, glow, city, grain: grain(x, y) });
      }
    }
  });
  return dots;
}
