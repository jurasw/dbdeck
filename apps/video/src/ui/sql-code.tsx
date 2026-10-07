const keywords = new Set(
  "SELECT FROM WHERE AND OR NOT IN IS NULL LIKE JOIN LEFT INNER ON GROUP BY ORDER HAVING LIMIT AS DESC ASC SUM COUNT NOW DATE_TRUNC".split(" "),
);

export function SqlCode({ code }: { code: string }) {
  const tokens = code.match(/'[^']*'?|\d+(?:\.\d+)?|[A-Za-z_]+|\s+|./g) ?? [];
  return (
    <>
      {tokens.map((tok, i) => {
        if (tok.startsWith("'")) return <span key={i} className="text-amber-200">{tok}</span>;
        if (/^\d/.test(tok)) return <span key={i} className="text-emerald-300">{tok}</span>;
        if (keywords.has(tok.toUpperCase()) && /^[A-Za-z_]+$/.test(tok))
          return <span key={i} className="text-sky-300">{tok}</span>;
        return <span key={i}>{tok}</span>;
      })}
    </>
  );
}
