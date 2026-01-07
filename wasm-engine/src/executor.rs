//! Executor module - handles block execution with call stack

use std::collections::HashMap;
use crate::{Block, Entity, Value};

/// Result of block execution
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ExecuteResult {
    Continue,      // Continue to next block
    Wait,          // Wait (for timed blocks)
    Break,         // Break out of loop
    End,           // Execution ended
    JumpedToBlock, // Jumped to a new block list (don't increment block_index)
}

/// Executor manages the execution of a thread of blocks
#[derive(Clone, Debug)]
pub struct Executor {
    pub entity_idx: usize,
    blocks: Vec<Block>,
    block_index: usize,
    call_stack: Vec<StackFrame>,
    #[allow(dead_code)]
    register: HashMap<String, Value>,
    wait_frames: u32,
    iteration_count: u32,
    // Cached entity properties for value blocks
    cached_entity_x: f64,
    cached_entity_y: f64,
    cached_entity_rotation: f64,
    cached_entity_direction: f64,
    cached_entity_scale: f64,
}

#[derive(Clone, Debug)]
struct StackFrame {
    blocks: Vec<Block>,
    block_index: usize,
    iteration_count: u32,
    is_loop: bool,
}

impl Executor {
    pub fn new(entity_idx: usize, blocks: Vec<Block>) -> Self {
        Executor {
            entity_idx,
            blocks,
            block_index: 0,
            call_stack: Vec::new(),
            register: HashMap::new(),
            wait_frames: 0,
            iteration_count: 0,
            cached_entity_x: 0.0,
            cached_entity_y: 0.0,
            cached_entity_rotation: 0.0,
            cached_entity_direction: 90.0,
            cached_entity_scale: 100.0,
        }
    }
    
    /// Update cached entity properties from the entity
    fn update_cached_entity(&mut self, entity: Option<&Entity>) {
        if let Some(e) = entity {
            self.cached_entity_x = e.x;
            self.cached_entity_y = e.y;
            self.cached_entity_rotation = e.rotation;
            self.cached_entity_direction = e.direction;
            self.cached_entity_scale = e.get_scale();
        }
    }
    
    /// Helper to convert Value to String
    fn value_as_string(value: &Value) -> String {
        match value {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            Value::Bool(b) => if *b { "true".to_string() } else { "false".to_string() },
            Value::List(l) => format!("{:?}", l),
            Value::Null => String::new(),
        }
    }

    /// Execute one step
    pub fn execute(
        &mut self, 
        entities: &mut Vec<Entity>, 
        variables: &mut HashMap<String, Value>
    ) -> ExecuteResult {
        // Log current state at start of execute
        web_sys::console::log_1(&format!(
            "[WASM] execute(): block_index={}, blocks.len()={}, wait_frames={}, iteration_count={}",
            self.block_index, self.blocks.len(), self.wait_frames, self.iteration_count
        ).into());
        
        // Update cached entity properties
        self.update_cached_entity(entities.get(self.entity_idx));
        
        // Check if waiting
        if self.wait_frames > 0 {
            self.wait_frames -= 1;
            return ExecuteResult::Wait;
        }

        // Get current block
        let block = match self.get_current_block() {
            Some(b) => b.clone(),
            None => {
                web_sys::console::log_1(&format!(
                    "[WASM] No current block at index {}, stack size: {}",
                    self.block_index, self.call_stack.len()
                ).into());
                
                // Try to pop from call stack
                if let Some(frame) = self.call_stack.pop() {
                    self.blocks = frame.blocks;
                    self.block_index = frame.block_index;
                    
                    web_sys::console::log_1(&format!(
                        "[WASM] Popped stack frame: is_loop={}, iteration_count={}, block_index={}",
                        frame.is_loop, frame.iteration_count, frame.block_index
                    ).into());
                    
                    if frame.is_loop && frame.iteration_count > 0 {
                        // More iterations remaining - set iteration_count for repeat_basic to use
                        self.iteration_count = frame.iteration_count;
                        web_sys::console::log_1(&format!(
                            "[WASM] Loop iteration complete, {} remaining, will re-execute block at index {}",
                            frame.iteration_count, self.block_index
                        ).into());
                        // Re-execute the loop block (don't increment block_index)
                        return ExecuteResult::Continue;
                    }
                    
                    // Loop finished or not a loop - move to next block
                    self.iteration_count = 0;
                    self.block_index += 1;
                    web_sys::console::log_1(&format!(
                        "[WASM] Stack frame popped, moving to block {}, blocks.len()={}",
                        self.block_index, self.blocks.len()
                    ).into());
                    return ExecuteResult::Continue;
                }
                web_sys::console::log_1(&"[WASM] No more blocks and stack empty, returning End".into());
                return ExecuteResult::End;
            }
        };

        // Execute block
        let entity = entities.get_mut(self.entity_idx);
        let result = self.execute_block(&block, entity, variables);

        match result {
            ExecuteResult::Continue => {
                self.block_index += 1;
            }
            ExecuteResult::JumpedToBlock => {
                // Don't increment block_index - we jumped to a new block list
            }
            ExecuteResult::Break => {
                // Pop loop from stack
                while let Some(frame) = self.call_stack.pop() {
                    if frame.is_loop {
                        self.blocks = frame.blocks;
                        self.block_index = frame.block_index + 1;
                        break;
                    }
                }
            }
            _ => {}
        }

        result
    }

    fn get_current_block(&self) -> Option<&Block> {
        self.blocks.get(self.block_index)
    }

    fn execute_block(
        &mut self,
        block: &Block,
        entity: Option<&mut Entity>,
        variables: &mut HashMap<String, Value>,
    ) -> ExecuteResult {
        let block_type = block.block_type.as_str();
        
        match block_type {
            // === Event blocks (just pass through) ===
            "when_run_button_click" | 
            "when_some_key_pressed" |
            "when_object_click" |
            "when_clone_start" |
            "when_message_cast" => ExecuteResult::Continue,

            // === Movement blocks ===
            "move_direction" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    let old_x = e.x;
                    let old_y = e.y;
                    e.move_direction(value);
                    web_sys::console::log_1(&format!(
                        "[WASM] move_direction({}) executed: ({:.1}, {:.1}) -> ({:.1}, {:.1})",
                        value, old_x, old_y, e.x, e.y
                    ).into());
                }
                ExecuteResult::Continue
            }
            
            "move_x" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    e.move_x(value);
                }
                ExecuteResult::Continue
            }
            
            "move_y" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    e.move_y(value);
                }
                ExecuteResult::Continue
            }
            
            "locate_x" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    e.set_x(value);
                }
                ExecuteResult::Continue
            }
            
            "locate_y" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    e.set_y(value);
                }
                ExecuteResult::Continue
            }
            
            "locate_xy" => {
                if let Some(e) = entity {
                    let x = self.get_param_number(block, 0, variables);
                    let y = self.get_param_number(block, 1, variables);
                    e.set_xy(x, y);
                }
                ExecuteResult::Continue
            }
            
            "rotate_relative" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    let old_rot = e.rotation;
                    e.rotate(value);
                    web_sys::console::log_1(&format!(
                        "[WASM] rotate_relative({}) executed: {:.1} -> {:.1}",
                        value, old_rot, e.rotation
                    ).into());
                }
                ExecuteResult::Continue
            }
            
            "direction_relative" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    e.add_direction(value);
                }
                ExecuteResult::Continue
            }
            
            "rotate_absolute" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    e.set_rotation(value);
                }
                ExecuteResult::Continue
            }
            
            "direction_absolute" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    e.set_direction(value);
                }
                ExecuteResult::Continue
            }
            
            "move_to_angle" => {
                if let Some(e) = entity {
                    let angle = self.get_param_number(block, 0, variables);
                    let distance = self.get_param_number(block, 1, variables);
                    let angle_rad = (angle - 90.0).to_radians();
                    e.x += distance * angle_rad.cos();
                    e.y -= distance * angle_rad.sin();
                }
                ExecuteResult::Continue
            }

            // === Looks blocks ===
            "show" => {
                if let Some(e) = entity {
                    e.show();
                }
                ExecuteResult::Continue
            }
            
            "hide" => {
                if let Some(e) = entity {
                    e.hide();
                }
                ExecuteResult::Continue
            }
            
            "change_to_next_shape" => {
                if let Some(e) = entity {
                    e.next_picture();
                }
                ExecuteResult::Continue
            }
            
            "set_effect" => {
                if let Some(e) = entity {
                    let effect = self.get_param_string(block, 0);
                    let value = self.get_param_number(block, 1, variables);
                    e.set_effect(&effect, value);
                }
                ExecuteResult::Continue
            }
            
            "change_effect" => {
                if let Some(e) = entity {
                    let effect = self.get_param_string(block, 0);
                    let value = self.get_param_number(block, 1, variables);
                    e.change_effect(&effect, value);
                }
                ExecuteResult::Continue
            }
            
            "clear_effect" => {
                if let Some(e) = entity {
                    e.clear_effects();
                }
                ExecuteResult::Continue
            }
            
            "change_scale_size" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    e.change_scale(value / 100.0);
                }
                ExecuteResult::Continue
            }
            
            "set_scale_size" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    e.set_scale(value / 100.0);
                }
                ExecuteResult::Continue
            }
            
            "flip_x" => {
                if let Some(e) = entity {
                    e.scale_y = -e.scale_y;
                }
                ExecuteResult::Continue
            }
            
            "flip_y" => {
                if let Some(e) = entity {
                    e.scale_x = -e.scale_x;
                }
                ExecuteResult::Continue
            }
            
            "dialog" | "dialog_time" => {
                // Dialog blocks - just log for now since we don't have UI
                let message = self.get_param_string(block, 0);
                web_sys::console::log_1(&format!("[WASM] Dialog: {}", message).into());
                
                if block_type == "dialog_time" {
                    let seconds = self.get_param_number(block, 1, variables);
                    self.wait_frames = (seconds * 60.0) as u32;
                }
                ExecuteResult::Continue
            }
            
            "remove_dialog" => {
                // Just continue - no UI to remove
                ExecuteResult::Continue
            }

            // === Flow control blocks ===
            "wait_second" => {
                let seconds = self.get_param_number(block, 0, variables);
                self.wait_frames = (seconds * 60.0) as u32; // Assuming 60 FPS
                // Note: We return Continue here so block_index increments.
                // The wait will happen on subsequent ticks via wait_frames check.
                ExecuteResult::Continue
            }
            
            "repeat_basic" => {
                // Check if we're resuming a loop (iteration_count was set by stack pop)
                // or starting fresh
                let count = if self.iteration_count > 0 {
                    // Resuming from stack pop - use remaining iterations
                    self.iteration_count
                } else {
                    // Fresh start - get count from params
                    self.get_param_number(block, 0, variables) as u32
                };
                
                web_sys::console::log_1(&format!(
                    "[WASM] repeat_basic: count={}, has_statements={}",
                    count,
                    block.statements.is_some()
                ).into());
                
                if count > 0 {
                    if let Some(statements) = &block.statements {
                        if let Some(inner_blocks) = statements.first() {
                            if !inner_blocks.is_empty() {
                                web_sys::console::log_1(&format!(
                                    "[WASM] repeat_basic: entering loop iteration, {} remaining",
                                    count
                                ).into());
                                // Save current state with remaining count
                                let frame = StackFrame {
                                    blocks: self.blocks.clone(),
                                    block_index: self.block_index,
                                    iteration_count: count - 1,
                                    is_loop: true,
                                };
                                self.call_stack.push(frame);
                                
                                // Enter loop body
                                self.blocks = inner_blocks.clone();
                                self.block_index = 0;
                                self.iteration_count = 0; // Reset for inner blocks
                                return ExecuteResult::JumpedToBlock;
                            }
                        }
                    }
                }
                // Loop finished or no statements
                self.iteration_count = 0;
                ExecuteResult::Continue
            }
            
            "repeat_inf" => {
                if let Some(statements) = &block.statements {
                    if let Some(inner_blocks) = statements.first() {
                        if !inner_blocks.is_empty() {
                            let frame = StackFrame {
                                blocks: self.blocks.clone(),
                                block_index: self.block_index,
                                iteration_count: u32::MAX,
                                is_loop: true,
                            };
                            self.call_stack.push(frame);
                            
                            self.blocks = inner_blocks.clone();
                            self.block_index = 0;
                            self.iteration_count = u32::MAX;
                            return ExecuteResult::JumpedToBlock;
                        }
                    }
                }
                ExecuteResult::Continue
            }
            
            "_if" => {
                let condition = self.get_param_bool(block, 0, variables);
                if condition {
                    if let Some(statements) = &block.statements {
                        if let Some(inner_blocks) = statements.first() {
                            if !inner_blocks.is_empty() {
                                let frame = StackFrame {
                                    blocks: self.blocks.clone(),
                                    block_index: self.block_index,
                                    iteration_count: 0,
                                    is_loop: false,
                                };
                                self.call_stack.push(frame);
                                
                                self.blocks = inner_blocks.clone();
                                self.block_index = 0;
                                return ExecuteResult::JumpedToBlock;
                            }
                        }
                    }
                }
                ExecuteResult::Continue
            }
            
            "if_else" => {
                let condition = self.get_param_bool(block, 0, variables);
                if let Some(statements) = &block.statements {
                    let branch_idx = if condition { 0 } else { 1 };
                    if let Some(inner_blocks) = statements.get(branch_idx) {
                        if !inner_blocks.is_empty() {
                            let frame = StackFrame {
                                blocks: self.blocks.clone(),
                                block_index: self.block_index,
                                iteration_count: 0,
                                is_loop: false,
                            };
                            self.call_stack.push(frame);
                            
                            self.blocks = inner_blocks.clone();
                            self.block_index = 0;
                            return ExecuteResult::JumpedToBlock;
                        }
                    }
                }
                ExecuteResult::Continue
            }
            
            "stop_repeat" => ExecuteResult::Break,
            
            "continue_repeat" => {
                // Continue to next iteration of loop - pop back to loop start
                while let Some(frame) = self.call_stack.pop() {
                    if frame.is_loop {
                        // Found the loop, restore and continue iteration
                        self.blocks = frame.blocks;
                        self.block_index = frame.block_index;
                        if frame.iteration_count > 0 {
                            self.iteration_count = frame.iteration_count;
                        }
                        return ExecuteResult::Continue;
                    }
                }
                // No loop found, just continue
                ExecuteResult::Continue
            }
            
            "repeat_while_true" => {
                // Get the condition and option (until/while)
                let condition = self.get_param_bool(block, 0, variables);
                let option = self.get_param_string(block, 1);
                
                // If option is "until", invert the condition
                let should_loop = if option == "until" { !condition } else { condition };
                
                if should_loop {
                    if let Some(statements) = &block.statements {
                        if let Some(inner_blocks) = statements.first() {
                            if !inner_blocks.is_empty() {
                                let frame = StackFrame {
                                    blocks: self.blocks.clone(),
                                    block_index: self.block_index,
                                    iteration_count: u32::MAX, // Infinite until condition changes
                                    is_loop: true,
                                };
                                self.call_stack.push(frame);
                                
                                self.blocks = inner_blocks.clone();
                                self.block_index = 0;
                                self.iteration_count = 0;
                                return ExecuteResult::JumpedToBlock;
                            }
                        }
                    }
                }
                ExecuteResult::Continue
            }
            
            "wait_until_true" => {
                let condition = self.get_param_bool(block, 0, variables);
                if condition {
                    ExecuteResult::Continue
                } else {
                    // Stay on this block and wait
                    ExecuteResult::Wait
                }
            }
            
            "stop_object" => {
                // Stop execution
                ExecuteResult::End
            }

            // === Variable blocks ===
            "set_variable" => {
                let var_id = self.get_param_string(block, 0);
                let value = self.get_param_value(block, 1, variables);
                variables.insert(var_id, value);
                ExecuteResult::Continue
            }
            
            "change_variable" => {
                let var_id = self.get_param_string(block, 0);
                let delta = self.get_param_number(block, 1, variables);
                if let Some(var) = variables.get_mut(&var_id) {
                    let current = var.as_number();
                    *var = Value::Number(current + delta);
                }
                ExecuteResult::Continue
            }

            // === Calculation blocks (return values) ===
            "calc_basic" => {
                // This is handled in get_param_number for nested blocks
                ExecuteResult::Continue
            }

            // Default: unknown block, just continue
            _ => {
                // Log unknown block type in debug builds
                #[cfg(debug_assertions)]
                web_sys::console::log_1(&format!("Unknown block type: {}", block_type).into());
                ExecuteResult::Continue
            }
        }
    }

    // Parameter extraction helpers
    fn get_param_number(&self, block: &Block, index: usize, variables: &HashMap<String, Value>) -> f64 {
        if let Some(params) = &block.params {
            if let Some(param) = params.get(index) {
                return self.evaluate_value(param, variables).as_number();
            }
        }
        0.0
    }

    fn get_param_string(&self, block: &Block, index: usize) -> String {
        if let Some(params) = &block.params {
            if let Some(param) = params.get(index) {
                if let Some(s) = param.as_str() {
                    return s.to_string();
                }
            }
        }
        String::new()
    }

    fn get_param_bool(&self, block: &Block, index: usize, variables: &HashMap<String, Value>) -> bool {
        if let Some(params) = &block.params {
            if let Some(param) = params.get(index) {
                return self.evaluate_value(param, variables).as_bool();
            }
        }
        false
    }

    fn get_param_value(&self, block: &Block, index: usize, variables: &HashMap<String, Value>) -> Value {
        if let Some(params) = &block.params {
            if let Some(param) = params.get(index) {
                return self.evaluate_value(param, variables);
            }
        }
        Value::Null
    }

    fn evaluate_value(&self, json: &serde_json::Value, variables: &HashMap<String, Value>) -> Value {
        match json {
            serde_json::Value::Number(n) => Value::Number(n.as_f64().unwrap_or(0.0)),
            serde_json::Value::String(s) => Value::String(s.clone()),
            serde_json::Value::Bool(b) => Value::Bool(*b),
            serde_json::Value::Object(obj) => {
                // This is a nested block
                if let Some(block_type) = obj.get("type").and_then(|v| v.as_str()) {
                    return self.evaluate_block(block_type, obj, variables);
                }
                Value::Null
            }
            serde_json::Value::Array(arr) => {
                Value::List(arr.iter().map(|v| self.evaluate_value(v, variables)).collect())
            }
            _ => Value::Null,
        }
    }

    fn evaluate_block(&self, block_type: &str, obj: &serde_json::Map<String, serde_json::Value>, variables: &HashMap<String, Value>) -> Value {
        match block_type {
            "number" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    if let Some(val) = params.first() {
                        if let Some(s) = val.as_str() {
                            return Value::Number(s.parse().unwrap_or(0.0));
                        }
                        if let Some(n) = val.as_f64() {
                            return Value::Number(n);
                        }
                    }
                }
                Value::Number(0.0)
            }
            
            "text" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    if let Some(val) = params.first() {
                        if let Some(s) = val.as_str() {
                            return Value::String(s.to_string());
                        }
                    }
                }
                Value::String(String::new())
            }
            
            "True" => Value::Bool(true),
            "False" => Value::Bool(false),
            
            "get_variable" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    if let Some(var_id) = params.first().and_then(|v| v.as_str()) {
                        if let Some(val) = variables.get(var_id) {
                            return val.clone();
                        }
                    }
                }
                Value::Number(0.0)
            }
            
            "calc_basic" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let left = params.get(0).map(|v| self.evaluate_value(v, variables).as_number()).unwrap_or(0.0);
                    let op = params.get(1).and_then(|v| v.as_str()).unwrap_or("+");
                    let right = params.get(2).map(|v| self.evaluate_value(v, variables).as_number()).unwrap_or(0.0);
                    
                    let result = match op {
                        "PLUS" | "+" => left + right,
                        "MINUS" | "-" => left - right,
                        "MULTI" | "*" => left * right,
                        "DIVIDE" | "/" => if right != 0.0 { left / right } else { 0.0 },
                        _ => 0.0,
                    };
                    return Value::Number(result);
                }
                Value::Number(0.0)
            }
            
            "calc_rand" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let min = params.get(0).map(|v| self.evaluate_value(v, variables).as_number()).unwrap_or(0.0);
                    let max = params.get(1).map(|v| self.evaluate_value(v, variables).as_number()).unwrap_or(10.0);
                    
                    // Simple pseudo-random (not cryptographically secure)
                    let random = js_sys::Math::random();
                    let result = min + random * (max - min);
                    return Value::Number(result);
                }
                Value::Number(0.0)
            }
            
            "boolean_basic_operator" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let left = params.get(0).map(|v| self.evaluate_value(v, variables).as_number()).unwrap_or(0.0);
                    let op = params.get(1).and_then(|v| v.as_str()).unwrap_or("EQUAL");
                    let right = params.get(2).map(|v| self.evaluate_value(v, variables).as_number()).unwrap_or(0.0);
                    
                    let result = match op {
                        "EQUAL" | "==" => (left - right).abs() < f64::EPSILON,
                        "NOT_EQUAL" | "!=" => (left - right).abs() >= f64::EPSILON,
                        "GREATER" | ">" => left > right,
                        "GREATER_OR_EQUAL" | ">=" => left >= right,
                        "LESS" | "<" => left < right,
                        "LESS_OR_EQUAL" | "<=" => left <= right,
                        _ => false,
                    };
                    return Value::Bool(result);
                }
                Value::Bool(false)
            }
            
            "boolean_and_or" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let left = params.get(0).map(|v| self.evaluate_value(v, variables).as_bool()).unwrap_or(false);
                    let op = params.get(1).and_then(|v| v.as_str()).unwrap_or("AND");
                    let right = params.get(2).map(|v| self.evaluate_value(v, variables).as_bool()).unwrap_or(false);
                    
                    let result = match op {
                        "AND" => left && right,
                        "OR" => left || right,
                        _ => false,
                    };
                    return Value::Bool(result);
                }
                Value::Bool(false)
            }
            
            "boolean_not" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let val = params.get(0).map(|v| self.evaluate_value(v, variables).as_bool()).unwrap_or(false);
                    return Value::Bool(!val);
                }
                Value::Bool(true)
            }
            
            // Entity property blocks
            "get_x" => Value::Number(self.cached_entity_x),
            "get_y" => Value::Number(self.cached_entity_y),
            "get_rotation" => Value::Number(self.cached_entity_rotation),
            "get_direction" => Value::Number(self.cached_entity_direction),
            "get_scale" => Value::Number(self.cached_entity_scale),
            
            // Coordinate blocks
            "coordinate_mouse" => {
                // Return 0 for mouse coordinates since we don't have mouse in WASM
                // In a real implementation, this would get from JavaScript
                Value::Number(0.0)
            }
            
            "coordinate_object" => {
                // Get coordinate of another object - for now return cached values
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let coord = params.get(3).and_then(|v| v.as_str()).unwrap_or("x");
                    match coord {
                        "x" => return Value::Number(self.cached_entity_x),
                        "y" => return Value::Number(self.cached_entity_y),
                        "rotation" => return Value::Number(self.cached_entity_rotation),
                        "direction" => return Value::Number(self.cached_entity_direction),
                        "size" => return Value::Number(self.cached_entity_scale),
                        _ => return Value::Number(0.0),
                    }
                }
                Value::Number(0.0)
            }
            
            // Math operations
            "calc_operation" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let value = params.get(1).map(|v| self.evaluate_value(v, variables).as_number()).unwrap_or(0.0);
                    let op = params.get(3).and_then(|v| v.as_str()).unwrap_or("round");
                    
                    let result = match op {
                        "square" => value * value,
                        "root" | "sqrt" => value.sqrt(),
                        "sin" => (value.to_radians()).sin(),
                        "cos" => (value.to_radians()).cos(),
                        "tan" => (value.to_radians()).tan(),
                        "asin" | "asin_radian" => value.asin().to_degrees(),
                        "acos" | "acos_radian" => value.acos().to_degrees(),
                        "atan" | "atan_radian" => value.atan().to_degrees(),
                        "log" => value.log10(),
                        "ln" => value.ln(),
                        "floor" => value.floor(),
                        "ceil" => value.ceil(),
                        "round" => value.round(),
                        "abs" => value.abs(),
                        "factorial" => {
                            let n = value as u64;
                            let mut result = 1u64;
                            for i in 2..=n {
                                result = result.saturating_mul(i);
                            }
                            result as f64
                        }
                        "unnatural" => value - value.floor(), // Decimal part
                        _ => value.round(),
                    };
                    return Value::Number(result);
                }
                Value::Number(0.0)
            }
            
            // String operations
            "length_of_string" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let val = params.get(1).map(|v| self.evaluate_value(v, variables)).unwrap_or(Value::Null);
                    let s = Self::value_as_string(&val);
                    return Value::Number(s.len() as f64);
                }
                Value::Number(0.0)
            }
            
            "char_at" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let val = params.get(1).map(|v| self.evaluate_value(v, variables)).unwrap_or(Value::Null);
                    let s = Self::value_as_string(&val);
                    let idx = params.get(3).map(|v| self.evaluate_value(v, variables).as_number()).unwrap_or(1.0) as usize;
                    if idx > 0 && idx <= s.len() {
                        return Value::String(s.chars().nth(idx - 1).map(|c| c.to_string()).unwrap_or_default());
                    }
                }
                Value::String(String::new())
            }
            
            "combine_something" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let val1 = params.get(1).map(|v| self.evaluate_value(v, variables)).unwrap_or(Value::Null);
                    let val2 = params.get(3).map(|v| self.evaluate_value(v, variables)).unwrap_or(Value::Null);
                    let s1 = Self::value_as_string(&val1);
                    let s2 = Self::value_as_string(&val2);
                    return Value::String(format!("{}{}", s1, s2));
                }
                Value::String(String::new())
            }
            
            _ => Value::Null
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_executor_creation() {
        let executor = Executor::new(0, vec![]);
        assert_eq!(executor.entity_idx, 0);
        assert_eq!(executor.block_index, 0);
        assert_eq!(executor.cached_entity_x, 0.0);
        assert_eq!(executor.cached_entity_direction, 90.0);
    }
}
