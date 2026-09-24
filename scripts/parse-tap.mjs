// Reads `supabase db query` output on stdin and prints the TAP lines carried
// in the TAP_RESULTS abort message. Exits 1 on any failure or if none found.
let raw = "";
process.stdin.on("data", (d) => (raw += d)).on("end", () => {
  const match = raw.match(/\{"_tag".*\}/s);
  let message = "";
  try {
    const outer = JSON.parse(match[0]).error.message;
    message = JSON.parse(outer.slice(outer.indexOf("{"))).message;
  } catch {
    console.log("not ok - could not parse query output:\n" + raw);
    process.exit(1);
  }
  const start = message.indexOf("TAP_RESULTS");
  if (start === -1) {
    console.log("not ok - suite errored before finishing:\n" + message);
    process.exit(1);
  }
  const lines = message.slice(start + "TAP_RESULTS".length).split("\n")
    .filter((l) => l && !l.startsWith("CONTEXT:"));
  console.log(lines.join("\n"));
  process.exit(lines.some((l) => /^not ok|^# Looks like/.test(l)) ? 1 : 0);
});
