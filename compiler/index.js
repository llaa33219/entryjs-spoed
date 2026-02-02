/**
 * EntryJS to WASM Compiler
 * 
 * This compiler takes an EntryJS project JSON and compiles it to:
 * 1. A WASM file containing all project logic
 * 2. A minimal JS file that only handles PixiJS rendering
 * 
 * The WASM file contains:
 * - All entity states (position, rotation, size, visibility, etc.)
 * - All block execution logic
 * - All variables and lists
 * - Event handling
 * 
 * The JS file only:
 * - Initializes PixiJS
 * - Reads entity states from WASM memory
 * - Updates sprite visuals accordingly
 * - Forwards user input events to WASM
 */

const fs = require('fs');
const path = require('path');
const { parseProject } = require('./parser');
const { generateWAT } = require('./codegen/wat-generator');
const { generateRenderer } = require('./codegen/renderer-generator');
const { generateServer } = require('./codegen/server-generator');

class EntryCompiler {
    constructor(options = {}) {
        this.options = {
            outputDir: options.outputDir || './output',
            optimize: options.optimize !== false,
            debug: options.debug || false,
            ...options
        };
    }

    /**
     * Compile an EntryJS project JSON to WASM + JS
     * @param {Object|string} projectJson - The project JSON object or path to JSON file
     * @returns {Promise<{wat: string, js: string, wasm?: Buffer}>}
     */
    async compile(projectJson) {
        // Load project if path is provided
        if (typeof projectJson === 'string') {
            projectJson = JSON.parse(fs.readFileSync(projectJson, 'utf8'));
        }

        console.log('[Compiler] Parsing project...');
        const parsedProject = parseProject(projectJson);

        console.log('[Compiler] Generating WAT code...');
        const watCode = generateWAT(parsedProject, this.options);

        console.log('[Compiler] Generating renderer JS...');
        const rendererJs = generateRenderer(parsedProject, this.options);

        const result = {
            wat: watCode,
            js: rendererJs,
            project: parsedProject
        };

        // Save outputs if outputDir is specified
        if (this.options.outputDir) {
            await this.saveOutput(result);
        }

        return result;
    }

    /**
     * Save compiled output to files
     */
    async saveOutput(result) {
        const { outputDir } = this.options;

        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Save WAT file
        const watPath = path.join(outputDir, 'project.wat');
        fs.writeFileSync(watPath, result.wat);
        console.log(`[Compiler] WAT saved to ${watPath}`);

        // Save JS renderer
        const jsPath = path.join(outputDir, 'renderer.js');
        fs.writeFileSync(jsPath, result.js);
        console.log(`[Compiler] Renderer JS saved to ${jsPath}`);

        // Save HTML wrapper
        const htmlPath = path.join(outputDir, 'index.html');
        fs.writeFileSync(htmlPath, this.generateHTML());
        console.log(`[Compiler] HTML saved to ${htmlPath}`);

        // Generate and save server.js
        console.log('[Compiler] Generating server JS...');
        const serverCode = generateServer(result.project, this.options);
        const serverPath = path.join(outputDir, 'server.js');
        fs.writeFileSync(serverPath, serverCode);
        console.log(`[Compiler] Server JS saved to ${serverPath}`);

        console.log('\n[Compiler] To compile WAT to WASM, run:');
        console.log(`  wat2wasm ${watPath} -o ${path.join(outputDir, 'project.wasm')}`);
    }

    /**
     * Generate HTML wrapper
     */
    generateHTML() {
        return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>EntryJS Compiled Project</title>
    <script src="https://pixijs.download/v7.3.2/pixi.min.js"></script>
    <style>
        body { margin: 0; overflow: hidden; background: #000; }
        #stage { display: block; margin: auto; }
    </style>
</head>
<body>
    <canvas id="stage" width="480" height="360"></canvas>
    <script type="module" src="renderer.js"></script>
</body>
</html>`;
    }
}

// CLI support
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log('Usage: node compiler/index.js <project.json> [output-dir]');
        process.exit(1);
    }

    const projectPath = args[0];
    const outputDir = args[1] || './compiled-output';

    const compiler = new EntryCompiler({ outputDir });
    compiler.compile(projectPath)
        .then(() => console.log('\n[Compiler] Done!'))
        .catch(err => {
            console.error('[Compiler] Error:', err);
            process.exit(1);
        });
}

module.exports = { EntryCompiler };
