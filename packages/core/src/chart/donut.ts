/**
 * Кольцо по категориям.
 *
 * Одна реализация на обе поверхности: приложение вставляет этот SVG как есть,
 * бот рендерит его в PNG. Две отдельные рисовалки со временем разъехались бы.
 */

export type Segment = {
  label: string;
  value: number;
  color: string;
};

/** Палитра Aurora. Категорий может быть больше — цвета идут по кругу. */
export const PALETTE = [
  "#5DE0B4",
  "#A78BFA",
  "#FCA277",
  "#8AB4F8",
  "#F0A6C8",
  "#E9D27A",
  "#7BE8C0",
  "#B5A6F5",
];

export type DonutOptions = {
  size?: number;
  /** Крупная надпись в центре — обычно общая сумма. */
  total: string;
  /** Мелкая подпись под ней — период. */
  caption: string;
  /** Сколько строк легенды рисовать под кольцом. Ноль — только кольцо. */
  legendRows?: number;
};

const RADIUS = 40;
const STROKE = 13;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function donutSvg(segments: Segment[], options: DonutOptions): string {
  const size = options.size ?? 420;
  const legendRows = options.legendRows ?? Math.min(segments.length, 6);
  const legendHeight = legendRows * 15 + (legendRows > 0 ? 10 : 0);
  const height = 100 + legendHeight;

  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const arcs: string[] = [];

  // Дуги кладём подряд по кругу: длина штриха — доля сегмента, поворот —
  // сумма всех предыдущих. Так не нужны математические выкладки для path.
  let offsetDeg = -90;
  for (const segment of segments) {
    if (segment.value <= 0 || total <= 0) continue;
    const share = segment.value / total;
    const dash = share * CIRCUMFERENCE;

    arcs.push(
      `<circle cx="50" cy="50" r="${RADIUS}" fill="none" stroke="${segment.color}" ` +
        `stroke-width="${STROKE}" stroke-dasharray="${dash.toFixed(2)} ${(CIRCUMFERENCE - dash).toFixed(2)}" ` +
        `transform="rotate(${offsetDeg.toFixed(2)} 50 50)"/>`,
    );

    offsetDeg += share * 360;
  }

  const legend = segments.slice(0, legendRows).map((s, i) => {
    const y = 108 + i * 15;
    const percent = total > 0 ? Math.round((s.value / total) * 100) : 0;
    return (
      `<rect x="4" y="${y - 7}" width="8" height="8" rx="2" fill="${s.color}"/>` +
      `<text x="17" y="${y}" class="lg">${escapeXml(s.label)}</text>` +
      `<text x="96" y="${y}" class="lg rt" text-anchor="end">${percent}%</text>`
    );
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 ${height}" width="${size}" height="${Math.round((size * height) / 100)}">`,
    "<style>",
    ".bg{fill:#2A1B57}",
    ".tt{fill:#ffffff;font:600 15px system-ui,sans-serif}",
    ".cp{fill:#b9aee0;font:400 7px system-ui,sans-serif}",
    ".lg{fill:#e7e2f7;font:400 8px system-ui,sans-serif}",
    ".rt{fill:#b9aee0}",
    "</style>",
    `<rect class="bg" x="0" y="0" width="100" height="${height}"/>`,
    `<circle cx="50" cy="50" r="${RADIUS}" fill="none" stroke="#ffffff22" stroke-width="${STROKE}"/>`,
    ...arcs,
    `<text x="50" y="49" text-anchor="middle" class="tt">${escapeXml(options.total)}</text>`,
    `<text x="50" y="60" text-anchor="middle" class="cp">${escapeXml(options.caption)}</text>`,
    ...legend,
    "</svg>",
  ].join("");
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
