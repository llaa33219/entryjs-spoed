//! Virtual Machine for Entry WASM Engine
//! 
//! Executes the 32-bit fixed-width bytecode using a register-based architecture.

use crate::bytecode::{
    Program, NUM_REGISTERS,
    decode_opcode, decode_reg_a, decode_reg_b, decode_reg_c,
    decode_imm16, decode_imm16_signed, decode_operand_signed,
};
use crate::{Entity, Value, JsAction, HashMap};

/// Register file for the VM
#[derive(Clone)]
pub struct RegisterFile {
    /// 256 general-purpose registers
    registers: [Value; NUM_REGISTERS],
}

impl Default for RegisterFile {
    fn default() -> Self {
        Self::new()
    }
}

impl RegisterFile {
    pub fn new() -> Self {
        // Initialize all registers to Null
        Self {
            registers: std::array::from_fn(|_| Value::Null),
        }
    }
    
    #[inline(always)]
    pub fn get(&self, idx: u8) -> &Value {
        &self.registers[idx as usize]
    }
    
    #[inline(always)]
    pub fn get_mut(&mut self, idx: u8) -> &mut Value {
        &mut self.registers[idx as usize]
    }
    
    #[inline(always)]
    pub fn set(&mut self, idx: u8, value: Value) {
        self.registers[idx as usize] = value;
    }
    
    #[inline(always)]
    pub fn get_number(&self, idx: u8) -> f64 {
        self.registers[idx as usize].as_number()
    }
    
    #[inline(always)]
    pub fn get_bool(&self, idx: u8) -> bool {
        self.registers[idx as usize].as_bool()
    }
    
    #[inline(always)]
    pub fn get_string(&self, idx: u8) -> String {
        self.registers[idx as usize].as_string()
    }
    
    /// Reset all registers to Null
    pub fn reset(&mut self) {
        for reg in &mut self.registers {
            *reg = Value::Null;
        }
    }
}

/// Execution result from a single step
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VMResult {
    /// Continue execution
    Continue,
    /// Script ended normally
    End,
    /// Yield control (cooperative multitasking)
    Yield,
    /// Wait for specified time
    Wait(u32),
    /// Wait for condition
    WaitUntil,
    /// Break from loop
    Break,
    /// Continue loop
    ContinueLoop,
    /// Error occurred
    Error,
}

/// Virtual Machine state
pub struct VM<'a> {
    /// Reference to the compiled program
    program: &'a Program,
    /// Register file
    pub registers: RegisterFile,
    /// Entity list
    entities: &'a mut Vec<Entity>,
    /// Global variables
    variables: &'a mut HashMap<String, Value>,
    /// Pending JavaScript actions
    js_actions: &'a mut Vec<JsAction>,
    /// Call stack for function calls
    call_stack: Vec<CallFrame>,
    /// Loop stack for break/continue
    loop_stack: Vec<LoopInfo>,
    /// Local variables stack (for function calls)
    local_vars: Vec<Value>,
    /// Function parameters by type name (stringParam_xxx, booleanParam_xxx)
    func_params: HashMap<String, Value>,
    /// Stack of saved func_params for nested function calls
    func_params_stack: Vec<HashMap<String, Value>>,
    /// Function-local variables by variableId
    func_locals: HashMap<String, Value>,
    /// Stack of saved func_locals for nested function calls
    func_locals_stack: Vec<HashMap<String, Value>>,
    /// Current entity index
    entity_idx: usize,
    /// Cached mouse coordinates
    pub mouse_x: f64,
    pub mouse_y: f64,
    /// Cached timer value
    pub timer_value: f64,
    /// Cached mouse clicked state
    pub mouse_clicked: bool,
    /// Currently pressed keys
    pub pressed_keys: Vec<u32>,
    /// Answer from last ASK block
    pub answer: String,
}

/// Call frame for function calls
#[derive(Clone, Debug)]
pub struct CallFrame {
    /// Return address (PC to return to)
    pub return_pc: usize,
    /// Base register for local variables (reserved for future use)
    #[allow(dead_code)]
    pub base_reg: u8,
}

/// Loop information for break/continue
#[derive(Clone, Debug)]
pub struct LoopInfo {
    /// PC of loop start
    pub start_pc: usize,
    /// PC after loop end
    pub end_pc: usize,
    /// Counter register (reserved for future use)
    #[allow(dead_code)]
    pub counter_reg: Option<u8>,
}

/// VMThread - persistent execution state for a script
/// This tracks all state needed to pause and resume execution between ticks
#[derive(Clone)]
pub struct VMThread {
    /// Entity this thread is executing for
    pub entity_idx: usize,
    /// Current program counter
    pub pc: usize,
    /// Whether this thread has completed
    pub completed: bool,
    /// Frames to wait before resuming (for wait_second)
    pub wait_frames: u32,
    /// Whether waiting for a condition (for wait_until)
    pub wait_until: bool,
    /// Register file
    pub registers: RegisterFile,
    /// Call stack for function calls
    pub call_stack: Vec<CallFrame>,
    /// Loop stack for break/continue
    pub loop_stack: Vec<LoopInfo>,
    /// Local variables
    pub local_vars: Vec<Value>,
    
    /// Function parameters by type name (stringParam_xxx, booleanParam_xxx)
    /// Used for JS-compatible parameter lookup within functions
    pub func_params: HashMap<String, Value>,
    /// Stack of saved func_params for nested function calls
    pub func_params_stack: Vec<HashMap<String, Value>>,
    /// Function-local variables by variableId
    pub func_locals: HashMap<String, Value>,
    /// Stack of saved func_locals for nested function calls
    pub func_locals_stack: Vec<HashMap<String, Value>>,
    
    // Input state (updated from engine each tick)
    pub mouse_x: f64,
    pub mouse_y: f64,
    pub mouse_clicked: bool,
    pub pressed_keys: Vec<u32>,
    pub timer_value: f64,
    pub answer: String,
}

impl VMThread {
    /// Create a new VMThread for a script
    pub fn new(entity_idx: usize, start_pc: usize) -> Self {
        VMThread {
            entity_idx,
            pc: start_pc,
            completed: false,
            wait_frames: 0,
            wait_until: false,
            registers: RegisterFile::new(),
            call_stack: Vec::with_capacity(64),
            loop_stack: Vec::with_capacity(16),
            local_vars: Vec::with_capacity(64),
            func_params: HashMap::default(),
            func_params_stack: Vec::with_capacity(16),
            func_locals: HashMap::default(),
            func_locals_stack: Vec::with_capacity(16),
            mouse_x: 0.0,
            mouse_y: 0.0,
            mouse_clicked: false,
            pressed_keys: Vec::new(),
            timer_value: 0.0,
            answer: String::new(),
        }
    }
    
    /// Check if this thread is waiting
    pub fn is_waiting(&self) -> bool {
        self.wait_frames > 0 || self.wait_until
    }
    
    /// Decrement wait counter if waiting
    pub fn tick_wait(&mut self) {
        if self.wait_frames > 0 {
            self.wait_frames -= 1;
        }
    }
}

impl<'a> VM<'a> {
    pub fn new(
        program: &'a Program,
        entities: &'a mut Vec<Entity>,
        variables: &'a mut HashMap<String, Value>,
        js_actions: &'a mut Vec<JsAction>,
    ) -> Self {
        VM {
            program,
            registers: RegisterFile::new(),
            entities,
            variables,
            js_actions,
            call_stack: Vec::with_capacity(64),
            loop_stack: Vec::with_capacity(16),
            local_vars: Vec::with_capacity(64),
            func_params: HashMap::default(),
            func_params_stack: Vec::with_capacity(16),
            func_locals: HashMap::default(),
            func_locals_stack: Vec::with_capacity(16),
            entity_idx: 0,
            mouse_x: 0.0,
            mouse_y: 0.0,
            timer_value: 0.0,
            mouse_clicked: false,
            pressed_keys: Vec::new(),
            answer: String::new(),
        }
    }
    
    /// Execute a VMThread for one tick
    /// Returns the updated thread state
    pub fn execute_thread(&mut self, thread: &mut VMThread) -> VMResult {
        // Check if waiting on frames
        if thread.wait_frames > 0 {
            thread.wait_frames -= 1;
            return VMResult::Yield;
        }
        
        // Load thread state into VM
        self.entity_idx = thread.entity_idx;
        self.registers = thread.registers.clone();
        self.call_stack = thread.call_stack.clone();
        self.loop_stack = thread.loop_stack.clone();
        self.local_vars = thread.local_vars.clone();
        self.func_params = thread.func_params.clone();
        self.func_params_stack = thread.func_params_stack.clone();
        self.func_locals = thread.func_locals.clone();
        self.func_locals_stack = thread.func_locals_stack.clone();
        self.mouse_x = thread.mouse_x;
        self.mouse_y = thread.mouse_y;
        self.mouse_clicked = thread.mouse_clicked;
        self.pressed_keys = thread.pressed_keys.clone();
        self.timer_value = thread.timer_value;
        self.answer = thread.answer.clone();
        
        let mut pc = thread.pc;
        let max_instructions_per_tick = 100_000;
        let mut instruction_count = 0;
        
        // If waiting until condition, re-check it
        if thread.wait_until {
            // The wait_until instruction should be at current PC-1 (we incremented after wait)
            // Just continue execution - the condition will be re-evaluated
            thread.wait_until = false;
        }
        
        let result = loop {
            if pc >= self.program.instructions.len() {
                break VMResult::End;
            }
            
            instruction_count += 1;
            if instruction_count > max_instructions_per_tick {
                // Yield to prevent infinite loops from blocking
                break VMResult::Yield;
            }
            
            let (result, next_pc) = self.execute_instruction(pc);
            
            match result {
                VMResult::Continue => {
                    pc = next_pc;
                }
                VMResult::End => break VMResult::End,
                VMResult::Yield => {
                    pc = next_pc;
                    break VMResult::Yield;
                }
                VMResult::Wait(frames) => {
                    thread.wait_frames = frames.saturating_sub(1); // Subtract 1 since this tick counts
                    pc = next_pc;
                    break VMResult::Yield;
                }
                VMResult::WaitUntil => {
                    thread.wait_until = true;
                    // Stay at current PC to re-evaluate condition next tick
                    break VMResult::Yield;
                }
                VMResult::Break => {
                    if let Some(loop_info) = self.loop_stack.pop() {
                        pc = loop_info.end_pc;
                    } else {
                        break VMResult::End;
                    }
                }
                VMResult::ContinueLoop => {
                    if let Some(loop_info) = self.loop_stack.last() {
                        pc = loop_info.start_pc;
                    } else {
                        break VMResult::End;
                    }
                }
                VMResult::Error => break VMResult::End,
            }
        };
        
        // Save state back to thread
        thread.pc = pc;
        thread.registers = self.registers.clone();
        thread.call_stack = self.call_stack.clone();
        thread.loop_stack = self.loop_stack.clone();
        thread.local_vars = self.local_vars.clone();
        thread.func_params = self.func_params.clone();
        thread.func_params_stack = self.func_params_stack.clone();
        thread.func_locals = self.func_locals.clone();
        thread.func_locals_stack = self.func_locals_stack.clone();
        
        if matches!(result, VMResult::End) {
            thread.completed = true;
        }
        
        result
    }
    
    /// Execute a script starting from the given PC (legacy method)
    pub fn execute_script(&mut self, entity_idx: usize, start_pc: usize) -> VMResult {
        self.entity_idx = entity_idx;
        self.registers.reset();
        self.call_stack.clear();
        self.loop_stack.clear();
        
        let mut pc = start_pc;
        
        loop {
            if pc >= self.program.instructions.len() {
                return VMResult::End;
            }
            
            let result = self.execute_instruction(pc);
            
            match result {
                (VMResult::Continue, next_pc) => {
                    pc = next_pc;
                }
                (VMResult::End, _) => return VMResult::End,
                (VMResult::Yield, _) => return VMResult::Yield,
                (VMResult::Wait(frames), _) => return VMResult::Wait(frames),
                (VMResult::WaitUntil, _) => return VMResult::WaitUntil,
                (VMResult::Break, _) => {
                    // Find enclosing loop and jump to end
                    if let Some(loop_info) = self.loop_stack.pop() {
                        pc = loop_info.end_pc;
                    } else {
                        return VMResult::End;
                    }
                }
                (VMResult::ContinueLoop, _) => {
                    // Find enclosing loop and jump to start
                    if let Some(loop_info) = self.loop_stack.last() {
                        pc = loop_info.start_pc;
                    } else {
                        return VMResult::End;
                    }
                }
                (VMResult::Error, _) => return VMResult::Error,
            }
        }
    }
    
    /// Execute a single instruction, returns (result, next_pc)
    #[inline]
    fn execute_instruction(&mut self, pc: usize) -> (VMResult, usize) {
        let instr = self.program.instructions[pc];
        let opcode = decode_opcode(instr);
        
        // Fast path for common opcodes
        match opcode {
            // NOP
            0x00 => (VMResult::Continue, pc + 1),
            
            // END
            0x01 => (VMResult::End, pc),
            
            // JMP
            0x02 => {
                let offset = decode_operand_signed(instr);
                let new_pc = (pc as i32 + offset) as usize;
                (VMResult::Continue, new_pc)
            }
            
            // JZ (jump if zero/false)
            0x03 => {
                let reg = decode_reg_a(instr);
                let offset = decode_imm16_signed(instr);
                if !self.registers.get_bool(reg) {
                    let new_pc = (pc as i32 + offset as i32) as usize;
                    (VMResult::Continue, new_pc)
                } else {
                    (VMResult::Continue, pc + 1)
                }
            }
            
            // JNZ (jump if not zero/true)
            0x04 => {
                let reg = decode_reg_a(instr);
                let offset = decode_imm16_signed(instr);
                if self.registers.get_bool(reg) {
                    let new_pc = (pc as i32 + offset as i32) as usize;
                    (VMResult::Continue, new_pc)
                } else {
                    (VMResult::Continue, pc + 1)
                }
            }
            
            // CALL - Function call with parameter passing
            0x05 => {
                let func_pc = decode_operand_signed(instr) as usize;
                
                // O(1) lookup: first get func_id from func_by_pc, then get FunctionInfo
                let func_info = self.program.func_by_pc.get(&func_pc)
                    .and_then(|id| self.program.functions.get(id))
                    .cloned();
                
                // Save current func_params and func_locals for restoration on RET
                self.func_params_stack.push(self.func_params.clone());
                self.func_locals_stack.push(self.func_locals.clone());
                
                // Create new func_params mapping register values to param type names
                let mut new_params = HashMap::default();
                if let Some(info) = func_info {
                    for (i, param_type) in info.param_types.iter().enumerate() {
                        let value = self.registers.get(i as u8).clone();
                        new_params.insert(param_type.clone(), value);
                    }
                }
                self.func_params = new_params;
                self.func_locals = HashMap::default(); // Clear locals for new function scope
                
                // Push return address
                self.call_stack.push(CallFrame {
                    return_pc: pc + 1,
                    base_reg: 0,
                });
                
                (VMResult::Continue, func_pc)
            }
            
            // RET - Return from function, restore previous func_params and func_locals
            0x06 => {
                // Restore previous func_params
                if let Some(prev_params) = self.func_params_stack.pop() {
                    self.func_params = prev_params;
                } else {
                    self.func_params.clear();
                }
                
                // Restore previous func_locals
                if let Some(prev_locals) = self.func_locals_stack.pop() {
                    self.func_locals = prev_locals;
                } else {
                    self.func_locals.clear();
                }
                
                if let Some(frame) = self.call_stack.pop() {
                    (VMResult::Continue, frame.return_pc)
                } else {
                    (VMResult::End, pc)
                }
            }
            
            // YIELD
            0x07 => (VMResult::Yield, pc + 1),
            
            // WAIT
            0x08 => {
                let reg = decode_reg_a(instr);
                let seconds = self.registers.get_number(reg);
                let frames = (seconds * 60.0).max(1.0) as u32; // Assuming 60 FPS
                (VMResult::Wait(frames), pc + 1)
            }
            
            // WAIT_UNTIL
            0x09 => {
                let reg = decode_reg_a(instr);
                if self.registers.get_bool(reg) {
                    (VMResult::Continue, pc + 1)
                } else {
                    (VMResult::WaitUntil, pc)
                }
            }
            
            // LOOP_START
            0x0A => {
                let counter_reg = decode_reg_a(instr);
                let count_reg = decode_reg_b(instr);
                let count = self.registers.get_number(count_reg) as i32;
                self.registers.set(counter_reg, Value::Number(count as f64));
                (VMResult::Continue, pc + 1)
            }
            
            // LOOP_END
            0x0B => {
                let counter_reg = decode_reg_a(instr);
                let offset = decode_imm16_signed(instr);
                let count = self.registers.get_number(counter_reg) as i32 - 1;
                if count > 0 {
                    self.registers.set(counter_reg, Value::Number(count as f64));
                    let new_pc = (pc as i32 + offset as i32) as usize;
                    (VMResult::Continue, new_pc)
                } else {
                    (VMResult::Continue, pc + 1)
                }
            }
            
            // BREAK
            0x0C => (VMResult::Break, pc),
            
            // CONTINUE
            0x0D => (VMResult::ContinueLoop, pc),
            
            // MOV
            0x20 => {
                let dst = decode_reg_a(instr);
                let src = decode_reg_b(instr);
                let val = self.registers.get(src).clone();
                self.registers.set(dst, val);
                (VMResult::Continue, pc + 1)
            }
            
            // LOAD_CONST
            0x21 => {
                let dst = decode_reg_a(instr);
                let idx = decode_imm16(instr) as usize;
                if let Some(val) = self.program.constants.get(idx) {
                    self.registers.set(dst, val.clone());
                }
                (VMResult::Continue, pc + 1)
            }
            
            // LOAD_VAR
            0x22 => {
                let dst = decode_reg_a(instr);
                let idx = decode_imm16(instr) as usize;
                if let Some(var_name) = self.program.string_pool.get(idx) {
                    if let Some(val) = self.variables.get(var_name) {
                        self.registers.set(dst, val.clone());
                    } else {
                        self.registers.set(dst, Value::Null);
                    }
                } else {
                    self.registers.set(dst, Value::Null);
                }
                (VMResult::Continue, pc + 1)
            }
            
            // STORE_VAR
            0x23 => {
                let src = decode_reg_a(instr);
                let idx = decode_imm16(instr) as usize;
                if let Some(var_name) = self.program.string_pool.get(idx) {
                    let val = self.registers.get(src).clone();
                    self.variables.insert(var_name.clone(), val);
                }
                (VMResult::Continue, pc + 1)
            }
            
            // LOAD_IMM
            0x26 => {
                let dst = decode_reg_a(instr);
                let imm = decode_imm16_signed(instr) as f64;
                self.registers.set(dst, Value::Number(imm));
                (VMResult::Continue, pc + 1)
            }
            
            // LOAD_STR
            0x27 => {
                let dst = decode_reg_a(instr);
                let idx = decode_imm16(instr) as usize;
                if let Some(s) = self.program.string_pool.get(idx) {
                    self.registers.set(dst, Value::String(s.clone()));
                } else {
                    self.registers.set(dst, Value::String(String::new()));
                }
                (VMResult::Continue, pc + 1)
            }
            
            // LOAD_NIL
            0x28 => {
                let dst = decode_reg_a(instr);
                self.registers.set(dst, Value::Null);
                (VMResult::Continue, pc + 1)
            }
            
            // LOAD_TRUE
            0x29 => {
                let dst = decode_reg_a(instr);
                self.registers.set(dst, Value::Bool(true));
                (VMResult::Continue, pc + 1)
            }
            
            // LOAD_FALSE
            0x2A => {
                let dst = decode_reg_a(instr);
                self.registers.set(dst, Value::Bool(false));
                (VMResult::Continue, pc + 1)
            }
            
            // LOAD_LOCAL (0x24) - Load local variable or function parameter
            0x24 => {
                let dst = decode_reg_a(instr);
                let idx = decode_imm16(instr) as usize;
                
                // Check if this is a function parameter or local variable reference
                let val = if let Some(name) = self.program.string_pool.get(idx) {
                    if name.starts_with("stringParam_") || name.starts_with("booleanParam_") {
                        // Look up in func_params by type name
                        self.func_params.get(name).cloned().unwrap_or(Value::Null)
                    } else {
                        // Try func_locals first (for set_func_variable), then fall back to local_vars
                        self.func_locals.get(name).cloned()
                            .or_else(|| self.local_vars.get(idx).cloned())
                            .unwrap_or(Value::Null)
                    }
                } else {
                    // Fallback to local_vars
                    self.local_vars.get(idx).cloned().unwrap_or(Value::Null)
                };
                
                self.registers.set(dst, val);
                (VMResult::Continue, pc + 1)
            }
            
            // STORE_LOCAL (0x25) - Store to local variable or function parameter
            0x25 => {
                let src = decode_reg_a(instr);
                let idx = decode_imm16(instr) as usize;
                let val = self.registers.get(src).clone();
                
                // Check if this is a function parameter or local variable
                if let Some(name) = self.program.string_pool.get(idx) {
                    if name.starts_with("stringParam_") || name.starts_with("booleanParam_") {
                        // Store to func_params by type name
                        self.func_params.insert(name.clone(), val);
                    } else {
                        // Store to func_locals by variable name
                        self.func_locals.insert(name.clone(), val);
                    }
                } else {
                    // Fallback to local_vars vector
                    while self.local_vars.len() <= idx {
                        self.local_vars.push(Value::Null);
                    }
                    self.local_vars[idx] = val;
                }
                (VMResult::Continue, pc + 1)
            }
            
            // DUP (0x2B)
            0x2B => {
                let dst = decode_reg_a(instr);
                let src = decode_reg_b(instr);
                let val = self.registers.get(src).clone();
                self.registers.set(dst, val);
                (VMResult::Continue, pc + 1)
            }
            
            // Entity position operations
            // GET_X
            0x40 => {
                let dst = decode_reg_a(instr);
                if let Some(e) = self.entities.get(self.entity_idx) {
                    self.registers.set(dst, Value::Number(e.x));
                }
                (VMResult::Continue, pc + 1)
            }
            
            // GET_Y
            0x41 => {
                let dst = decode_reg_a(instr);
                if let Some(e) = self.entities.get(self.entity_idx) {
                    self.registers.set(dst, Value::Number(e.y));
                }
                (VMResult::Continue, pc + 1)
            }
            
            // SET_X
            0x42 => {
                let src = decode_reg_a(instr);
                let val = self.registers.get_number(src);
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.x = val;
                }
                (VMResult::Continue, pc + 1)
            }
            
            // SET_Y
            0x43 => {
                let src = decode_reg_a(instr);
                let val = self.registers.get_number(src);
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.y = val;
                }
                (VMResult::Continue, pc + 1)
            }
            
            // ADD_X
            0x44 => {
                let src = decode_reg_a(instr);
                let val = self.registers.get_number(src);
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.move_x(val);
                }
                (VMResult::Continue, pc + 1)
            }
            
            // ADD_Y
            0x45 => {
                let src = decode_reg_a(instr);
                let val = self.registers.get_number(src);
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.move_y(val);
                }
                (VMResult::Continue, pc + 1)
            }
            
            // SET_XY
            0x46 => {
                let x_reg = decode_reg_a(instr);
                let y_reg = decode_reg_b(instr);
                let x = self.registers.get_number(x_reg);
                let y = self.registers.get_number(y_reg);
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.x = x;
                    e.y = y;
                }
                (VMResult::Continue, pc + 1)
            }
            
            // ADD_XY (0x47)
            0x47 => {
                let x_reg = decode_reg_a(instr);
                let y_reg = decode_reg_b(instr);
                let dx = self.registers.get_number(x_reg);
                let dy = self.registers.get_number(y_reg);
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.x += dx;
                    e.y += dy;
                }
                (VMResult::Continue, pc + 1)
            }
            
            // Direction/Rotation operations
            // GET_DIR
            0x50 => {
                let dst = decode_reg_a(instr);
                if let Some(e) = self.entities.get(self.entity_idx) {
                    self.registers.set(dst, Value::Number(e.direction));
                }
                (VMResult::Continue, pc + 1)
            }
            
            // SET_DIR
            0x51 => {
                let src = decode_reg_a(instr);
                let val = self.registers.get_number(src);
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.direction = val;
                }
                (VMResult::Continue, pc + 1)
            }
            
            // ADD_DIR
            0x52 => {
                let src = decode_reg_a(instr);
                let val = self.registers.get_number(src);
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.direction += val;
                }
                (VMResult::Continue, pc + 1)
            }
            
            // GET_ROT
            0x53 => {
                let dst = decode_reg_a(instr);
                if let Some(e) = self.entities.get(self.entity_idx) {
                    self.registers.set(dst, Value::Number(e.rotation));
                }
                (VMResult::Continue, pc + 1)
            }
            
            // SET_ROT
            0x54 => {
                let src = decode_reg_a(instr);
                let val = self.registers.get_number(src);
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.rotation = val;
                }
                (VMResult::Continue, pc + 1)
            }
            
            // ADD_ROT
            0x55 => {
                let src = decode_reg_a(instr);
                let val = self.registers.get_number(src);
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.rotation += val;
                }
                (VMResult::Continue, pc + 1)
            }
            
            // MOVE_DIR - matches Entry JS: angle = (rotation + direction - 90), y -= sin(angle)
            0x56 => {
                let dist_reg = decode_reg_a(instr);
                let distance = self.registers.get_number(dist_reg);
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    // Use entity's move_direction which has the correct formula:
                    // angle = (rotation + direction - 90).to_radians()
                    // x += distance * cos(angle)
                    // y -= distance * sin(angle)  <- note: SUBTRACTION for Y
                    e.move_direction(distance);
                }
                (VMResult::Continue, pc + 1)
            }
            
            // BOUNCE_WALL (0x58)
            0x58 => {
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    // Stage bounds: -240 to 240 for X, -135 to 135 for Y (typical Entry stage)
                    let half_width = e.width * e.scale_x.abs() / 2.0;
                    let half_height = e.height * e.scale_y.abs() / 2.0;
                    
                    let mut bounced = false;
                    
                    // Check horizontal bounds
                    if e.x - half_width < -240.0 || e.x + half_width > 240.0 {
                        e.direction = 180.0 - e.direction;
                        bounced = true;
                        // Clamp position
                        if e.x - half_width < -240.0 {
                            e.x = -240.0 + half_width;
                        } else if e.x + half_width > 240.0 {
                            e.x = 240.0 - half_width;
                        }
                    }
                    
                    // Check vertical bounds
                    if e.y - half_height < -135.0 || e.y + half_height > 135.0 {
                        e.direction = -e.direction;
                        bounced = true;
                        // Clamp position
                        if e.y - half_height < -135.0 {
                            e.y = -135.0 + half_height;
                        } else if e.y + half_height > 135.0 {
                            e.y = 135.0 - half_height;
                        }
                    }
                    
                    if bounced {
                        // Normalize direction to 0-360
                        e.direction = e.direction.rem_euclid(360.0);
                    }
                }
                (VMResult::Continue, pc + 1)
            }
            
            // Appearance operations
            // SHOW
            0x60 => {
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.visible = true;
                }
                (VMResult::Continue, pc + 1)
            }
            
            // HIDE
            0x61 => {
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.visible = false;
                }
                (VMResult::Continue, pc + 1)
            }
            
            // NEXT_SHAPE
            0x62 => {
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.next_picture();
                }
                (VMResult::Continue, pc + 1)
            }
            
            // PREV_SHAPE
            0x63 => {
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.prev_picture();
                }
                (VMResult::Continue, pc + 1)
            }
            
            // SET_SHAPE (0x64)
            0x64 => {
                let src = decode_reg_a(instr);
                let val = self.registers.get(src);
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    match val {
                        Value::Number(n) => {
                            let idx = (*n as usize).saturating_sub(1); // 1-indexed to 0-indexed
                            if let Some(pic_id) = e.pictures.get(idx).cloned() {
                                e.set_picture(&pic_id);
                            }
                        }
                        Value::String(s) => {
                            // Try as picture ID first, then as name
                            if e.pictures.contains(s) {
                                e.set_picture(s);
                            } else if let Some(idx) = e.picture_names.iter().position(|n| n == s) {
                                if let Some(pic_id) = e.pictures.get(idx).cloned() {
                                    e.set_picture(&pic_id);
                                }
                            }
                        }
                        _ => {}
                    }
                }
                (VMResult::Continue, pc + 1)
            }
            
            // GET_SCALE
            0x65 => {
                let dst = decode_reg_a(instr);
                if let Some(e) = self.entities.get(self.entity_idx) {
                    self.registers.set(dst, Value::Number(e.scale_x * 100.0));
                }
                (VMResult::Continue, pc + 1)
            }
            
            // SET_SCALE
            0x66 => {
                let src = decode_reg_a(instr);
                let val = self.registers.get_number(src) / 100.0;
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.scale_x = val;
                    e.scale_y = val;
                }
                (VMResult::Continue, pc + 1)
            }
            
            // ADD_SCALE (0x67)
            0x67 => {
                let src = decode_reg_a(instr);
                let delta = self.registers.get_number(src) / 100.0;
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.scale_x += delta;
                    e.scale_y += delta;
                }
                (VMResult::Continue, pc + 1)
            }
            
            // SET_SCALE_XY (0x68)
            0x68 => {
                let x_reg = decode_reg_a(instr);
                let y_reg = decode_reg_b(instr);
                let sx = self.registers.get_number(x_reg) / 100.0;
                let sy = self.registers.get_number(y_reg) / 100.0;
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.scale_x = sx;
                    e.scale_y = sy;
                }
                (VMResult::Continue, pc + 1)
            }
            
            // FLIP_X (0x69)
            0x69 => {
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.scale_x = -e.scale_x;
                }
                (VMResult::Continue, pc + 1)
            }
            
            // FLIP_Y (0x6A)
            0x6A => {
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.scale_y = -e.scale_y;
                }
                (VMResult::Continue, pc + 1)
            }
            
            // SET_EFFECT (0x6B)
            0x6B => {
                let effect_type = decode_reg_a(instr);
                let value_reg = decode_reg_b(instr);
                let value = self.registers.get_number(value_reg);
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    match effect_type {
                        0 => e.brightness = value,      // brightness
                        1 => e.transparency = value.clamp(0.0, 100.0), // transparency
                        2 => e.color_effect = value,    // color
                        _ => {}
                    }
                }
                (VMResult::Continue, pc + 1)
            }
            
            // CHANGE_EFFECT (0x6C)
            0x6C => {
                let effect_type = decode_reg_a(instr);
                let value_reg = decode_reg_b(instr);
                let delta = self.registers.get_number(value_reg);
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    match effect_type {
                        0 => e.brightness += delta,
                        1 => e.transparency = (e.transparency + delta).clamp(0.0, 100.0),
                        2 => e.color_effect += delta,
                        _ => {}
                    }
                }
                (VMResult::Continue, pc + 1)
            }
            
            // CLEAR_EFFECT (0x6D)
            0x6D => {
                let effect_type = decode_reg_a(instr);
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    match effect_type {
                        0 => e.brightness = 0.0,
                        1 => e.transparency = 0.0,
                        2 => e.color_effect = 0.0,
                        _ => {}
                    }
                }
                (VMResult::Continue, pc + 1)
            }
            
            // CLEAR_ALL_EFFECTS (0x6E)
            0x6E => {
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.brightness = 0.0;
                    e.transparency = 0.0;
                    e.color_effect = 0.0;
                }
                (VMResult::Continue, pc + 1)
            }
            
            // CHANGE_INDEX (0x6F)
            0x6F => {
                let loc_reg = decode_reg_a(instr);
                let location = self.registers.get_string(loc_reg);
                self.js_actions.push(JsAction::ChangeObjectIndex {
                    entity_id: self.entity_idx,
                    location,
                });
                (VMResult::Continue, pc + 1)
            }
            
            // Arithmetic operations
            // ADD
            0x70 => {
                let dst = decode_reg_a(instr);
                let src1 = decode_reg_b(instr);
                let src2 = decode_reg_c(instr);
                let a = self.registers.get_number(src1);
                let b = self.registers.get_number(src2);
                self.registers.set(dst, Value::Number(a + b));
                (VMResult::Continue, pc + 1)
            }
            
            // SUB
            0x71 => {
                let dst = decode_reg_a(instr);
                let src1 = decode_reg_b(instr);
                let src2 = decode_reg_c(instr);
                let a = self.registers.get_number(src1);
                let b = self.registers.get_number(src2);
                self.registers.set(dst, Value::Number(a - b));
                (VMResult::Continue, pc + 1)
            }
            
            // MUL
            0x72 => {
                let dst = decode_reg_a(instr);
                let src1 = decode_reg_b(instr);
                let src2 = decode_reg_c(instr);
                let a = self.registers.get_number(src1);
                let b = self.registers.get_number(src2);
                self.registers.set(dst, Value::Number(a * b));
                (VMResult::Continue, pc + 1)
            }
            
            // DIV
            0x73 => {
                let dst = decode_reg_a(instr);
                let src1 = decode_reg_b(instr);
                let src2 = decode_reg_c(instr);
                let a = self.registers.get_number(src1);
                let b = self.registers.get_number(src2);
                let result = if b != 0.0 { a / b } else { 0.0 };
                self.registers.set(dst, Value::Number(result));
                (VMResult::Continue, pc + 1)
            }
            
            // MOD
            0x74 => {
                let dst = decode_reg_a(instr);
                let src1 = decode_reg_b(instr);
                let src2 = decode_reg_c(instr);
                let a = self.registers.get_number(src1);
                let b = self.registers.get_number(src2);
                let result = if b != 0.0 { a % b } else { 0.0 };
                self.registers.set(dst, Value::Number(result));
                (VMResult::Continue, pc + 1)
            }
            
            // NEG
            0x75 => {
                let dst = decode_reg_a(instr);
                let src = decode_reg_b(instr);
                let val = self.registers.get_number(src);
                self.registers.set(dst, Value::Number(-val));
                (VMResult::Continue, pc + 1)
            }
            
            // ABS
            0x76 => {
                let dst = decode_reg_a(instr);
                let src = decode_reg_b(instr);
                let val = self.registers.get_number(src);
                self.registers.set(dst, Value::Number(val.abs()));
                (VMResult::Continue, pc + 1)
            }
            
            // FLOOR
            0x77 => {
                let dst = decode_reg_a(instr);
                let src = decode_reg_b(instr);
                let val = self.registers.get_number(src);
                self.registers.set(dst, Value::Number(val.floor()));
                (VMResult::Continue, pc + 1)
            }
            
            // CEIL
            0x78 => {
                let dst = decode_reg_a(instr);
                let src = decode_reg_b(instr);
                let val = self.registers.get_number(src);
                self.registers.set(dst, Value::Number(val.ceil()));
                (VMResult::Continue, pc + 1)
            }
            
            // ROUND
            0x79 => {
                let dst = decode_reg_a(instr);
                let src = decode_reg_b(instr);
                let val = self.registers.get_number(src);
                self.registers.set(dst, Value::Number(val.round()));
                (VMResult::Continue, pc + 1)
            }
            
            // SQRT
            0x7A => {
                let dst = decode_reg_a(instr);
                let src = decode_reg_b(instr);
                let val = self.registers.get_number(src);
                self.registers.set(dst, Value::Number(val.sqrt()));
                (VMResult::Continue, pc + 1)
            }
            
            // SIN (degrees)
            0x7B => {
                let dst = decode_reg_a(instr);
                let src = decode_reg_b(instr);
                let val = self.registers.get_number(src).to_radians();
                self.registers.set(dst, Value::Number(val.sin()));
                (VMResult::Continue, pc + 1)
            }
            
            // COS (degrees)
            0x7C => {
                let dst = decode_reg_a(instr);
                let src = decode_reg_b(instr);
                let val = self.registers.get_number(src).to_radians();
                self.registers.set(dst, Value::Number(val.cos()));
                (VMResult::Continue, pc + 1)
            }
            
            // TAN (degrees)
            0x7D => {
                let dst = decode_reg_a(instr);
                let src = decode_reg_b(instr);
                let val = self.registers.get_number(src).to_radians();
                self.registers.set(dst, Value::Number(val.tan()));
                (VMResult::Continue, pc + 1)
            }
            
            // ASIN (0x7E) - returns degrees
            0x7E => {
                let dst = decode_reg_a(instr);
                let src = decode_reg_b(instr);
                let val = self.registers.get_number(src).clamp(-1.0, 1.0);
                self.registers.set(dst, Value::Number(val.asin().to_degrees()));
                (VMResult::Continue, pc + 1)
            }
            
            // ACOS (0x7F) - returns degrees
            0x7F => {
                let dst = decode_reg_a(instr);
                let src = decode_reg_b(instr);
                let val = self.registers.get_number(src).clamp(-1.0, 1.0);
                self.registers.set(dst, Value::Number(val.acos().to_degrees()));
                (VMResult::Continue, pc + 1)
            }
            
            // ATAN (0x80) - returns degrees
            0x80 => {
                let dst = decode_reg_a(instr);
                let src = decode_reg_b(instr);
                let val = self.registers.get_number(src);
                self.registers.set(dst, Value::Number(val.atan().to_degrees()));
                (VMResult::Continue, pc + 1)
            }
            
            // LN (0x81) - natural logarithm
            0x81 => {
                let dst = decode_reg_a(instr);
                let src = decode_reg_b(instr);
                let val = self.registers.get_number(src);
                let result = if val > 0.0 { val.ln() } else { f64::NAN };
                self.registers.set(dst, Value::Number(result));
                (VMResult::Continue, pc + 1)
            }
            
            // LOG10 (0x82) - base 10 logarithm
            0x82 => {
                let dst = decode_reg_a(instr);
                let src = decode_reg_b(instr);
                let val = self.registers.get_number(src);
                let result = if val > 0.0 { val.log10() } else { f64::NAN };
                self.registers.set(dst, Value::Number(result));
                (VMResult::Continue, pc + 1)
            }
            
            // EXP (0x83) - e^x
            0x83 => {
                let dst = decode_reg_a(instr);
                let src = decode_reg_b(instr);
                let val = self.registers.get_number(src);
                self.registers.set(dst, Value::Number(val.exp()));
                (VMResult::Continue, pc + 1)
            }
            
            // POW (0x84) - base^exp
            0x84 => {
                let dst = decode_reg_a(instr);
                let base_reg = decode_reg_b(instr);
                let exp_reg = decode_reg_c(instr);
                let base = self.registers.get_number(base_reg);
                let exp = self.registers.get_number(exp_reg);
                self.registers.set(dst, Value::Number(base.powf(exp)));
                (VMResult::Continue, pc + 1)
            }
            
            // RAND
            0x85 => {
                let dst = decode_reg_a(instr);
                let min_reg = decode_reg_b(instr);
                let max_reg = decode_reg_c(instr);
                let min = self.registers.get_number(min_reg);
                let max = self.registers.get_number(max_reg);
                // Simple random using timestamp-based seed
                let rand_val = min + (max - min) * rand_f64();
                self.registers.set(dst, Value::Number(rand_val.floor()));
                (VMResult::Continue, pc + 1)
            }
            
            // QUOT (integer quotient)
            0x86 => {
                let dst = decode_reg_a(instr);
                let src1 = decode_reg_b(instr);
                let src2 = decode_reg_c(instr);
                let a = self.registers.get_number(src1) as i64;
                let b = self.registers.get_number(src2) as i64;
                let result = if b != 0 { a / b } else { 0 };
                self.registers.set(dst, Value::Number(result as f64));
                (VMResult::Continue, pc + 1)
            }
            
            // ADDI (0x87) - add immediate
            0x87 => {
                let dst = decode_reg_a(instr);
                let src = decode_reg_b(instr);
                let imm = decode_reg_c(instr) as i8 as f64; // treat as signed
                let val = self.registers.get_number(src);
                self.registers.set(dst, Value::Number(val + imm));
                (VMResult::Continue, pc + 1)
            }
            
            // SUBI (0x88) - subtract immediate
            0x88 => {
                let dst = decode_reg_a(instr);
                let src = decode_reg_b(instr);
                let imm = decode_reg_c(instr) as i8 as f64;
                let val = self.registers.get_number(src);
                self.registers.set(dst, Value::Number(val - imm));
                (VMResult::Continue, pc + 1)
            }
            
            // MULI (0x89) - multiply immediate
            0x89 => {
                let dst = decode_reg_a(instr);
                let src = decode_reg_b(instr);
                let imm = decode_reg_c(instr) as i8 as f64;
                let val = self.registers.get_number(src);
                self.registers.set(dst, Value::Number(val * imm));
                (VMResult::Continue, pc + 1)
            }
            
            // Comparison operations
            // EQ
            0x90 => {
                let dst = decode_reg_a(instr);
                let src1 = decode_reg_b(instr);
                let src2 = decode_reg_c(instr);
                let a = self.registers.get_number(src1);
                let b = self.registers.get_number(src2);
                self.registers.set(dst, Value::Bool((a - b).abs() < f64::EPSILON));
                (VMResult::Continue, pc + 1)
            }
            
            // NE
            0x91 => {
                let dst = decode_reg_a(instr);
                let src1 = decode_reg_b(instr);
                let src2 = decode_reg_c(instr);
                let a = self.registers.get_number(src1);
                let b = self.registers.get_number(src2);
                self.registers.set(dst, Value::Bool((a - b).abs() >= f64::EPSILON));
                (VMResult::Continue, pc + 1)
            }
            
            // LT
            0x92 => {
                let dst = decode_reg_a(instr);
                let src1 = decode_reg_b(instr);
                let src2 = decode_reg_c(instr);
                let a = self.registers.get_number(src1);
                let b = self.registers.get_number(src2);
                self.registers.set(dst, Value::Bool(a < b));
                (VMResult::Continue, pc + 1)
            }
            
            // LE
            0x93 => {
                let dst = decode_reg_a(instr);
                let src1 = decode_reg_b(instr);
                let src2 = decode_reg_c(instr);
                let a = self.registers.get_number(src1);
                let b = self.registers.get_number(src2);
                self.registers.set(dst, Value::Bool(a <= b));
                (VMResult::Continue, pc + 1)
            }
            
            // GT
            0x94 => {
                let dst = decode_reg_a(instr);
                let src1 = decode_reg_b(instr);
                let src2 = decode_reg_c(instr);
                let a = self.registers.get_number(src1);
                let b = self.registers.get_number(src2);
                self.registers.set(dst, Value::Bool(a > b));
                (VMResult::Continue, pc + 1)
            }
            
            // GE
            0x95 => {
                let dst = decode_reg_a(instr);
                let src1 = decode_reg_b(instr);
                let src2 = decode_reg_c(instr);
                let a = self.registers.get_number(src1);
                let b = self.registers.get_number(src2);
                self.registers.set(dst, Value::Bool(a >= b));
                (VMResult::Continue, pc + 1)
            }
            
            // AND
            0x96 => {
                let dst = decode_reg_a(instr);
                let src1 = decode_reg_b(instr);
                let src2 = decode_reg_c(instr);
                let a = self.registers.get_bool(src1);
                let b = self.registers.get_bool(src2);
                self.registers.set(dst, Value::Bool(a && b));
                (VMResult::Continue, pc + 1)
            }
            
            // OR
            0x97 => {
                let dst = decode_reg_a(instr);
                let src1 = decode_reg_b(instr);
                let src2 = decode_reg_c(instr);
                let a = self.registers.get_bool(src1);
                let b = self.registers.get_bool(src2);
                self.registers.set(dst, Value::Bool(a || b));
                (VMResult::Continue, pc + 1)
            }
            
            // NOT
            0x98 => {
                let dst = decode_reg_a(instr);
                let src = decode_reg_b(instr);
                let val = self.registers.get_bool(src);
                self.registers.set(dst, Value::Bool(!val));
                (VMResult::Continue, pc + 1)
            }
            
            // String operations
            // CONCAT
            0xA0 => {
                let dst = decode_reg_a(instr);
                let src1 = decode_reg_b(instr);
                let src2 = decode_reg_c(instr);
                let a = self.registers.get_string(src1);
                let b = self.registers.get_string(src2);
                self.registers.set(dst, Value::String(a + &b));
                (VMResult::Continue, pc + 1)
            }
            
            // STRLEN
            0xA1 => {
                let dst = decode_reg_a(instr);
                let src = decode_reg_b(instr);
                let s = self.registers.get_string(src);
                self.registers.set(dst, Value::Number(s.chars().count() as f64));
                (VMResult::Continue, pc + 1)
            }
            
            // SUBSTR (0xA2) - dst = str[start..start+len]
            0xA2 => {
                let dst = decode_reg_a(instr);
                let str_reg = decode_reg_b(instr);
                let start_reg = decode_reg_c(instr);
                // Length is in next instruction or use convention
                let s = self.registers.get_string(str_reg);
                let start = (self.registers.get_number(start_reg) as usize).saturating_sub(1); // 1-indexed
                let chars: Vec<char> = s.chars().collect();
                // Default: get rest of string from start
                let result: String = chars.iter().skip(start).collect();
                self.registers.set(dst, Value::String(result));
                (VMResult::Continue, pc + 1)
            }
            
            // CHAR_AT (0xA3) - dst = str[idx]
            0xA3 => {
                let dst = decode_reg_a(instr);
                let str_reg = decode_reg_b(instr);
                let idx_reg = decode_reg_c(instr);
                let s = self.registers.get_string(str_reg);
                let idx = (self.registers.get_number(idx_reg) as usize).saturating_sub(1); // 1-indexed
                let result = s.chars().nth(idx).map(|c| c.to_string()).unwrap_or_default();
                self.registers.set(dst, Value::String(result));
                (VMResult::Continue, pc + 1)
            }
            
            // INDEX_OF (0xA4) - dst = str.indexOf(substr)
            0xA4 => {
                let dst = decode_reg_a(instr);
                let str_reg = decode_reg_b(instr);
                let substr_reg = decode_reg_c(instr);
                let s = self.registers.get_string(str_reg);
                let substr = self.registers.get_string(substr_reg);
                let result = s.find(&substr).map(|i| i as f64 + 1.0).unwrap_or(0.0); // 1-indexed, 0 if not found
                self.registers.set(dst, Value::Number(result));
                (VMResult::Continue, pc + 1)
            }
            
            // REPLACE (0xA5) - dst = str.replace(old, new) - uses next few registers
            0xA5 => {
                let dst = decode_reg_a(instr);
                let str_reg = decode_reg_b(instr);
                let old_reg = decode_reg_c(instr);
                // new_reg follows (convention: old_reg + 1)
                let s = self.registers.get_string(str_reg);
                let old = self.registers.get_string(old_reg);
                let new = self.registers.get_string(old_reg.wrapping_add(1));
                let result = s.replace(&old, &new);
                self.registers.set(dst, Value::String(result));
                (VMResult::Continue, pc + 1)
            }
            
            // CHANGE_CASE (0xA6) - dst = upper/lower case
            0xA6 => {
                let dst = decode_reg_a(instr);
                let src = decode_reg_b(instr);
                let case_type = decode_reg_c(instr); // 0 = upper, 1 = lower
                let s = self.registers.get_string(src);
                let result = if case_type == 0 {
                    s.to_uppercase()
                } else {
                    s.to_lowercase()
                };
                self.registers.set(dst, Value::String(result));
                (VMResult::Continue, pc + 1)
            }
            
            // REVERSE_STR (0xA7)
            0xA7 => {
                let dst = decode_reg_a(instr);
                let src = decode_reg_b(instr);
                let s = self.registers.get_string(src);
                let result: String = s.chars().rev().collect();
                self.registers.set(dst, Value::String(result));
                (VMResult::Continue, pc + 1)
            }
            
            // TO_STRING (0xA9)
            0xA9 => {
                let dst = decode_reg_a(instr);
                let src = decode_reg_b(instr);
                let result = self.registers.get_string(src);
                self.registers.set(dst, Value::String(result));
                (VMResult::Continue, pc + 1)
            }
            
            // TO_NUMBER (0xAA)
            0xAA => {
                let dst = decode_reg_a(instr);
                let src = decode_reg_b(instr);
                let result = self.registers.get_number(src);
                self.registers.set(dst, Value::Number(result));
                (VMResult::Continue, pc + 1)
            }
            
            // ============ List Operations ============
            
            // LIST_GET (0xB0) - dst = list[idx]
            0xB0 => {
                let dst = decode_reg_a(instr);
                let list_reg = decode_reg_b(instr);
                let idx_reg = decode_reg_c(instr);
                let idx = (self.registers.get_number(idx_reg) as usize).saturating_sub(1); // 1-indexed
                let result = if let Value::List(list) = self.registers.get(list_reg) {
                    list.get(idx).cloned().unwrap_or(Value::Null)
                } else {
                    Value::Null
                };
                self.registers.set(dst, result);
                (VMResult::Continue, pc + 1)
            }
            
            // LIST_SET (0xB1) - list[idx] = value
            0xB1 => {
                let list_reg = decode_reg_a(instr);
                let idx_reg = decode_reg_b(instr);
                let value_reg = decode_reg_c(instr);
                let idx = (self.registers.get_number(idx_reg) as usize).saturating_sub(1); // 1-indexed
                let value = self.registers.get(value_reg).clone();
                if let Value::List(list) = self.registers.get_mut(list_reg) {
                    if idx < list.len() {
                        list[idx] = value;
                    }
                }
                (VMResult::Continue, pc + 1)
            }
            
            // LIST_PUSH (0xB2) - list.push(value)
            0xB2 => {
                let list_reg = decode_reg_a(instr);
                let value_reg = decode_reg_b(instr);
                let value = self.registers.get(value_reg).clone();
                if let Value::List(list) = self.registers.get_mut(list_reg) {
                    list.push(value);
                }
                (VMResult::Continue, pc + 1)
            }
            
            // LIST_DEL (0xB3) - list.remove(idx)
            0xB3 => {
                let list_reg = decode_reg_a(instr);
                let idx_reg = decode_reg_b(instr);
                let idx = (self.registers.get_number(idx_reg) as usize).saturating_sub(1); // 1-indexed
                if let Value::List(list) = self.registers.get_mut(list_reg) {
                    if idx < list.len() {
                        list.remove(idx);
                    }
                }
                (VMResult::Continue, pc + 1)
            }
            
            // LIST_LEN (0xB4) - dst = list.len()
            0xB4 => {
                let dst = decode_reg_a(instr);
                let list_reg = decode_reg_b(instr);
                let len = if let Value::List(list) = self.registers.get(list_reg) {
                    list.len() as f64
                } else {
                    0.0
                };
                self.registers.set(dst, Value::Number(len));
                (VMResult::Continue, pc + 1)
            }
            
            // LIST_CONTAINS (0xB5) - dst = list.contains(value)
            0xB5 => {
                let dst = decode_reg_a(instr);
                let list_reg = decode_reg_b(instr);
                let value_reg = decode_reg_c(instr);
                let value = self.registers.get(value_reg);
                let contains = if let Value::List(list) = self.registers.get(list_reg) {
                    list.iter().any(|item| values_equal(item, value))
                } else {
                    false
                };
                self.registers.set(dst, Value::Bool(contains));
                (VMResult::Continue, pc + 1)
            }
            
            // LIST_INSERT (0xB6) - list.insert(idx, value)
            0xB6 => {
                let list_reg = decode_reg_a(instr);
                let idx_reg = decode_reg_b(instr);
                let value_reg = decode_reg_c(instr);
                let idx = (self.registers.get_number(idx_reg) as usize).saturating_sub(1); // 1-indexed
                let value = self.registers.get(value_reg).clone();
                if let Value::List(list) = self.registers.get_mut(list_reg) {
                    let insert_idx = idx.min(list.len());
                    list.insert(insert_idx, value);
                }
                (VMResult::Continue, pc + 1)
            }
            
            // LIST_INDEX_OF (0xB7) - dst = list.indexOf(value)
            0xB7 => {
                let dst = decode_reg_a(instr);
                let list_reg = decode_reg_b(instr);
                let value_reg = decode_reg_c(instr);
                let value = self.registers.get(value_reg);
                let idx = if let Value::List(list) = self.registers.get(list_reg) {
                    list.iter().position(|item| values_equal(item, value))
                        .map(|i| i as f64 + 1.0) // 1-indexed
                        .unwrap_or(0.0)
                } else {
                    0.0
                };
                self.registers.set(dst, Value::Number(idx));
                (VMResult::Continue, pc + 1)
            }
            
            // LIST_NEW (0xB8) - dst = []
            0xB8 => {
                let dst = decode_reg_a(instr);
                self.registers.set(dst, Value::List(Vec::new()));
                (VMResult::Continue, pc + 1)
            }
            
            // LIST_CLEAR (0xB9) - list.clear()
            0xB9 => {
                let list_reg = decode_reg_a(instr);
                if let Value::List(list) = self.registers.get_mut(list_reg) {
                    list.clear();
                }
                (VMResult::Continue, pc + 1)
            }
            
            // ============ Sound Actions ============
            
            // PLAY_SOUND (0xC0)
            0xC0 => {
                let id_reg = decode_reg_a(instr);
                let sound_id = self.registers.get_string(id_reg);
                self.js_actions.push(JsAction::PlaySound {
                    entity_id: self.entity_idx,
                    sound_id,
                });
                (VMResult::Continue, pc + 1)
            }
            
            // PLAY_SOUND_WAIT (0xC1)
            0xC1 => {
                let id_reg = decode_reg_a(instr);
                let sound_id = self.registers.get_string(id_reg);
                self.js_actions.push(JsAction::PlaySoundWait {
                    entity_id: self.entity_idx,
                    sound_id,
                });
                (VMResult::Yield, pc + 1)
            }
            
            // SET_VOLUME (0xC4)
            0xC4 => {
                let src = decode_reg_a(instr);
                let volume = self.registers.get_number(src);
                self.js_actions.push(JsAction::SetSoundVolume { volume });
                (VMResult::Continue, pc + 1)
            }
            
            // CHANGE_VOLUME (0xC5)
            0xC5 => {
                let src = decode_reg_a(instr);
                let delta = self.registers.get_number(src);
                self.js_actions.push(JsAction::ChangeSoundVolume { delta });
                (VMResult::Continue, pc + 1)
            }
            
            // STOP_SOUND (0xC6)
            0xC6 => {
                self.js_actions.push(JsAction::StopAllSounds);
                (VMResult::Continue, pc + 1)
            }
            
            // PLAY_BGM (0xC7)
            0xC7 => {
                let id_reg = decode_reg_a(instr);
                let sound_id = self.registers.get_string(id_reg);
                self.js_actions.push(JsAction::PlayBGM {
                    entity_id: self.entity_idx,
                    sound_id,
                });
                (VMResult::Continue, pc + 1)
            }
            
            // ============ Dialog/UI ============
            
            // DIALOG (0xC8)
            0xC8 => {
                let msg_reg = decode_reg_a(instr);
                let mode_reg = decode_reg_b(instr);
                let message = self.registers.get_string(msg_reg);
                let mode = self.registers.get_string(mode_reg);
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.dialog_message = Some(message.clone());
                    e.dialog_mode = Some(mode.clone());
                }
                self.js_actions.push(JsAction::ShowDialog {
                    entity_id: self.entity_idx,
                    message,
                    mode,
                });
                (VMResult::Continue, pc + 1)
            }
            
            // DIALOG_TIME (0xC9)
            0xC9 => {
                let msg_reg = decode_reg_a(instr);
                let mode_reg = decode_reg_b(instr);
                let time_reg = decode_reg_c(instr);
                let message = self.registers.get_string(msg_reg);
                let mode = self.registers.get_string(mode_reg);
                let time = self.registers.get_number(time_reg);
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.dialog_message = Some(message.clone());
                    e.dialog_mode = Some(mode.clone());
                }
                self.js_actions.push(JsAction::ShowDialog {
                    entity_id: self.entity_idx,
                    message,
                    mode,
                });
                let frames = (time * 60.0).max(1.0) as u32;
                (VMResult::Wait(frames), pc + 1)
            }
            
            // REMOVE_DIALOG (0xCA)
            0xCA => {
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.dialog_message = None;
                    e.dialog_mode = None;
                }
                self.js_actions.push(JsAction::RemoveDialog {
                    entity_id: self.entity_idx,
                });
                (VMResult::Continue, pc + 1)
            }
            
            // ASK (0xCB)
            0xCB => {
                let msg_reg = decode_reg_a(instr);
                let message = self.registers.get_string(msg_reg);
                self.js_actions.push(JsAction::AskAndWait {
                    entity_id: self.entity_idx,
                    message,
                });
                (VMResult::Yield, pc + 1)
            }
            
            // GET_ANSWER (0xCC)
            0xCC => {
                let dst = decode_reg_a(instr);
                self.registers.set(dst, Value::String(self.answer.clone()));
                (VMResult::Continue, pc + 1)
            }
            
            // ============ Clone/Entity ============
            
            // CLONE (0xD0)
            0xD0 => {
                let target_reg = decode_reg_a(instr);
                let target = self.registers.get_string(target_reg);
                self.js_actions.push(JsAction::CreateClone {
                    entity_id: self.entity_idx,
                    target,
                });
                (VMResult::Continue, pc + 1)
            }
            
            // DELETE_CLONE (0xD1)
            0xD1 => {
                self.js_actions.push(JsAction::DeleteClone {
                    entity_id: self.entity_idx,
                });
                (VMResult::End, pc)
            }
            
            // DELETE_ALL_CLONES (0xD2)
            0xD2 => {
                self.js_actions.push(JsAction::RemoveAllClones);
                (VMResult::Continue, pc + 1)
            }
            
            // SEND_MSG (0xD3)
            0xD3 => {
                let msg_reg = decode_reg_a(instr);
                let message_id = self.registers.get_string(msg_reg);
                self.js_actions.push(JsAction::MessageCast { message_id });
                (VMResult::Continue, pc + 1)
            }
            
            // SEND_MSG_WAIT (0xD4)
            0xD4 => {
                let msg_reg = decode_reg_a(instr);
                let message_id = self.registers.get_string(msg_reg);
                self.js_actions.push(JsAction::MessageCastWait { message_id });
                (VMResult::Yield, pc + 1)
            }
            
            // START_SCENE (0xD5)
            0xD5 => {
                let scene_reg = decode_reg_a(instr);
                let scene_id = self.registers.get_string(scene_reg);
                self.js_actions.push(JsAction::StartScene { scene_id });
                (VMResult::End, pc)
            }
            
            // START_NEXT_SCENE (0xD6)
            0xD6 => {
                self.js_actions.push(JsAction::StartNextScene);
                (VMResult::End, pc)
            }
            
            // START_PREV_SCENE (0xD7)
            0xD7 => {
                self.js_actions.push(JsAction::StartPreviousScene);
                (VMResult::End, pc)
            }
            
            // ============ Brush/Drawing ============
            
            // BRUSH_DOWN (0xD8)
            0xD8 => {
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.brush_down = true;
                    e.frame_brush_path.push((e.x, e.y));
                }
                self.js_actions.push(JsAction::StartDrawing {
                    entity_id: self.entity_idx,
                    x: self.entities.get(self.entity_idx).map(|e| e.x).unwrap_or(0.0),
                    y: self.entities.get(self.entity_idx).map(|e| e.y).unwrap_or(0.0),
                });
                (VMResult::Continue, pc + 1)
            }
            
            // BRUSH_UP (0xD9)
            0xD9 => {
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.brush_down = false;
                }
                self.js_actions.push(JsAction::StopDrawing {
                    entity_id: self.entity_idx,
                });
                (VMResult::Continue, pc + 1)
            }
            
            // STAMP (0xDA)
            0xDA => {
                self.js_actions.push(JsAction::BrushStamp {
                    entity_id: self.entity_idx,
                });
                (VMResult::Continue, pc + 1)
            }
            
            // SET_BRUSH_COLOR (0xDB)
            0xDB => {
                let color_reg = decode_reg_a(instr);
                let color = self.registers.get_string(color_reg);
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.brush_color = color.clone();
                }
                self.js_actions.push(JsAction::SetBrushColor {
                    entity_id: self.entity_idx,
                    color,
                });
                (VMResult::Continue, pc + 1)
            }
            
            // SET_BRUSH_SIZE (0xDC)
            0xDC => {
                let size_reg = decode_reg_a(instr);
                let thickness = self.registers.get_number(size_reg);
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.brush_size = thickness;
                }
                self.js_actions.push(JsAction::SetThickness {
                    entity_id: self.entity_idx,
                    thickness,
                });
                (VMResult::Continue, pc + 1)
            }
            
            // BRUSH_ERASE_ALL (0xDD)
            0xDD => {
                self.js_actions.push(JsAction::BrushEraseAll {
                    entity_id: self.entity_idx,
                });
                (VMResult::Continue, pc + 1)
            }
            
            // START_FILL (0xDE)
            0xDE => {
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.fill_down = true;
                    e.frame_fill_path.push((e.x, e.y));
                }
                self.js_actions.push(JsAction::StartFill {
                    entity_id: self.entity_idx,
                    x: self.entities.get(self.entity_idx).map(|e| e.x).unwrap_or(0.0),
                    y: self.entities.get(self.entity_idx).map(|e| e.y).unwrap_or(0.0),
                });
                (VMResult::Continue, pc + 1)
            }
            
            // STOP_FILL (0xDF)
            0xDF => {
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.fill_down = false;
                }
                self.js_actions.push(JsAction::StopFill {
                    entity_id: self.entity_idx,
                });
                (VMResult::Continue, pc + 1)
            }
            
            // ============ Timer/Project ============
            
            // TIMER_ACTION (0xE0)
            0xE0 => {
                let action_type = decode_reg_a(instr);
                let action = match action_type {
                    0 => "start",
                    1 => "stop",
                    2 => "reset",
                    _ => "start",
                };
                self.js_actions.push(JsAction::TimerAction {
                    action: action.to_string(),
                });
                (VMResult::Continue, pc + 1)
            }
            
            // SET_TIMER_VISIBLE (0xE1)
            0xE1 => {
                let visible_reg = decode_reg_a(instr);
                let visible = self.registers.get_bool(visible_reg);
                self.js_actions.push(JsAction::SetTimerVisible { visible });
                (VMResult::Continue, pc + 1)
            }
            
            // STOP_ALL (0xE3)
            0xE3 => {
                self.js_actions.push(JsAction::StopAll);
                (VMResult::End, pc)
            }
            
            // STOP_THIS (0xE4)
            0xE4 => {
                self.js_actions.push(JsAction::StopEntity {
                    entity_id: self.entity_idx,
                });
                (VMResult::End, pc)
            }
            
            // STOP_OTHER (0xE5)
            0xE5 => {
                self.js_actions.push(JsAction::StopOtherEntities {
                    entity_id: self.entity_idx,
                });
                (VMResult::Continue, pc + 1)
            }
            
            // RESTART (0xE6)
            0xE6 => {
                self.js_actions.push(JsAction::RestartProject);
                (VMResult::End, pc)
            }
            
            // Input/Sensors
            // GET_MOUSE_X
            0xE8 => {
                let dst = decode_reg_a(instr);
                self.registers.set(dst, Value::Number(self.mouse_x));
                (VMResult::Continue, pc + 1)
            }
            
            // GET_MOUSE_Y
            0xE9 => {
                let dst = decode_reg_a(instr);
                self.registers.set(dst, Value::Number(self.mouse_y));
                (VMResult::Continue, pc + 1)
            }
            
            // GET_TIMER
            0xE2 => {
                let dst = decode_reg_a(instr);
                self.registers.set(dst, Value::Number(self.timer_value));
                (VMResult::Continue, pc + 1)
            }
            
            // IS_MOUSE_CLICKED (0xEA)
            0xEA => {
                let dst = decode_reg_a(instr);
                self.registers.set(dst, Value::Bool(self.mouse_clicked));
                (VMResult::Continue, pc + 1)
            }
            
            // IS_KEY_PRESSED (0xEB)
            0xEB => {
                let dst = decode_reg_a(instr);
                let key_reg = decode_reg_b(instr);
                let key_code = self.registers.get_number(key_reg) as u32;
                let pressed = self.pressed_keys.contains(&key_code);
                self.registers.set(dst, Value::Bool(pressed));
                (VMResult::Continue, pc + 1)
            }
            
            // IS_TOUCHING (0xEC)
            0xEC => {
                let dst = decode_reg_a(instr);
                let target_reg = decode_reg_b(instr);
                let target = self.registers.get_string(target_reg);
                
                let touching = if let Some(e) = self.entities.get(self.entity_idx) {
                    if target == "edge" || target == "wall" {
                        // Check if touching edge
                        let half_w = e.width * e.scale_x.abs() / 2.0;
                        let half_h = e.height * e.scale_y.abs() / 2.0;
                        e.x - half_w <= -240.0 || e.x + half_w >= 240.0 ||
                        e.y - half_h <= -135.0 || e.y + half_h >= 135.0
                    } else if target == "mouse" {
                        // Check if touching mouse
                        let half_w = e.width * e.scale_x.abs() / 2.0;
                        let half_h = e.height * e.scale_y.abs() / 2.0;
                        self.mouse_x >= e.x - half_w && self.mouse_x <= e.x + half_w &&
                        self.mouse_y >= e.y - half_h && self.mouse_y <= e.y + half_h
                    } else {
                        // Check if touching another entity
                        let mut result = false;
                        for other in self.entities.iter() {
                            if other.object_id == target && other.id != e.id && other.visible {
                                let e_half_w = e.width * e.scale_x.abs() / 2.0;
                                let e_half_h = e.height * e.scale_y.abs() / 2.0;
                                let o_half_w = other.width * other.scale_x.abs() / 2.0;
                                let o_half_h = other.height * other.scale_y.abs() / 2.0;
                                
                                if (e.x - e_half_w < other.x + o_half_w) &&
                                   (e.x + e_half_w > other.x - o_half_w) &&
                                   (e.y - e_half_h < other.y + o_half_h) &&
                                   (e.y + e_half_h > other.y - o_half_h) {
                                    result = true;
                                    break;
                                }
                            }
                        }
                        result
                    }
                } else {
                    false
                };
                self.registers.set(dst, Value::Bool(touching));
                (VMResult::Continue, pc + 1)
            }
            
            // GET_DISTANCE (0xED)
            0xED => {
                let dst = decode_reg_a(instr);
                let target_reg = decode_reg_b(instr);
                let target = self.registers.get_string(target_reg);
                
                let distance = if let Some(e) = self.entities.get(self.entity_idx) {
                    if target == "mouse" {
                        let dx = self.mouse_x - e.x;
                        let dy = self.mouse_y - e.y;
                        (dx * dx + dy * dy).sqrt()
                    } else {
                        // Find target entity
                        let mut min_dist = f64::MAX;
                        for other in self.entities.iter() {
                            if other.object_id == target && other.id != e.id && other.visible {
                                let dx = other.x - e.x;
                                let dy = other.y - e.y;
                                let dist = (dx * dx + dy * dy).sqrt();
                                if dist < min_dist {
                                    min_dist = dist;
                                }
                            }
                        }
                        if min_dist == f64::MAX { 0.0 } else { min_dist }
                    }
                } else {
                    0.0
                };
                self.registers.set(dst, Value::Number(distance));
                (VMResult::Continue, pc + 1)
            }
            
            // GET_DATE (0xEE)
            0xEE => {
                let dst = decode_reg_a(instr);
                let type_reg = decode_reg_b(instr);
                let date_type = self.registers.get_number(type_reg) as u32;
                
                use std::time::{SystemTime, UNIX_EPOCH};
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                
                // Simple date calculation (approximate)
                let secs_per_day = 86400u64;
                let secs_per_hour = 3600u64;
                let secs_per_min = 60u64;
                
                let result = match date_type {
                    0 => ((now / (secs_per_day * 365)) + 1970) as f64, // year (approximate)
                    1 => (((now / secs_per_day) % 365) / 30 + 1) as f64, // month (approximate)
                    2 => ((now / secs_per_day) % 30 + 1) as f64, // day (approximate)
                    3 => ((now / secs_per_hour) % 24) as f64, // hour
                    4 => ((now / secs_per_min) % 60) as f64, // minute
                    5 => (now % 60) as f64, // second
                    _ => 0.0,
                };
                self.registers.set(dst, Value::Number(result));
                (VMResult::Continue, pc + 1)
            }
            
            // GET_OBJ_COORD (0xEF)
            0xEF => {
                let dst = decode_reg_a(instr);
                let obj_reg = decode_reg_b(instr);
                let coord_type = decode_reg_c(instr);
                let obj_id = self.registers.get_string(obj_reg);
                
                let result = if obj_id == "mouse" {
                    match coord_type {
                        0 => self.mouse_x,
                        1 => self.mouse_y,
                        _ => 0.0,
                    }
                } else {
                    // Find entity by object_id
                    let mut val = 0.0;
                    for e in self.entities.iter() {
                        if e.object_id == obj_id {
                            val = match coord_type {
                                0 => e.x,
                                1 => e.y,
                                2 => e.direction,
                                3 => e.rotation,
                                4 => e.scale_x * 100.0,
                                _ => 0.0,
                            };
                            break;
                        }
                    }
                    val
                };
                self.registers.set(dst, Value::Number(result));
                (VMResult::Continue, pc + 1)
            }
            
            // ============ Text Object ============
            
            // TEXT_SET (0xF0)
            0xF0 => {
                let src = decode_reg_a(instr);
                let text = self.registers.get_string(src);
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.text = Some(text);
                }
                (VMResult::Continue, pc + 1)
            }
            
            // TEXT_APPEND (0xF1)
            0xF1 => {
                let src = decode_reg_a(instr);
                let append_text = self.registers.get_string(src);
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    let current = e.text.clone().unwrap_or_default();
                    e.text = Some(current + &append_text);
                }
                (VMResult::Continue, pc + 1)
            }
            
            // TEXT_PREPEND (0xF2)
            0xF2 => {
                let src = decode_reg_a(instr);
                let prepend_text = self.registers.get_string(src);
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    let current = e.text.clone().unwrap_or_default();
                    e.text = Some(prepend_text + &current);
                }
                (VMResult::Continue, pc + 1)
            }
            
            // TEXT_CLEAR (0xF3)
            0xF3 => {
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.text = Some(String::new());
                }
                (VMResult::Continue, pc + 1)
            }
            
            // TEXT_FONT (0xF4)
            0xF4 => {
                let font_reg = decode_reg_a(instr);
                let font = self.registers.get_string(font_reg);
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.font = Some(font);
                }
                (VMResult::Continue, pc + 1)
            }
            
            // TEXT_COLOR (0xF5)
            0xF5 => {
                let color_reg = decode_reg_a(instr);
                let color = self.registers.get_string(color_reg);
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.colour = Some(color);
                }
                (VMResult::Continue, pc + 1)
            }
            
            // TEXT_BG (0xF6)
            0xF6 => {
                let bg_reg = decode_reg_a(instr);
                let bg = self.registers.get_string(bg_reg);
                if let Some(e) = self.entities.get_mut(self.entity_idx) {
                    e.bg_color = Some(bg);
                }
                (VMResult::Continue, pc + 1)
            }
            
            // TEXT_GET (0xF7)
            0xF7 => {
                let dst = decode_reg_a(instr);
                let text = self.entities.get(self.entity_idx)
                    .and_then(|e| e.text.clone())
                    .unwrap_or_default();
                self.registers.set(dst, Value::String(text));
                (VMResult::Continue, pc + 1)
            }
            
            // EXEC (fallback for unimplemented blocks)
            0xF8 => {
                let _type_id = decode_imm16(instr);
                // This would dispatch to the old block execution system
                // For now, just continue
                (VMResult::Continue, pc + 1)
            }
            
            // Unknown opcode - skip
            _ => (VMResult::Continue, pc + 1),
        }
    }
}

/// Compare two values for equality (for list operations)
#[inline(always)]
fn values_equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => (x - y).abs() < f64::EPSILON,
        (Value::String(x), Value::String(y)) => x == y,
        (Value::Bool(x), Value::Bool(y)) => x == y,
        (Value::Null, Value::Null) => true,
        // Cross-type comparisons (string vs number)
        (Value::Number(n), Value::String(s)) | (Value::String(s), Value::Number(n)) => {
            if let Ok(parsed) = s.parse::<f64>() {
                (n - parsed).abs() < f64::EPSILON
            } else {
                false
            }
        }
        _ => false,
    }
}

/// Simple random number generator (pseudo-random)
fn rand_f64() -> f64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    static mut SEED: u64 = 0;
    
    unsafe {
        if SEED == 0 {
            SEED = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos() as u64)
                .unwrap_or(12345);
        }
        
        // Linear congruential generator
        SEED = SEED.wrapping_mul(6364136223846793005).wrapping_add(1);
        (SEED >> 33) as f64 / (1u64 << 31) as f64
    }
}
