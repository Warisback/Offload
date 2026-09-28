// Node loader hook for the tests: Vite fills in import.meta.env at build time, Node leaves it undefined.
// Any file under src/ that reads import.meta.env gets a small stand-in first (mock mode, no API base).
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!/\/src\//.test(url) || result.source == null) return result;
  const source = typeof result.source === 'string' ? result.source : new TextDecoder().decode(result.source);
  if (!source.includes('import.meta.env')) return result;
  return { ...result, source: `import.meta.env ??= { VITE_USE_MOCK: 'true', BASE_URL: '/' };\n${source}` };
}
