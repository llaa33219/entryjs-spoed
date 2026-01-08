//! Entry WASM Execution Engine
//! High-performance block execution engine for Entry projects

use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::cell::{Cell, RefCell};
use std::panic::{catch_unwind, AssertUnwindSafe};

mod blocks;
mod executor;
mod entity;

pub use blocks::*;
pub use executor::*;
pub use entity::*;

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
    BrushEraseAll,
    StartDrawing { entity_id: usize },
    StopDrawing { entity_id: usize },
    StartFill { entity_id: usize },
    StopFill { entity_id: usize },
    SetBrushColor { entity_id: usize, color: String },
    SetRandomColor { entity_id: usize },
    SetFillColor { entity_id: usize, color: String },
    
    // Timer actions  
    TimerAction { action: String },  // start, stop, reset
    SetTimerVisible { visible: bool },
    
    // Object actions
    ChangeObjectIndex { entity_id: usize, location: String },
    
    // Input actions
    AskAndWait { entity_id: usize, message: String },
    SetAnswerVisible { visible: bool },
    
    // Project control
    RestartProject,
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
}

impl EngineInner {
    fn new() -> Self {
        EngineInner {
            state: EngineState::Stopped,
            entities: Vec::new(),
            variables: HashMap::new(),
            variables_snapshot: HashMap::new(),
            executors: Vec::new(),
            tick_count: 0,
            fps: 60,
            project_data: None,
            functions: HashMap::new(),
            pending_js_actions: Vec::new(),
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
        inner.project_data = Some(project.clone());
        
        // Initialize entities from objects
        inner.entities.clear();
        if let Some(objects) = &project.objects {
            for (idx, obj) in objects.iter().enumerate() {
                let entity = Entity::from_object(obj, idx);
                inner.entities.push(entity);
            }
        }
        
        // Initialize variables
        inner.variables.clear();
        if let Some(vars) = &project.variables {
            for var in vars {
                let value = Value::from_json(&var.value);
                inner.variables.insert(var.id.clone(), value);
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

    /// Start the engine
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
        
        // Initialize executors and fire start event
        Self::initialize_executors_inner(&mut inner);
        Self::fire_event_inner(&mut inner, "start");
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
        let tick_result = catch_unwind(AssertUnwindSafe(|| {
            self.tick_inner()
        }));
        
        if let Err(panic_info) = tick_result {
            if !self.error_logged.get() {
                self.error_logged.set(true);
                let panic_msg = if let Some(s) = panic_info.downcast_ref::<&str>() {
                    s.to_string()
                } else if let Some(s) = panic_info.downcast_ref::<String>() {
                    s.clone()
                } else {
                    format!("{:?}", panic_info)
                };
                web_sys::console::error_1(
                    &format!("WASM tick panic: {}", panic_msg).into()
                );
            }
        }
    }
    
    fn tick_inner(&self) {
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
        
        for (idx, executor) in executors.iter_mut().enumerate() {
            if inner.state != EngineState::Running || self.stop_requested.get() {
                break;
            }
            
            let mut execution_count = 0u32;
            
            loop {
                if inner.state != EngineState::Running || self.stop_requested.get() {
                    break;
                }
                

                
                let execute_result = catch_unwind(AssertUnwindSafe(|| {
                    executor.execute(
                        &mut entities, 
                        &mut variables, 
                        &mut pending_js_actions, 
                        functions_ref
                    )
                }));
                
                match execute_result {
                    Ok(result) => {
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
                    Err(panic_info) => {
                        if !self.error_logged.get() {
                            self.error_logged.set(true);
                            let panic_msg = if let Some(s) = panic_info.downcast_ref::<&str>() {
                                s.to_string()
                            } else if let Some(s) = panic_info.downcast_ref::<String>() {
                                s.clone()
                            } else {
                                format!("{:?}", panic_info)
                            };
                            web_sys::console::error_1(
                                &format!("WASM panic in executor (entity {}): {}", executor.entity_idx, panic_msg).into()
                            );
                        }
                        completed.push(idx);
                        break;
                    }
                }
            }
        }
        
        for idx in completed.into_iter().rev() {
            executors.remove(idx);
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
    }
    
    #[wasm_bindgen]
    pub fn get_js_actions(&self) -> String {
        catch_unwind(AssertUnwindSafe(|| {
            let mut inner = match self.inner.try_borrow_mut() {
                Ok(inner) => inner,
                Err(_) => return "[]".to_string(),
            };
            
            if inner.pending_js_actions.is_empty() {
                return "[]".to_string();
            }
            
            let actions = std::mem::take(&mut inner.pending_js_actions);
            serde_json::to_string(&actions).unwrap_or_else(|_| "[]".to_string())
        })).unwrap_or_else(|_| "[]".to_string())
    }
    
    #[wasm_bindgen]
    pub fn has_pending_js_actions(&self) -> bool {
        catch_unwind(AssertUnwindSafe(|| {
            match self.inner.try_borrow() {
                Ok(inner) => !inner.pending_js_actions.is_empty(),
                Err(_) => false,
            }
        })).unwrap_or(false)
    }

    #[wasm_bindgen]
    pub fn get_render_data(&self) -> String {
        catch_unwind(AssertUnwindSafe(|| {
            let inner = match self.inner.try_borrow() {
                Ok(inner) => inner,
                Err(_) => return "[]".to_string(),
            };
            
            // Reverse order: first object in data should be rendered last (on top/front)
            let render_entities: Vec<RenderEntity> = inner.entities
                .iter()
                .rev()  // Reverse iteration so first object appears on top
                .filter(|e| e.visible)
                .map(|e| RenderEntity::from(e))
                .collect();
            
            serde_json::to_string(&render_entities).unwrap_or_else(|_| "[]".to_string())
        })).unwrap_or_else(|_| "[]".to_string())
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
    
    /// Update mouse state from JavaScript
    #[wasm_bindgen]
    pub fn update_mouse(&self, x: f64, y: f64, clicked: bool) {
        let mut inner = match self.inner.try_borrow_mut() {
            Ok(inner) => inner,
            Err(_) => return,
        };
        
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
                                    inner.executors.push(executor);
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
            "mouse_clicked" => block_type == "when_some_key_pressed" || block_type == "when_object_click",
            _ => false,
        }
    }

    fn initialize_executors_inner(inner: &mut EngineInner) {
        inner.executors.clear();
        for entity in &mut inner.entities {
            entity.take_snapshot();
        }
        inner.variables_snapshot = inner.variables.clone();
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
    fn test_value_conversion() {
        let num = Value::Number(42.0);
        assert_eq!(num.as_number(), 42.0);
        assert_eq!(num.as_string(), "42");
        assert!(num.as_bool());

        let zero = Value::Number(0.0);
        assert!(!zero.as_bool());
    }
}
