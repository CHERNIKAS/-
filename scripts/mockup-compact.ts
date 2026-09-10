import { writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

const W = 380, H = 760, FONT = "'Segoe UI','Noto Sans','DejaVu Sans',sans-serif";
const MINT = "#5DE0B4", VIOLET = "#A78BFA", CORAL = "#FCA277", BLUE = "#8AB4F8";

const text = (x: number, y: number, t: string, size = 15, fill = "#fff", weight = 400, anchor = "start") =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${t}</text>`;
const label = (x: number, y: number, t: string) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="11.5" letter-spacing="1.2" fill="#ffffff6b">${t}</text>`;
const chip = (x: number, y: number, w: number, t: string, active = false) =>
  `<rect x="${x}" y="${y}" width="${w}" height="32" rx="16" fill="${active ? MINT : "#ffffff10"}" stroke="${active ? "none" : "#ffffff24"}"/>` +
  text(x + w / 2, y + 21, t, 12.5, active ? "#10233a" : "#ffffffa8", active ? 600 : 400, "middle");

const phone = (x: number, body: string, title: string) => `
  <defs>
    <linearGradient id="g${x}" x1="0" y1="0" x2="0.7" y2="1">
      <stop offset="0" stop-color="#2a1b57"/><stop offset="0.34" stop-color="#43277f"/>
      <stop offset="0.7" stop-color="#1f5c8d"/><stop offset="1" stop-color="#0f7a6d"/>
    </linearGradient>
    <clipPath id="c${x}"><rect x="${x}" y="46" width="${W}" height="${H}" rx="34"/></clipPath>
  </defs>
  ${text(x + W / 2, 32, title, 14, "#ffffff8a", 500, "middle")}
  <g clip-path="url(#c${x})">
    <rect x="${x}" y="46" width="${W}" height="${H}" fill="url(#g${x})"/>
    ${body}
  </g>
  <rect x="${x}" y="46" width="${W}" height="${H}" rx="34" fill="none" stroke="#ffffff33" stroke-width="1.5"/>`;

const donut = (cx: number, cy: number, r: number, sw: number, parts: [number, string][]) => {
  const C = 2 * Math.PI * r;
  let deg = -90;
  const arcs = parts.map(([share, color]) => {
    const a = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-dasharray="${(share * C).toFixed(1)} ${(C - share * C).toFixed(1)}" transform="rotate(${deg.toFixed(1)} ${cx} ${cy})"/>`;
    deg += share * 360;
    return a;
  }).join("");
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#ffffff1f" stroke-width="${sw}"/>${arcs}`;
};

const row = (x: number, y: number, color: string, sign: string, name: string, amount: string, sub: string) =>
  `<rect x="${x + 16}" y="${y}" width="30" height="30" rx="10" fill="${color}22" stroke="${color}3d"/>` +
  text(x + 31, y + 20, sign, 13, color, 600, "middle") +
  text(x + 56, y + 20, name, 14.5, "#fff", 500) +
  text(x + W - 16, y + 14, amount, 14.5, "#fff", 600, "end") +
  text(x + W - 16, y + 30, sub, 12, "#ffffff6b", 400, "end");

// --- было ---
const before = [
  chip(58, 78, 74, "День"), chip(140, 78, 88, "Неделя"), chip(236, 78, 92, "30 дней", true),
  chip(58, 120, 84, "Месяц"), chip(150, 120, 62, "Год"),
  chip(58, 162, 68, "Свой"),
  chip(58, 208, 108, "Категории"), chip(174, 208, 84, "Валюты", true),
  donut(210, 400, 78, 26, [[0.62, MINT], [0.36, VIOLET], [0.02, CORAL]]),
  text(210, 396, "$56", 26, "#fff", 700, "middle"),
  text(210, 420, "30 дней", 12, "#ffffff8a", 400, "middle"),
  label(58, 520, "В КАКИХ ВАЛЮТАХ"),
  `<rect x="40" y="534" width="${W - 40}" height="230" rx="20" fill="#ffffff17" stroke="#ffffff24"/>`,
  row(20, 552, MINT, "€", "Евро", "€30,00", "≈ $35 · 62%"),
  row(20, 612, VIOLET, "$", "Доллар", "$20,00", "36%"),
  row(20, 672, CORAL, "₴", "Гривна", "₴38,00", "≈ $0,85 · 2%"),
  row(20, 732, BLUE, "₺", "Лира", "₺15,00", "≈ $0,31 · 1%"),
  `<rect x="40" y="700" width="${W - 40}" height="106" fill="url(#g20)" opacity="0.001"/>`,
  text(210, 800, "↓ нужно скроллить", 12.5, "#ffffff8a", 400, "middle"),
].join("");

// --- стало ---
const X = 420;
const after = [
  chip(X + 18, 78, 62, "День"), chip(X + 88, 78, 74, "Неделя"), chip(X + 170, 78, 82, "30 дней", true),
  chip(X + 260, 78, 70, "Месяц"), chip(X + 338, 78, 50, "Год"),
  `<rect x="${X + 18}" y="122" width="160" height="34" rx="17" fill="#ffffff10" stroke="#ffffff24"/>`,
  `<rect x="${X + 20}" y="124" width="78" height="30" rx="15" fill="#ffffff00"/>`,
  `<rect x="${X + 98}" y="124" width="78" height="30" rx="15" fill="${MINT}"/>`,
  text(X + 59, 144, "Категории", 12, "#ffffffa8", 400, "middle"),
  text(X + 137, 144, "Валюты", 12, "#10233a", 600, "middle"),
  text(X + W - 18, 144, "Свой период", 12.5, "#ffffff8a", 400, "end"),
  donut(X + 190, 268, 62, 20, [[0.62, MINT], [0.36, VIOLET], [0.02, CORAL]]),
  text(X + 190, 266, "$56", 24, "#fff", 700, "middle"),
  text(X + 190, 288, "30 дней", 11.5, "#ffffff8a", 400, "middle"),
  label(X + 18, 372, "В КАКИХ ВАЛЮТАХ"),
  `<rect x="${X}" y="386" width="${W - 40}" height="212" rx="20" fill="#ffffff17" stroke="#ffffff24"/>`,
  row(X - 20, 402, MINT, "€", "Евро", "€30,00", "≈ $35 · 62%"),
  row(X - 20, 454, VIOLET, "$", "Доллар", "$20,00", "36%"),
  row(X - 20, 506, CORAL, "₴", "Гривна", "₴38,00", "≈ $0,85 · 2%"),
  row(X - 20, 558, BLUE, "₺", "Лира", "₺15,00", "≈ $0,31 · 1%"),
  `<rect x="${X + 20}" y="700" width="${W - 80}" height="62" rx="24" fill="#140c2d99" stroke="#ffffff33"/>`,
  text(X + 60, 737, "Главная", 10.5, "#ffffff6b", 500, "middle"),
  text(X + 130, 737, "Разбор", 10.5, "#fff", 500, "middle"),
  `<rect x="${X + 165}" y="712" width="52" height="38" rx="14" fill="${MINT}"/>`,
  text(X + 260, 737, "История", 10.5, "#ffffff6b", 500, "middle"),
  text(X + 330, 737, "Ещё", 10.5, "#ffffff6b", 500, "middle"),
  text(X + 190, 650, "всё влезает без прокрутки", 12.5, "#ffffff8a", 400, "middle"),
].join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="820" height="830" viewBox="0 0 820 830">
  <rect width="820" height="830" fill="#161226"/>
  ${phone(20, before, "сейчас")}
  ${phone(420, after, "предлагаю")}
</svg>`;

writeFileSync(process.argv[2] as string,
  new Resvg(svg, { fitTo: { mode: "width", value: 1640 }, background: "#161226", font: { loadSystemFonts: true } }).render().asPng());
console.log("готово");
