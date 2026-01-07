/* tslint:disable */
/* eslint-disable */

export class WasmEngine {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Check if engine is running
   */
  is_running(): boolean;
  /**
   * Update pressed keys from JavaScript
   */
  update_keys(keys: Uint32Array): void;
  /**
   * Load a project from JSON string
   */
  load_project(json: string): void;
  /**
   * Update mouse state from JavaScript
   */
  update_mouse(x: number, y: number, clicked: boolean): void;
  /**
   * Get render data as JSON string for JavaScript to draw
   */
  get_render_data(): string;
  /**
   * Create a new WASM engine instance
   */
  constructor();
  /**
   * Stop the engine
   */
  stop(): void;
  /**
   * Execute one tick of the engine
   */
  tick(): void;
  /**
   * Reset the engine to initial state
   */
  reset(): void;
  /**
   * Start the engine
   */
  start(): void;
  /**
   * Get current tick count
   */
  get_tick(): bigint;
}

/**
 * Initialize panic hook for better error messages in browser console
 */
export function init(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_wasmengine_free: (a: number, b: number) => void;
  readonly wasmengine_get_render_data: (a: number) => [number, number];
  readonly wasmengine_get_tick: (a: number) => bigint;
  readonly wasmengine_is_running: (a: number) => number;
  readonly wasmengine_load_project: (a: number, b: number, c: number) => [number, number];
  readonly wasmengine_new: () => number;
  readonly wasmengine_reset: (a: number) => void;
  readonly wasmengine_start: (a: number) => void;
  readonly wasmengine_stop: (a: number) => void;
  readonly wasmengine_tick: (a: number) => void;
  readonly wasmengine_update_keys: (a: number, b: number, c: number) => void;
  readonly wasmengine_update_mouse: (a: number, b: number, c: number, d: number) => void;
  readonly init: () => void;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
