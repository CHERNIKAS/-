import { writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { PALETTE, donutSvg } from "../packages/core/src/index.js";

const data = [
  { label: "Магазин", value: 310 },
  { label: "Жильё", value: 250 },
  { label: "Кафе", value: 118 },
  { label: "Транспорт", value: 96 },
  { label: "Подписки", value: 68 },
];

const svg = donutSvg(
  data.map((d, i) => ({ ...d, color: PALETTE[i % PALETTE.length] as string })),
  { total: "$842", caption: "30 дней", legendRows: data.length },
);

const png = new Resvg(svg, {
  fitTo: { mode: "width", value: 1040 },
  background: "#2A1B57",
  font: { loadSystemFonts: true, defaultFontFamily: "Noto Sans" },
}).render().asPng();
writeFileSync(process.argv[2] ?? "donut.png", png);
console.log(`готово, ${(png.length / 1024).toFixed(1)} КБ`);
