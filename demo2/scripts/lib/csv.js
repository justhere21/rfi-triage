// Small strict CSV reader: quoted commas, escaped quotes, CRLF, and multiline cells.
// Array cells use JSON arrays or | separators; spaces inside spec IDs are retained.
export function parseCsv(text, source = "CSV") {
  const rows = [];
  let row = [];
  let cell = "";
  let state = "start";
  const input = text.replace(/^\uFEFF/, "");
  const finishRow = () => {
    row.push(cell);
    if (row.some((value) => value !== "")) rows.push(row);
    row = [];
    cell = "";
    state = "start";
  };
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (state === "quoted") {
      if (char === '"') {
        if (input[i + 1] === '"') { cell += '"'; i++; }
        else state = "closed";
      } else cell += char;
      continue;
    }
    if (char === ",") {
      row.push(cell); cell = ""; state = "start";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      finishRow();
    } else if (char === '"' && state === "start") {
      state = "quoted";
    } else {
      if (state === "closed" || char === '"') {
        throw new Error(`${source}: unexpected character in CSV record ${rows.length + 1}`);
      }
      cell += char; state = "unquoted";
    }
  }
  if (state === "quoted") throw new Error(`${source}: unterminated quoted cell`);
  if (cell !== "" || row.length || state === "closed") finishRow();
  if (!rows.length) throw new Error(`${source}: missing header`);
  const headers = rows.shift();
  if (headers.some((value) => !value) || new Set(headers).size !== headers.length) {
    throw new Error(`${source}: empty or duplicate column name`);
  }
  return rows.map((values, index) => {
    if (values.length !== headers.length) {
      throw new Error(`${source}: record ${index + 1} has ${values.length} cells; expected ${headers.length}`);
    }
    return Object.fromEntries(headers.map((key, i) => [key, values[i]]));
  });
}

export function listCell(value) {
  if (value === null || value === undefined || value === "") return [];
  if (Array.isArray(value)) {
    if (value.some((item) => typeof item !== "string")) throw new Error("Array values must be strings");
    return [...value];
  }
  if (typeof value !== "string") throw new Error("Expected a string, string array, or empty value");
  if (value.trim().startsWith("[")) {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error("Expected a JSON array");
    return listCell(parsed);
  }
  return value.split("|").map((item) => item.trim()).filter(Boolean);
}
