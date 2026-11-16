import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../..", import.meta.url)).replace(/\\/g, "/").replace(/\/$/, "");
export async function loadDb() {
  const db = new PGlite();
  await db.exec(readFileSync(new URL("./stub.sql", import.meta.url), "utf8"));
  return db;
}

if (process.argv[1].endsWith("load.mjs")) {
  const db = await loadDb();
  for (const f of ["docs/phase-2-step-1-sales-rep-enum.sql", "docs/phase-2-supabase-sql-editor.sql"]) {
    try {
      await db.exec(readFileSync(`${repo}/${f}`, "utf8"));
      console.log("OK", f);
    } catch (e) {
      console.log("FAIL", f, "\n", e.message, "\n", e.position ?? "", e.where ?? "", e.hint ?? "");
      process.exit(1);
    }
  }
}
