//! Entry WASM Execution Engine
//! High-performance block execution engine for Entry projects

use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use rustc_hash::FxHashMap;
use std::cell::{Cell, RefCell};

pub type HashMap<K, V> = FxHashMap<K, V>;

#[inline(always)]
pub fn new_hashmap<K, V>() -> HashMap<K, V> {
    HashMap::default()
}

mod blocks;
mod executor;
mod entity;
mod bytecode;
mod compiler;
mod vm;

pub use blocks::*;
pub use executor::*;
pub use entity::*;
pub use bytecode::*;
pub use compiler::*;
pub use vm::*;

/// Actions that need to be executed by JavaScript
/// These are queued during WASM execution and consumed by JS after each tick
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum JsAction {
    // Sound actions
    PlaySound { entity_id: usize, sound_id: String },
    PlaySoundWait { entity_id: usize, sound_id: String },
    PlaySoundFromSecond { entity_id: usize, sound_id: String, start_second: f64 },
    PlaySoundFromTo { entity_id: usize, sound_id: String, start: f64, end: f64 },
    PlaySoundFromToWait { entity_id: usize, sound_id: String, start: f64, end: f64 },
    PlaySoundDuration { entity_id: usize, sound_id: String, duration: f64 },
    PlaySoundDurationWait { entity_id: usize, sound_id: String, duration: f64 },
    StopSound,
    StopAllSounds,
    StopOtherSounds { entity_id: usize },
    PlayBGM { entity_id: usize, sound_id: String },
    StopBGM,
    SetSoundVolume { volume: f64 },
    ChangeSoundVolume { delta: f64 },
    SetSoundSpeed { speed: f64 },
    ChangeSoundSpeed { delta: f64 },
    
    // Clone actions
    CreateClone { entity_id: usize, target: String },
    DeleteClone { entity_id: usize },
    RemoveAllClones,
    
    // Message actions
    MessageCast { message_id: String },
    MessageCastWait { message_id: String },
    
    // Scene actions
    StartScene { scene_id: String },
    StartNextScene,
    StartPreviousScene,
    
    // Variable visibility
    ShowVariable { variable_id: String },
    HideVariable { variable_id: String },
    ShowList { list_id: String },
    HideList { list_id: String },
    
    // Brush/Pen actions
    BrushStamp { entity_id: usize },
    BrushEraseAll { entity_id: usize },
    StartDrawing { entity_id: usize, x: f64, y: f64 },
    StopDrawing { entity_id: usize },
    BrushLineTo { entity_id: usize, x: f64, y: f64 },
    BrushPath { entity_id: usize, points: Vec<(f64, f64)> },
    StartFill { entity_id: usize, x: f64, y: f64 },
    StopFill { entity_id: usize },
    FillLineTo { entity_id: usize, x: f64, y: f64 },
    FillPath { entity_id: usize, points: Vec<(f64, f64)> },
    SetBrushColor { entity_id: usize, color: String },
    SetRandomColor { entity_id: usize },
    SetFillColor { entity_id: usize, color: String },
    SetBrushTransparency { entity_id: usize, transparency: f64 },
    
    // Timer actions  
    TimerAction { action: String },  // start, stop, reset
    SetTimerVisible { visible: bool },
    
    // Object actions
    ChangeObjectIndex { entity_id: usize, location: String },
    
    // Dialog actions
    ShowDialog { entity_id: usize, message: String, mode: String },
    RemoveDialog { entity_id: usize },
    
    // Input actions
    AskAndWait { entity_id: usize, message: String },
    SetAnswerVisible { visible: bool },
    
    // Project control
    RestartProject,
    
    // Scene restore (for reset to initial scene)
    RestoreStartScene,
}

/// Initialize panic hook for better error messages in browser console
#[wasm_bindgen(start)]
pub fn init() {
    // Always set panic hook for better error messages in browser console
    console_error_panic_hook::set_once();
}

/// Function data structure
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FunctionData {
    pub id: String,
    #[serde(deserialize_with = "deserialize_script", default)]
    pub content: Option<Vec<Vec<Block>>>,
    #[serde(rename = "localVariables")]
    pub local_variables: Option<Vec<VariableData>>,
    #[serde(rename = "useLocalVariables")]
    pub use_local_variables: Option<bool>,
}

struct EngineInner {
    state: EngineState,
    entities: Vec<Entity>,
    variables: HashMap<String, Value>,
    variables_snapshot: HashMap<String, Value>,
    executors: Vec<Executor>,
    tick_count: u64,
    fps: u32,
    project_data: Option<ProjectData>,
    functions: HashMap<String, FunctionData>,
    pending_js_actions: Vec<JsAction>,
    
    // Global input state
    mouse_x: f64,
    mouse_y: f64,
    mouse_clicked: bool,
    
    program: Option<Program>,
    render_buffer: Vec<f64>,
}

impl EngineInner {
    fn new() -> Self {
        EngineInner {
            state: EngineState::Stopped,
            entities: Vec::new(),
            variables: HashMap::default(),
            variables_snapshot: HashMap::default(),
            executors: Vec::new(),
            tick_count: 0,
            fps: 60,
            project_data: None,
            functions: HashMap::default(),
            pending_js_actions: Vec::new(),
            mouse_x: 0.0,
            mouse_y: 0.0,
            mouse_clicked: false,
            program: None,
            render_buffer: Vec::with_capacity(1024),
        }
    }
}

/// Main WASM Engine class exposed to JavaScript
/// Uses RefCell for interior mutability to prevent wasm-bindgen borrow conflicts
#[wasm_bindgen]
pub struct WasmEngine {
    inner: RefCell<EngineInner>,
    /// Separate flag for stop requests that can be set even when inner is borrowed
    stop_requested: Cell<bool>,
    /// Flag to log error only once (prevents console flood)
    error_logged: Cell<bool>,
}

#[wasm_bindgen]
impl WasmEngine {
    /// Create a new WASM engine instance
    #[wasm_bindgen(constructor)]
    pub fn new() -> WasmEngine {
        WasmEngine {
            inner: RefCell::new(EngineInner::new()),
            stop_requested: Cell::new(false),
            error_logged: Cell::new(false),
        }
    }

    /// Load a project from JSON string
    #[wasm_bindgen]
    pub fn load_project(&self, json: &str) -> Result<(), JsValue> {
        let mut inner = self.inner.borrow_mut();
        
        let project: ProjectData = serde_json::from_str(json)
            .map_err(|e| JsValue::from_str(&format!("JSON parse error: {}", e)))?;
        
        inner.fps = project.speed.unwrap_or(60);
        
        let compiler = Compiler::new();
        inner.program = Some(compiler.compile(&project));
        
        inner.project_data = Some(project.clone());
        
        // Initialize entities from objects
        inner.entities.clear();
        if let Some(objects) = &project.objects {
            for (idx, obj) in objects.iter().enumerate() {
                let entity = Entity::from_object(obj, idx);
                inner.entities.push(entity);
            }
        }
        
        // Initialize variables and lists
        inner.variables.clear();
        if let Some(vars) = &project.variables {
            for var in vars {
                let is_list = var.variable_type.as_deref() == Some("list");
                
                if is_list {
                    if let Some(arr) = &var.array {
                        let list_values: Vec<Value> = arr.iter().map(|item| {
                            if let Some(obj) = item.as_object() {
                                if let Some(data) = obj.get("data") {
                                    return Value::from_json(data);
                                }
                            }
                            Value::from_json(item)
                        }).collect();
                        inner.variables.insert(var.id.clone(), Value::List(list_values));
                    } else {
                        inner.variables.insert(var.id.clone(), Value::List(Vec::new()));
                    }
                } else {
                    let value = Value::from_json(&var.value);
                    inner.variables.insert(var.id.clone(), value);
                }
            }
        }
        
        // Initialize functions
        inner.functions.clear();
        if let Some(funcs) = &project.functions {
            // Handle array format (from getFunctionJSON())
            if let Some(func_array) = funcs.as_array() {
                for func_value in func_array {
                    if let Ok(func_data) = serde_json::from_value::<FunctionData>(func_value.clone()) {
                        inner.functions.insert(func_data.id.clone(), func_data);
                    }
                }
            }
            // Handle object format (legacy or alternative format)
            else if let Some(func_map) = funcs.as_object() {
                for (func_id, func_value) in func_map {
                    if let Ok(func_data) = serde_json::from_value::<FunctionData>(func_value.clone()) {
                        // Use func_data.id for consistency with execute_function_call lookup
                        let key = if func_data.id.is_empty() { func_id.clone() } else { func_data.id.clone() };
                        inner.functions.insert(key, func_data);
                    }
                }
            }
        }
        
        if let Some(objects) = &project.objects {
            for obj in objects {
                if let Some(scripts) = &obj.script {
                    for thread in scripts {
                        if let Some(first_block) = thread.first() {
                            if first_block.block_type == "function_create" || first_block.block_type == "function_create_value" {
                                if let Some(params) = &first_block.params {
                                    if let Some(first_param) = params.first() {
                                        if let Some(param_obj) = first_param.as_object() {
                                            if let Some(param_type) = param_obj.get("type").and_then(|v| v.as_str()) {
                                                if param_type.starts_with("func_") && param_type.len() > 5 {
                                                    let func_id = &param_type[5..];
                                                    if !inner.functions.contains_key(func_id) {
                                                        let func_data = FunctionData {
                                                            id: func_id.to_string(),
                                                            content: Some(vec![thread.clone()]),
                                                            local_variables: None,
                                                            use_local_variables: None,
                                                        };
                                                        inner.functions.insert(func_id.to_string(), func_data);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        

        
        Ok(())
    }

    /// Start the engine (fires both "start" and "when_scene_start" events)
    #[wasm_bindgen]
    pub fn start(&self) {
        // Use try_borrow_mut to avoid panic if already borrowed (e.g., during tick)
        let mut inner = match self.inner.try_borrow_mut() {
            Ok(inner) => inner,
            Err(_) => {
                // Already borrowed (likely in tick), ignore the call
                return;
            }
        };
        
        inner.state = EngineState::Running;
        self.stop_requested.set(false);
        self.error_logged.set(false); // Reset error flag on start
        
        Self::initialize_executors_inner(&mut inner);
        Self::fire_event_inner(&mut inner, "start");
        Self::fire_event_inner(&mut inner, "when_scene_start");
    }

    /// Start the engine for scene transition (fires only "when_scene_start", not "start")
    #[wasm_bindgen]
    pub fn start_scene(&self) {
        let mut inner = match self.inner.try_borrow_mut() {
            Ok(inner) => inner,
            Err(_) => {
                return;
            }
        };
        
        inner.state = EngineState::Running;
        self.stop_requested.set(false);
        self.error_logged.set(false);
        
        Self::initialize_executors_inner(&mut inner);
        Self::fire_event_inner(&mut inner, "when_scene_start");
    }

    /// Stop the engine
    #[wasm_bindgen]
    pub fn stop(&self) {
        // Use try_borrow_mut to avoid panic if already borrowed (e.g., during tick)
        match self.inner.try_borrow_mut() {
            Ok(mut inner) => {
                inner.state = EngineState::Stopped;
                inner.executors.clear();
                self.stop_requested.set(false);
            }
            Err(_) => {
                // Already borrowed (likely in tick), set the stop flag
                // The tick loop will check this and stop gracefully
                self.stop_requested.set(true);
            }
        };
    }

    #[wasm_bindgen]
    pub fn reset(&self) {
        let mut inner = match self.inner.try_borrow_mut() {
            Ok(inner) => inner,
            Err(_) => {
                self.stop_requested.set(true);
                return;
            }
        };
        
        inner.state = EngineState::Stopped;
        inner.tick_count = 0;
        inner.executors.clear();
        inner.pending_js_actions.clear();
        inner.pending_js_actions.push(JsAction::RestoreStartScene);
        self.stop_requested.set(false);
        self.error_logged.set(false);
        
        for entity in &mut inner.entities {
            entity.restore_snapshot();
            entity.dialog_message = None;
            entity.dialog_mode = None;
            entity.brush_down = false;
            entity.brush_size = 1.0;
            entity.brush_color = "#ff0000".to_string();
        }
        
        inner.variables = inner.variables_snapshot.clone();
    }
    
    /// Check if the engine is currently executing a tick (always returns false now since we handle this internally)
    #[wasm_bindgen]
    pub fn is_busy(&self) -> bool {
        // With RefCell, we can check if it's borrowed
        self.inner.try_borrow_mut().is_err()
    }

    #[wasm_bindgen]
    pub fn tick(&self) {
        // Use try_borrow_mut to prevent recursive tick calls
        let mut inner = match self.inner.try_borrow_mut() {
            Ok(inner) => inner,
            Err(_) => {
                return;
            }
        };
        
        if inner.state != EngineState::Running {
            return;
        }
        
        inner.tick_count += 1;
        
        let mut completed = Vec::new();
        const MAX_EXECUTIONS_PER_TICK: u32 = 1_000_000;
        
        let mut executors = std::mem::take(&mut inner.executors);
        let mut entities = std::mem::take(&mut inner.entities);
        let mut variables = std::mem::take(&mut inner.variables);
        let mut pending_js_actions = std::mem::take(&mut inner.pending_js_actions);
        let functions_ref = &inner.functions;
        
        let initial_action_count = pending_js_actions.len();
        
        for (idx, executor) in executors.iter_mut().enumerate() {
            if inner.state != EngineState::Running || self.stop_requested.get() {
                break;
            }
            
            let mut execution_count = 0u32;
            
            loop {
                if inner.state != EngineState::Running || self.stop_requested.get() {
                    break;
                }
                

                
                let result = executor.execute(
                    &mut entities, 
                    &mut variables, 
                    &mut pending_js_actions, 
                    functions_ref
                );
                
                match result {
                    ExecuteResult::End => {
                        completed.push(idx);
                        break;
                    }
                    ExecuteResult::Wait => {
                        break;
                    }
                    ExecuteResult::Continue | ExecuteResult::JumpedToBlock | ExecuteResult::Break => {
                        execution_count += 1;
                        if execution_count >= MAX_EXECUTIONS_PER_TICK {
                            break;
                        }
                    }
                }
            }
        }
        
        for idx in completed.into_iter().rev() {
            executors.swap_remove(idx);
        }
        
        if pending_js_actions.len() > initial_action_count {
            let mut new_executors = Vec::new();
            
            for i in initial_action_count..pending_js_actions.len() {
                let action = &pending_js_actions[i];
                if let JsAction::MessageCast { message_id } | JsAction::MessageCastWait { message_id } = action {
                    let mut executors_for_msg = Self::find_executors_for_message(&inner, message_id);
                    new_executors.append(&mut executors_for_msg);
                }
            }
            executors.append(&mut new_executors);
        }
        
        for entity in &mut entities {
            if !entity.frame_brush_path.is_empty() {
                let points = std::mem::take(&mut entity.frame_brush_path);
                pending_js_actions.push(JsAction::BrushPath {
                    entity_id: entity.id,
                    points,
                });
            }
            if !entity.frame_fill_path.is_empty() {
                let points = std::mem::take(&mut entity.frame_fill_path);
                pending_js_actions.push(JsAction::FillPath {
                    entity_id: entity.id,
                    points,
                });
            }
        }
        
        inner.executors = executors;
        inner.entities = entities;
        inner.variables = variables;
        inner.pending_js_actions = pending_js_actions;
        
        if self.stop_requested.get() {
            inner.state = EngineState::Stopped;
            inner.executors.clear();
            self.stop_requested.set(false);
        }
        
        let mut buffer = std::mem::take(&mut inner.render_buffer);
        buffer.clear();
        for entity in &inner.entities {
            if entity.visible || entity.brush_down || entity.fill_down {
                buffer.push(entity.id as f64);
                buffer.push(entity.x);
                buffer.push(entity.y);
                buffer.push(entity.rotation);
                buffer.push(entity.direction);
                buffer.push(entity.scale_x);
                buffer.push(entity.scale_y);
                buffer.push(entity.width);
                buffer.push(entity.height);
                buffer.push(if entity.visible { 1.0 } else { 0.0 });
                buffer.push(if entity.brush_down { 1.0 } else { 0.0 });
                buffer.push(entity.brush_size);
                buffer.push(entity.brush_transparency);
                buffer.push(if entity.fill_down { 1.0 } else { 0.0 });
                buffer.push(entity.fill_transparency);
                buffer.push(0.0); 
            }
        }
        inner.render_buffer = buffer;
    }
    
    #[wasm_bindgen]
    pub fn get_js_actions(&self) -> String {
        let mut inner = match self.inner.try_borrow_mut() {
            Ok(inner) => inner,
            Err(_) => return "[]".to_string(),
        };
        
        if inner.pending_js_actions.is_empty() {
            return "[]".to_string();
        }
        
        let actions = std::mem::take(&mut inner.pending_js_actions);
        serde_json::to_string(&actions).unwrap_or_else(|_| "[]".to_string())
    }
    
    #[wasm_bindgen]
    pub fn has_pending_js_actions(&self) -> bool {
        match self.inner.try_borrow() {
            Ok(inner) => !inner.pending_js_actions.is_empty(),
            Err(_) => false,
        }
    }

    #[wasm_bindgen]
    pub fn get_render_data(&self) -> String {
        let inner = match self.inner.try_borrow() {
            Ok(inner) => inner,
            Err(_) => return "[]".to_string(),
        };
        
        let render_entities: Vec<RenderEntity> = inner.entities
            .iter()
            .rev()
            .filter(|e| e.visible || e.brush_down || e.fill_down)
            .map(|e| RenderEntity::from(e))
            .collect();
        
        serde_json::to_string(&render_entities).unwrap_or_else(|_| "[]".to_string())
    }

    #[wasm_bindgen]
    pub fn get_render_buffer_ptr(&self) -> *const f64 {
        match self.inner.try_borrow() {
            Ok(inner) => inner.render_buffer.as_ptr(),
            Err(_) => std::ptr::null(),
        }
    }

    #[wasm_bindgen]
    pub fn get_render_buffer_len(&self) -> usize {
        match self.inner.try_borrow() {
            Ok(inner) => inner.render_buffer.len(),
            Err(_) => 0,
        }
    }

    /// Check if engine is running
    #[wasm_bindgen]
    pub fn is_running(&self) -> bool {
        match self.inner.try_borrow() {
            Ok(inner) => inner.state == EngineState::Running,
            Err(_) => true, // If borrowed, we're probably in tick, which means running
        }
    }

    /// Get current tick count
    #[wasm_bindgen]
    pub fn get_tick(&self) -> u64 {
        match self.inner.try_borrow() {
            Ok(inner) => inner.tick_count,
            Err(_) => 0,
        }
    }
    
    #[wasm_bindgen]
    pub fn get_variables(&self) -> String {
        let inner = match self.inner.try_borrow() {
            Ok(inner) => inner,
            Err(_) => return "{}".to_string(),
        };
        
        serde_json::to_string(&inner.variables).unwrap_or_else(|_| "{}".to_string())
    }
    
    /// Set variables state from JSON string
    /// Used for restoring variable state after scene transitions
    #[wasm_bindgen]
    pub fn set_variables(&self, json: &str) {
        let mut inner = match self.inner.try_borrow_mut() {
            Ok(inner) => inner,
            Err(_) => return,
        };
        
        if let Ok(variables) = serde_json::from_str::<HashMap<String, Value>>(json) {
            inner.variables = variables;
        }
    }
    
    /// Update mouse state from JavaScript
    #[wasm_bindgen]
    pub fn update_mouse(&self, x: f64, y: f64, clicked: bool) {
        let mut inner = match self.inner.try_borrow_mut() {
            Ok(inner) => inner,
            Err(_) => return,
        };
        
        inner.mouse_x = x;
        inner.mouse_y = y;
        inner.mouse_clicked = clicked;
        
        for executor in &mut inner.executors {
            executor.cached_mouse_x = x;
            executor.cached_mouse_y = y;
            executor.mouse_clicked = clicked;
        }
    }
    
    /// Update pressed keys from JavaScript
    #[wasm_bindgen]
    pub fn update_keys(&self, keys: &[u32]) {
        let mut inner = match self.inner.try_borrow_mut() {
            Ok(inner) => inner,
            Err(_) => return,
        };
        
        let keys_vec: Vec<u32> = keys.to_vec();
        for executor in &mut inner.executors {
            executor.pressed_keys = keys_vec.clone();
        }
    }

    /// Fire an event to all entities (internal helper)
    fn fire_event_inner(inner: &mut EngineInner, event_name: &str) {
        if let Some(project) = &inner.project_data.clone() {
            if let Some(objects) = &project.objects {
                for (entity_idx, obj) in objects.iter().enumerate() {
                    if let Some(scripts) = &obj.script {
                        for thread in scripts.iter() {
                            if let Some(first_block) = thread.first() {
                                if Self::is_event_block_inner(&first_block.block_type, event_name) {
                                    let executor = Executor::new(
                                        entity_idx,
                                        thread.clone(),
                                    );
                                    let mut exec_with_state = executor;
                                    exec_with_state.cached_mouse_x = inner.mouse_x;
                                    exec_with_state.cached_mouse_y = inner.mouse_y;
                                    exec_with_state.mouse_clicked = inner.mouse_clicked;
                                    inner.executors.push(exec_with_state);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    fn is_event_block_inner(block_type: &str, event_name: &str) -> bool {
        match event_name {
            "start" => block_type == "when_run_button_click",
            "keyPress" => block_type == "when_some_key_pressed",
            "mouse_clicked" => block_type == "mouse_clicked",
            "mouse_click_cancled" => block_type == "mouse_click_cancled",
            "when_scene_start" => block_type == "when_scene_start",
            _ => false,
        }
    }
    
    /// Fire key press event with specific key code
    #[wasm_bindgen]
    pub fn fire_key_event(&self, key_code: u32) {
        let mut inner = match self.inner.try_borrow_mut() {
            Ok(inner) => inner,
            Err(_) => return,
        };
        
        if inner.state != EngineState::Running {
            return;
        }
        
        if let Some(project) = &inner.project_data.clone() {
            if let Some(objects) = &project.objects {
                for (entity_idx, obj) in objects.iter().enumerate() {
                    if let Some(scripts) = &obj.script {
                        for thread in scripts.iter() {
                            if let Some(first_block) = thread.first() {
                                if first_block.block_type == "when_some_key_pressed" {
                                    // Check if this block's key matches the pressed key
                                    if let Some(params) = &first_block.params {
                                        if let Some(key_param) = params.get(1) {
                                            let block_key = key_param.as_str()
                                                .and_then(|s| s.parse::<u32>().ok())
                                                .or_else(|| key_param.as_f64().map(|n| n as u32))
                                                .unwrap_or(0);
                                            
                                            if block_key == key_code {
                                                let executor = Executor::new(
                                                    entity_idx,
                                                    thread.clone(),
                                                );
                                                let mut exec_with_state = executor;
                                                exec_with_state.cached_mouse_x = inner.mouse_x;
                                                exec_with_state.cached_mouse_y = inner.mouse_y;
                                                exec_with_state.mouse_clicked = inner.mouse_clicked;
                                                inner.executors.push(exec_with_state);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    /// Fire mouse clicked event
    #[wasm_bindgen]
    pub fn fire_mouse_clicked(&self) {
        let mut inner = match self.inner.try_borrow_mut() {
            Ok(inner) => inner,
            Err(_) => return,
        };
        
        if inner.state != EngineState::Running {
            return;
        }
        
        Self::fire_event_inner(&mut inner, "mouse_clicked");
        
        let mouse_x = inner.mouse_x;
        let mouse_y = inner.mouse_y;
        
        let mut clicked_entities = Vec::new();
        
        for entity in &inner.entities {
            if !entity.visible {
                continue;
            }
            
            let x1 = entity.x - (entity.reg_x * entity.scale_x);
            let x2 = entity.x + ((entity.width - entity.reg_x) * entity.scale_x);
            let min_x = x1.min(x2);
            let max_x = x1.max(x2);
            
            let y1 = entity.y + (entity.reg_y * entity.scale_y);
            let y2 = entity.y - ((entity.height - entity.reg_y) * entity.scale_y);
            let min_y = y1.min(y2);
            let max_y = y1.max(y2);
            
            if mouse_x >= min_x && mouse_x <= max_x && 
               mouse_y >= min_y && mouse_y <= max_y {
                clicked_entities.push(entity.id);
            }
        }
        
        if let Some(project) = &inner.project_data.clone() {
            if let Some(objects) = &project.objects {
                for entity_id in clicked_entities {
                     if let Some(obj) = objects.get(entity_id) {
                        if let Some(scripts) = &obj.script {
                            for thread in scripts.iter() {
                                if let Some(first_block) = thread.first() {
                                    if first_block.block_type == "when_object_click" {
                                        let executor = Executor::new(
                                            entity_id,
                                            thread.clone(),
                                        );
                                        let mut exec_with_state = executor;
                                        exec_with_state.cached_mouse_x = mouse_x;
                                        exec_with_state.cached_mouse_y = mouse_y;
                                        exec_with_state.mouse_clicked = true;
                                        inner.executors.push(exec_with_state);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    /// Fire mouse click cancelled event
    #[wasm_bindgen]
    pub fn fire_mouse_click_cancled(&self) {
        let mut inner = match self.inner.try_borrow_mut() {
            Ok(inner) => inner,
            Err(_) => return,
        };
        
        if inner.state != EngineState::Running {
            return;
        }
        
        Self::fire_event_inner(&mut inner, "mouse_click_cancled");
    }

    #[wasm_bindgen]
    pub fn fire_message_cast(&self, message_id: &str) {
        let mut inner = match self.inner.try_borrow_mut() {
            Ok(inner) => inner,
            Err(_) => return,
        };
        
        if inner.state != EngineState::Running {
            return;
        }
        
        let mut new_executors = Self::find_executors_for_message(&inner, message_id);
        inner.executors.append(&mut new_executors);
    }

    #[wasm_bindgen]
    pub fn fire_object_click(&self, entity_id: usize) {
        let mut inner = match self.inner.try_borrow_mut() {
            Ok(inner) => inner,
            Err(_) => return,
        };
        
        if inner.state != EngineState::Running {
            return;
        }
        
        if let Some(project) = &inner.project_data.clone() {
            if let Some(objects) = &project.objects {
                if let Some(obj) = objects.get(entity_id) {
                    if let Some(scripts) = &obj.script {
                        for thread in scripts.iter() {
                            if let Some(first_block) = thread.first() {
                                if first_block.block_type == "when_object_click" {
                                    let executor = Executor::new(
                                        entity_id,
                                        thread.clone(),
                                    );
                                    let mut exec_with_state = executor;
                                    exec_with_state.cached_mouse_x = inner.mouse_x;
                                    exec_with_state.cached_mouse_y = inner.mouse_y;
                                    exec_with_state.mouse_clicked = inner.mouse_clicked;
                                    inner.executors.push(exec_with_state);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    #[wasm_bindgen]
    pub fn fire_object_click_canceled(&self, entity_id: usize) {
        let mut inner = match self.inner.try_borrow_mut() {
            Ok(inner) => inner,
            Err(_) => return,
        };
        
        if inner.state != EngineState::Running {
            return;
        }
        
        if let Some(project) = &inner.project_data.clone() {
            if let Some(objects) = &project.objects {
                if let Some(obj) = objects.get(entity_id) {
                    if let Some(scripts) = &obj.script {
                        for thread in scripts.iter() {
                            if let Some(first_block) = thread.first() {
                                if first_block.block_type == "when_object_click_canceled" {
                                    let executor = Executor::new(
                                        entity_id,
                                        thread.clone(),
                                    );
                                    let mut exec_with_state = executor;
                                    exec_with_state.cached_mouse_x = inner.mouse_x;
                                    exec_with_state.cached_mouse_y = inner.mouse_y;
                                    exec_with_state.mouse_clicked = inner.mouse_clicked;
                                    inner.executors.push(exec_with_state);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    /// Fire scene start event
    #[wasm_bindgen]
    pub fn fire_scene_start(&self) {
        let mut inner = match self.inner.try_borrow_mut() {
            Ok(inner) => inner,
            Err(_) => return,
        };
        
        if inner.state != EngineState::Running {
            return;
        }
        
        Self::fire_event_inner(&mut inner, "when_scene_start");
    }

    fn initialize_executors_inner(inner: &mut EngineInner) {
        inner.executors.clear();
        for entity in &mut inner.entities {
            entity.take_snapshot();
        }
        inner.variables_snapshot = inner.variables.clone();
    }

    fn check_message_match(block: &Block, message_id: &str) -> bool {
        if let Some(params) = &block.params {
            if let Some(param) = params.get(1) {
                if let Some(s) = param.as_str() {
                    if s == message_id {
                        return true;
                    }
                } else if let Some(n) = param.as_f64() {
                    if n.to_string() == message_id {
                        return true;
                    }
                }
            }
            
            for param in params {
                if let Some(s) = param.as_str() {
                    if s == message_id {
                        return true;
                    }
                } else if let Some(n) = param.as_f64() {
                    if n.to_string() == message_id {
                        return true;
                    }
                }
            }
        }
        false
    }

    fn find_executors_for_message(inner: &EngineInner, message_id: &str) -> Vec<Executor> {
        let mut executors = Vec::new();
        
        if let Some(project) = &inner.project_data {
            if let Some(objects) = &project.objects {
                for (entity_idx, obj) in objects.iter().enumerate() {
                    if let Some(scripts) = &obj.script {
                        for thread in scripts.iter() {
                            if let Some(first_block) = thread.first() {
                                if first_block.block_type == "when_message_cast" {
                                    if Self::check_message_match(first_block, message_id) {
                                        let executor = Executor::new(
                                            entity_idx,
                                            thread.clone(),
                                        );
                                        let mut exec_with_state = executor;
                                        exec_with_state.cached_mouse_x = inner.mouse_x;
                                        exec_with_state.cached_mouse_y = inner.mouse_y;
                                        exec_with_state.mouse_clicked = inner.mouse_clicked;
                                        executors.push(exec_with_state);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        executors
    }
}

/// Engine state enum
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EngineState {
    Stopped,
    Running,
    Paused,
}

/// Value type for variables
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Value {
    Number(f64),
    String(String),
    Bool(bool),
    List(Vec<Value>),
    Null,
}

impl Value {
    pub fn from_json(json: &serde_json::Value) -> Self {
        match json {
            serde_json::Value::Number(n) => Value::Number(n.as_f64().unwrap_or(0.0)),
            serde_json::Value::String(s) => Value::String(s.clone()),
            serde_json::Value::Bool(b) => Value::Bool(*b),
            serde_json::Value::Array(arr) => {
                Value::List(arr.iter().map(Value::from_json).collect())
            }
            _ => Value::Null,
        }
    }

    pub fn as_number(&self) -> f64 {
        match self {
            Value::Number(n) => *n,
            Value::String(s) => s.parse().unwrap_or(0.0),
            Value::Bool(b) => if *b { 1.0 } else { 0.0 },
            _ => 0.0,
        }
    }

    pub fn as_string(&self) -> String {
        match self {
            Value::Number(n) => n.to_string(),
            Value::String(s) => s.clone(),
            Value::Bool(b) => b.to_string(),
            _ => String::new(),
        }
    }

    pub fn as_bool(&self) -> bool {
        match self {
            Value::Number(n) => *n != 0.0,
            Value::String(s) => !s.is_empty() && s != "0" && s.to_lowercase() != "false",
            Value::Bool(b) => *b,
            _ => false,
        }
    }
}

/// Project data structure
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProjectData {
    pub id: Option<String>,
    pub name: Option<String>,
    pub speed: Option<u32>,
    pub objects: Option<Vec<ObjectData>>,
    pub variables: Option<Vec<VariableData>>,
    pub messages: Option<Vec<MessageData>>,
    pub functions: Option<serde_json::Value>,
    pub scenes: Option<Vec<SceneData>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ObjectData {
    pub id: String,
    pub name: Option<String>,
    #[serde(deserialize_with = "deserialize_script", default)]
    pub script: Option<Vec<Vec<Block>>>,
    #[serde(rename = "selectedPictureId")]
    pub selected_picture_id: Option<String>,
    #[serde(rename = "objectType")]
    pub object_type: Option<String>,
    pub entity: Option<EntityData>,
    pub sprite: Option<SpriteData>,
}

// script 필드가 문자열로 올 경우를 처리하는 커스텀 디시리얼라이저
fn deserialize_script<'de, D>(deserializer: D) -> Result<Option<Vec<Vec<Block>>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::Error;
    
    let value: Option<serde_json::Value> = Option::deserialize(deserializer)?;
    
    match value {
        None => Ok(None),
        Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::String(s)) => {
            // 문자열인 경우 JSON으로 파싱
            if s.is_empty() {
                return Ok(Some(Vec::new()));
            }
            serde_json::from_str(&s)
                .map(Some)
                .map_err(|e| D::Error::custom(format!("Failed to parse script string: {}", e)))
        }
        Some(serde_json::Value::Array(arr)) => {
            // 이미 배열인 경우
            serde_json::from_value(serde_json::Value::Array(arr))
                .map(Some)
                .map_err(|e| D::Error::custom(format!("Failed to parse script array: {}", e)))
        }
        Some(other) => {
            Err(D::Error::custom(format!("Unexpected script type: {:?}", other)))
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EntityData {
    pub x: Option<f64>,
    pub y: Option<f64>,
    #[serde(rename = "regX")]
    pub reg_x: Option<f64>,
    #[serde(rename = "regY")]
    pub reg_y: Option<f64>,
    #[serde(rename = "scaleX")]
    pub scale_x: Option<f64>,
    #[serde(rename = "scaleY")]
    pub scale_y: Option<f64>,
    pub rotation: Option<f64>,
    pub direction: Option<f64>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub visible: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SpriteData {
    pub pictures: Option<Vec<PictureData>>,
    pub sounds: Option<Vec<SoundData>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PictureData {
    pub id: String,
    pub name: Option<String>,
    pub filename: Option<String>,
    pub fileurl: Option<String>,
    pub dimension: Option<DimensionData>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DimensionData {
    pub width: Option<f64>,
    pub height: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SoundData {
    pub id: String,
    pub name: Option<String>,
    pub filename: Option<String>,
    pub fileurl: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VariableData {
    pub id: String,
    pub name: Option<String>,
    pub value: serde_json::Value,
    #[serde(rename = "variableType")]
    pub variable_type: Option<String>,
    pub array: Option<Vec<serde_json::Value>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MessageData {
    pub id: String,
    pub name: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SceneData {
    pub id: String,
    pub name: Option<String>,
}

/// Block structure
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Block {
    #[serde(rename = "type")]
    pub block_type: String,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub params: Option<Vec<serde_json::Value>>,
    pub statements: Option<Vec<Vec<Block>>>,
}

/// Render entity for JavaScript
#[derive(Clone, Debug, Serialize)]
pub struct RenderEntity {
    pub id: usize,
    pub x: f64,
    pub y: f64,
    pub rotation: f64,
    pub direction: f64,
    #[serde(rename = "scaleX")]
    pub scale_x: f64,
    #[serde(rename = "scaleY")]
    pub scale_y: f64,
    pub width: f64,
    pub height: f64,
    pub visible: bool,
    pub color: String,
    #[serde(rename = "pictureId")]
    pub picture_id: Option<String>,
    #[serde(rename = "dialogMessage")]
    pub dialog_message: Option<String>,
    #[serde(rename = "dialogMode")]
    pub dialog_mode: Option<String>,
    // Brush state
    #[serde(rename = "brushDown")]
    pub brush_down: bool,
    #[serde(rename = "brushColor")]
    pub brush_color: String,
    #[serde(rename = "brushSize")]
    pub brush_size: f64,
    #[serde(rename = "brushTransparency")]
    pub brush_transparency: f64,
    // Fill state
    #[serde(rename = "fillDown")]
    pub fill_down: bool,
    #[serde(rename = "fillColor")]
    pub fill_color: String,
    #[serde(rename = "fillTransparency")]
    pub fill_transparency: f64,
}

impl From<&Entity> for RenderEntity {
    fn from(e: &Entity) -> Self {
        RenderEntity {
            id: e.id,
            x: e.x,
            y: e.y,
            rotation: e.rotation,
            direction: e.direction,
            scale_x: e.scale_x,
            scale_y: e.scale_y,
            width: e.width,
            height: e.height,
            visible: e.visible,
            color: "#4a90d9".to_string(),
            picture_id: e.current_picture_id.clone(),
            dialog_message: e.dialog_message.clone(),
            dialog_mode: e.dialog_mode.clone(),
            brush_down: e.brush_down,
            brush_color: e.brush_color.clone(),
            brush_size: e.brush_size,
            brush_transparency: e.brush_transparency,
            fill_down: e.fill_down,
            fill_color: e.fill_color.clone(),
            fill_transparency: e.fill_transparency,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_engine_creation() {
        let engine = WasmEngine::new();
        assert!(!engine.is_running());
        assert_eq!(engine.get_tick(), 0);
    }

    #[test]
    fn test_signal_casting() {
        let json = r#"{
            "speed": 60,
            "variables": [
                {
                    "id": "var1",
                    "name": "received",
                    "value": 0,
                    "variableType": "variable"
                }
            ],
            "objects": [
                {
                    "id": "obj1",
                    "script": [
                        [
                            {
                                "type": "when_run_button_click",
                                "params": []
                            },
                            {
                                "type": "message_cast_wait",
                                "params": ["sig1"]
                            }
                        ]
                    ]
                },
                {
                    "id": "obj2",
                    "script": [
                        [
                            {
                                "type": "when_message_cast",
                                "params": ["sig1"]
                            },
                            {
                                "type": "set_variable",
                                "params": ["var1", 1]
                            }
                        ]
                    ]
                }
            ]
        }"#;

        let engine = WasmEngine::new();
        engine.load_project(json).unwrap();
        engine.start();
        
        // Tick 1: when_run_button_click executes -> message_cast_wait executes -> queues signal
        engine.tick(); 
        
        // Tick 2: signal handler should be added and executed
        engine.tick();
        
        let vars = engine.get_variables();
        assert!(vars.contains("\"var1\":1") || vars.contains("\"var1\":1.0"), "Variable should be updated to 1, got: {}", vars);
    }
}
