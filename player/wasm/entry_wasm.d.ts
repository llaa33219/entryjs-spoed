/* tslint:disable */
/* eslint-disable */

/**
 * Types of actions that WASM needs JavaScript to execute
 * Note: entity_id is a numeric index from WASM, which needs to be mapped
 * to Entry.js object IDs using the entity ID mapping.
 */
export interface JsActionPlaySound { type: 'PlaySound'; data: { entity_id: number; sound_id: string } }
export interface JsActionPlaySoundWait { type: 'PlaySoundWait'; data: { entity_id: number; sound_id: string } }
export interface JsActionPlaySoundFromSecond { type: 'PlaySoundFromSecond'; data: { entity_id: number; sound_id: string; start_second: number } }
export interface JsActionStopSound { type: 'StopSound'; data?: undefined }
export interface JsActionSetSoundVolume { type: 'SetSoundVolume'; data: { volume: number } }
export interface JsActionChangeSoundVolume { type: 'ChangeSoundVolume'; data: { delta: number } }
export interface JsActionSetSoundSpeed { type: 'SetSoundSpeed'; data: { speed: number } }
export interface JsActionChangeSoundSpeed { type: 'ChangeSoundSpeed'; data: { delta: number } }
export interface JsActionCreateClone { type: 'CreateClone'; data: { entity_id: number; target: string } }
export interface JsActionDeleteClone { type: 'DeleteClone'; data: { entity_id: number } }
export interface JsActionRemoveAllClones { type: 'RemoveAllClones'; data?: undefined }
export interface JsActionMessageCast { type: 'MessageCast'; data: { message_id: string } }
export interface JsActionMessageCastWait { type: 'MessageCastWait'; data: { message_id: string } }
export interface JsActionStartScene { type: 'StartScene'; data: { scene_id: string } }
export interface JsActionStartNextScene { type: 'StartNextScene'; data?: undefined }
export interface JsActionStartPreviousScene { type: 'StartPreviousScene'; data?: undefined }
export interface JsActionShowVariable { type: 'ShowVariable'; data: { variable_id: string } }
export interface JsActionHideVariable { type: 'HideVariable'; data: { variable_id: string } }
export interface JsActionShowList { type: 'ShowList'; data: { list_id: string } }
export interface JsActionHideList { type: 'HideList'; data: { list_id: string } }
export interface JsActionBrushStamp { type: 'BrushStamp'; data: { entity_id: number } }
export interface JsActionBrushEraseAll { type: 'BrushEraseAll'; data?: undefined }
export interface JsActionTimerAction { type: 'TimerAction'; data: { action: string } }
export interface JsActionSetTimerVisible { type: 'SetTimerVisible'; data: { visible: boolean } }
export interface JsActionChangeObjectIndex { type: 'ChangeObjectIndex'; data: { entity_id: number; location: string } }
export interface JsActionAskAndWait { type: 'AskAndWait'; data: { entity_id: number; message: string } }
export interface JsActionRestartProject { type: 'RestartProject'; data?: undefined }

export type JsActionType =
  | JsActionPlaySound
  | JsActionPlaySoundWait
  | JsActionPlaySoundFromSecond
  | JsActionStopSound
  | JsActionSetSoundVolume
  | JsActionChangeSoundVolume
  | JsActionSetSoundSpeed
  | JsActionChangeSoundSpeed
  | JsActionCreateClone
  | JsActionDeleteClone
  | JsActionRemoveAllClones
  | JsActionMessageCast
  | JsActionMessageCastWait
  | JsActionStartScene
  | JsActionStartNextScene
  | JsActionStartPreviousScene
  | JsActionShowVariable
  | JsActionHideVariable
  | JsActionShowList
  | JsActionHideList
  | JsActionBrushStamp
  | JsActionBrushEraseAll
  | JsActionTimerAction
  | JsActionSetTimerVisible
  | JsActionChangeObjectIndex
  | JsActionAskAndWait
  | JsActionRestartProject;

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
   * Get pending JavaScript actions as JSON string and clear the queue.
   * Call this after tick() to process any actions that require JS execution.
   * @returns JSON array of JsAction objects
   */
  get_js_actions(): string;
  /**
   * Check if there are pending JS actions
   */
  has_pending_js_actions(): boolean;
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
  readonly wasmengine_get_js_actions: (a: number) => [number, number];
  readonly wasmengine_has_pending_js_actions: (a: number) => number;
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
