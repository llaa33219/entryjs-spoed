//! High-Performance Bytecode System for Entry WASM Engine
//! 
//! This module implements a 32-bit fixed-width instruction format designed for
//! efficient execution in WebAssembly. Each instruction is exactly 4 bytes:
//! 
//! ```text
//! +--------+--------+--------+--------+
//! | Opcode |   Operand (24 bits)      |
//! | 8 bits |  A(8)  |  B(8)  |  C(8)  |
//! +--------+--------+--------+--------+
//! ```
//! 
//! Operand formats:
//! - RRR: 3 registers (dst, src1, src2) - 8 bits each
//! - RRI: 2 registers + 8-bit immediate (dst, src, imm8)
//! - RI16: 1 register + 16-bit immediate (reg, imm16)
//! - I24: 24-bit immediate (for jumps, constants)

use serde::{Serialize, Deserialize};
use crate::blocks::BlockTypeId;
use crate::Value;
use std::collections::HashMap;

// ============================================================================
// Instruction Encoding Constants
// ============================================================================

/// Instruction is a 32-bit value
pub type Instruction = u32;

/// Number of available registers (0-255)
pub const NUM_REGISTERS: usize = 256;

/// Maximum 24-bit immediate value
pub const MAX_IMM24: u32 = 0x00FF_FFFF;

/// Maximum 16-bit immediate value  
#[allow(dead_code)]
pub const MAX_IMM16: u32 = 0x0000_FFFF;

/// Maximum 8-bit immediate value
#[allow(dead_code)]
pub const MAX_IMM8: u32 = 0x0000_00FF;

// ============================================================================
// Opcode Definitions
// ============================================================================

/// All opcodes for the Entry bytecode VM
/// Using #[repr(u8)] for efficient memory layout and direct use in instructions
/// 
/// Note: We use SCREAMING_SNAKE_CASE for opcodes as this is the standard convention
/// for instruction set architectures and makes assembly-like code more readable.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
#[allow(non_camel_case_types)]
pub enum Opcode {
    // ========================================================================
    // Control Flow (0x00 - 0x1F)
    // ========================================================================
    
    /// No operation
    NOP = 0x00,
    /// End of script/function
    END = 0x01,
    /// Unconditional jump: JMP offset24 (signed)
    JMP = 0x02,
    /// Jump if zero: JZ reg, offset16
    JZ = 0x03,
    /// Jump if not zero: JNZ reg, offset16
    JNZ = 0x04,
    /// Call function: CALL func_idx24
    CALL = 0x05,
    /// Return from function
    RET = 0x06,
    /// Yield execution (cooperative multitasking)
    YIELD = 0x07,
    /// Wait for specified frames: WAIT reg (contains frame count)
    WAIT = 0x08,
    /// Wait for condition: WAIT_UNTIL reg (condition register)
    WAIT_UNTIL = 0x09,
    /// Loop start marker with counter: LOOP_START counter_reg, count_reg
    LOOP_START = 0x0A,
    /// Loop end - decrements counter, jumps if not zero: LOOP_END counter_reg, offset16
    LOOP_END = 0x0B,
    /// Break out of loop
    BREAK = 0x0C,
    /// Continue to next iteration
    CONTINUE = 0x0D,
    
    // ========================================================================
    // Data Movement (0x20 - 0x3F)
    // ========================================================================
    
    /// Move register to register: MOV dst, src
    MOV = 0x20,
    /// Load constant: LOAD_CONST dst, const_idx16
    LOAD_CONST = 0x21,
    /// Load global variable: LOAD_VAR dst, var_idx16
    LOAD_VAR = 0x22,
    /// Store to global variable: STORE_VAR var_idx16, src
    STORE_VAR = 0x23,
    /// Load local variable: LOAD_LOCAL dst, local_idx16
    LOAD_LOCAL = 0x24,
    /// Store to local variable: STORE_LOCAL local_idx16, src
    STORE_LOCAL = 0x25,
    /// Load immediate small integer: LOAD_IMM dst, imm16 (signed)
    LOAD_IMM = 0x26,
    /// Load from string pool: LOAD_STR dst, str_idx16
    LOAD_STR = 0x27,
    /// Load nil/null value: LOAD_NIL dst
    LOAD_NIL = 0x28,
    /// Load boolean true: LOAD_TRUE dst
    LOAD_TRUE = 0x29,
    /// Load boolean false: LOAD_FALSE dst
    LOAD_FALSE = 0x2A,
    /// Duplicate register value: DUP dst, src
    DUP = 0x2B,
    
    // ========================================================================
    // Entity Properties - Position (0x40 - 0x4F)
    // ========================================================================
    
    /// Get entity X position: GET_X dst
    GET_X = 0x40,
    /// Get entity Y position: GET_Y dst
    GET_Y = 0x41,
    /// Set entity X position: SET_X src
    SET_X = 0x42,
    /// Set entity Y position: SET_Y src
    SET_Y = 0x43,
    /// Add to entity X position: ADD_X src
    ADD_X = 0x44,
    /// Add to entity Y position: ADD_Y src
    ADD_Y = 0x45,
    /// Set X and Y: SET_XY x_reg, y_reg
    SET_XY = 0x46,
    /// Add to X and Y: ADD_XY x_reg, y_reg
    ADD_XY = 0x47,
    
    // ========================================================================
    // Entity Properties - Direction/Rotation (0x50 - 0x5F)
    // ========================================================================
    
    /// Get entity direction: GET_DIR dst
    GET_DIR = 0x50,
    /// Set entity direction: SET_DIR src
    SET_DIR = 0x51,
    /// Add to entity direction: ADD_DIR src
    ADD_DIR = 0x52,
    /// Get entity rotation: GET_ROT dst
    GET_ROT = 0x53,
    /// Set entity rotation: SET_ROT src
    SET_ROT = 0x54,
    /// Add to entity rotation: ADD_ROT src
    ADD_ROT = 0x55,
    /// Move in direction: MOVE_DIR distance_reg
    MOVE_DIR = 0x56,
    /// Move at angle: MOVE_ANGLE distance_reg, angle_reg
    MOVE_ANGLE = 0x57,
    /// Bounce off wall
    BOUNCE_WALL = 0x58,
    
    // ========================================================================
    // Entity Properties - Appearance (0x60 - 0x6F)
    // ========================================================================
    
    /// Show entity
    SHOW = 0x60,
    /// Hide entity
    HIDE = 0x61,
    /// Switch to next shape/costume
    NEXT_SHAPE = 0x62,
    /// Switch to previous shape/costume
    PREV_SHAPE = 0x63,
    /// Set shape by index or ID: SET_SHAPE src
    SET_SHAPE = 0x64,
    /// Get current scale: GET_SCALE dst
    GET_SCALE = 0x65,
    /// Set scale: SET_SCALE src
    SET_SCALE = 0x66,
    /// Change scale: ADD_SCALE src
    ADD_SCALE = 0x67,
    /// Set scale X and Y separately: SET_SCALE_XY x_reg, y_reg
    SET_SCALE_XY = 0x68,
    /// Flip X
    FLIP_X = 0x69,
    /// Flip Y
    FLIP_Y = 0x6A,
    /// Set effect: SET_EFFECT effect_type, value_reg
    SET_EFFECT = 0x6B,
    /// Change effect: CHANGE_EFFECT effect_type, value_reg
    CHANGE_EFFECT = 0x6C,
    /// Clear specific effect: CLEAR_EFFECT effect_type
    CLEAR_EFFECT = 0x6D,
    /// Clear all effects
    CLEAR_ALL_EFFECTS = 0x6E,
    /// Change object layer index: CHANGE_INDEX location_reg
    CHANGE_INDEX = 0x6F,
    
    // ========================================================================
    // Arithmetic Operations (0x70 - 0x8F)
    // ========================================================================
    
    /// Add: ADD dst, src1, src2
    ADD = 0x70,
    /// Subtract: SUB dst, src1, src2
    SUB = 0x71,
    /// Multiply: MUL dst, src1, src2
    MUL = 0x72,
    /// Divide: DIV dst, src1, src2
    DIV = 0x73,
    /// Modulo: MOD dst, src1, src2
    MOD = 0x74,
    /// Negate: NEG dst, src
    NEG = 0x75,
    /// Absolute value: ABS dst, src
    ABS = 0x76,
    /// Floor: FLOOR dst, src
    FLOOR = 0x77,
    /// Ceiling: CEIL dst, src
    CEIL = 0x78,
    /// Round: ROUND dst, src
    ROUND = 0x79,
    /// Square root: SQRT dst, src
    SQRT = 0x7A,
    /// Sine: SIN dst, src (degrees)
    SIN = 0x7B,
    /// Cosine: COS dst, src (degrees)
    COS = 0x7C,
    /// Tangent: TAN dst, src (degrees)
    TAN = 0x7D,
    /// Arc sine: ASIN dst, src
    ASIN = 0x7E,
    /// Arc cosine: ACOS dst, src
    ACOS = 0x7F,
    /// Arc tangent: ATAN dst, src
    ATAN = 0x80,
    /// Natural log: LN dst, src
    LN = 0x81,
    /// Log base 10: LOG10 dst, src
    LOG10 = 0x82,
    /// Exponential (e^x): EXP dst, src
    EXP = 0x83,
    /// Power: POW dst, base, exp
    POW = 0x84,
    /// Random number: RAND dst, min_reg, max_reg
    RAND = 0x85,
    /// Integer quotient: QUOT dst, src1, src2
    QUOT = 0x86,
    /// Add immediate: ADDI dst, src, imm8
    ADDI = 0x87,
    /// Subtract immediate: SUBI dst, src, imm8
    SUBI = 0x88,
    /// Multiply immediate: MULI dst, src, imm8
    MULI = 0x89,
    
    // ========================================================================
    // Comparison Operations (0x90 - 0x9F)
    // ========================================================================
    
    /// Equal: EQ dst, src1, src2
    EQ = 0x90,
    /// Not equal: NE dst, src1, src2
    NE = 0x91,
    /// Less than: LT dst, src1, src2
    LT = 0x92,
    /// Less than or equal: LE dst, src1, src2
    LE = 0x93,
    /// Greater than: GT dst, src1, src2
    GT = 0x94,
    /// Greater than or equal: GE dst, src1, src2
    GE = 0x95,
    /// Logical AND: AND dst, src1, src2
    AND = 0x96,
    /// Logical OR: OR dst, src1, src2
    OR = 0x97,
    /// Logical NOT: NOT dst, src
    NOT = 0x98,
    /// Compare and set flags (for conditional jumps)
    CMP = 0x99,
    
    // ========================================================================
    // String Operations (0xA0 - 0xAF)
    // ========================================================================
    
    /// Concatenate strings: CONCAT dst, src1, src2
    CONCAT = 0xA0,
    /// Get string length: STRLEN dst, src
    STRLEN = 0xA1,
    /// Get substring: SUBSTR dst, str, start, len
    SUBSTR = 0xA2,
    /// Get character at index: CHAR_AT dst, str, idx
    CHAR_AT = 0xA3,
    /// Find index of substring: INDEX_OF dst, str, substr
    INDEX_OF = 0xA4,
    /// Replace string: REPLACE dst, str, old, new
    REPLACE = 0xA5,
    /// Change case: CHANGE_CASE dst, src, case_type
    CHANGE_CASE = 0xA6,
    /// Reverse string: REVERSE_STR dst, src
    REVERSE_STR = 0xA7,
    /// Count matches: COUNT_MATCH dst, str, pattern
    COUNT_MATCH = 0xA8,
    /// Convert to string: TO_STRING dst, src
    TO_STRING = 0xA9,
    /// Convert to number: TO_NUMBER dst, src
    TO_NUMBER = 0xAA,
    
    // ========================================================================
    // List Operations (0xB0 - 0xBF)
    // ========================================================================
    
    /// Get list element: LIST_GET dst, list, idx
    LIST_GET = 0xB0,
    /// Set list element: LIST_SET list, idx, value
    LIST_SET = 0xB1,
    /// Push to list: LIST_PUSH list, value
    LIST_PUSH = 0xB2,
    /// Delete from list: LIST_DEL list, idx
    LIST_DEL = 0xB3,
    /// Get list length: LIST_LEN dst, list
    LIST_LEN = 0xB4,
    /// Check if list contains: LIST_CONTAINS dst, list, value
    LIST_CONTAINS = 0xB5,
    /// Insert at index: LIST_INSERT list, idx, value
    LIST_INSERT = 0xB6,
    /// Find index of value: LIST_INDEX_OF dst, list, value
    LIST_INDEX_OF = 0xB7,
    /// Create new list: LIST_NEW dst
    LIST_NEW = 0xB8,
    /// Clear list: LIST_CLEAR list
    LIST_CLEAR = 0xB9,
    
    // ========================================================================
    // Actions - Sound (0xC0 - 0xC7)
    // ========================================================================
    
    /// Play sound: PLAY_SOUND sound_id_reg
    PLAY_SOUND = 0xC0,
    /// Play sound and wait: PLAY_SOUND_WAIT sound_id_reg
    PLAY_SOUND_WAIT = 0xC1,
    /// Play sound from time: PLAY_SOUND_FROM sound_id_reg, start_reg
    PLAY_SOUND_FROM = 0xC2,
    /// Play sound range: PLAY_SOUND_RANGE sound_id_reg, start_reg, end_reg
    PLAY_SOUND_RANGE = 0xC3,
    /// Set volume: SET_VOLUME src
    SET_VOLUME = 0xC4,
    /// Change volume: CHANGE_VOLUME src
    CHANGE_VOLUME = 0xC5,
    /// Stop all sounds
    STOP_SOUND = 0xC6,
    /// Play BGM: PLAY_BGM sound_id_reg
    PLAY_BGM = 0xC7,
    
    // ========================================================================
    // Actions - Dialog/UI (0xC8 - 0xCF)
    // ========================================================================
    
    /// Show dialog: DIALOG msg_reg, mode_reg
    DIALOG = 0xC8,
    /// Show timed dialog: DIALOG_TIME msg_reg, mode_reg, time_reg
    DIALOG_TIME = 0xC9,
    /// Remove dialog
    REMOVE_DIALOG = 0xCA,
    /// Ask and wait: ASK msg_reg
    ASK = 0xCB,
    /// Get answer: GET_ANSWER dst
    GET_ANSWER = 0xCC,
    
    // ========================================================================
    // Actions - Clone/Entity (0xD0 - 0xD7)
    // ========================================================================
    
    /// Clone entity: CLONE target_reg
    CLONE = 0xD0,
    /// Delete this clone
    DELETE_CLONE = 0xD1,
    /// Delete all clones
    DELETE_ALL_CLONES = 0xD2,
    /// Send message: SEND_MSG msg_reg
    SEND_MSG = 0xD3,
    /// Send message and wait: SEND_MSG_WAIT msg_reg
    SEND_MSG_WAIT = 0xD4,
    /// Start scene: START_SCENE scene_reg
    START_SCENE = 0xD5,
    /// Start next scene
    START_NEXT_SCENE = 0xD6,
    /// Start previous scene
    START_PREV_SCENE = 0xD7,
    
    // ========================================================================
    // Actions - Brush/Drawing (0xD8 - 0xDF)
    // ========================================================================
    
    /// Pen down / start drawing
    BRUSH_DOWN = 0xD8,
    /// Pen up / stop drawing
    BRUSH_UP = 0xD9,
    /// Stamp current sprite
    STAMP = 0xDA,
    /// Set brush color: SET_BRUSH_COLOR color_reg
    SET_BRUSH_COLOR = 0xDB,
    /// Set brush size: SET_BRUSH_SIZE size_reg
    SET_BRUSH_SIZE = 0xDC,
    /// Erase all drawings
    BRUSH_ERASE_ALL = 0xDD,
    /// Start fill
    START_FILL = 0xDE,
    /// Stop fill
    STOP_FILL = 0xDF,
    
    // ========================================================================
    // Actions - Timer/Project (0xE0 - 0xE7)
    // ========================================================================
    
    /// Timer action: TIMER_ACTION action_type
    TIMER_ACTION = 0xE0,
    /// Set timer visibility: SET_TIMER_VISIBLE visible_reg
    SET_TIMER_VISIBLE = 0xE1,
    /// Get timer value: GET_TIMER dst
    GET_TIMER = 0xE2,
    /// Stop all scripts
    STOP_ALL = 0xE3,
    /// Stop this entity's scripts
    STOP_THIS = 0xE4,
    /// Stop other scripts
    STOP_OTHER = 0xE5,
    /// Restart project
    RESTART = 0xE6,
    
    // ========================================================================
    // Input/Sensors (0xE8 - 0xEF)
    // ========================================================================
    
    /// Get mouse X: GET_MOUSE_X dst
    GET_MOUSE_X = 0xE8,
    /// Get mouse Y: GET_MOUSE_Y dst
    GET_MOUSE_Y = 0xE9,
    /// Check if mouse clicked: IS_MOUSE_CLICKED dst
    IS_MOUSE_CLICKED = 0xEA,
    /// Check if key pressed: IS_KEY_PRESSED dst, key_reg
    IS_KEY_PRESSED = 0xEB,
    /// Check if touching: IS_TOUCHING dst, target_reg
    IS_TOUCHING = 0xEC,
    /// Get distance to: GET_DISTANCE dst, target_reg
    GET_DISTANCE = 0xED,
    /// Get date/time: GET_DATE dst, type_reg
    GET_DATE = 0xEE,
    /// Get object coordinate: GET_OBJ_COORD dst, obj_reg, coord_type
    GET_OBJ_COORD = 0xEF,
    
    // ========================================================================
    // Text Object (0xF0 - 0xF7)
    // ========================================================================
    
    /// Set text content: TEXT_SET src
    TEXT_SET = 0xF0,
    /// Append text: TEXT_APPEND src
    TEXT_APPEND = 0xF1,
    /// Prepend text: TEXT_PREPEND src
    TEXT_PREPEND = 0xF2,
    /// Clear text
    TEXT_CLEAR = 0xF3,
    /// Set text font: TEXT_FONT font_reg
    TEXT_FONT = 0xF4,
    /// Set text color: TEXT_COLOR color_reg
    TEXT_COLOR = 0xF5,
    /// Set text background: TEXT_BG bg_reg
    TEXT_BG = 0xF6,
    /// Get text content: TEXT_GET dst
    TEXT_GET = 0xF7,
    
    // ========================================================================
    // Extended/Special (0xF8 - 0xFF)
    // ========================================================================
    
    /// Execute block by type ID: EXEC block_type_id16
    EXEC = 0xF8,
    /// Debug breakpoint
    DEBUG = 0xF9,
    /// No-op placeholder for future use
    RESERVED_FA = 0xFA,
    RESERVED_FB = 0xFB,
    RESERVED_FC = 0xFC,
    RESERVED_FD = 0xFD,
    RESERVED_FE = 0xFE,
    /// Extended opcode prefix (for future expansion)
    EXTENDED = 0xFF,
}

impl Opcode {
    /// Convert from u8 to Opcode
    #[inline(always)]
    pub fn from_u8(value: u8) -> Option<Self> {
        // Safety: We check if the value is a valid opcode
        match value {
            0x00..=0x0D => Some(unsafe { std::mem::transmute(value) }),
            0x20..=0x2B => Some(unsafe { std::mem::transmute(value) }),
            0x40..=0x47 => Some(unsafe { std::mem::transmute(value) }),
            0x50..=0x58 => Some(unsafe { std::mem::transmute(value) }),
            0x60..=0x6F => Some(unsafe { std::mem::transmute(value) }),
            0x70..=0x89 => Some(unsafe { std::mem::transmute(value) }),
            0x90..=0x99 => Some(unsafe { std::mem::transmute(value) }),
            0xA0..=0xAA => Some(unsafe { std::mem::transmute(value) }),
            0xB0..=0xB9 => Some(unsafe { std::mem::transmute(value) }),
            0xC0..=0xC7 => Some(unsafe { std::mem::transmute(value) }),
            0xC8..=0xCC => Some(unsafe { std::mem::transmute(value) }),
            0xD0..=0xD7 => Some(unsafe { std::mem::transmute(value) }),
            0xD8..=0xDF => Some(unsafe { std::mem::transmute(value) }),
            0xE0..=0xE6 => Some(unsafe { std::mem::transmute(value) }),
            0xE8..=0xEF => Some(unsafe { std::mem::transmute(value) }),
            0xF0..=0xF9 => Some(unsafe { std::mem::transmute(value) }),
            0xFA..=0xFF => Some(unsafe { std::mem::transmute(value) }),
            _ => None,
        }
    }
    
    /// Convert Opcode to u8
    #[inline(always)]
    pub fn to_u8(self) -> u8 {
        self as u8
    }
}

// ============================================================================
// Instruction Encoding/Decoding
// ============================================================================

/// Encode an instruction with opcode and 24-bit operand
#[inline(always)]
pub fn encode_instruction(opcode: Opcode, operand: u32) -> Instruction {
    ((opcode as u32) << 24) | (operand & MAX_IMM24)
}

/// Encode an instruction with opcode and three 8-bit registers (RRR format)
#[inline(always)]
pub fn encode_rrr(opcode: Opcode, dst: u8, src1: u8, src2: u8) -> Instruction {
    ((opcode as u32) << 24) | ((dst as u32) << 16) | ((src1 as u32) << 8) | (src2 as u32)
}

/// Encode an instruction with opcode, two 8-bit registers, and 8-bit immediate (RRI format)
#[inline(always)]
pub fn encode_rri(opcode: Opcode, dst: u8, src: u8, imm: u8) -> Instruction {
    ((opcode as u32) << 24) | ((dst as u32) << 16) | ((src as u32) << 8) | (imm as u32)
}

/// Encode an instruction with opcode, one 8-bit register, and 16-bit immediate (RI16 format)
#[inline(always)]
pub fn encode_ri16(opcode: Opcode, reg: u8, imm: u16) -> Instruction {
    ((opcode as u32) << 24) | ((reg as u32) << 16) | (imm as u32)
}

/// Encode an instruction with opcode and 24-bit signed immediate (I24 format)
#[inline(always)]
pub fn encode_i24(opcode: Opcode, imm: i32) -> Instruction {
    let imm_u24 = (imm as u32) & MAX_IMM24;
    ((opcode as u32) << 24) | imm_u24
}

/// Decode opcode from instruction
#[inline(always)]
pub fn decode_opcode(instr: Instruction) -> u8 {
    (instr >> 24) as u8
}

/// Decode 24-bit operand from instruction
#[inline(always)]
#[allow(dead_code)]
pub fn decode_operand(instr: Instruction) -> u32 {
    instr & MAX_IMM24
}

/// Decode 24-bit signed operand from instruction
#[inline(always)]
pub fn decode_operand_signed(instr: Instruction) -> i32 {
    let operand = instr & MAX_IMM24;
    // Sign extend from 24 bits to 32 bits
    if operand & 0x00800000 != 0 {
        (operand | 0xFF000000) as i32
    } else {
        operand as i32
    }
}

/// Decode first register (A) from instruction - bits 16-23
#[inline(always)]
pub fn decode_reg_a(instr: Instruction) -> u8 {
    ((instr >> 16) & 0xFF) as u8
}

/// Decode second register (B) from instruction - bits 8-15
#[inline(always)]
pub fn decode_reg_b(instr: Instruction) -> u8 {
    ((instr >> 8) & 0xFF) as u8
}

/// Decode third register (C) from instruction - bits 0-7
#[inline(always)]
pub fn decode_reg_c(instr: Instruction) -> u8 {
    (instr & 0xFF) as u8
}

/// Decode 16-bit immediate from instruction - bits 0-15
#[inline(always)]
pub fn decode_imm16(instr: Instruction) -> u16 {
    (instr & 0xFFFF) as u16
}

/// Decode 16-bit signed immediate from instruction - bits 0-15
#[inline(always)]
pub fn decode_imm16_signed(instr: Instruction) -> i16 {
    (instr & 0xFFFF) as i16
}

/// Decode 8-bit immediate from instruction - bits 0-7
#[inline(always)]
#[allow(dead_code)]
pub fn decode_imm8(instr: Instruction) -> u8 {
    (instr & 0xFF) as u8
}

// ============================================================================
// Instruction Builder (for readability in compiler)
// ============================================================================

/// Builder for creating instructions with a fluent API
pub struct InstructionBuilder;

impl InstructionBuilder {
    // Control flow
    #[inline] pub fn nop() -> Instruction { encode_instruction(Opcode::NOP, 0) }
    #[inline] pub fn end() -> Instruction { encode_instruction(Opcode::END, 0) }
    #[inline] pub fn jmp(offset: i32) -> Instruction { encode_i24(Opcode::JMP, offset) }
    #[inline] pub fn jz(reg: u8, offset: i16) -> Instruction { encode_ri16(Opcode::JZ, reg, offset as u16) }
    #[inline] pub fn jnz(reg: u8, offset: i16) -> Instruction { encode_ri16(Opcode::JNZ, reg, offset as u16) }
    #[inline] pub fn call(func_idx: u32) -> Instruction { encode_instruction(Opcode::CALL, func_idx) }
    #[inline] pub fn ret() -> Instruction { encode_instruction(Opcode::RET, 0) }
    #[inline] pub fn yield_() -> Instruction { encode_instruction(Opcode::YIELD, 0) }
    #[inline] pub fn wait(frames_reg: u8) -> Instruction { encode_ri16(Opcode::WAIT, frames_reg, 0) }
    #[inline] pub fn wait_until(cond_reg: u8) -> Instruction { encode_ri16(Opcode::WAIT_UNTIL, cond_reg, 0) }
    #[inline] pub fn loop_start(counter: u8, count: u8) -> Instruction { encode_rrr(Opcode::LOOP_START, counter, count, 0) }
    #[inline] pub fn loop_end(counter: u8, offset: i16) -> Instruction { encode_ri16(Opcode::LOOP_END, counter, offset as u16) }
    #[inline] pub fn break_() -> Instruction { encode_instruction(Opcode::BREAK, 0) }
    #[inline] pub fn continue_() -> Instruction { encode_instruction(Opcode::CONTINUE, 0) }
    
    // Data movement
    #[inline] pub fn mov(dst: u8, src: u8) -> Instruction { encode_rrr(Opcode::MOV, dst, src, 0) }
    #[inline] pub fn load_const(dst: u8, idx: u16) -> Instruction { encode_ri16(Opcode::LOAD_CONST, dst, idx) }
    #[inline] pub fn load_var(dst: u8, idx: u16) -> Instruction { encode_ri16(Opcode::LOAD_VAR, dst, idx) }
    #[inline] pub fn store_var(idx: u16, src: u8) -> Instruction { encode_ri16(Opcode::STORE_VAR, src, idx) }
    #[inline] pub fn load_local(dst: u8, idx: u16) -> Instruction { encode_ri16(Opcode::LOAD_LOCAL, dst, idx) }
    #[inline] pub fn store_local(idx: u16, src: u8) -> Instruction { encode_ri16(Opcode::STORE_LOCAL, src, idx) }
    #[inline] pub fn load_imm(dst: u8, imm: i16) -> Instruction { encode_ri16(Opcode::LOAD_IMM, dst, imm as u16) }
    #[inline] pub fn load_str(dst: u8, idx: u16) -> Instruction { encode_ri16(Opcode::LOAD_STR, dst, idx) }
    #[inline] pub fn load_nil(dst: u8) -> Instruction { encode_ri16(Opcode::LOAD_NIL, dst, 0) }
    #[inline] pub fn load_true(dst: u8) -> Instruction { encode_ri16(Opcode::LOAD_TRUE, dst, 0) }
    #[inline] pub fn load_false(dst: u8) -> Instruction { encode_ri16(Opcode::LOAD_FALSE, dst, 0) }
    #[inline] pub fn dup(dst: u8, src: u8) -> Instruction { encode_rrr(Opcode::DUP, dst, src, 0) }
    
    // Entity position
    #[inline] pub fn get_x(dst: u8) -> Instruction { encode_ri16(Opcode::GET_X, dst, 0) }
    #[inline] pub fn get_y(dst: u8) -> Instruction { encode_ri16(Opcode::GET_Y, dst, 0) }
    #[inline] pub fn set_x(src: u8) -> Instruction { encode_ri16(Opcode::SET_X, src, 0) }
    #[inline] pub fn set_y(src: u8) -> Instruction { encode_ri16(Opcode::SET_Y, src, 0) }
    #[inline] pub fn add_x(src: u8) -> Instruction { encode_ri16(Opcode::ADD_X, src, 0) }
    #[inline] pub fn add_y(src: u8) -> Instruction { encode_ri16(Opcode::ADD_Y, src, 0) }
    #[inline] pub fn set_xy(x: u8, y: u8) -> Instruction { encode_rrr(Opcode::SET_XY, x, y, 0) }
    #[inline] pub fn add_xy(x: u8, y: u8) -> Instruction { encode_rrr(Opcode::ADD_XY, x, y, 0) }
    
    // Entity direction/rotation
    #[inline] pub fn get_dir(dst: u8) -> Instruction { encode_ri16(Opcode::GET_DIR, dst, 0) }
    #[inline] pub fn set_dir(src: u8) -> Instruction { encode_ri16(Opcode::SET_DIR, src, 0) }
    #[inline] pub fn add_dir(src: u8) -> Instruction { encode_ri16(Opcode::ADD_DIR, src, 0) }
    #[inline] pub fn get_rot(dst: u8) -> Instruction { encode_ri16(Opcode::GET_ROT, dst, 0) }
    #[inline] pub fn set_rot(src: u8) -> Instruction { encode_ri16(Opcode::SET_ROT, src, 0) }
    #[inline] pub fn add_rot(src: u8) -> Instruction { encode_ri16(Opcode::ADD_ROT, src, 0) }
    #[inline] pub fn move_dir(dist: u8) -> Instruction { encode_ri16(Opcode::MOVE_DIR, dist, 0) }
    #[inline] pub fn move_angle(dist: u8, angle: u8) -> Instruction { encode_rrr(Opcode::MOVE_ANGLE, dist, angle, 0) }
    #[inline] pub fn bounce_wall() -> Instruction { encode_instruction(Opcode::BOUNCE_WALL, 0) }
    
    // Entity appearance
    #[inline] pub fn show() -> Instruction { encode_instruction(Opcode::SHOW, 0) }
    #[inline] pub fn hide() -> Instruction { encode_instruction(Opcode::HIDE, 0) }
    #[inline] pub fn next_shape() -> Instruction { encode_instruction(Opcode::NEXT_SHAPE, 0) }
    #[inline] pub fn prev_shape() -> Instruction { encode_instruction(Opcode::PREV_SHAPE, 0) }
    #[inline] pub fn set_shape(src: u8) -> Instruction { encode_ri16(Opcode::SET_SHAPE, src, 0) }
    #[inline] pub fn get_scale(dst: u8) -> Instruction { encode_ri16(Opcode::GET_SCALE, dst, 0) }
    #[inline] pub fn set_scale(src: u8) -> Instruction { encode_ri16(Opcode::SET_SCALE, src, 0) }
    #[inline] pub fn add_scale(src: u8) -> Instruction { encode_ri16(Opcode::ADD_SCALE, src, 0) }
    #[inline] pub fn set_scale_xy(x: u8, y: u8) -> Instruction { encode_rrr(Opcode::SET_SCALE_XY, x, y, 0) }
    #[inline] pub fn flip_x() -> Instruction { encode_instruction(Opcode::FLIP_X, 0) }
    #[inline] pub fn flip_y() -> Instruction { encode_instruction(Opcode::FLIP_Y, 0) }
    #[inline] pub fn set_effect(effect_type: u8, value: u8) -> Instruction { encode_rrr(Opcode::SET_EFFECT, effect_type, value, 0) }
    #[inline] pub fn change_effect(effect_type: u8, value: u8) -> Instruction { encode_rrr(Opcode::CHANGE_EFFECT, effect_type, value, 0) }
    #[inline] pub fn clear_effect(effect_type: u8) -> Instruction { encode_ri16(Opcode::CLEAR_EFFECT, effect_type, 0) }
    #[inline] pub fn clear_all_effects() -> Instruction { encode_instruction(Opcode::CLEAR_ALL_EFFECTS, 0) }
    #[inline] pub fn change_index(loc: u8) -> Instruction { encode_ri16(Opcode::CHANGE_INDEX, loc, 0) }
    
    // Arithmetic
    #[inline] pub fn add(dst: u8, src1: u8, src2: u8) -> Instruction { encode_rrr(Opcode::ADD, dst, src1, src2) }
    #[inline] pub fn sub(dst: u8, src1: u8, src2: u8) -> Instruction { encode_rrr(Opcode::SUB, dst, src1, src2) }
    #[inline] pub fn mul(dst: u8, src1: u8, src2: u8) -> Instruction { encode_rrr(Opcode::MUL, dst, src1, src2) }
    #[inline] pub fn div(dst: u8, src1: u8, src2: u8) -> Instruction { encode_rrr(Opcode::DIV, dst, src1, src2) }
    #[inline] pub fn mod_(dst: u8, src1: u8, src2: u8) -> Instruction { encode_rrr(Opcode::MOD, dst, src1, src2) }
    #[inline] pub fn neg(dst: u8, src: u8) -> Instruction { encode_rrr(Opcode::NEG, dst, src, 0) }
    #[inline] pub fn abs(dst: u8, src: u8) -> Instruction { encode_rrr(Opcode::ABS, dst, src, 0) }
    #[inline] pub fn floor(dst: u8, src: u8) -> Instruction { encode_rrr(Opcode::FLOOR, dst, src, 0) }
    #[inline] pub fn ceil(dst: u8, src: u8) -> Instruction { encode_rrr(Opcode::CEIL, dst, src, 0) }
    #[inline] pub fn round(dst: u8, src: u8) -> Instruction { encode_rrr(Opcode::ROUND, dst, src, 0) }
    #[inline] pub fn sqrt(dst: u8, src: u8) -> Instruction { encode_rrr(Opcode::SQRT, dst, src, 0) }
    #[inline] pub fn sin(dst: u8, src: u8) -> Instruction { encode_rrr(Opcode::SIN, dst, src, 0) }
    #[inline] pub fn cos(dst: u8, src: u8) -> Instruction { encode_rrr(Opcode::COS, dst, src, 0) }
    #[inline] pub fn tan(dst: u8, src: u8) -> Instruction { encode_rrr(Opcode::TAN, dst, src, 0) }
    #[inline] pub fn asin(dst: u8, src: u8) -> Instruction { encode_rrr(Opcode::ASIN, dst, src, 0) }
    #[inline] pub fn acos(dst: u8, src: u8) -> Instruction { encode_rrr(Opcode::ACOS, dst, src, 0) }
    #[inline] pub fn atan(dst: u8, src: u8) -> Instruction { encode_rrr(Opcode::ATAN, dst, src, 0) }
    #[inline] pub fn ln(dst: u8, src: u8) -> Instruction { encode_rrr(Opcode::LN, dst, src, 0) }
    #[inline] pub fn log10(dst: u8, src: u8) -> Instruction { encode_rrr(Opcode::LOG10, dst, src, 0) }
    #[inline] pub fn exp(dst: u8, src: u8) -> Instruction { encode_rrr(Opcode::EXP, dst, src, 0) }
    #[inline] pub fn pow(dst: u8, base: u8, exp: u8) -> Instruction { encode_rrr(Opcode::POW, dst, base, exp) }
    #[inline] pub fn rand(dst: u8, min: u8, max: u8) -> Instruction { encode_rrr(Opcode::RAND, dst, min, max) }
    #[inline] pub fn quot(dst: u8, src1: u8, src2: u8) -> Instruction { encode_rrr(Opcode::QUOT, dst, src1, src2) }
    #[inline] pub fn addi(dst: u8, src: u8, imm: u8) -> Instruction { encode_rri(Opcode::ADDI, dst, src, imm) }
    #[inline] pub fn subi(dst: u8, src: u8, imm: u8) -> Instruction { encode_rri(Opcode::SUBI, dst, src, imm) }
    #[inline] pub fn muli(dst: u8, src: u8, imm: u8) -> Instruction { encode_rri(Opcode::MULI, dst, src, imm) }
    
    // Comparison
    #[inline] pub fn eq(dst: u8, src1: u8, src2: u8) -> Instruction { encode_rrr(Opcode::EQ, dst, src1, src2) }
    #[inline] pub fn ne(dst: u8, src1: u8, src2: u8) -> Instruction { encode_rrr(Opcode::NE, dst, src1, src2) }
    #[inline] pub fn lt(dst: u8, src1: u8, src2: u8) -> Instruction { encode_rrr(Opcode::LT, dst, src1, src2) }
    #[inline] pub fn le(dst: u8, src1: u8, src2: u8) -> Instruction { encode_rrr(Opcode::LE, dst, src1, src2) }
    #[inline] pub fn gt(dst: u8, src1: u8, src2: u8) -> Instruction { encode_rrr(Opcode::GT, dst, src1, src2) }
    #[inline] pub fn ge(dst: u8, src1: u8, src2: u8) -> Instruction { encode_rrr(Opcode::GE, dst, src1, src2) }
    #[inline] pub fn and(dst: u8, src1: u8, src2: u8) -> Instruction { encode_rrr(Opcode::AND, dst, src1, src2) }
    #[inline] pub fn or(dst: u8, src1: u8, src2: u8) -> Instruction { encode_rrr(Opcode::OR, dst, src1, src2) }
    #[inline] pub fn not(dst: u8, src: u8) -> Instruction { encode_rrr(Opcode::NOT, dst, src, 0) }
    
    // String operations
    #[inline] pub fn concat(dst: u8, src1: u8, src2: u8) -> Instruction { encode_rrr(Opcode::CONCAT, dst, src1, src2) }
    #[inline] pub fn strlen(dst: u8, src: u8) -> Instruction { encode_rrr(Opcode::STRLEN, dst, src, 0) }
    #[inline] pub fn char_at(dst: u8, str: u8, idx: u8) -> Instruction { encode_rrr(Opcode::CHAR_AT, dst, str, idx) }
    #[inline] pub fn index_of(dst: u8, str: u8, substr: u8) -> Instruction { encode_rrr(Opcode::INDEX_OF, dst, str, substr) }
    #[inline] pub fn to_string(dst: u8, src: u8) -> Instruction { encode_rrr(Opcode::TO_STRING, dst, src, 0) }
    #[inline] pub fn to_number(dst: u8, src: u8) -> Instruction { encode_rrr(Opcode::TO_NUMBER, dst, src, 0) }
    
    // List operations
    #[inline] pub fn list_get(dst: u8, list: u8, idx: u8) -> Instruction { encode_rrr(Opcode::LIST_GET, dst, list, idx) }
    #[inline] pub fn list_set(list: u8, idx: u8, value: u8) -> Instruction { encode_rrr(Opcode::LIST_SET, list, idx, value) }
    #[inline] pub fn list_push(list: u8, value: u8) -> Instruction { encode_rrr(Opcode::LIST_PUSH, list, value, 0) }
    #[inline] pub fn list_del(list: u8, idx: u8) -> Instruction { encode_rrr(Opcode::LIST_DEL, list, idx, 0) }
    #[inline] pub fn list_len(dst: u8, list: u8) -> Instruction { encode_rrr(Opcode::LIST_LEN, dst, list, 0) }
    #[inline] pub fn list_contains(dst: u8, list: u8, value: u8) -> Instruction { encode_rrr(Opcode::LIST_CONTAINS, dst, list, value) }
    #[inline] pub fn list_insert(list: u8, idx: u8, value: u8) -> Instruction { encode_rrr(Opcode::LIST_INSERT, list, idx, value) }
    #[inline] pub fn list_index_of(dst: u8, list: u8, value: u8) -> Instruction { encode_rrr(Opcode::LIST_INDEX_OF, dst, list, value) }
    #[inline] pub fn list_new(dst: u8) -> Instruction { encode_ri16(Opcode::LIST_NEW, dst, 0) }
    #[inline] pub fn list_clear(list: u8) -> Instruction { encode_ri16(Opcode::LIST_CLEAR, list, 0) }
    
    // Sound actions
    #[inline] pub fn play_sound(id_reg: u8) -> Instruction { encode_ri16(Opcode::PLAY_SOUND, id_reg, 0) }
    #[inline] pub fn play_sound_wait(id_reg: u8) -> Instruction { encode_ri16(Opcode::PLAY_SOUND_WAIT, id_reg, 0) }
    #[inline] pub fn stop_sound() -> Instruction { encode_instruction(Opcode::STOP_SOUND, 0) }
    #[inline] pub fn set_volume(src: u8) -> Instruction { encode_ri16(Opcode::SET_VOLUME, src, 0) }
    #[inline] pub fn change_volume(src: u8) -> Instruction { encode_ri16(Opcode::CHANGE_VOLUME, src, 0) }
    #[inline] pub fn play_bgm(id_reg: u8) -> Instruction { encode_ri16(Opcode::PLAY_BGM, id_reg, 0) }
    
    // Dialog actions
    #[inline] pub fn dialog(msg: u8, mode: u8) -> Instruction { encode_rrr(Opcode::DIALOG, msg, mode, 0) }
    #[inline] pub fn dialog_time(msg: u8, mode: u8, time: u8) -> Instruction { encode_rrr(Opcode::DIALOG_TIME, msg, mode, time) }
    #[inline] pub fn remove_dialog() -> Instruction { encode_instruction(Opcode::REMOVE_DIALOG, 0) }
    #[inline] pub fn ask(msg: u8) -> Instruction { encode_ri16(Opcode::ASK, msg, 0) }
    #[inline] pub fn get_answer(dst: u8) -> Instruction { encode_ri16(Opcode::GET_ANSWER, dst, 0) }
    
    // Clone/Entity actions
    #[inline] pub fn clone(target: u8) -> Instruction { encode_ri16(Opcode::CLONE, target, 0) }
    #[inline] pub fn delete_clone() -> Instruction { encode_instruction(Opcode::DELETE_CLONE, 0) }
    #[inline] pub fn delete_all_clones() -> Instruction { encode_instruction(Opcode::DELETE_ALL_CLONES, 0) }
    #[inline] pub fn send_msg(msg: u8) -> Instruction { encode_ri16(Opcode::SEND_MSG, msg, 0) }
    #[inline] pub fn send_msg_wait(msg: u8) -> Instruction { encode_ri16(Opcode::SEND_MSG_WAIT, msg, 0) }
    #[inline] pub fn start_scene(scene: u8) -> Instruction { encode_ri16(Opcode::START_SCENE, scene, 0) }
    #[inline] pub fn start_next_scene() -> Instruction { encode_instruction(Opcode::START_NEXT_SCENE, 0) }
    #[inline] pub fn start_prev_scene() -> Instruction { encode_instruction(Opcode::START_PREV_SCENE, 0) }
    
    // Brush actions
    #[inline] pub fn brush_down() -> Instruction { encode_instruction(Opcode::BRUSH_DOWN, 0) }
    #[inline] pub fn brush_up() -> Instruction { encode_instruction(Opcode::BRUSH_UP, 0) }
    #[inline] pub fn stamp() -> Instruction { encode_instruction(Opcode::STAMP, 0) }
    #[inline] pub fn set_brush_color(color: u8) -> Instruction { encode_ri16(Opcode::SET_BRUSH_COLOR, color, 0) }
    #[inline] pub fn set_brush_size(size: u8) -> Instruction { encode_ri16(Opcode::SET_BRUSH_SIZE, size, 0) }
    #[inline] pub fn brush_erase_all() -> Instruction { encode_instruction(Opcode::BRUSH_ERASE_ALL, 0) }
    #[inline] pub fn start_fill() -> Instruction { encode_instruction(Opcode::START_FILL, 0) }
    #[inline] pub fn stop_fill() -> Instruction { encode_instruction(Opcode::STOP_FILL, 0) }
    
    // Timer/Project actions
    #[inline] pub fn timer_action(action_type: u8) -> Instruction { encode_ri16(Opcode::TIMER_ACTION, action_type, 0) }
    #[inline] pub fn set_timer_visible(visible: u8) -> Instruction { encode_ri16(Opcode::SET_TIMER_VISIBLE, visible, 0) }
    #[inline] pub fn get_timer(dst: u8) -> Instruction { encode_ri16(Opcode::GET_TIMER, dst, 0) }
    #[inline] pub fn stop_all() -> Instruction { encode_instruction(Opcode::STOP_ALL, 0) }
    #[inline] pub fn stop_this() -> Instruction { encode_instruction(Opcode::STOP_THIS, 0) }
    #[inline] pub fn stop_other() -> Instruction { encode_instruction(Opcode::STOP_OTHER, 0) }
    #[inline] pub fn restart() -> Instruction { encode_instruction(Opcode::RESTART, 0) }
    
    // Input/Sensors
    #[inline] pub fn get_mouse_x(dst: u8) -> Instruction { encode_ri16(Opcode::GET_MOUSE_X, dst, 0) }
    #[inline] pub fn get_mouse_y(dst: u8) -> Instruction { encode_ri16(Opcode::GET_MOUSE_Y, dst, 0) }
    #[inline] pub fn is_mouse_clicked(dst: u8) -> Instruction { encode_ri16(Opcode::IS_MOUSE_CLICKED, dst, 0) }
    #[inline] pub fn is_key_pressed(dst: u8, key: u8) -> Instruction { encode_rrr(Opcode::IS_KEY_PRESSED, dst, key, 0) }
    #[inline] pub fn is_touching(dst: u8, target: u8) -> Instruction { encode_rrr(Opcode::IS_TOUCHING, dst, target, 0) }
    #[inline] pub fn get_distance(dst: u8, target: u8) -> Instruction { encode_rrr(Opcode::GET_DISTANCE, dst, target, 0) }
    #[inline] pub fn get_date(dst: u8, date_type: u8) -> Instruction { encode_rrr(Opcode::GET_DATE, dst, date_type, 0) }
    #[inline] pub fn get_obj_coord(dst: u8, obj: u8, coord_type: u8) -> Instruction { encode_rrr(Opcode::GET_OBJ_COORD, dst, obj, coord_type) }
    
    // Text object
    #[inline] pub fn text_set(src: u8) -> Instruction { encode_ri16(Opcode::TEXT_SET, src, 0) }
    #[inline] pub fn text_append(src: u8) -> Instruction { encode_ri16(Opcode::TEXT_APPEND, src, 0) }
    #[inline] pub fn text_prepend(src: u8) -> Instruction { encode_ri16(Opcode::TEXT_PREPEND, src, 0) }
    #[inline] pub fn text_clear() -> Instruction { encode_instruction(Opcode::TEXT_CLEAR, 0) }
    #[inline] pub fn text_font(font: u8) -> Instruction { encode_ri16(Opcode::TEXT_FONT, font, 0) }
    #[inline] pub fn text_color(color: u8) -> Instruction { encode_ri16(Opcode::TEXT_COLOR, color, 0) }
    #[inline] pub fn text_bg(bg: u8) -> Instruction { encode_ri16(Opcode::TEXT_BG, bg, 0) }
    #[inline] pub fn text_get(dst: u8) -> Instruction { encode_ri16(Opcode::TEXT_GET, dst, 0) }
    
    // Extended
    #[inline] pub fn exec(block_type: u16) -> Instruction { encode_ri16(Opcode::EXEC, 0, block_type) }
    #[inline] pub fn debug() -> Instruction { encode_instruction(Opcode::DEBUG, 0) }
}

// ============================================================================
// Program Structure
// ============================================================================

/// Compiled bytecode program
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct Program {
    /// Fixed-width 32-bit instructions
    pub instructions: Vec<Instruction>,
    
    /// Constant pool for numbers and complex values
    pub constants: Vec<Value>,
    
    /// String pool for string literals
    pub string_pool: Vec<String>,
    
    /// Mapping from variable ID to variable index
    pub variable_map: HashMap<String, usize>,
    
    /// Mapping from function ID to function info
    pub functions: HashMap<String, FunctionInfo>,
    
    /// Script entry points
    pub scripts: Vec<ScriptInfo>,
    
    /// List variable IDs (for distinguishing from regular variables)
    pub list_variables: Vec<String>,
}

impl Program {
    /// Create a new empty program
    pub fn new() -> Self {
        Self::default()
    }
    
    /// Add a constant and return its index
    pub fn add_constant(&mut self, value: Value) -> u16 {
        // Check if constant already exists
        for (i, existing) in self.constants.iter().enumerate() {
            if Self::values_equal(existing, &value) {
                return i as u16;
            }
        }
        let idx = self.constants.len();
        self.constants.push(value);
        idx as u16
    }
    
    /// Add a string to the pool and return its index
    pub fn add_string(&mut self, s: String) -> u16 {
        // Check if string already exists
        for (i, existing) in self.string_pool.iter().enumerate() {
            if existing == &s {
                return i as u16;
            }
        }
        let idx = self.string_pool.len();
        self.string_pool.push(s);
        idx as u16
    }
    
    /// Get or create variable index
    pub fn get_or_create_variable(&mut self, var_id: &str) -> u16 {
        if let Some(&idx) = self.variable_map.get(var_id) {
            return idx as u16;
        }
        let idx = self.variable_map.len();
        self.variable_map.insert(var_id.to_string(), idx);
        idx as u16
    }
    
    /// Helper to compare values for deduplication
    fn values_equal(a: &Value, b: &Value) -> bool {
        match (a, b) {
            (Value::Number(x), Value::Number(y)) => (x - y).abs() < f64::EPSILON,
            (Value::String(x), Value::String(y)) => x == y,
            (Value::Bool(x), Value::Bool(y)) => x == y,
            (Value::Null, Value::Null) => true,
            _ => false,
        }
    }
    
    /// Get the current instruction count (for computing jump offsets)
    #[inline]
    pub fn current_pc(&self) -> usize {
        self.instructions.len()
    }
    
    /// Emit an instruction and return its address
    #[inline]
    pub fn emit(&mut self, instr: Instruction) -> usize {
        let pc = self.instructions.len();
        self.instructions.push(instr);
        pc
    }
    
    /// Patch a jump instruction at the given address
    #[inline]
    pub fn patch_jump(&mut self, addr: usize, target: usize) {
        let instr = self.instructions[addr];
        let opcode = decode_opcode(instr);
        let offset = (target as i32) - (addr as i32);
        
        // Re-encode with the correct offset
        match opcode {
            op if op == Opcode::JMP as u8 => {
                self.instructions[addr] = encode_i24(Opcode::JMP, offset);
            }
            op if op == Opcode::JZ as u8 => {
                let reg = decode_reg_a(instr);
                self.instructions[addr] = encode_ri16(Opcode::JZ, reg, offset as i16 as u16);
            }
            op if op == Opcode::JNZ as u8 => {
                let reg = decode_reg_a(instr);
                self.instructions[addr] = encode_ri16(Opcode::JNZ, reg, offset as i16 as u16);
            }
            op if op == Opcode::LOOP_END as u8 => {
                let reg = decode_reg_a(instr);
                self.instructions[addr] = encode_ri16(Opcode::LOOP_END, reg, offset as i16 as u16);
            }
            _ => {}
        }
    }
}

// ============================================================================
// Script and Function Info
// ============================================================================

/// Information about a script entry point
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ScriptInfo {
    /// Entity index this script belongs to
    pub entity_index: usize,
    
    /// Program counter where script starts
    pub start_pc: usize,
    
    /// Trigger type (event that starts this script)
    pub trigger_type: BlockTypeId,
    
    /// Optional trigger value (e.g., message ID, key code)
    pub trigger_value: Option<TriggerValue>,
}

/// Trigger value for script activation
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum TriggerValue {
    /// Message ID for message_cast triggers
    MessageId(String),
    /// Key code for key press triggers
    KeyCode(u32),
    /// Scene ID for scene start triggers
    SceneId(String),
    /// Generic index value
    Index(usize),
}

/// Information about a compiled function
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FunctionInfo {
    /// Function ID
    pub id: String,
    
    /// Program counter where function starts
    pub start_pc: usize,
    
    /// Number of parameters
    pub param_count: u8,
    
    /// Number of local variables (including parameters)
    pub local_count: u8,
    
    /// Whether function returns a value
    pub returns_value: bool,
}

// ============================================================================
// Register Allocation Helper
// ============================================================================

/// Simple register allocator for compilation
#[derive(Clone, Debug)]
pub struct RegisterAllocator {
    /// Next available register
    next_reg: u8,
    /// Stack of saved positions for nested scopes
    scope_stack: Vec<u8>,
}

impl RegisterAllocator {
    pub fn new() -> Self {
        Self {
            next_reg: 0,
            scope_stack: Vec::new(),
        }
    }
    
    /// Allocate a new register
    #[inline]
    pub fn alloc(&mut self) -> u8 {
        let reg = self.next_reg;
        self.next_reg = self.next_reg.wrapping_add(1);
        if self.next_reg == 0 {
            panic!("Register overflow: exceeded 256 registers");
        }
        reg
    }
    
    /// Allocate multiple consecutive registers
    #[inline]
    pub fn alloc_n(&mut self, n: u8) -> u8 {
        let start = self.next_reg;
        self.next_reg = self.next_reg.wrapping_add(n);
        if self.next_reg < start {
            panic!("Register overflow: exceeded 256 registers");
        }
        start
    }
    
    /// Enter a new scope (save current position)
    #[inline]
    pub fn enter_scope(&mut self) {
        self.scope_stack.push(self.next_reg);
    }
    
    /// Exit scope (restore to saved position)
    #[inline]
    pub fn exit_scope(&mut self) {
        if let Some(saved) = self.scope_stack.pop() {
            self.next_reg = saved;
        }
    }
    
    /// Get current register count
    #[inline]
    pub fn current(&self) -> u8 {
        self.next_reg
    }
    
    /// Reset allocator
    #[inline]
    pub fn reset(&mut self) {
        self.next_reg = 0;
        self.scope_stack.clear();
    }
    
    /// Peek at the last allocated register without allocating a new one
    #[inline]
    pub fn last(&self) -> u8 {
        self.next_reg.saturating_sub(1)
    }
    
    /// Free the last allocated register (decrement counter)
    #[inline]
    pub fn free_last(&mut self) {
        if self.next_reg > 0 {
            self.next_reg -= 1;
        }
    }
}

impl Default for RegisterAllocator {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Instruction Disassembler (for debugging)
// ============================================================================

/// Disassemble a single instruction to a human-readable string
#[allow(dead_code)]
pub fn disassemble(instr: Instruction) -> String {
    let opcode = decode_opcode(instr);
    let opcode_enum = Opcode::from_u8(opcode);
    
    match opcode_enum {
        Some(Opcode::NOP) => "NOP".to_string(),
        Some(Opcode::END) => "END".to_string(),
        Some(Opcode::JMP) => format!("JMP {}", decode_operand_signed(instr)),
        Some(Opcode::JZ) => format!("JZ r{}, {}", decode_reg_a(instr), decode_imm16_signed(instr)),
        Some(Opcode::JNZ) => format!("JNZ r{}, {}", decode_reg_a(instr), decode_imm16_signed(instr)),
        Some(Opcode::CALL) => format!("CALL {}", decode_operand(instr)),
        Some(Opcode::RET) => "RET".to_string(),
        Some(Opcode::YIELD) => "YIELD".to_string(),
        Some(Opcode::WAIT) => format!("WAIT r{}", decode_reg_a(instr)),
        Some(Opcode::MOV) => format!("MOV r{}, r{}", decode_reg_a(instr), decode_reg_b(instr)),
        Some(Opcode::LOAD_CONST) => format!("LOAD_CONST r{}, #{}", decode_reg_a(instr), decode_imm16(instr)),
        Some(Opcode::LOAD_VAR) => format!("LOAD_VAR r{}, v{}", decode_reg_a(instr), decode_imm16(instr)),
        Some(Opcode::STORE_VAR) => format!("STORE_VAR v{}, r{}", decode_imm16(instr), decode_reg_a(instr)),
        Some(Opcode::LOAD_IMM) => format!("LOAD_IMM r{}, {}", decode_reg_a(instr), decode_imm16_signed(instr)),
        Some(Opcode::GET_X) => format!("GET_X r{}", decode_reg_a(instr)),
        Some(Opcode::GET_Y) => format!("GET_Y r{}", decode_reg_a(instr)),
        Some(Opcode::SET_X) => format!("SET_X r{}", decode_reg_a(instr)),
        Some(Opcode::SET_Y) => format!("SET_Y r{}", decode_reg_a(instr)),
        Some(Opcode::ADD) => format!("ADD r{}, r{}, r{}", decode_reg_a(instr), decode_reg_b(instr), decode_reg_c(instr)),
        Some(Opcode::SUB) => format!("SUB r{}, r{}, r{}", decode_reg_a(instr), decode_reg_b(instr), decode_reg_c(instr)),
        Some(Opcode::MUL) => format!("MUL r{}, r{}, r{}", decode_reg_a(instr), decode_reg_b(instr), decode_reg_c(instr)),
        Some(Opcode::DIV) => format!("DIV r{}, r{}, r{}", decode_reg_a(instr), decode_reg_b(instr), decode_reg_c(instr)),
        Some(Opcode::EQ) => format!("EQ r{}, r{}, r{}", decode_reg_a(instr), decode_reg_b(instr), decode_reg_c(instr)),
        Some(Opcode::LT) => format!("LT r{}, r{}, r{}", decode_reg_a(instr), decode_reg_b(instr), decode_reg_c(instr)),
        Some(Opcode::SHOW) => "SHOW".to_string(),
        Some(Opcode::HIDE) => "HIDE".to_string(),
        Some(Opcode::EXEC) => format!("EXEC {}", decode_imm16(instr)),
        Some(op) => format!("{:?} (0x{:08X})", op, instr),
        None => format!("UNKNOWN(0x{:02X}) 0x{:06X}", opcode, decode_operand(instr)),
    }
}

/// Disassemble a program to a vector of strings
#[allow(dead_code)]
pub fn disassemble_program(program: &Program) -> Vec<String> {
    program.instructions
        .iter()
        .enumerate()
        .map(|(i, &instr)| format!("{:04}: {}", i, disassemble(instr)))
        .collect()
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_instruction_encoding() {
        // Test basic encoding
        let instr = encode_instruction(Opcode::NOP, 0);
        assert_eq!(decode_opcode(instr), Opcode::NOP as u8);
        assert_eq!(decode_operand(instr), 0);
        
        // Test RRR encoding
        let instr = encode_rrr(Opcode::ADD, 1, 2, 3);
        assert_eq!(decode_opcode(instr), Opcode::ADD as u8);
        assert_eq!(decode_reg_a(instr), 1);
        assert_eq!(decode_reg_b(instr), 2);
        assert_eq!(decode_reg_c(instr), 3);
        
        // Test RI16 encoding
        let instr = encode_ri16(Opcode::LOAD_CONST, 5, 1000);
        assert_eq!(decode_opcode(instr), Opcode::LOAD_CONST as u8);
        assert_eq!(decode_reg_a(instr), 5);
        assert_eq!(decode_imm16(instr), 1000);
        
        // Test signed jump encoding
        let instr = encode_i24(Opcode::JMP, -10);
        assert_eq!(decode_opcode(instr), Opcode::JMP as u8);
        assert_eq!(decode_operand_signed(instr), -10);
    }
    
    #[test]
    fn test_instruction_builder() {
        assert_eq!(decode_opcode(InstructionBuilder::nop()), Opcode::NOP as u8);
        assert_eq!(decode_opcode(InstructionBuilder::end()), Opcode::END as u8);
        
        let add = InstructionBuilder::add(0, 1, 2);
        assert_eq!(decode_opcode(add), Opcode::ADD as u8);
        assert_eq!(decode_reg_a(add), 0);
        assert_eq!(decode_reg_b(add), 1);
        assert_eq!(decode_reg_c(add), 2);
    }
    
    #[test]
    fn test_register_allocator() {
        let mut alloc = RegisterAllocator::new();
        assert_eq!(alloc.alloc(), 0);
        assert_eq!(alloc.alloc(), 1);
        assert_eq!(alloc.alloc(), 2);
        
        alloc.enter_scope();
        assert_eq!(alloc.alloc(), 3);
        assert_eq!(alloc.alloc(), 4);
        alloc.exit_scope();
        
        assert_eq!(alloc.alloc(), 3); // Reuses registers after scope exit
    }
    
    #[test]
    fn test_program_constants() {
        let mut program = Program::new();
        
        let idx1 = program.add_constant(Value::Number(42.0));
        let idx2 = program.add_constant(Value::Number(100.0));
        let idx3 = program.add_constant(Value::Number(42.0)); // Duplicate
        
        assert_eq!(idx1, 0);
        assert_eq!(idx2, 1);
        assert_eq!(idx3, 0); // Should return existing index
        assert_eq!(program.constants.len(), 2);
    }
    
    #[test]
    fn test_program_strings() {
        let mut program = Program::new();
        
        let idx1 = program.add_string("hello".to_string());
        let idx2 = program.add_string("world".to_string());
        let idx3 = program.add_string("hello".to_string()); // Duplicate
        
        assert_eq!(idx1, 0);
        assert_eq!(idx2, 1);
        assert_eq!(idx3, 0); // Should return existing index
        assert_eq!(program.string_pool.len(), 2);
    }
    
    #[test]
    fn test_disassemble() {
        assert_eq!(disassemble(InstructionBuilder::nop()), "NOP");
        assert_eq!(disassemble(InstructionBuilder::end()), "END");
        assert!(disassemble(InstructionBuilder::add(0, 1, 2)).contains("ADD"));
    }
}
