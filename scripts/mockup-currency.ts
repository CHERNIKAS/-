import { writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

const W = 380;
const H = 760;
const FONT = "'Segoe UI','Noto Sans','DejaVu Sans',sans-serif";

const phone = (x: number, body: string) => `
  <defs>
    <linearGradient id="bg${x}" x1="0" y1="0" x2="0.7" y2="1">
      <stop offset="0" stop-color="#2a1b57"/><stop offset="0.34" stop-color="#43277f"/>
      <stop offset="0.7" stop-color="#1f5c8d"/><stop offset="1" stop-color="#0f7a6d"/>
    </linearGradient>
    <clipPath id="clip${x}"><rect x="${x}" y="20" width="${W}" height="${H}" rx="34"/></clipPath>
  </defs>
  <g clip-path="url(#clip${x})">
    <rect x="${x}" y="20" width="${W}" height="${H}" fill="url(#bg${x})"/>
    ${body}
  </g>
  <rect x="${x}" y="20" width="${W}" height="${H}" rx="34" fill="none" stroke="#ffffff33" stroke-width="1.5"/>`;

const label = (x: number, y: number, t: string) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="12" letter-spacing="1.2" fill="#ffffff6b">${t}</text>`;
const text = (x: number, y: number, t: string, size = 15, fill = "#fff", weight = 400, anchor = "start") =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${t}</text>`;
const pill = (x: number, y: number, w: number, t: string, bg: string, fg: string) =>
  `<rect x="${x}" y="${y}" width="${w}" height="30" rx="15" fill="${bg}"/>` +
  text(x + w / 2, y + 20, t, 13, fg, 600, "middle");
const card = (x: number, y: number, w: number, h: number) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="20" fill="#ffffff17" stroke="#ffffff24"/>`;
const bar = (x: number, y: number, w: number, pct: number, color: string) =>
  `<rect x="${x}" y="${y}" width="${w}" height="5" rx="2.5" fill="#00000038"/>` +
  `<rect x="${x}" y="${y}" width="${(w * pct).toFixed(0)}" height="5" rx="2.5" fill="${color}"/>`;

const MINT = "#5DE0B4", VIOLET = "#A78BFA", CORAL = "#FCA277";

// --- Экран 1: главная с полоской валют ---
const left = [
  label(60, 70, "СЕНТЯБРЬ"),
  `<rect x="272" y="52" width="72" height="30" rx="15" fill="#ffffff24" stroke="#ffffff38"/>`,
  text(308, 72, "USD ⌄", 13, "#fff", 500, "middle"),
  label(60, 118, "ПОТРАЧЕНО"),
  text(58, 168, "$842", 44, "#fff", 700),
  `<rect x="60" y="192" width="140" height="7" rx="3.5" fill="${MINT}"/>`,
  `<rect x="206" y="192" width="76" height="7" rx="3.5" fill="${VIOLET}"/>`,
  `<rect x="288" y="192" width="54" height="7" rx="3.5" fill="${CORAL}"/>`,
  `<rect x="60" y="216" width="8" height="8" rx="2" fill="${MINT}"/>`, text(74, 224, "₺14 200", 13),
  `<rect x="158" y="216" width="8" height="8" rx="2" fill="${VIOLET}"/>`, text(172, 224, "$236", 13),
  `<rect x="238" y="216" width="8" height="8" rx="2" fill="${CORAL}"/>`, text(252, 224, "€145", 13),
  card(58, 246, 138, 66), text(74, 272, "Сегодня", 13, "#ffffff6b"), text(74, 296, "$38", 19, "#fff", 600),
  card(206, 246, 138, 66), text(222, 272, "В день", 13, "#ffffff6b"), text(222, 296, "$28", 19, "#fff", 600),
  label(60, 344, "ПОСЛЕДНИЕ ТРАТЫ"),
  card(58, 358, 286, 190),
  text(78, 392, "Migros", 15, "#fff", 500), text(78, 412, "Сегодня · Магазин", 12.5, "#ffffff6b"),
  text(324, 398, "₺330", 15, "#fff", 600, "end"),
  text(78, 444, "Claude", 15, "#fff", 500), text(78, 464, "Сегодня · Подписки", 12.5, "#ffffff6b"),
  text(324, 450, "$20", 15, "#fff", 600, "end"),
  text(78, 496, "Кофе", 15, "#fff", 500), text(78, 516, "Вчера · Кафе", 12.5, "#ffffff6b"),
  text(324, 502, "€4,50", 15, "#fff", 600, "end"),
  text(60, 600, "Полоска появляется только при нескольких", 12.5, "#ffffff6b"),
  text(60, 620, "валютах. Тап открывает подробности.", 12.5, "#ffffff6b"),
].join("");

// --- Экран 2: разбор с переключателем на валюты ---
const R = 62, C = 2 * Math.PI * R;
const seg = (share: number, from: number, color: string) =>
  `<circle cx="612" cy="300" r="${R}" fill="none" stroke="${color}" stroke-width="22" stroke-dasharray="${(share * C).toFixed(1)} ${(C - share * C).toFixed(1)}" transform="rotate(${from} 612 300)"/>`;

const right = [
  pill(452, 52, 108, "Категории", "#ffffff14", "#ffffffa8"),
  pill(568, 52, 92, "Валюты", MINT, "#10233a"),
  `<circle cx="612" cy="300" r="${R}" fill="none" stroke="#ffffff1f" stroke-width="22"/>`,
  seg(0.52, -90, MINT), seg(0.28, 97, VIOLET), seg(0.2, 198, CORAL),
  text(612, 296, "$842", 26, "#fff", 700, "middle"),
  text(612, 320, "30 дней", 13, "#ffffff8a", 400, "middle"),
  label(452, 412, "В КАКИХ ВАЛЮТАХ"),
  card(450, 428, 286, 186),
  `<rect x="470" y="458" width="10" height="10" rx="3" fill="${MINT}"/>`,
  text(492, 467, "Лира", 15), text(716, 460, "₺14 200", 15, "#fff", 600, "end"), text(716, 480, "≈ $437 · 52%", 12.5, "#ffffff6b", 400, "end"),
  bar(492, 486, 224, 0.52, MINT),
  `<rect x="470" y="520" width="10" height="10" rx="3" fill="${VIOLET}"/>`,
  text(492, 529, "Доллар", 15), text(716, 522, "$236", 15, "#fff", 600, "end"), text(716, 542, "28%", 12.5, "#ffffff6b", 400, "end"),
  bar(492, 548, 224, 0.28, VIOLET),
  `<rect x="470" y="582" width="10" height="10" rx="3" fill="${CORAL}"/>`,
  text(492, 591, "Евро", 15), text(716, 584, "€145", 15, "#fff", 600, "end"), text(716, 604, "≈ $169 · 20%", 12.5, "#ffffff6b", 400, "end"),
  text(452, 660, "Кольцо то же, но режет по валютам.", 12.5, "#ffffff6b"),
  text(452, 680, "Периоды работают как обычно.", 12.5, "#ffffff6b"),
].join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="820" height="800" viewBox="0 0 820 800">
  <rect width="820" height="800" fill="#161226"/>
  ${phone(20, left)}
  ${phone(420, right)}
</svg>`;

const png = new Resvg(svg, {
  fitTo: { mode: "width", value: 1640 },
  background: "#161226",
  font: { loadSystemFonts: true },
}).render().asPng();

writeFileSync(process.argv[2] as string, png);
console.log(`готово, ${(png.length / 1024).toFixed(0)} КБ`);
