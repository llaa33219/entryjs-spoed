/**
 * EntryJS Compiled Project - Bundler
 *
 * Combines the compiled WASM binary and the bundle renderer
 * into a single self-contained JavaScript file.
 *
 * The output script can be loaded via <script> tag and exposes
 * a global `EntryProject` object (or module.exports in Node/CJS).
 *
 * Usage:
 *   node compiler/bundler.js <output-dir> [output-file]
 *
 * API:
 *   EntryProject.init(canvasOrId, options) → Promise
 *   EntryProject.start()
 *   EntryProject.stop()
 *   EntryProject.pause()
 *   EntryProject.resume()
 */

const fs = require('fs');
const path = require('path');

/**
 * Bundle WASM + renderer into a single JS file
 * @param {string} outputDir - Directory containing project.wasm and renderer.bundle.js
 * @param {string} [outputFile] - Output file path (default: <outputDir>/entry-project.js)
 * @returns {string} Path to the bundled file
 */
function bundle(outputDir, outputFile) {
    const wasmPath = path.join(outputDir, 'project.wasm');
    const rendererPath = path.join(outputDir, 'renderer.bundle.js');

    if (!fs.existsSync(wasmPath)) {
        throw new Error(
            `WASM file not found: ${wasmPath}\n` +
            `Run wat2wasm first: wat2wasm ${path.join(outputDir, 'project.wat')} -o ${wasmPath}`
        );
    }

    if (!fs.existsSync(rendererPath)) {
        throw new Error(
            `Bundle renderer not found: ${rendererPath}\n` +
            `Compile with --bundle flag: node compiler/index.js <project.json> ${outputDir} --bundle`
        );
    }

    const wasmBuffer = fs.readFileSync(wasmPath);
    const wasmBase64 = wasmBuffer.toString('base64');

    const rendererCode = fs.readFileSync(rendererPath, 'utf8');

    const bundled = rendererCode.replace("'__WASM_BASE64__'", `'${wasmBase64}'`);

    const outPath = outputFile || path.join(outputDir, 'entry-project.js');
    fs.writeFileSync(outPath, bundled);

    const sizeKB = (bundled.length / 1024).toFixed(1);
    const wasmSizeKB = (wasmBuffer.length / 1024).toFixed(1);
    console.log(`[Bundler] Bundle saved to ${outPath}`);
    console.log(`[Bundler]   Total: ${sizeKB} KB (WASM: ${wasmSizeKB} KB)`);

    return outPath;
}

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log('Usage: node compiler/bundler.js <output-dir> [output-file]');
        console.log('');
        console.log('Combines project.wasm + renderer.bundle.js into a single JS file.');
        console.log('The output directory must contain project.wasm and renderer.bundle.js.');
        process.exit(1);
    }

    try {
        bundle(args[0], args[1]);
    } catch (err) {
        console.error('[Bundler] Error:', err.message);
        process.exit(1);
    }
}

module.exports = { bundle };
