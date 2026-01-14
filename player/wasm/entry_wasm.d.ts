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
   * Start the engine for scene transition (fires only "when_scene_start", not "start")
   */
  start_scene(): void;
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
  get_debug_info(): string;
  get_js_actions(): string;
  get_render_data(): string;
  /**
   * Fire scene start event
   */
  fire_scene_start(): void;
  fire_message_cast(message_id: string): void;
  fire_object_click(entity_id: number): void;
  /**
   * Fire mouse clicked event
   */
  fire_mouse_clicked(): void;
  get_render_buffer_len(): number;
  get_render_buffer_ptr(): number;
  has_pending_js_actions(): boolean;
  /**
   * Fire mouse click cancelled event
   */
  fire_mouse_click_cancled(): void;
  fire_object_click_canceled(entity_id: number): void;
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
   * Start the engine (fires both "start" and "when_scene_start" events)
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
  readonly wasmengine_fire_message_cast: (a: number, b: number, c: number) => void;
  readonly wasmengine_fire_mouse_click_cancled: (a: number) => void;
  readonly wasmengine_fire_mouse_clicked: (a: number) => void;
  readonly wasmengine_fire_object_click: (a: number, b: number) => void;
  readonly wasmengine_fire_object_click_canceled: (a: number, b: number) => void;
  readonly wasmengine_fire_scene_start: (a: number) => void;
  readonly wasmengine_get_debug_info: (a: number, b: number) => void;
  readonly wasmengine_get_js_actions: (a: number, b: number) => void;
  readonly wasmengine_get_render_buffer_len: (a: number) => number;
  readonly wasmengine_get_render_buffer_ptr: (a: number) => number;
  readonly wasmengine_get_render_data: (a: number, b: number) => void;
  readonly wasmengine_get_tick: (a: number) => bigint;
  readonly wasmengine_get_variables: (a: number, b: number) => void;
  readonly wasmengine_has_pending_js_actions: (a: number) => number;
  readonly wasmengine_is_busy: (a: number) => number;
  readonly wasmengine_is_running: (a: number) => number;
  readonly wasmengine_load_project: (a: number, b: number, c: number, d: number) => void;
  readonly wasmengine_new: () => number;
  readonly wasmengine_reset: (a: number) => void;
  readonly wasmengine_set_variables: (a: number, b: number, c: number) => void;
  readonly wasmengine_start: (a: number) => void;
  readonly wasmengine_start_scene: (a: number) => void;
  readonly wasmengine_stop: (a: number) => void;
  readonly wasmengine_tick: (a: number) => void;
  readonly wasmengine_update_keys: (a: number, b: number, c: number) => void;
  readonly wasmengine_update_mouse: (a: number, b: number, c: number, d: number) => void;
  readonly init: () => void;
  readonly __wbindgen_export: (a: number, b: number, c: number) => void;
  readonly __wbindgen_export2: (a: number, b: number) => number;
  readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
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
