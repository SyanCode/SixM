// Rapporteur de tests : chaque échec devient une annotation GitHub, lisible sans ouvrir le journal.
export default async function* report(source) {
  const escape = (s) => String(s).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  for await (const { type, data } of source) {
    if (type !== 'test:fail') continue;
    const e = data.details?.error;
    const text = [e?.cause?.message ?? e?.message ?? 'échec', e?.cause?.stack?.split('\n').find((l) => l.includes('/test/'))?.trim()].filter(Boolean).join('\n');
    yield `::error title=${escape(data.name).replaceAll(',', '%2C').replaceAll(':', '%3A')}::${escape(text).slice(0, 3000)}\n`;
  }
}
