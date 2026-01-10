use serde::{Serialize, Deserialize};
use crate::blocks::BlockTypeId;
use crate::Value;
use std::collections::HashMap;

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct Program {
    pub instructions: Vec<Instruction>,
    pub constants: Vec<Value>,
    pub string_pool: Vec<String>,
    pub variable_map: HashMap<String, usize>,
    pub functions: HashMap<String, usize>,
    pub scripts: Vec<ScriptInfo>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ScriptInfo {
    pub entity_index: usize,
    pub start_pc: usize,
    pub trigger_type: BlockTypeId,
    pub trigger_value: Option<usize>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
pub enum Instruction {
    Nop,
    Jump(i32),
    JumpIfFalse(i32),
    Call(u16),
    Return,
    PushConst(u16),
    PushVar(u16),
    SetVar(u16),
    PushLocal(u16),
    SetLocal(u16),
    GetX,
    GetY,
    SetX,
    SetY,
    Exec(BlockTypeId), 
    End,
}
