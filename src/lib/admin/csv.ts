// csv.ts — build a CSV a spreadsheet can open safely. Pure.
//
// Two things matter for a file that holds text people typed (an audit reason,
// an error message): quoting, so a comma or newline stays inside its cell, and
// formula injection, so a cell that starts with = + - @ (or a tab/CR) is not
// run as a formula when the file is opened in Excel or Sheets. Such a cell is
// prefixed with a single quote, which spreadsheets show as plain text.

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text =
    typeof value === "string"
      ? value
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<readonly unknown[]>): string {
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  // CRLF is what spreadsheets expect; a trailing newline keeps tools happy.
  return `${lines.join("\r\n")}\r\n`;
}
