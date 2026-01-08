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
   * Get current variables state as JSON string
   * Used for preserving variable state across scene transitions
   */
  get_variables(): string;
  /**
   * Set variables state from JSON string
   * Used for restoring variable state after scene transitions
   */
  set_variables(json: string): void;
  /**
   * Fire key press event with specific key code
   */
  fire_key_event(key_code: number): void;
  get_js_actions(): string;
  get_render_data(): string;
  /**
   * Fire scene start event
   */
  fire_scene_start(): void;
  /**
   * Fire mouse clicked event
   */
  fire_mouse_clicked(): void;
  has_pending_js_actions(): boolean;
  /**
   * Fire mouse click cancelled event
   */
  fire_mouse_click_cancled(): void;
  /**
   * Create a new WASM engine instance
   */
  constructor();
  /**
   * Stop the engine
   */
  stop(): void;
  tick(): void;
  reset(): void;
  /**
   * Start the engine
   */
  start(): void;
  /**
   * Check if the engine is currently executing a tick (always returns false now since we handle this internally)
   */
  is_busy(): boolean;
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
  readonly wasmengine_fire_key_event: (a: number, b: number) => void;
  readonly wasmengine_fire_mouse_click_cancled: (a: number) => void;
  readonly wasmengine_fire_mouse_clicked: (a: number) => void;
  readonly wasmengine_fire_scene_start: (a: number) => void;
  readonly wasmengine_get_js_actions: (a: number) => [number, number];
  readonly wasmengine_get_render_data: (a: number) => [number, number];
  readonly wasmengine_get_tick: (a: number) => bigint;
  readonly wasmengine_get_variables: (a: number) => [number, number];
  readonly wasmengine_has_pending_js_actions: (a: number) => number;
  readonly wasmengine_is_busy: (a: number) => number;
  readonly wasmengine_is_running: (a: number) => number;
  readonly wasmengine_load_project: (a: number, b: number, c: number) => [number, number];
  readonly wasmengine_new: () => number;
  readonly wasmengine_reset: (a: number) => void;
  readonly wasmengine_set_variables: (a: number, b: number, c: number) => void;
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
