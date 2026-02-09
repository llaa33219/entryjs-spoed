/**
 * EntryJS Compiler - Browser Runtime
 *
 * Compiles and runs EntryJS projects entirely in the browser.
 *
 * External dependencies (load via <script> tags):
 *   - PixiJS v7+: https://pixijs.download/v7.3.2/pixi.min.js
 *   - wabt.js:    https://cdn.jsdelivr.net/npm/wabt@1.0.36/index.js
 *
 * Usage:
 *   EntryCompiler.run(canvas, projectJson, options).then(api => {
 *       api.pause(); api.resume(); api.stop(); api.start();
 *   });
 */

var parseProject = require('../parser').parseProject;
var generateWAT = require('../codegen/wat-generator').generateWAT;
var generateBundleRenderer = require('../codegen/renderer-generator').generateBundleRenderer;

/**
 * Compile a project JSON to WAT + renderer code (no execution)
 * @param {Object} projectJson - EntryJS project JSON
 * @returns {{ wat: string, rendererCode: string, project: Object }}
 */
function compile(projectJson) {
    var project = parseProject(projectJson);
    var wat = generateWAT(project);
    var rendererCode = generateBundleRenderer(project);
    return { wat: wat, rendererCode: rendererCode, project: project };
}

/**
 * Compile and run a project in the browser
 * @param {HTMLCanvasElement|string} canvas - Canvas element or element ID
 * @param {Object} projectJson - EntryJS project JSON
 * @param {Object} [options] - Options: { proxyUrl, assetBaseUrl }
 * @returns {Promise<Object>} API: { init, start, stop, pause, resume, restart, changeScene, getSceneInfo }
 */
async function run(canvas, projectJson, options) {
    if (!canvas) throw new Error('[EntryCompiler] Canvas element is required');
    if (!projectJson) throw new Error('[EntryCompiler] Project JSON is required');

    console.log('[EntryCompiler] Compiling project...');
    var result = compile(projectJson);
    console.log('[EntryCompiler] WAT generated (' + (result.wat.length / 1024).toFixed(1) + ' KB)');

    // WAT → WASM via wabt.js
    if (typeof WabtModule === 'undefined') {
        throw new Error(
            '[EntryCompiler] wabt.js is required for WAT→WASM compilation.\n' +
            'Add this script tag before your code:\n' +
            '  <script src="https://cdn.jsdelivr.net/npm/wabt@1.0.36/index.js"><\/script>'
        );
    }

    console.log('[EntryCompiler] Compiling WAT → WASM...');
    var wabt = await WabtModule();
    var wasmModule = wabt.parseWat('project.wat', result.wat);
    wasmModule.resolveNames();
    wasmModule.validate();
    var binaryResult = wasmModule.toBinary({ write_debug_names: false });
    wasmModule.destroy();

    var wasmBytes = binaryResult.buffer;
    wabt = null;
    console.log('[EntryCompiler] WASM compiled (' + (wasmBytes.length / 1024).toFixed(1) + ' KB)');

    // Convert WASM binary to base64
    var chunks = [];
    for (var i = 0; i < wasmBytes.length; i += 8192) {
        var slice = wasmBytes.subarray(i, Math.min(i + 8192, wasmBytes.length));
        chunks.push(String.fromCharCode.apply(null, slice));
    }
    var wasmBase64 = btoa(chunks.join(''));

    // Inject WASM base64 into renderer bundle code
    var code = result.rendererCode.replace("'__WASM_BASE64__'", "'" + wasmBase64 + "'");

    // Execute renderer IIFE (returns the API object)
    console.log('[EntryCompiler] Starting renderer...');
    var api;
    try {
        api = (0, eval)(code);
    } catch (e) {
        throw new Error('[EntryCompiler] Renderer execution failed: ' + e.message);
    }
    if (!api || typeof api.init !== 'function') {
        throw new Error('[EntryCompiler] Renderer bundle produced invalid API');
    }

    // Initialize with canvas and options
    await api.init(canvas, options || {});

    return api;
}

module.exports = { compile: compile, run: run };
