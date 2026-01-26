//! AOT Bytecode Compiler for Entry WASM Engine
//! 
//! Compiles Entry project blocks into the 32-bit fixed-width bytecode format.
//! This is a complete ahead-of-time compiler that converts the block-based
//! Entry language into efficient bytecode for the VM.
//!
//! ## Compilation Strategy
//! 
//! 1. **Variables**: Mapped to indices at compile time, stored in variable_map
//! 2. **Constants**: Deduplicated in the constant pool
//! 3. **Nested expressions**: Compiled bottom-up, results stored in registers
//! 4. **Control flow**: Uses jump instructions with computed offsets
//! 5. **Loops**: Use LOOP_START/LOOP_END with YIELD for cooperative multitasking
//! 6. **Functions**: Compiled separately, called with CALL instruction

use crate::blocks::{BlockTypeId, get_block_type_id};
use crate::{Block, ProjectData, Value};
use crate::bytecode::{
    Program, ScriptInfo, TriggerValue, RegisterAllocator, FunctionInfo,
    InstructionBuilder,
};
use std::collections::HashMap;

/// Loop context for break/continue handling
#[derive(Clone, Debug)]
struct LoopContext {
    /// PC of loop start (for continue)
    start_pc: usize,
    /// Placeholder addresses for break instructions that need patching
    break_placeholders: Vec<usize>,
    /// Counter register for counted loops (reserved for future optimization)
    #[allow(dead_code)]
    counter_reg: Option<u8>,
}

/// Compiler state for converting Entry blocks to bytecode
pub struct Compiler {
    /// The compiled program being built
    program: Program,
    /// Register allocator for the current script/function
    reg_alloc: RegisterAllocator,
    /// Stack of loop contexts for nested loop handling
    loop_stack: Vec<LoopContext>,
    /// Function definitions found during compilation
    function_defs: HashMap<String, FunctionDef>,
    /// Current entity index being compiled
    current_entity: usize,
}

/// Function definition extracted from blocks
#[derive(Clone, Debug)]
struct FunctionDef {
    /// Function ID
    id: String,
    /// Parameter types (stringParam_xxx, booleanParam_xxx)
    param_types: Vec<String>,
    /// Function body blocks
    body: Vec<Block>,
    /// Whether this function returns a value
    returns_value: bool,
    /// Return value expression (for value functions)
    return_expr: Option<serde_json::Value>,
}

impl Compiler {
    pub fn new() -> Self {
        Compiler {
            program: Program::default(),
            reg_alloc: RegisterAllocator::new(),
            loop_stack: Vec::new(),
            function_defs: HashMap::new(),
            current_entity: 0,
        }
    }

    /// Compile a complete project into bytecode
    pub fn compile(mut self, project: &ProjectData) -> Program {
        // Phase 1: Initialize variable map from project variables
        self.init_variables(project);
        
        // Phase 2: Extract function definitions from all objects
        self.extract_functions(project);
        
        // Phase 3: Compile function definitions FIRST
        // This must happen before scripts so that function calls have valid start_pc
        self.compile_functions();
        
        // Phase 4: Compile all scripts from all objects
        // Now function calls can look up FunctionInfo with correct start_pc
        self.compile_scripts(project);
        
        self.program
    }
    
    /// Initialize variables from project data
    fn init_variables(&mut self, project: &ProjectData) {
        if let Some(vars) = &project.variables {
            for var in vars.iter() {
                let is_list = var.variable_type.as_deref() == Some("list");
                let idx = self.program.variable_map.len();
                self.program.variable_map.insert(var.id.clone(), idx);
                self.program.string_pool.push(var.id.clone());
                
                if is_list {
                    self.program.list_variables.push(var.id.clone());
                }
            }
        }
    }
    
    /// Extract function definitions from project
    fn extract_functions(&mut self, project: &ProjectData) {
        if let Some(objects) = &project.objects {
            for obj in objects {
                if let Some(scripts) = &obj.script {
                    for thread in scripts {
                        if let Some(first_block) = thread.first() {
                            if first_block.block_type == "function_create" || 
                               first_block.block_type == "function_create_value" {
                                if let Some(func_def) = self.extract_function_def(first_block, thread) {
                                    self.function_defs.insert(func_def.id.clone(), func_def);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    /// Extract a function definition from a function_create block
    fn extract_function_def(&self, create_block: &Block, thread: &[Block]) -> Option<FunctionDef> {
        let params = create_block.params.as_ref()?;
        let first_param = params.first()?;
        let param_obj = first_param.as_object()?;
        let param_type = param_obj.get("type")?.as_str()?;
        
        if !param_type.starts_with("func_") || param_type.len() <= 5 {
            return None;
        }
        
        let func_id = param_type[5..].to_string();
        let returns_value = create_block.block_type == "function_create_value";
        
        // Extract parameter types from the definition chain
        let param_types = self.extract_param_types_from_chain(first_param);
        
        // Get function body from statements or remaining thread blocks
        let body = if let Some(stmts) = &create_block.statements {
            stmts.first().cloned().unwrap_or_default()
        } else if thread.len() > 1 {
            thread[1..].to_vec()
        } else {
            Vec::new()
        };
        
        // Get return expression for value functions
        let return_expr = if returns_value {
            params.get(3).cloned()
        } else {
            None
        };
        
        Some(FunctionDef {
            id: func_id,
            param_types,
            body,
            returns_value,
            return_expr,
        })
    }
    
    /// Extract parameter types from a function definition chain
    fn extract_param_types_from_chain(&self, json: &serde_json::Value) -> Vec<String> {
        let mut param_types = Vec::new();
        self.collect_param_types(json, &mut param_types);
        param_types
    }
    
    fn collect_param_types(&self, json: &serde_json::Value, param_types: &mut Vec<String>) {
        if let Some(obj) = json.as_object() {
            if let Some(block_type) = obj.get("type").and_then(|v| v.as_str()) {
                if block_type.starts_with("stringParam_") || block_type.starts_with("booleanParam_") {
                    param_types.push(block_type.to_string());
                }
            }
            if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                for param in params {
                    self.collect_param_types(param, param_types);
                }
            }
        }
    }
    
    /// Compile all scripts from project
    fn compile_scripts(&mut self, project: &ProjectData) {
        if let Some(objects) = &project.objects {
            for (obj_idx, obj) in objects.iter().enumerate() {
                self.current_entity = obj_idx;
                if let Some(scripts) = &obj.script {
                    for script in scripts {
                        self.compile_script(obj_idx, script);
                    }
                }
            }
        }
    }
    
    /// Compile function definitions
    fn compile_functions(&mut self) {
        let func_defs: Vec<_> = self.function_defs.values().cloned().collect();
        
        for func_def in func_defs {
            self.compile_function_def(&func_def);
        }
    }
    
    /// Compile a single function definition
    fn compile_function_def(&mut self, func_def: &FunctionDef) {
        let start_pc = self.program.current_pc();
        
        // Reset register allocator
        self.reg_alloc.reset();
        
        // Reserve registers for parameters
        let param_count = func_def.param_types.len() as u8;
        for _ in 0..param_count {
            self.reg_alloc.alloc();
        }
        
        // Compile function body
        for block in &func_def.body {
            self.compile_block(block);
        }
        
        // Handle return value for value functions
        if func_def.returns_value {
            if let Some(return_expr) = &func_def.return_expr {
                let result_reg = self.compile_value_to_reg(return_expr);
                // Move result to return register (r0)
                if result_reg != 0 {
                    self.program.emit(InstructionBuilder::mov(0, result_reg));
                }
            }
        }
        
        // Emit return instruction
        self.program.emit(InstructionBuilder::ret());
        
        // Register function info with param_types for parameter lookup
        self.program.functions.insert(func_def.id.clone(), FunctionInfo {
            id: func_def.id.clone(),
            start_pc,
            param_count,
            local_count: self.reg_alloc.current(),
            returns_value: func_def.returns_value,
            param_types: func_def.param_types.clone(),
        });
        
        // Also add reverse mapping for O(1) lookup by start_pc
        self.program.func_by_pc.insert(start_pc, func_def.id.clone());
    }

    /// Compile a single script (event handler + blocks)
    fn compile_script(&mut self, entity_idx: usize, script: &[Block]) {
        if script.is_empty() {
            return;
        }

        let first_block = &script[0];
        let type_id = get_block_type_id(&first_block.block_type);
        
        // Skip if not an event block (script must start with event)
        if crate::blocks::is_executable_block(&first_block.block_type) {
            return;
        }

        let start_pc = self.program.current_pc();
        
        // Extract trigger value if applicable
        let trigger_value = self.extract_trigger_value(first_block, type_id);
        
        self.program.scripts.push(ScriptInfo {
            entity_index: entity_idx,
            start_pc,
            trigger_type: type_id,
            trigger_value,
        });

        // Reset register allocator for each script
        self.reg_alloc.reset();
        self.loop_stack.clear();
        
        // Compile the body blocks (skip the event block)
        self.compile_statements(&script[1..]);
        
        // End the script
        self.program.emit(InstructionBuilder::end());
    }
    
    /// Extract trigger value from event block parameters
    fn extract_trigger_value(&self, block: &Block, type_id: BlockTypeId) -> Option<TriggerValue> {
        match type_id {
            BlockTypeId::WhenMessageCast => {
                if let Some(params) = &block.params {
                    if let Some(msg_val) = params.get(1).or_else(|| params.first()) {
                        if let Some(s) = msg_val.as_str() {
                            return Some(TriggerValue::MessageId(s.to_string()));
                        } else if let Some(n) = msg_val.as_f64() {
                            return Some(TriggerValue::MessageId(n.to_string()));
                        }
                    }
                }
                None
            }
            BlockTypeId::WhenSomeKeyPressed => {
                if let Some(params) = &block.params {
                    if let Some(key_val) = params.get(1) {
                        let key_code = key_val.as_str()
                            .and_then(|s| s.parse::<u32>().ok())
                            .or_else(|| key_val.as_f64().map(|n| n as u32))
                            .unwrap_or(0);
                        return Some(TriggerValue::KeyCode(key_code));
                    }
                }
                None
            }
            _ => None,
        }
    }
    
    /// Compile a list of statement blocks
    fn compile_statements(&mut self, blocks: &[Block]) {
        for block in blocks {
            self.compile_block(block);
        }
    }

    /// Compile a single block into bytecode
    fn compile_block(&mut self, block: &Block) {
        let type_id = get_block_type_id(&block.block_type);
        
        // Check for function calls first (func_xxx blocks)
        if block.block_type.starts_with("func_") {
            self.compile_function_call(block);
            return;
        }
        
        match type_id {
            // ================================================================
            // Variable Operations
            // ================================================================
            BlockTypeId::SetVariable => self.compile_set_variable(block),
            BlockTypeId::ChangeVariable => self.compile_change_variable(block),
            BlockTypeId::GetVariable => { self.compile_get_variable(block); }
            BlockTypeId::ShowVariable => self.compile_show_variable(block),
            BlockTypeId::HideVariable => self.compile_hide_variable(block),
            BlockTypeId::SetFuncVariable => self.compile_set_func_variable(block),
            
            // ================================================================
            // Control Flow
            // ================================================================
            BlockTypeId::RepeatBasic => self.compile_repeat_basic(block),
            BlockTypeId::RepeatInf => self.compile_repeat_inf(block),
            BlockTypeId::RepeatWhileTrue => self.compile_repeat_while(block),
            BlockTypeId::If => self.compile_if(block),
            BlockTypeId::IfElse => self.compile_if_else(block),
            BlockTypeId::WaitSecond => self.compile_wait(block),
            BlockTypeId::WaitUntilTrue => self.compile_wait_until(block),
            BlockTypeId::StopRepeat => self.compile_break(),
            BlockTypeId::ContinueRepeat => self.compile_continue(),
            BlockTypeId::StopObject => self.compile_stop_object(block),
            BlockTypeId::RestartProject => {
                self.program.emit(InstructionBuilder::restart());
            }
            
            // ================================================================
            // Movement Blocks
            // ================================================================
            BlockTypeId::MoveX => {
                let reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::add_x(reg));
            }
            BlockTypeId::MoveY => {
                let reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::add_y(reg));
            }
            BlockTypeId::LocateX => {
                let reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::set_x(reg));
            }
            BlockTypeId::LocateY => {
                let reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::set_y(reg));
            }
            BlockTypeId::LocateXy => {
                let x_reg = self.compile_param_to_reg(block, 0);
                let y_reg = self.compile_param_to_reg(block, 1);
                self.program.emit(InstructionBuilder::set_xy(x_reg, y_reg));
            }
            BlockTypeId::MoveDirection => {
                let reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::move_dir(reg));
            }
            BlockTypeId::RotateRelative => {
                let reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::add_rot(reg));
            }
            BlockTypeId::RotateAbsolute => {
                let reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::set_rot(reg));
            }
            BlockTypeId::DirectionRelative => {
                let reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::add_dir(reg));
            }
            BlockTypeId::DirectionAbsolute => {
                let reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::set_dir(reg));
            }
            BlockTypeId::BounceWall => {
                self.program.emit(InstructionBuilder::bounce_wall());
            }
            BlockTypeId::MoveToAngle => {
                // move_to_angle: params[0]=angle, params[1]=distance
                self.compile_exec_block(block, type_id);
            }
            BlockTypeId::MoveXyTime => {
                // Timed movement - needs special handling via EXEC
                self.compile_exec_block(block, type_id);
            }
            BlockTypeId::LocateXyTime => {
                self.compile_exec_block(block, type_id);
            }
            BlockTypeId::RotateByTime => {
                self.compile_exec_block(block, type_id);
            }
            BlockTypeId::DirectionRelativeDuration => {
                self.compile_exec_block(block, type_id);
            }
            BlockTypeId::Locate => {
                // locate to target (mouse, object)
                self.compile_exec_block(block, type_id);
            }
            BlockTypeId::SeeAngleObject => {
                self.compile_exec_block(block, type_id);
            }
            BlockTypeId::SeeAngleDirection => {
                let reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::set_dir(reg));
            }
            BlockTypeId::LocateObjectTime => {
                self.compile_exec_block(block, type_id);
            }
            
            // ================================================================
            // Appearance Blocks
            // ================================================================
            BlockTypeId::Show => {
                self.program.emit(InstructionBuilder::show());
            }
            BlockTypeId::Hide => {
                self.program.emit(InstructionBuilder::hide());
            }
            BlockTypeId::ChangeToNextShape => {
                self.program.emit(InstructionBuilder::next_shape());
            }
            BlockTypeId::ChangeToPreviousShape => {
                self.program.emit(InstructionBuilder::prev_shape());
            }
            BlockTypeId::ChangeToSomeShape => {
                let reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::set_shape(reg));
            }
            BlockTypeId::SetScaleSize => {
                let reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::set_scale(reg));
            }
            BlockTypeId::ChangeScaleSize => {
                let reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::add_scale(reg));
            }
            BlockTypeId::FlipX => {
                self.program.emit(InstructionBuilder::flip_x());
            }
            BlockTypeId::FlipY => {
                self.program.emit(InstructionBuilder::flip_y());
            }
            BlockTypeId::SetEffect => {
                let effect_reg = self.compile_param_to_reg(block, 0);
                let value_reg = self.compile_param_to_reg(block, 1);
                self.program.emit(InstructionBuilder::set_effect(effect_reg, value_reg));
            }
            BlockTypeId::ChangeEffect => {
                let effect_reg = self.compile_param_to_reg(block, 0);
                let value_reg = self.compile_param_to_reg(block, 1);
                self.program.emit(InstructionBuilder::change_effect(effect_reg, value_reg));
            }
            BlockTypeId::ClearEffect => {
                let effect_reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::clear_effect(effect_reg));
            }
            BlockTypeId::EraseAllEffects => {
                self.program.emit(InstructionBuilder::clear_all_effects());
            }
            BlockTypeId::AddEffectAmount | BlockTypeId::ChangeEffectAmount => {
                self.compile_exec_block(block, type_id);
            }
            BlockTypeId::ChangeObjectIndex => {
                let loc_reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::change_index(loc_reg));
            }
            BlockTypeId::StretchScaleSize | BlockTypeId::ResetScaleSize => {
                self.compile_exec_block(block, type_id);
            }
            
            // ================================================================
            // Dialog Blocks
            // ================================================================
            BlockTypeId::Dialog => {
                let msg_reg = self.compile_param_to_reg(block, 0);
                let mode_reg = self.compile_param_to_reg(block, 1);
                self.program.emit(InstructionBuilder::dialog(msg_reg, mode_reg));
            }
            BlockTypeId::DialogTime => {
                let msg_reg = self.compile_param_to_reg(block, 0);
                let time_reg = self.compile_param_to_reg(block, 1);
                let mode_reg = self.compile_param_to_reg(block, 2);
                self.program.emit(InstructionBuilder::dialog_time(msg_reg, mode_reg, time_reg));
            }
            BlockTypeId::RemoveDialog => {
                self.program.emit(InstructionBuilder::remove_dialog());
            }
            
            // ================================================================
            // Sound Blocks
            // ================================================================
            BlockTypeId::SoundSomething | BlockTypeId::SoundSomethingWithBlock => {
                let reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::play_sound(reg));
            }
            BlockTypeId::SoundSomethingWait | BlockTypeId::SoundSomethingWaitWithBlock => {
                let reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::play_sound_wait(reg));
            }
            BlockTypeId::SoundSomethingSecond | BlockTypeId::SoundSomethingSecondWithBlock => {
                self.compile_exec_block(block, type_id);
            }
            BlockTypeId::SoundSomethingSecondWaitWithBlock => {
                self.compile_exec_block(block, type_id);
            }
            BlockTypeId::SoundFromTo | BlockTypeId::SoundFromToAndWait => {
                self.compile_exec_block(block, type_id);
            }
            BlockTypeId::SoundStop => {
                self.program.emit(InstructionBuilder::stop_sound());
            }
            BlockTypeId::SoundSilentAll => {
                self.program.emit(InstructionBuilder::stop_sound());
            }
            BlockTypeId::SoundVolumeSet => {
                let reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::set_volume(reg));
            }
            BlockTypeId::SoundVolumeChange => {
                let reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::change_volume(reg));
            }
            BlockTypeId::SoundSpeedSet | BlockTypeId::SoundSpeedChange => {
                self.compile_exec_block(block, type_id);
            }
            BlockTypeId::PlayBgm => {
                let reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::play_bgm(reg));
            }
            BlockTypeId::StopBgm => {
                self.program.emit(InstructionBuilder::stop_sound());
            }
            
            // ================================================================
            // Clone Blocks
            // ================================================================
            BlockTypeId::CreateClone => {
                let reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::clone(reg));
            }
            BlockTypeId::DeleteClone => {
                self.program.emit(InstructionBuilder::delete_clone());
            }
            BlockTypeId::RemoveAllClones => {
                self.program.emit(InstructionBuilder::delete_all_clones());
            }
            
            // ================================================================
            // Message Blocks
            // ================================================================
            BlockTypeId::MessageCast => {
                let reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::send_msg(reg));
            }
            BlockTypeId::MessageCastWait => {
                let reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::send_msg_wait(reg));
            }
            
            // ================================================================
            // Scene Blocks
            // ================================================================
            BlockTypeId::StartScene => {
                let reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::start_scene(reg));
            }
            BlockTypeId::StartNeighborScene => {
                // Check direction parameter
                let dir = self.get_param_string(block, 0);
                if dir == "next" {
                    self.program.emit(InstructionBuilder::start_next_scene());
                } else {
                    self.program.emit(InstructionBuilder::start_prev_scene());
                }
            }
            
            // ================================================================
            // Brush/Pen Blocks
            // ================================================================
            BlockTypeId::BrushDown | BlockTypeId::StartDrawing => {
                self.program.emit(InstructionBuilder::brush_down());
            }
            BlockTypeId::BrushUp | BlockTypeId::StopDrawing => {
                self.program.emit(InstructionBuilder::brush_up());
            }
            BlockTypeId::BrushStamp => {
                self.program.emit(InstructionBuilder::stamp());
            }
            BlockTypeId::SetBrushColor | BlockTypeId::SetColor => {
                let reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::set_brush_color(reg));
            }
            BlockTypeId::SetBrushSize | BlockTypeId::SetThickness => {
                let reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::set_brush_size(reg));
            }
            BlockTypeId::ChangeBrushSize | BlockTypeId::ChangeThickness => {
                self.compile_exec_block(block, type_id);
            }
            BlockTypeId::BrushEraseAll | BlockTypeId::BrushClear => {
                self.program.emit(InstructionBuilder::brush_erase_all());
            }
            BlockTypeId::StartFill => {
                self.program.emit(InstructionBuilder::start_fill());
            }
            BlockTypeId::StopFill => {
                self.program.emit(InstructionBuilder::stop_fill());
            }
            BlockTypeId::SetFillColor => {
                self.compile_exec_block(block, type_id);
            }
            BlockTypeId::SetRandomColor => {
                self.compile_exec_block(block, type_id);
            }
            BlockTypeId::ChangeBrushTransparency | BlockTypeId::SetBrushTranparency => {
                self.compile_exec_block(block, type_id);
            }
            
            // ================================================================
            // Timer Blocks
            // ================================================================
            BlockTypeId::ChooseProjectTimerAction => {
                let action_reg = self.compile_param_to_reg(block, 1);
                self.program.emit(InstructionBuilder::timer_action(action_reg));
            }
            BlockTypeId::SetVisibleProjectTimer => {
                let visible_reg = self.compile_param_to_reg(block, 1);
                self.program.emit(InstructionBuilder::set_timer_visible(visible_reg));
            }
            
            // ================================================================
            // List Operations
            // ================================================================
            BlockTypeId::AddValueToList => self.compile_list_push(block),
            BlockTypeId::RemoveValueFromList => self.compile_list_remove(block),
            BlockTypeId::InsertValueToList => self.compile_list_insert(block),
            BlockTypeId::ChangeValueListIndex => self.compile_list_set(block),
            BlockTypeId::ShowList => {
                let list_reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::exec(BlockTypeId::ShowList as u16));
                // Store list_reg for runtime use
                self.program.emit(InstructionBuilder::mov(0, list_reg));
            }
            BlockTypeId::HideList => {
                let list_reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::exec(BlockTypeId::HideList as u16));
                self.program.emit(InstructionBuilder::mov(0, list_reg));
            }
            
            // ================================================================
            // Input Blocks
            // ================================================================
            BlockTypeId::AskAndWait => {
                let msg_reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::ask(msg_reg));
            }
            BlockTypeId::SetVisibleAnswer => {
                self.compile_exec_block(block, type_id);
            }
            
            // ================================================================
            // Text Object Blocks
            // ================================================================
            BlockTypeId::TextWrite => {
                let text_reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::text_set(text_reg));
            }
            BlockTypeId::TextAppend => {
                let text_reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::text_append(text_reg));
            }
            BlockTypeId::TextPrepend => {
                let text_reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::text_prepend(text_reg));
            }
            BlockTypeId::TextFlush => {
                self.program.emit(InstructionBuilder::text_clear());
            }
            BlockTypeId::TextChangeFont => {
                let font_reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::text_font(font_reg));
            }
            BlockTypeId::TextChangeFontColor => {
                let color_reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::text_color(color_reg));
            }
            BlockTypeId::TextChangeBgColor => {
                let bg_reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::text_bg(bg_reg));
            }
            BlockTypeId::TextChangeEffect => {
                self.compile_exec_block(block, type_id);
            }
            
            // ================================================================
            // Function Definition Blocks (pass through)
            // ================================================================
            BlockTypeId::FunctionCreate | BlockTypeId::FunctionCreateValue => {
                // Function definitions are handled separately
            }
            BlockTypeId::FunctionFieldLabel | BlockTypeId::FunctionFieldString | 
            BlockTypeId::FunctionFieldBoolean => {
                // Parameter definition blocks - no code generated
            }
            
            // ================================================================
            // Event Blocks (pass through when not at script start)
            // ================================================================
            BlockTypeId::WhenRunButtonClick | BlockTypeId::WhenSomeKeyPressed |
            BlockTypeId::WhenObjectClick | BlockTypeId::WhenObjectClickCanceled |
            BlockTypeId::WhenCloneStart | BlockTypeId::WhenMessageCast |
            BlockTypeId::WhenSceneStart | BlockTypeId::MouseClicked |
            BlockTypeId::MouseClickCancled => {
                // Event blocks generate no code - they are handled at script level
            }
            
            // ================================================================
            // Value Blocks (should not appear as statements, but handle gracefully)
            // ================================================================
            BlockTypeId::CalcBasic | BlockTypeId::CalcRand | BlockTypeId::CalcOperation |
            BlockTypeId::QuotientAndMod | BlockTypeId::GetDate | BlockTypeId::DistanceSomething |
            BlockTypeId::GetProjectTimerValue | BlockTypeId::CoordinateMouse |
            BlockTypeId::CoordinateObject | BlockTypeId::GetSoundVolume |
            BlockTypeId::LengthOfString | BlockTypeId::ReverseOfString |
            BlockTypeId::CombineSomething | BlockTypeId::CharAt | BlockTypeId::Substring |
            BlockTypeId::CountMatchString | BlockTypeId::IndexOfString |
            BlockTypeId::ReplaceString | BlockTypeId::ChangeStringCase |
            BlockTypeId::TextRead => {
                // Value blocks as statements - evaluate and discard
            }
            
            // ================================================================
            // Unknown/Default - use EXEC fallback
            // ================================================================
            _ => {
                self.compile_exec_block(block, type_id);
            }
        }
    }
    
    // ========================================================================
    // Variable Compilation
    // ========================================================================
    
    /// Compile set_variable block
    fn compile_set_variable(&mut self, block: &Block) {
        if let Some(params) = &block.params {
            if let Some(id_val) = params.first() {
                if let Some(id) = id_val.as_str() {
                    let value_reg = self.compile_param_to_reg(block, 1);
                    let var_idx = self.program.get_or_create_variable(id);
                    self.program.emit(InstructionBuilder::store_var(var_idx, value_reg));
                    return;
                }
            }
        }
        self.compile_exec_block(block, BlockTypeId::SetVariable);
    }
    
    /// Compile change_variable block
    fn compile_change_variable(&mut self, block: &Block) {
        if let Some(params) = &block.params {
            if let Some(id_val) = params.first() {
                if let Some(id) = id_val.as_str() {
                    let var_idx = self.program.get_or_create_variable(id);
                    
                    // Load current value
                    let current_reg = self.reg_alloc.alloc();
                    self.program.emit(InstructionBuilder::load_var(current_reg, var_idx));
                    
                    // Compile delta value
                    let delta_reg = self.compile_param_to_reg(block, 1);
                    
                    // Add them
                    let result_reg = self.reg_alloc.alloc();
                    self.program.emit(InstructionBuilder::add(result_reg, current_reg, delta_reg));
                    
                    // Store back
                    self.program.emit(InstructionBuilder::store_var(var_idx, result_reg));
                    return;
                }
            }
        }
        self.compile_exec_block(block, BlockTypeId::ChangeVariable);
    }
    
    /// Compile get_variable block (value block)
    fn compile_get_variable(&mut self, block: &Block) -> u8 {
        if let Some(params) = &block.params {
            if let Some(id_val) = params.first() {
                if let Some(id) = id_val.as_str() {
                    let var_idx = self.program.get_or_create_variable(id);
                    let dst = self.reg_alloc.alloc();
                    self.program.emit(InstructionBuilder::load_var(dst, var_idx));
                    return dst;
                }
            }
        }
        let dst = self.reg_alloc.alloc();
        self.program.emit(InstructionBuilder::load_nil(dst));
        dst
    }
    
    fn compile_show_variable(&mut self, block: &Block) {
        self.compile_exec_block(block, BlockTypeId::ShowVariable);
    }
    
    fn compile_hide_variable(&mut self, block: &Block) {
        self.compile_exec_block(block, BlockTypeId::HideVariable);
    }
    
    fn compile_set_func_variable(&mut self, block: &Block) {
        // Local variables are handled via LOAD_LOCAL/STORE_LOCAL
        if let Some(params) = &block.params {
            if let Some(id_val) = params.first() {
                if let Some(id) = id_val.as_str() {
                    let value_reg = self.compile_param_to_reg(block, 1);
                    let local_idx = self.program.add_string(id.to_string());
                    self.program.emit(InstructionBuilder::store_local(local_idx, value_reg));
                    return;
                }
            }
        }
        self.compile_exec_block(block, BlockTypeId::SetFuncVariable);
    }
    
    // ========================================================================
    // Control Flow Compilation
    // ========================================================================
    
    /// Compile repeat_basic block
    fn compile_repeat_basic(&mut self, block: &Block) {
        // Compile count expression
        let count_reg = self.compile_param_to_reg(block, 0);
        
        // Allocate counter register
        let counter_reg = self.reg_alloc.alloc();
        
        // Initialize counter with LOOP_START
        self.program.emit(InstructionBuilder::loop_start(counter_reg, count_reg));
        
        let loop_start = self.program.current_pc();
        
        // Push loop context
        self.loop_stack.push(LoopContext {
            start_pc: loop_start,
            break_placeholders: Vec::new(),
            counter_reg: Some(counter_reg),
        });
        
        // Compile body
        if let Some(stmts) = &block.statements {
            if let Some(body) = stmts.first() {
                self.compile_statements(body);
            }
        }
        
        // Yield after each iteration for cooperative multitasking
        self.program.emit(InstructionBuilder::yield_());
        
        // Loop end - jumps back if counter > 0
        let loop_end_pc = self.program.current_pc();
        let offset = (loop_start as i32) - (loop_end_pc as i32);
        self.program.emit(InstructionBuilder::loop_end(counter_reg, offset as i16));
        
        // Patch break placeholders
        let loop_ctx = self.loop_stack.pop().unwrap();
        let after_loop = self.program.current_pc();
        for break_addr in loop_ctx.break_placeholders {
            self.program.patch_jump(break_addr, after_loop);
        }
    }
    
    /// Compile repeat_inf (infinite loop)
    fn compile_repeat_inf(&mut self, block: &Block) {
        let loop_start = self.program.current_pc();
        
        // Push loop context
        self.loop_stack.push(LoopContext {
            start_pc: loop_start,
            break_placeholders: Vec::new(),
            counter_reg: None,
        });
        
        // Compile body
        if let Some(stmts) = &block.statements {
            if let Some(body) = stmts.first() {
                self.compile_statements(body);
            }
        }
        
        // Yield for cooperative multitasking
        self.program.emit(InstructionBuilder::yield_());
        
        // Jump back to start
        let current_pc = self.program.current_pc();
        let offset = (loop_start as i32) - (current_pc as i32);
        self.program.emit(InstructionBuilder::jmp(offset));
        
        // Patch break placeholders
        let loop_ctx = self.loop_stack.pop().unwrap();
        let after_loop = self.program.current_pc();
        for break_addr in loop_ctx.break_placeholders {
            self.program.patch_jump(break_addr, after_loop);
        }
    }
    
    /// Compile repeat_while_true block
    fn compile_repeat_while(&mut self, block: &Block) {
        let loop_start = self.program.current_pc();
        
        // Compile condition
        let cond_reg = self.compile_param_to_reg(block, 0);
        
        // Get option (while/until)
        let option = self.get_param_string(block, 1);
        
        // Jump to end if condition fails
        // For "until": jump if condition is TRUE (loop while false)
        // For "while": jump if condition is FALSE (loop while true)
        let jz_addr = if option == "until" {
            self.program.emit(InstructionBuilder::jnz(cond_reg, 0))
        } else {
            self.program.emit(InstructionBuilder::jz(cond_reg, 0))
        };
        
        // Push loop context
        self.loop_stack.push(LoopContext {
            start_pc: loop_start,
            break_placeholders: Vec::new(),
            counter_reg: None,
        });
        
        // Compile body
        if let Some(stmts) = &block.statements {
            if let Some(body) = stmts.first() {
                self.compile_statements(body);
            }
        }
        
        // Yield
        self.program.emit(InstructionBuilder::yield_());
        
        // Jump back to condition check
        let current_pc = self.program.current_pc();
        let back_offset = (loop_start as i32) - (current_pc as i32);
        self.program.emit(InstructionBuilder::jmp(back_offset));
        
        // Patch the conditional jump
        self.program.patch_jump(jz_addr, self.program.current_pc());
        
        // Patch break placeholders
        let loop_ctx = self.loop_stack.pop().unwrap();
        let after_loop = self.program.current_pc();
        for break_addr in loop_ctx.break_placeholders {
            self.program.patch_jump(break_addr, after_loop);
        }
    }
    
    /// Compile if block
    fn compile_if(&mut self, block: &Block) {
        // Compile condition
        let cond_reg = self.compile_param_to_reg(block, 0);
        
        // Jump if false (placeholder)
        let jz_addr = self.program.emit(InstructionBuilder::jz(cond_reg, 0));
        
        // Compile body
        if let Some(stmts) = &block.statements {
            if let Some(body) = stmts.first() {
                self.compile_statements(body);
            }
        }
        
        // Patch jump
        self.program.patch_jump(jz_addr, self.program.current_pc());
    }
    
    /// Compile if_else block
    fn compile_if_else(&mut self, block: &Block) {
        // Compile condition
        let cond_reg = self.compile_param_to_reg(block, 0);
        
        // Jump to else if false
        let jz_addr = self.program.emit(InstructionBuilder::jz(cond_reg, 0));
        
        // Compile then body
        if let Some(stmts) = &block.statements {
            if let Some(then_body) = stmts.first() {
                self.compile_statements(then_body);
            }
        }
        
        // Jump over else
        let jmp_addr = self.program.emit(InstructionBuilder::jmp(0));
        
        // Patch jump to else
        self.program.patch_jump(jz_addr, self.program.current_pc());
        
        // Compile else body
        if let Some(stmts) = &block.statements {
            if let Some(else_body) = stmts.get(1) {
                self.compile_statements(else_body);
            }
        }
        
        // Patch jump over else
        self.program.patch_jump(jmp_addr, self.program.current_pc());
    }
    
    /// Compile wait_second block
    fn compile_wait(&mut self, block: &Block) {
        let time_reg = self.compile_param_to_reg(block, 0);
        self.program.emit(InstructionBuilder::wait(time_reg));
    }
    
    /// Compile wait_until_true block
    fn compile_wait_until(&mut self, block: &Block) {
        let cond_reg = self.compile_param_to_reg(block, 0);
        self.program.emit(InstructionBuilder::wait_until(cond_reg));
    }
    
    /// Compile break (stop_repeat)
    fn compile_break(&mut self) {
        if let Some(loop_ctx) = self.loop_stack.last_mut() {
            let break_addr = self.program.emit(InstructionBuilder::jmp(0));
            loop_ctx.break_placeholders.push(break_addr);
        } else {
            // No loop context - emit BREAK instruction for runtime handling
            self.program.emit(InstructionBuilder::break_());
        }
    }
    
    /// Compile continue (continue_repeat)
    fn compile_continue(&mut self) {
        if let Some(loop_ctx) = self.loop_stack.last() {
            let current_pc = self.program.current_pc();
            let offset = (loop_ctx.start_pc as i32) - (current_pc as i32);
            self.program.emit(InstructionBuilder::jmp(offset));
        } else {
            // No loop context - emit CONTINUE instruction for runtime handling
            self.program.emit(InstructionBuilder::continue_());
        }
    }
    
    /// Compile stop_object block
    fn compile_stop_object(&mut self, block: &Block) {
        let target = self.get_param_string(block, 0);
        match target.as_str() {
            "all" => self.program.emit(InstructionBuilder::stop_all()),
            "thisOnly" | "thisObject" => self.program.emit(InstructionBuilder::stop_this()),
            "thisThread" => self.program.emit(InstructionBuilder::stop_this()),
            "otherThread" => self.program.emit(InstructionBuilder::stop_other()),
            _ => self.program.emit(InstructionBuilder::stop_this()),
        };
    }
    
    // ========================================================================
    // Function Call Compilation
    // ========================================================================
    
    /// Compile a function call block
    fn compile_function_call(&mut self, block: &Block) {
        let func_id = &block.block_type[5..]; // Skip "func_" prefix
        
        // Look up function info
        if let Some(func_info) = self.program.functions.get(func_id).cloned() {
            // Compile arguments to registers
            if let Some(params) = &block.params {
                for (i, param) in params.iter().enumerate() {
                    if i >= func_info.param_count as usize {
                        break;
                    }
                    let arg_reg = self.compile_value_to_reg(param);
                    // Arguments go in registers starting at r0
                    if arg_reg != i as u8 {
                        self.program.emit(InstructionBuilder::mov(i as u8, arg_reg));
                    }
                }
            }
            
            // Emit CALL instruction
            self.program.emit(InstructionBuilder::call(func_info.start_pc as u32));
        } else {
            // Function not found - use EXEC fallback
            let func_str_idx = self.program.add_string(block.block_type.clone());
            self.program.emit(InstructionBuilder::exec(func_str_idx));
        }
    }
    
    // ========================================================================
    // List Operations Compilation
    // ========================================================================
    
    /// Compile list push operation
    fn compile_list_push(&mut self, block: &Block) {
        if let Some(params) = &block.params {
            if let Some(list_id) = params.get(1).and_then(|v| v.as_str()) {
                let var_idx = self.program.get_or_create_variable(list_id);
                let list_reg = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::load_var(list_reg, var_idx));
                
                let value_reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::list_push(list_reg, value_reg));
                return;
            }
        }
        self.compile_exec_block(block, BlockTypeId::AddValueToList);
    }
    
    /// Compile list remove operation
    fn compile_list_remove(&mut self, block: &Block) {
        if let Some(params) = &block.params {
            if let Some(list_id) = params.get(1).and_then(|v| v.as_str()) {
                let var_idx = self.program.get_or_create_variable(list_id);
                let list_reg = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::load_var(list_reg, var_idx));
                
                let idx_reg = self.compile_param_to_reg(block, 0);
                self.program.emit(InstructionBuilder::list_del(list_reg, idx_reg));
                return;
            }
        }
        self.compile_exec_block(block, BlockTypeId::RemoveValueFromList);
    }
    
    /// Compile list insert operation
    fn compile_list_insert(&mut self, block: &Block) {
        if let Some(params) = &block.params {
            if let Some(list_id) = params.get(1).and_then(|v| v.as_str()) {
                let var_idx = self.program.get_or_create_variable(list_id);
                let list_reg = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::load_var(list_reg, var_idx));
                
                let value_reg = self.compile_param_to_reg(block, 0);
                let idx_reg = self.compile_param_to_reg(block, 2);
                self.program.emit(InstructionBuilder::list_insert(list_reg, idx_reg, value_reg));
                return;
            }
        }
        self.compile_exec_block(block, BlockTypeId::InsertValueToList);
    }
    
    /// Compile list set operation
    fn compile_list_set(&mut self, block: &Block) {
        if let Some(params) = &block.params {
            if let Some(list_id) = params.first().and_then(|v| v.as_str()) {
                let var_idx = self.program.get_or_create_variable(list_id);
                let list_reg = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::load_var(list_reg, var_idx));
                
                let idx_reg = self.compile_param_to_reg(block, 1);
                let value_reg = self.compile_param_to_reg(block, 2);
                self.program.emit(InstructionBuilder::list_set(list_reg, idx_reg, value_reg));
                return;
            }
        }
        self.compile_exec_block(block, BlockTypeId::ChangeValueListIndex);
    }
    
    // ========================================================================
    // EXEC Fallback Compilation
    // ========================================================================
    
    /// Compile a block using the EXEC fallback mechanism
    fn compile_exec_block(&mut self, block: &Block, type_id: BlockTypeId) {
        // Store block parameters in registers for runtime interpretation
        if let Some(params) = &block.params {
            for (i, param) in params.iter().enumerate().take(8) {
                let reg = self.compile_value_to_reg(param);
                if reg != i as u8 {
                    self.program.emit(InstructionBuilder::mov(i as u8, reg));
                }
            }
        }
        
        self.program.emit(InstructionBuilder::exec(type_id as u16));
    }
    
    // ========================================================================
    // Parameter and Value Compilation
    // ========================================================================
    
    /// Get string value from parameter (for compile-time known strings)
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
    
    /// Compile a parameter and return the register containing the result
    fn compile_param_to_reg(&mut self, block: &Block, index: usize) -> u8 {
        if let Some(params) = &block.params {
            if let Some(param) = params.get(index) {
                return self.compile_value_to_reg(param);
            }
        }
        
        // Return nil if parameter not found
        let dst = self.reg_alloc.alloc();
        self.program.emit(InstructionBuilder::load_nil(dst));
        dst
    }
    
    /// Compile a JSON value and return the register containing the result
    fn compile_value_to_reg(&mut self, json: &serde_json::Value) -> u8 {
        match json {
            serde_json::Value::Number(n) => {
                let val = n.as_f64().unwrap_or(0.0);
                let dst = self.reg_alloc.alloc();
                
                // Try to use immediate for small integers
                if val.fract() == 0.0 && val >= i16::MIN as f64 && val <= i16::MAX as f64 {
                    self.program.emit(InstructionBuilder::load_imm(dst, val as i16));
                } else {
                    let const_idx = self.program.add_constant(Value::Number(val));
                    self.program.emit(InstructionBuilder::load_const(dst, const_idx));
                }
                dst
            }
            serde_json::Value::String(s) => {
                let dst = self.reg_alloc.alloc();
                let str_idx = self.program.add_string(s.clone());
                self.program.emit(InstructionBuilder::load_str(dst, str_idx));
                dst
            }
            serde_json::Value::Bool(b) => {
                let dst = self.reg_alloc.alloc();
                if *b {
                    self.program.emit(InstructionBuilder::load_true(dst));
                } else {
                    self.program.emit(InstructionBuilder::load_false(dst));
                }
                dst
            }
            serde_json::Value::Object(obj) => {
                // This is a nested block - compile it as an expression
                self.compile_nested_block(obj)
            }
            serde_json::Value::Null => {
                let dst = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::load_nil(dst));
                dst
            }
            serde_json::Value::Array(arr) => {
                // Arrays as parameters - create list
                let dst = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::list_new(dst));
                
                for item in arr {
                    let item_reg = self.compile_value_to_reg(item);
                    self.program.emit(InstructionBuilder::list_push(dst, item_reg));
                }
                dst
            }
        }
    }
    
    /// Compile a nested block (expression block)
    fn compile_nested_block(&mut self, obj: &serde_json::Map<String, serde_json::Value>) -> u8 {
        let type_str = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let type_id = get_block_type_id(type_str);
        let params = obj.get("params").and_then(|v| v.as_array());
        
        match type_id {
            // ================================================================
            // Arithmetic Operations
            // ================================================================
            BlockTypeId::CalcBasic => self.compile_calc_basic(params),
            BlockTypeId::CalcRand => self.compile_calc_rand(params),
            BlockTypeId::CalcOperation => self.compile_calc_operation(params),
            BlockTypeId::QuotientAndMod => self.compile_quotient_mod(params),
            
            // ================================================================
            // Variable Access
            // ================================================================
            BlockTypeId::GetVariable => {
                if let Some(p) = params {
                    if let Some(id_val) = p.first() {
                        if let Some(id) = id_val.as_str() {
                            let var_idx = self.program.get_or_create_variable(id);
                            let dst = self.reg_alloc.alloc();
                            self.program.emit(InstructionBuilder::load_var(dst, var_idx));
                            return dst;
                        }
                    }
                }
                let dst = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::load_nil(dst));
                dst
            }
            
            // ================================================================
            // Entity Properties
            // ================================================================
            BlockTypeId::CoordinateObject => self.compile_coordinate_object(params),
            BlockTypeId::CoordinateMouse => self.compile_coordinate_mouse(params),
            
            // ================================================================
            // String Operations
            // ================================================================
            BlockTypeId::LengthOfString => {
                let str_reg = self.compile_param_from_array(params, 1);
                let dst = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::strlen(dst, str_reg));
                dst
            }
            BlockTypeId::CombineSomething => {
                let a_reg = self.compile_param_from_array(params, 1);
                let b_reg = self.compile_param_from_array(params, 3);
                let dst = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::concat(dst, a_reg, b_reg));
                dst
            }
            BlockTypeId::CharAt => {
                let str_reg = self.compile_param_from_array(params, 1);
                let idx_reg = self.compile_param_from_array(params, 3);
                let dst = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::char_at(dst, str_reg, idx_reg));
                dst
            }
            BlockTypeId::IndexOfString => {
                let str_reg = self.compile_param_from_array(params, 1);
                let target_reg = self.compile_param_from_array(params, 3);
                let dst = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::index_of(dst, str_reg, target_reg));
                dst
            }
            BlockTypeId::ReverseOfString => {
                self.compile_exec_value_block(obj)
            }
            BlockTypeId::Substring | BlockTypeId::ReplaceString | 
            BlockTypeId::CountMatchString | BlockTypeId::ChangeStringCase => {
                self.compile_exec_value_block(obj)
            }
            
            // ================================================================
            // Boolean/Comparison Operations
            // ================================================================
            BlockTypeId::Unknown => {
                // Check for special block types by string
                match type_str {
                    "True" => {
                        let dst = self.reg_alloc.alloc();
                        self.program.emit(InstructionBuilder::load_true(dst));
                        dst
                    }
                    "False" => {
                        let dst = self.reg_alloc.alloc();
                        self.program.emit(InstructionBuilder::load_false(dst));
                        dst
                    }
                    "number" | "angle" => {
                        if let Some(p) = params {
                            if let Some(val) = p.first() {
                                return self.compile_value_to_reg(val);
                            }
                        }
                        let dst = self.reg_alloc.alloc();
                        self.program.emit(InstructionBuilder::load_imm(dst, 0));
                        dst
                    }
                    "text" => {
                        if let Some(p) = params {
                            if let Some(val) = p.first() {
                                return self.compile_value_to_reg(val);
                            }
                        }
                        let dst = self.reg_alloc.alloc();
                        let str_idx = self.program.add_string(String::new());
                        self.program.emit(InstructionBuilder::load_str(dst, str_idx));
                        dst
                    }
                    "color" | "Color" => {
                        if let Some(p) = params {
                            if let Some(val) = p.first() {
                                return self.compile_value_to_reg(val);
                            }
                        }
                        let dst = self.reg_alloc.alloc();
                        let str_idx = self.program.add_string("#000000".to_string());
                        self.program.emit(InstructionBuilder::load_str(dst, str_idx));
                        dst
                    }
                    "boolean_basic_operator" => self.compile_boolean_basic(params),
                    "boolean_and_or" => self.compile_boolean_and_or(params),
                    "boolean_not" => self.compile_boolean_not(params),
                    "is_clicked" | "is_object_clicked" => {
                        let dst = self.reg_alloc.alloc();
                        self.program.emit(InstructionBuilder::is_mouse_clicked(dst));
                        dst
                    }
                    "is_press_some_key" => {
                        let key_reg = self.compile_param_from_array(params, 0);
                        let dst = self.reg_alloc.alloc();
                        self.program.emit(InstructionBuilder::is_key_pressed(dst, key_reg));
                        dst
                    }
                    "reach_something" => {
                        let target_reg = self.compile_param_from_array(params, 1);
                        let dst = self.reg_alloc.alloc();
                        self.program.emit(InstructionBuilder::is_touching(dst, target_reg));
                        dst
                    }
                    "get_x" => {
                        let dst = self.reg_alloc.alloc();
                        self.program.emit(InstructionBuilder::get_x(dst));
                        dst
                    }
                    "get_y" => {
                        let dst = self.reg_alloc.alloc();
                        self.program.emit(InstructionBuilder::get_y(dst));
                        dst
                    }
                    "get_rotation" => {
                        let dst = self.reg_alloc.alloc();
                        self.program.emit(InstructionBuilder::get_rot(dst));
                        dst
                    }
                    "get_direction" => {
                        let dst = self.reg_alloc.alloc();
                        self.program.emit(InstructionBuilder::get_dir(dst));
                        dst
                    }
                    "get_scale" => {
                        let dst = self.reg_alloc.alloc();
                        self.program.emit(InstructionBuilder::get_scale(dst));
                        dst
                    }
                    "mouse_x" => {
                        let dst = self.reg_alloc.alloc();
                        self.program.emit(InstructionBuilder::get_mouse_x(dst));
                        dst
                    }
                    "mouse_y" => {
                        let dst = self.reg_alloc.alloc();
                        self.program.emit(InstructionBuilder::get_mouse_y(dst));
                        dst
                    }
                    "get_canvas_input_value" => {
                        let dst = self.reg_alloc.alloc();
                        self.program.emit(InstructionBuilder::get_answer(dst));
                        dst
                    }
                    "get_project_timer_value" => {
                        let dst = self.reg_alloc.alloc();
                        self.program.emit(InstructionBuilder::get_timer(dst));
                        dst
                    }
                    "value_of_index_from_list" | "value_of_list_index" => {
                        self.compile_list_value(params)
                    }
                    "length_of_list" => {
                        self.compile_list_length(params)
                    }
                    "is_included_in_list" => {
                        self.compile_list_contains(params)
                    }
                    "index_of_list" => {
                        self.compile_list_index_of(params)
                    }
                    "get_func_variable" => {
                        if let Some(p) = params {
                            if let Some(id_val) = p.first() {
                                if let Some(id) = id_val.as_str() {
                                    let local_idx = self.program.add_string(id.to_string());
                                    let dst = self.reg_alloc.alloc();
                                    self.program.emit(InstructionBuilder::load_local(dst, local_idx));
                                    return dst;
                                }
                            }
                        }
                        let dst = self.reg_alloc.alloc();
                        self.program.emit(InstructionBuilder::load_nil(dst));
                        dst
                    }
                    "text_read" => {
                        let dst = self.reg_alloc.alloc();
                        self.program.emit(InstructionBuilder::text_get(dst));
                        dst
                    }
                    // Function parameter references
                    _ if type_str.starts_with("stringParam_") || 
                         type_str.starts_with("booleanParam_") => {
                        // Parameter lookup - load from function parameters
                        let param_idx = self.program.add_string(type_str.to_string());
                        let dst = self.reg_alloc.alloc();
                        self.program.emit(InstructionBuilder::load_local(dst, param_idx));
                        dst
                    }
                    // Function calls as values
                    _ if type_str.starts_with("func_") => {
                        self.compile_func_value_call(type_str, params)
                    }
                    // Unknown block - use constant pool fallback
                    _ => {
                        self.compile_exec_value_block(obj)
                    }
                }
            }
            
            // ================================================================
            // Other Value Blocks
            // ================================================================
            BlockTypeId::GetDate => {
                let type_reg = self.compile_param_from_array(params, 1);
                let dst = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::get_date(dst, type_reg));
                dst
            }
            BlockTypeId::DistanceSomething => {
                let target_reg = self.compile_param_from_array(params, 1);
                let dst = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::get_distance(dst, target_reg));
                dst
            }
            BlockTypeId::GetProjectTimerValue => {
                let dst = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::get_timer(dst));
                dst
            }
            BlockTypeId::GetSoundVolume => {
                // Return constant 100 for now (full volume)
                let dst = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::load_imm(dst, 100));
                dst
            }
            BlockTypeId::TextRead => {
                let dst = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::text_get(dst));
                dst
            }
            
            // Default: use EXEC for value blocks
            _ => {
                self.compile_exec_value_block(obj)
            }
        }
    }
    
    // ========================================================================
    // Arithmetic Expression Compilation
    // ========================================================================
    
    /// Compile calc_basic (arithmetic operations)
    fn compile_calc_basic(&mut self, params: Option<&Vec<serde_json::Value>>) -> u8 {
        let (left_reg, op, right_reg) = if let Some(p) = params {
            let left = p.first().map(|v| self.compile_value_to_reg(v)).unwrap_or_else(|| {
                let r = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::load_imm(r, 0));
                r
            });
            let op = p.get(1).and_then(|v| v.as_str()).unwrap_or("PLUS");
            let right = p.get(2).map(|v| self.compile_value_to_reg(v)).unwrap_or_else(|| {
                let r = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::load_imm(r, 0));
                r
            });
            (left, op, right)
        } else {
            let r1 = self.reg_alloc.alloc();
            let r2 = self.reg_alloc.alloc();
            self.program.emit(InstructionBuilder::load_imm(r1, 0));
            self.program.emit(InstructionBuilder::load_imm(r2, 0));
            (r1, "PLUS", r2)
        };
        
        let dst = self.reg_alloc.alloc();
        match op {
            "PLUS" | "+" => self.program.emit(InstructionBuilder::add(dst, left_reg, right_reg)),
            "MINUS" | "-" => self.program.emit(InstructionBuilder::sub(dst, left_reg, right_reg)),
            "MULTI" | "MULTIPLY" | "*" => self.program.emit(InstructionBuilder::mul(dst, left_reg, right_reg)),
            "DIVIDE" | "/" => self.program.emit(InstructionBuilder::div(dst, left_reg, right_reg)),
            _ => self.program.emit(InstructionBuilder::add(dst, left_reg, right_reg)),
        };
        
        dst
    }
    
    /// Compile calc_rand (random number)
    fn compile_calc_rand(&mut self, params: Option<&Vec<serde_json::Value>>) -> u8 {
        let (min_reg, max_reg) = if let Some(p) = params {
            let min = p.first().map(|v| self.compile_value_to_reg(v)).unwrap_or_else(|| {
                let r = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::load_imm(r, 1));
                r
            });
            let max = p.get(1).map(|v| self.compile_value_to_reg(v)).unwrap_or_else(|| {
                let r = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::load_imm(r, 10));
                r
            });
            (min, max)
        } else {
            let r1 = self.reg_alloc.alloc();
            let r2 = self.reg_alloc.alloc();
            self.program.emit(InstructionBuilder::load_imm(r1, 1));
            self.program.emit(InstructionBuilder::load_imm(r2, 10));
            (r1, r2)
        };
        
        let dst = self.reg_alloc.alloc();
        self.program.emit(InstructionBuilder::rand(dst, min_reg, max_reg));
        dst
    }
    
    /// Compile calc_operation (math functions)
    fn compile_calc_operation(&mut self, params: Option<&Vec<serde_json::Value>>) -> u8 {
        let (op, val_reg) = if let Some(p) = params {
            let op = p.get(3).or_else(|| p.first()).and_then(|v| v.as_str()).unwrap_or("abs");
            let val = p.get(1).map(|v| self.compile_value_to_reg(v)).unwrap_or_else(|| {
                let r = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::load_imm(r, 0));
                r
            });
            (op, val)
        } else {
            let r = self.reg_alloc.alloc();
            self.program.emit(InstructionBuilder::load_imm(r, 0));
            ("abs", r)
        };
        
        let dst = self.reg_alloc.alloc();
        match op {
            "absolute" | "abs" => self.program.emit(InstructionBuilder::abs(dst, val_reg)),
            "sqrt" | "root" => self.program.emit(InstructionBuilder::sqrt(dst, val_reg)),
            "sin" => self.program.emit(InstructionBuilder::sin(dst, val_reg)),
            "cos" => self.program.emit(InstructionBuilder::cos(dst, val_reg)),
            "tan" => self.program.emit(InstructionBuilder::tan(dst, val_reg)),
            "asin" | "asin_radian" => self.program.emit(InstructionBuilder::asin(dst, val_reg)),
            "acos" | "acos_radian" => self.program.emit(InstructionBuilder::acos(dst, val_reg)),
            "atan" | "atan_radian" => self.program.emit(InstructionBuilder::atan(dst, val_reg)),
            "log" | "log10" => self.program.emit(InstructionBuilder::log10(dst, val_reg)),
            "ln" => self.program.emit(InstructionBuilder::ln(dst, val_reg)),
            "exp" | "e^" => self.program.emit(InstructionBuilder::exp(dst, val_reg)),
            "floor" => self.program.emit(InstructionBuilder::floor(dst, val_reg)),
            "ceil" => self.program.emit(InstructionBuilder::ceil(dst, val_reg)),
            "round" => self.program.emit(InstructionBuilder::round(dst, val_reg)),
            "square" => {
                // square = val * val
                self.program.emit(InstructionBuilder::mul(dst, val_reg, val_reg))
            }
            _ => self.program.emit(InstructionBuilder::abs(dst, val_reg)),
        };
        
        dst
    }
    
    /// Compile quotient_and_mod
    fn compile_quotient_mod(&mut self, params: Option<&Vec<serde_json::Value>>) -> u8 {
        let (left_reg, op, right_reg) = if let Some(p) = params {
            let left = p.get(1).map(|v| self.compile_value_to_reg(v)).unwrap_or_else(|| {
                let r = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::load_imm(r, 0));
                r
            });
            let op = p.get(5).and_then(|v| v.as_str()).unwrap_or("QUOTIENT");
            let right = p.get(3).map(|v| self.compile_value_to_reg(v)).unwrap_or_else(|| {
                let r = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::load_imm(r, 1));
                r
            });
            (left, op, right)
        } else {
            let r1 = self.reg_alloc.alloc();
            let r2 = self.reg_alloc.alloc();
            self.program.emit(InstructionBuilder::load_imm(r1, 0));
            self.program.emit(InstructionBuilder::load_imm(r2, 1));
            (r1, "QUOTIENT", r2)
        };
        
        let dst = self.reg_alloc.alloc();
        match op {
            "QUOTIENT" => self.program.emit(InstructionBuilder::quot(dst, left_reg, right_reg)),
            "MOD" => self.program.emit(InstructionBuilder::mod_(dst, left_reg, right_reg)),
            _ => self.program.emit(InstructionBuilder::quot(dst, left_reg, right_reg)),
        };
        
        dst
    }
    
    // ========================================================================
    // Boolean Expression Compilation
    // ========================================================================
    
    /// Compile boolean_basic_operator (==, !=, <, >, <=, >=)
    fn compile_boolean_basic(&mut self, params: Option<&Vec<serde_json::Value>>) -> u8 {
        let (left_reg, op, right_reg) = if let Some(p) = params {
            let left = p.first().map(|v| self.compile_value_to_reg(v)).unwrap_or_else(|| {
                let r = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::load_imm(r, 0));
                r
            });
            let op = p.get(1).and_then(|v| v.as_str()).unwrap_or("EQUAL");
            let right = p.get(2).map(|v| self.compile_value_to_reg(v)).unwrap_or_else(|| {
                let r = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::load_imm(r, 0));
                r
            });
            (left, op, right)
        } else {
            let r1 = self.reg_alloc.alloc();
            let r2 = self.reg_alloc.alloc();
            self.program.emit(InstructionBuilder::load_imm(r1, 0));
            self.program.emit(InstructionBuilder::load_imm(r2, 0));
            (r1, "EQUAL", r2)
        };
        
        let dst = self.reg_alloc.alloc();
        match op {
            "EQUAL" | "==" => self.program.emit(InstructionBuilder::eq(dst, left_reg, right_reg)),
            "NOT_EQUAL" | "!=" => self.program.emit(InstructionBuilder::ne(dst, left_reg, right_reg)),
            "GREATER" | ">" => self.program.emit(InstructionBuilder::gt(dst, left_reg, right_reg)),
            "GREATER_OR_EQUAL" | ">=" => self.program.emit(InstructionBuilder::ge(dst, left_reg, right_reg)),
            "LESS" | "<" => self.program.emit(InstructionBuilder::lt(dst, left_reg, right_reg)),
            "LESS_OR_EQUAL" | "<=" => self.program.emit(InstructionBuilder::le(dst, left_reg, right_reg)),
            _ => self.program.emit(InstructionBuilder::eq(dst, left_reg, right_reg)),
        };
        
        dst
    }
    
    /// Compile boolean_and_or
    fn compile_boolean_and_or(&mut self, params: Option<&Vec<serde_json::Value>>) -> u8 {
        let (left_reg, op, right_reg) = if let Some(p) = params {
            let left = p.first().map(|v| self.compile_value_to_reg(v)).unwrap_or_else(|| {
                let r = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::load_false(r));
                r
            });
            let op = p.get(1).and_then(|v| v.as_str()).unwrap_or("AND");
            let right = p.get(2).map(|v| self.compile_value_to_reg(v)).unwrap_or_else(|| {
                let r = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::load_false(r));
                r
            });
            (left, op, right)
        } else {
            let r1 = self.reg_alloc.alloc();
            let r2 = self.reg_alloc.alloc();
            self.program.emit(InstructionBuilder::load_false(r1));
            self.program.emit(InstructionBuilder::load_false(r2));
            (r1, "AND", r2)
        };
        
        let dst = self.reg_alloc.alloc();
        match op {
            "AND" => self.program.emit(InstructionBuilder::and(dst, left_reg, right_reg)),
            "OR" => self.program.emit(InstructionBuilder::or(dst, left_reg, right_reg)),
            _ => self.program.emit(InstructionBuilder::and(dst, left_reg, right_reg)),
        };
        
        dst
    }
    
    /// Compile boolean_not
    fn compile_boolean_not(&mut self, params: Option<&Vec<serde_json::Value>>) -> u8 {
        let val_reg = if let Some(p) = params {
            p.first().map(|v| self.compile_value_to_reg(v)).unwrap_or_else(|| {
                let r = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::load_false(r));
                r
            })
        } else {
            let r = self.reg_alloc.alloc();
            self.program.emit(InstructionBuilder::load_false(r));
            r
        };
        
        let dst = self.reg_alloc.alloc();
        self.program.emit(InstructionBuilder::not(dst, val_reg));
        dst
    }
    
    // ========================================================================
    // Entity Property Compilation
    // ========================================================================
    
    /// Compile coordinate_object (get x/y of object)
    fn compile_coordinate_object(&mut self, params: Option<&Vec<serde_json::Value>>) -> u8 {
        // params: [null, target_id, null, coord_type]
        let coord = params
            .and_then(|p| p.get(3))
            .and_then(|v| v.as_str())
            .unwrap_or("x");
        
        let target = params
            .and_then(|p| p.get(1))
            .and_then(|v| v.as_str())
            .unwrap_or("self");
        
        let dst = self.reg_alloc.alloc();
        
        if target == "self" || target.is_empty() {
            // Get own property
            match coord {
                "x" => self.program.emit(InstructionBuilder::get_x(dst)),
                "y" => self.program.emit(InstructionBuilder::get_y(dst)),
                "direction" => self.program.emit(InstructionBuilder::get_dir(dst)),
                "rotation" => self.program.emit(InstructionBuilder::get_rot(dst)),
                "size" | "scale" => self.program.emit(InstructionBuilder::get_scale(dst)),
                _ => self.program.emit(InstructionBuilder::get_x(dst)),
            };
        } else {
            // Get other object's property - use EXEC fallback
            let target_reg = self.reg_alloc.alloc();
            let str_idx = self.program.add_string(target.to_string());
            self.program.emit(InstructionBuilder::load_str(target_reg, str_idx));
            
            let coord_reg = self.reg_alloc.alloc();
            let coord_idx = self.program.add_string(coord.to_string());
            self.program.emit(InstructionBuilder::load_str(coord_reg, coord_idx));
            
            // coord_type goes in r0, target goes in r1
            self.program.emit(InstructionBuilder::mov(0, coord_reg));
            self.program.emit(InstructionBuilder::mov(1, target_reg));
            self.program.emit(InstructionBuilder::get_obj_coord(dst, target_reg, coord_reg));
        }
        
        dst
    }
    
    /// Compile coordinate_mouse (get mouse x/y)
    fn compile_coordinate_mouse(&mut self, params: Option<&Vec<serde_json::Value>>) -> u8 {
        let coord = params
            .and_then(|p| p.get(1))
            .and_then(|v| v.as_str())
            .unwrap_or("x");
        
        let dst = self.reg_alloc.alloc();
        match coord {
            "x" => self.program.emit(InstructionBuilder::get_mouse_x(dst)),
            "y" => self.program.emit(InstructionBuilder::get_mouse_y(dst)),
            _ => self.program.emit(InstructionBuilder::get_mouse_x(dst)),
        };
        
        dst
    }
    
    // ========================================================================
    // List Value Operations
    // ========================================================================
    
    /// Compile value_of_index_from_list / value_of_list_index
    fn compile_list_value(&mut self, params: Option<&Vec<serde_json::Value>>) -> u8 {
        if let Some(p) = params {
            if let Some(list_id) = p.get(1).and_then(|v| v.as_str()) {
                let var_idx = self.program.get_or_create_variable(list_id);
                let list_reg = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::load_var(list_reg, var_idx));
                
                let idx_reg = self.compile_param_from_array(Some(p), 3);
                let dst = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::list_get(dst, list_reg, idx_reg));
                return dst;
            }
        }
        let dst = self.reg_alloc.alloc();
        self.program.emit(InstructionBuilder::load_nil(dst));
        dst
    }
    
    /// Compile length_of_list
    fn compile_list_length(&mut self, params: Option<&Vec<serde_json::Value>>) -> u8 {
        if let Some(p) = params {
            if let Some(list_id) = p.get(1).and_then(|v| v.as_str()) {
                let var_idx = self.program.get_or_create_variable(list_id);
                let list_reg = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::load_var(list_reg, var_idx));
                
                let dst = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::list_len(dst, list_reg));
                return dst;
            }
        }
        let dst = self.reg_alloc.alloc();
        self.program.emit(InstructionBuilder::load_imm(dst, 0));
        dst
    }
    
    /// Compile is_included_in_list
    fn compile_list_contains(&mut self, params: Option<&Vec<serde_json::Value>>) -> u8 {
        if let Some(p) = params {
            if let Some(list_id) = p.get(1).and_then(|v| v.as_str()) {
                let var_idx = self.program.get_or_create_variable(list_id);
                let list_reg = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::load_var(list_reg, var_idx));
                
                let value_reg = self.compile_param_from_array(Some(p), 0);
                let dst = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::list_contains(dst, list_reg, value_reg));
                return dst;
            }
        }
        let dst = self.reg_alloc.alloc();
        self.program.emit(InstructionBuilder::load_false(dst));
        dst
    }
    
    /// Compile index_of_list
    fn compile_list_index_of(&mut self, params: Option<&Vec<serde_json::Value>>) -> u8 {
        if let Some(p) = params {
            if let Some(list_id) = p.get(1).and_then(|v| v.as_str()) {
                let var_idx = self.program.get_or_create_variable(list_id);
                let list_reg = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::load_var(list_reg, var_idx));
                
                let value_reg = self.compile_param_from_array(Some(p), 0);
                let dst = self.reg_alloc.alloc();
                self.program.emit(InstructionBuilder::list_index_of(dst, list_reg, value_reg));
                return dst;
            }
        }
        let dst = self.reg_alloc.alloc();
        self.program.emit(InstructionBuilder::load_imm(dst, 0));
        dst
    }
    
    // ========================================================================
    // Function Value Call Compilation
    // ========================================================================
    
    /// Compile a function call that returns a value
    fn compile_func_value_call(&mut self, type_str: &str, params: Option<&Vec<serde_json::Value>>) -> u8 {
        let func_id = &type_str[5..]; // Skip "func_" prefix
        
        if let Some(func_info) = self.program.functions.get(func_id).cloned() {
            // Compile arguments
            if let Some(p) = params {
                for (i, param) in p.iter().enumerate() {
                    if i >= func_info.param_count as usize {
                        break;
                    }
                    let arg_reg = self.compile_value_to_reg(param);
                    if arg_reg != i as u8 {
                        self.program.emit(InstructionBuilder::mov(i as u8, arg_reg));
                    }
                }
            }
            
            // Call function
            self.program.emit(InstructionBuilder::call(func_info.start_pc as u32));
            
            // Return value is in r0
            let dst = self.reg_alloc.alloc();
            if dst != 0 {
                self.program.emit(InstructionBuilder::mov(dst, 0));
            }
            dst
        } else {
            // Function not found - return nil
            let dst = self.reg_alloc.alloc();
            self.program.emit(InstructionBuilder::load_nil(dst));
            dst
        }
    }
    
    // ========================================================================
    // Helper Methods
    // ========================================================================
    
    /// Compile a parameter from a params array at given index
    fn compile_param_from_array(&mut self, params: Option<&Vec<serde_json::Value>>, index: usize) -> u8 {
        if let Some(p) = params {
            if let Some(val) = p.get(index) {
                if !val.is_null() {
                    return self.compile_value_to_reg(val);
                }
            }
        }
        let r = self.reg_alloc.alloc();
        self.program.emit(InstructionBuilder::load_nil(r));
        r
    }
    
    /// Compile a value block using EXEC fallback (stores result in constant pool)
    fn compile_exec_value_block(&mut self, obj: &serde_json::Map<String, serde_json::Value>) -> u8 {
        // Store the entire block as a constant for runtime interpretation
        let dst = self.reg_alloc.alloc();
        let const_idx = self.program.add_constant(Value::from_json(&serde_json::Value::Object(obj.clone())));
        self.program.emit(InstructionBuilder::load_const(dst, const_idx));
        dst
    }
}

impl Default for Compiler {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bytecode::{decode_opcode, Opcode};
    
    #[test]
    fn test_compiler_creation() {
        let compiler = Compiler::new();
        assert_eq!(compiler.program.instructions.len(), 0);
    }
    
    #[test]
    fn test_compile_empty_project() {
        let project = ProjectData {
            id: None,
            name: None,
            speed: Some(60),
            objects: None,
            variables: None,
            messages: None,
            functions: None,
            scenes: None,
        };
        
        let compiler = Compiler::new();
        let program = compiler.compile(&project);
        
        assert_eq!(program.scripts.len(), 0);
    }
    
    #[test]
    fn test_compile_simple_script() {
        let json = r#"{
            "speed": 60,
            "objects": [
                {
                    "id": "obj1",
                    "script": [
                        [
                            {"type": "when_run_button_click", "params": []},
                            {"type": "move_x", "params": [10]}
                        ]
                    ]
                }
            ]
        }"#;
        
        let project: ProjectData = serde_json::from_str(json).unwrap();
        let compiler = Compiler::new();
        let program = compiler.compile(&project);
        
        assert_eq!(program.scripts.len(), 1);
        assert!(program.instructions.len() > 0);
        
        // Should have LOAD_IMM, ADD_X, END
        let last_instr = program.instructions.last().unwrap();
        assert_eq!(decode_opcode(*last_instr), Opcode::END as u8);
    }
    
    #[test]
    fn test_compile_variable_operations() {
        let json = r#"{
            "speed": 60,
            "variables": [
                {"id": "score", "name": "score", "value": 0, "variableType": "variable"}
            ],
            "objects": [
                {
                    "id": "obj1",
                    "script": [
                        [
                            {"type": "when_run_button_click", "params": []},
                            {"type": "set_variable", "params": ["score", 100]}
                        ]
                    ]
                }
            ]
        }"#;
        
        let project: ProjectData = serde_json::from_str(json).unwrap();
        let compiler = Compiler::new();
        let program = compiler.compile(&project);
        
        assert_eq!(program.scripts.len(), 1);
        assert!(program.variable_map.contains_key("score"));
    }
    
    #[test]
    fn test_compile_loop() {
        let json = r#"{
            "speed": 60,
            "objects": [
                {
                    "id": "obj1",
                    "script": [
                        [
                            {"type": "when_run_button_click", "params": []},
                            {
                                "type": "repeat_basic",
                                "params": [5],
                                "statements": [[
                                    {"type": "move_x", "params": [10]}
                                ]]
                            }
                        ]
                    ]
                }
            ]
        }"#;
        
        let project: ProjectData = serde_json::from_str(json).unwrap();
        let compiler = Compiler::new();
        let program = compiler.compile(&project);
        
        assert_eq!(program.scripts.len(), 1);
        
        // Should have loop instructions
        let has_loop_start = program.instructions.iter().any(|&i| {
            decode_opcode(i) == Opcode::LOOP_START as u8
        });
        let has_loop_end = program.instructions.iter().any(|&i| {
            decode_opcode(i) == Opcode::LOOP_END as u8
        });
        
        assert!(has_loop_start, "Should have LOOP_START instruction");
        assert!(has_loop_end, "Should have LOOP_END instruction");
    }
    
    #[test]
    fn test_compile_conditional() {
        let json = r#"{
            "speed": 60,
            "objects": [
                {
                    "id": "obj1",
                    "script": [
                        [
                            {"type": "when_run_button_click", "params": []},
                            {
                                "type": "_if",
                                "params": [{"type": "True", "params": []}],
                                "statements": [[
                                    {"type": "show", "params": []}
                                ]]
                            }
                        ]
                    ]
                }
            ]
        }"#;
        
        let project: ProjectData = serde_json::from_str(json).unwrap();
        let compiler = Compiler::new();
        let program = compiler.compile(&project);
        
        assert_eq!(program.scripts.len(), 1);
        
        // Should have JZ instruction for conditional
        let has_jz = program.instructions.iter().any(|&i| {
            decode_opcode(i) == Opcode::JZ as u8
        });
        
        assert!(has_jz, "Should have JZ instruction for conditional");
    }
    
    #[test]
    fn test_compile_nested_expression() {
        let json = r#"{
            "speed": 60,
            "objects": [
                {
                    "id": "obj1",
                    "script": [
                        [
                            {"type": "when_run_button_click", "params": []},
                            {"type": "move_x", "params": [
                                {"type": "calc_basic", "params": [10, "PLUS", 5]}
                            ]}
                        ]
                    ]
                }
            ]
        }"#;
        
        let project: ProjectData = serde_json::from_str(json).unwrap();
        let compiler = Compiler::new();
        let program = compiler.compile(&project);
        
        // Should have ADD instruction from calc_basic
        let has_add = program.instructions.iter().any(|&i| {
            decode_opcode(i) == Opcode::ADD as u8
        });
        
        assert!(has_add, "Should have ADD instruction from calc_basic");
    }
}
