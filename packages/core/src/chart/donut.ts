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

const CX = 50;
const CY = 40;
const RADIUS = 29;
const STROKE = 10;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const LEGEND_STEP = 11;

/**
 * Шрифт задаётся явным семейством, а не системным по умолчанию: рендер идёт в
 * контейнере, где системных шрифтов может не быть вовсе, и тогда текст молча
 * исчезает с картинки.
 */
const FONT = "'Noto Sans','DejaVu Sans',sans-serif";

export function donutSvg(segments: Segment[], options: DonutOptions): string {
  const visible = segments.filter((s) => s.value > 0);
  const legendRows = Math.min(options.legendRows ?? visible.length, visible.length, 8);
  const legendTop = CY + RADIUS + 16;
  const height = legendRows > 0 ? legendTop + legendRows * LEGEND_STEP : CY + RADIUS + 10;
  const size = options.size ?? 1040;

  const total = visible.reduce((sum, s) => sum + s.value, 0);
  const arcs: string[] = [];

  // Дуги кладём подряд по кругу: длина штриха — доля сегмента, поворот — сумма
  // всех предыдущих. Так не нужны выкладки для path.
  let offsetDeg = -90;
  for (const segment of visible) {
    const share = total > 0 ? segment.value / total : 0;
    const dash = share * CIRCUMFERENCE;

    arcs.push(
      `<circle cx="${CX}" cy="${CY}" r="${RADIUS}" fill="none" stroke="${segment.color}" ` +
        `stroke-width="${STROKE}" stroke-dasharray="${dash.toFixed(2)} ${(CIRCUMFERENCE - dash).toFixed(2)}" ` +
        `transform="rotate(${offsetDeg.toFixed(2)} ${CX} ${CY})"/>`,
    );

    offsetDeg += share * 360;
  }

  // В легенде только названия: точные суммы есть в подписи под картинкой, а
  // вдвоём в одной строке они наезжают друг на друга на длинных названиях.
  const legend = visible.slice(0, legendRows).map((s, i) => {
    const y = legendTop + i * LEGEND_STEP;
    const label = s.label.length > 22 ? `${s.label.slice(0, 21)}…` : s.label;
    return (
      `<rect x="14" y="${(y - 4.6).toFixed(1)}" width="6" height="6" rx="1.8" fill="${s.color}"/>` +
      `<text x="24" y="${y}" class="lg">${escapeXml(label)}</text>`
    );
  });

  const h = height.toFixed(0);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 ${h}" ` +
      `width="${size}" height="${Math.round((size * height) / 100)}">`,
    "<style>",
    `.tt{fill:#ffffff;font-family:${FONT};font-size:10px;font-weight:600}`,
    `.cp{fill:#b9aee0;font-family:${FONT};font-size:5px}`,
    `.lg{fill:#e7e2f7;font-family:${FONT};font-size:6px}`,
    "</style>",
    "<defs>",
    // Тот же градиент, что в приложении: картинка в чате и экран аппки должны
    // выглядеть одной вещью, а не двумя разными.
    '<linearGradient id="bg" x1="0" y1="0" x2="0.75" y2="1">',
    '<stop offset="0" stop-color="#2A1B57"/>',
    '<stop offset="0.38" stop-color="#4B2E8C"/>',
    '<stop offset="0.72" stop-color="#1E5F8F"/>',
    '<stop offset="1" stop-color="#0E7A6B"/>',
    "</linearGradient>",
    "</defs>",
    `<rect fill="url(#bg)" x="-2" y="-2" width="104" height="${Number(h) + 4}"/>`,
    `<circle cx="${CX}" cy="${CY}" r="${RADIUS}" fill="none" stroke="#ffffff22" stroke-width="${STROKE}"/>`,
    ...arcs,
    `<text x="${CX}" y="${CY + 2}" text-anchor="middle" class="tt">${escapeXml(options.total)}</text>`,
    `<text x="${CX}" y="${CY + 10}" text-anchor="middle" class="cp">${escapeXml(options.caption)}</text>`,
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
