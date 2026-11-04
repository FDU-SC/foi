// Turbopack loader for `?raw` imports: the file's text as the default export.
// Turbopack's own `raw` module type cannot be reached through import.meta.glob.
module.exports = function rawTextLoader(source) {
  return `export default ${JSON.stringify(String(source))};\n`;
};
