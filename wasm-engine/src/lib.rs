//! Entry WASM Execution Engine
//! High-performance block execution engine for Entry projects

use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// Function data structure
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FunctionData {
    pub id: String,
    #[serde(deserialize_with = "deserialize_script", default)]
    pub content: Option<Vec<Vec<Block>>>,
}

/// Main WASM Engine class exposed to JavaScript
#[wasm_bindgen]
pub struct WasmEngine {
    state: EngineState,
    entities: Vec<Entity>,
    variables: HashMap<String, Value>,
    executors: Vec<Executor>,
    tick_count: u64,
    fps: u32,
    project_data: Option<ProjectData>,
    /// Parsed functions for quick lookup
    functions: HashMap<String, FunctionData>,
    /// Pending JavaScript actions to be consumed after tick()
    pending_js_actions: Vec<JsAction>,
}

#[wasm_bindgen]
impl WasmEngine {
    /// Create a new WASM engine instance
    #[wasm_bindgen(constructor)]
    pub fn new() -> WasmEngine {
        WasmEngine {
            state: EngineState::Stopped,
            entities: Vec::new(),
            variables: HashMap::new(),
            executors: Vec::new(),
            tick_count: 0,
            fps: 60,
            project_data: None,
            functions: HashMap::new(),
            pending_js_actions: Vec::new(),
        }
    }

    /// Load a project from JSON string
    #[wasm_bindgen]
    pub fn load_project(&mut self, json: &str) -> Result<(), JsValue> {
        let project: ProjectData = serde_json::from_str(json)
            .map_err(|e| JsValue::from_str(&format!("JSON parse error: {}", e)))?;
        
        self.fps = project.speed.unwrap_or(60);
        self.project_data = Some(project.clone());
        
        // Initialize entities from objects
        self.entities.clear();
        if let Some(objects) = &project.objects {
            for (idx, obj) in objects.iter().enumerate() {
                let entity = Entity::from_object(obj, idx);
                self.entities.push(entity);
            }
        }
        
        // Initialize variables
        self.variables.clear();
        if let Some(vars) = &project.variables {
            for var in vars {
                let value = Value::from_json(&var.value);
                self.variables.insert(var.id.clone(), value);
            }
        }
        
        // Initialize functions
        self.functions.clear();
        if let Some(funcs) = &project.functions {
            if let Some(func_map) = funcs.as_object() {
                for (func_id, func_value) in func_map {
                    if let Ok(func_data) = serde_json::from_value::<FunctionData>(func_value.clone()) {
                        web_sys::console::log_1(&format!(
                            "[WASM] Loaded function: id={}, has_content={}",
                            func_id, func_data.content.is_some()
                        ).into());
                        self.functions.insert(func_id.clone(), func_data);
                    }
                }
            }
        }
        web_sys::console::log_1(&format!("[WASM] Loaded {} functions", self.functions.len()).into());
        
        Ok(())
    }

    /// Start the engine
    #[wasm_bindgen]
    pub fn start(&mut self) {
        web_sys::console::log_1(&"[WASM] start() called".into());
        self.state = EngineState::Running;
        self.initialize_executors();
        self.fire_event("start");
        web_sys::console::log_1(&format!("[WASM] After fire_event, executors count: {}", self.executors.len()).into());
    }

    /// Stop the engine
    #[wasm_bindgen]
    pub fn stop(&mut self) {
        self.state = EngineState::Stopped;
        self.executors.clear();
    }

    /// Reset the engine to initial state
    #[wasm_bindgen]
    pub fn reset(&mut self) {
        self.state = EngineState::Stopped;
        self.tick_count = 0;
        self.executors.clear();
        
        // Restore entity snapshots and clear dialog/brush state
        for entity in &mut self.entities {
            entity.restore_snapshot();
            entity.dialog_message = None;
            entity.dialog_mode = None;
            // Reset brush state
            entity.brush_down = false;
            entity.brush_size = 1.0;
            entity.brush_color = "#ff0000".to_string();
        }
    }

    /// Execute one tick of the engine
    #[wasm_bindgen]
    pub fn tick(&mut self) {
        if self.state != EngineState::Running {
            return;
        }
        
        self.tick_count += 1;
        
        // Log status every 60 ticks
        if self.tick_count % 60 == 0 {
            web_sys::console::log_1(&format!(
                "[WASM] Tick {}: {} executors, {} entities",
                self.tick_count,
                self.executors.len(),
                self.entities.len()
            ).into());
        }
        
        // Execute all active executors
        let mut completed = Vec::new();
        
        for (idx, executor) in self.executors.iter_mut().enumerate() {
            let result = executor.execute(&mut self.entities, &mut self.variables, &mut self.pending_js_actions, &self.functions);
            
            // Log first few ticks for debugging
            if self.tick_count <= 5 {
                web_sys::console::log_1(&format!(
                    "[WASM] Executor {} result: {:?}",
                    idx, result
                ).into());
            }
            
            if result == ExecuteResult::End {
                completed.push(idx);
            }
        }
        
        // Remove completed executors (in reverse order to maintain indices)
        for idx in completed.into_iter().rev() {
            self.executors.remove(idx);
        }
    }
    
    /// Get pending JavaScript actions as JSON and clear the queue
    /// Call this after tick() to process any actions that require JS
    #[wasm_bindgen]
    pub fn get_js_actions(&mut self) -> String {
        if self.pending_js_actions.is_empty() {
            return "[]".to_string();
        }
        
        let actions = std::mem::take(&mut self.pending_js_actions);
        serde_json::to_string(&actions).unwrap_or_else(|_| "[]".to_string())
    }
    
    /// Check if there are pending JS actions
    #[wasm_bindgen]
    pub fn has_pending_js_actions(&self) -> bool {
        !self.pending_js_actions.is_empty()
    }

    /// Get render data as JSON string for JavaScript to draw
    #[wasm_bindgen]
    pub fn get_render_data(&self) -> String {
        // Log entity positions every 60 ticks
        if self.tick_count % 60 == 0 && !self.entities.is_empty() {
            let e = &self.entities[0];
            web_sys::console::log_1(&format!(
                "[WASM] get_render_data: Entity 0 position: ({:.1}, {:.1}), visible: {}",
                e.x, e.y, e.visible
            ).into());
        }
        
        let render_entities: Vec<RenderEntity> = self.entities
            .iter()
            .filter(|e| e.visible)
            .map(|e| RenderEntity::from(e))
            .collect();
        
        serde_json::to_string(&render_entities).unwrap_or_else(|_| "[]".to_string())
    }

    /// Check if engine is running
    #[wasm_bindgen]
    pub fn is_running(&self) -> bool {
        self.state == EngineState::Running
    }

    /// Get current tick count
    #[wasm_bindgen]
    pub fn get_tick(&self) -> u64 {
        self.tick_count
    }
    
    /// Update mouse state from JavaScript
    #[wasm_bindgen]
    pub fn update_mouse(&mut self, x: f64, y: f64, clicked: bool) {
        for executor in &mut self.executors {
            executor.cached_mouse_x = x;
            executor.cached_mouse_y = y;
            executor.mouse_clicked = clicked;
        }
    }
    
    /// Update pressed keys from JavaScript
    #[wasm_bindgen]
    pub fn update_keys(&mut self, keys: &[u32]) {
        let keys_vec: Vec<u32> = keys.to_vec();
        for executor in &mut self.executors {
            executor.pressed_keys = keys_vec.clone();
        }
    }

    /// Fire an event to all entities
    fn fire_event(&mut self, event_name: &str) {
        web_sys::console::log_1(&format!("[WASM] fire_event('{}') called", event_name).into());
        
        if let Some(project) = &self.project_data {
            web_sys::console::log_1(&format!("[WASM] Project data exists, name: {:?}", project.name).into());
            
            if let Some(objects) = &project.objects {
                web_sys::console::log_1(&format!("[WASM] Found {} objects", objects.len()).into());
                
                for (entity_idx, obj) in objects.iter().enumerate() {
                    web_sys::console::log_1(&format!(
                        "[WASM] Object {}: id={}, name={:?}, has_script={}",
                        entity_idx,
                        obj.id,
                        obj.name,
                        obj.script.is_some()
                    ).into());
                    
                    if let Some(scripts) = &obj.script {
                        web_sys::console::log_1(&format!(
                            "[WASM]   Script has {} threads",
                            scripts.len()
                        ).into());
                        
                        for (thread_idx, thread) in scripts.iter().enumerate() {
                            web_sys::console::log_1(&format!(
                                "[WASM]   Thread {}: {} blocks",
                                thread_idx,
                                thread.len()
                            ).into());
                            
                            if let Some(first_block) = thread.first() {
                                web_sys::console::log_1(&format!(
                                    "[WASM]     First block type: '{}'",
                                    first_block.block_type
                                ).into());
                                
                                let is_match = self.is_event_block(&first_block.block_type, event_name);
                                web_sys::console::log_1(&format!(
                                    "[WASM]     Matches '{}' event: {}",
                                    event_name,
                                    is_match
                                ).into());
                                
                                if is_match {
                                    let executor = Executor::new(
                                        entity_idx,
                                        thread.clone(),
                                    );
                                    self.executors.push(executor);
                                    web_sys::console::log_1(&"[WASM]     Created executor for this thread".into());
                                }
                            } else {
                                web_sys::console::log_1(&"[WASM]     Thread is empty!".into());
                            }
                        }
                    } else {
                        web_sys::console::log_1(&"[WASM]   No script found for this object".into());
                    }
                }
            } else {
                web_sys::console::log_1(&"[WASM] No objects in project!".into());
            }
        } else {
            web_sys::console::log_1(&"[WASM] No project data loaded!".into());
        }
    }

    fn is_event_block(&self, block_type: &str, event_name: &str) -> bool {
        match event_name {
            "start" => block_type == "when_run_button_click",
            "mouse_clicked" => block_type == "when_some_key_pressed" || block_type == "when_object_click",
            _ => false,
        }
    }

    fn initialize_executors(&mut self) {
        self.executors.clear();
        // Take snapshots of all entities
        for entity in &mut self.entities {
            entity.take_snapshot();
        }
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
