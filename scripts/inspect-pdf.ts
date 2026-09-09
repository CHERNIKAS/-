import { readFileSync } from "node:fs";
import { readStatement } from "../packages/core/src/import/index.js";

const path = process.argv[2] as string;
const { rows, format } = await readStatement(new Uint8Array(readFileSync(path)), path);

console.log(`формат: ${format}, строк: ${rows.length}\n`);
for (const [i, row] of rows.slice(0, 45).entries()) {
  console.log(`${String(i).padStart(3)}: ${row.map((c) => `[${c}]`).join(" ")}`);
}
