/**
 * Minimal RFC-4180-ish CSV parser. Handles:
 *  - quoted fields with commas, newlines, and escaped quotes ("")
 *  - LF / CRLF line endings
 *  - trailing newline tolerated
 *  - blank lines skipped
 */
export function parseCsv(input: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  const text = input.replace(/^﻿/, ""); // strip BOM

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      row.push(field);
      field = "";
      // Skip a paired \r\n
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (row.length > 0 && !(row.length === 1 && row[0] === "")) {
        rows.push(row);
      }
      row = [];
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Flush last field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
  }
  return rows;
}

/**
 * Guess the delimiter from the header line: cells copied out of a
 * spreadsheet are tab-separated, European exports often use semicolons.
 * Commas win ties (and are the default).
 */
export function detectDelimiter(text: string): "," | "\t" | ";" {
  const first = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  const count = (c: string) => first.split(c).length - 1;
  const tabs = count("\t");
  const semis = count(";");
  const commas = count(",");
  if (tabs > commas && tabs >= semis) return "\t";
  if (semis > commas) return ";";
  return ",";
}
