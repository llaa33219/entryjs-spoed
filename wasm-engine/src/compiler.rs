use crate::blocks::{BlockTypeId, get_block_type_id};
use crate::{Block, ProjectData, Value};
use crate::bytecode::{Program, Instruction, ScriptInfo};

pub struct Compiler {
    program: Program,
}

impl Compiler {
    pub fn new() -> Self {
        Compiler {
            program: Program::default(),
        }
    }

    pub fn compile(mut self, project: &ProjectData) -> Program {
        if let Some(vars) = &project.variables {
            for (idx, var) in vars.iter().enumerate() {
                self.program.variable_map.insert(var.id.clone(), idx);
                self.program.string_pool.push(var.id.clone());
            }
        }
        
        if let Some(objects) = &project.objects {
            for (obj_idx, obj) in objects.iter().enumerate() {
                if let Some(scripts) = &obj.script {
                    for script in scripts {
                        self.compile_script(obj_idx, script);
                    }
                }
            }
        }
        
        self.program
    }

    fn compile_script(&mut self, entity_idx: usize, script: &Vec<Block>) {
        if script.is_empty() {
            return;
        }

        let first_block = &script[0];
        let type_id = get_block_type_id(&first_block.block_type);
        
        if crate::blocks::is_executable_block(&first_block.block_type) {
             return;
        }

        let start_pc = self.program.instructions.len();
        
        self.program.scripts.push(ScriptInfo {
            entity_index: entity_idx,
            start_pc,
            trigger_type: type_id,
            trigger_value: None,
        });

        for i in 1..script.len() {
            self.compile_block(&script[i]);
        }
        
        self.program.instructions.push(Instruction::End);
    }

    fn compile_block(&mut self, block: &Block) {
        let type_id = get_block_type_id(&block.block_type);
        
        match type_id {
            BlockTypeId::RepeatBasic => {
                self.compile_param(block, 0);
                
                if let Some(stmts) = &block.statements {
                    if let Some(_body) = stmts.first() {
                         
                    }
                }
            }
            BlockTypeId::SetVariable => {
                self.compile_param(block, 1);
                
                if let Some(params) = &block.params {
                    if let Some(id_val) = params.get(0) {
                        if let Some(id) = id_val.as_str() {
                            if let Some(&idx) = self.program.variable_map.get(id) {
                                self.program.instructions.push(Instruction::SetVar(idx as u16));
                                return;
                            }
                        }
                    }
                }
                
                self.program.instructions.push(Instruction::Exec(type_id));
            }
            BlockTypeId::GetVariable => {
                if let Some(params) = &block.params {
                    if let Some(id_val) = params.get(0) {
                        if let Some(id) = id_val.as_str() {
                            if let Some(&idx) = self.program.variable_map.get(id) {
                                self.program.instructions.push(Instruction::PushVar(idx as u16));
                                return;
                            }
                        }
                    }
                }
                
                self.program.instructions.push(Instruction::Exec(type_id));
            }
            _ => {
                if let Some(params) = &block.params {
                    for param in params {
                        self.compile_value_json(param);
                    }
                }
                
                self.program.instructions.push(Instruction::Exec(type_id));
            }
        }
    }
    
    fn compile_value_json(&mut self, json: &serde_json::Value) {
        match json {
            serde_json::Value::Number(n) => {
                let val = Value::Number(n.as_f64().unwrap_or(0.0));
                let idx = self.add_constant(val);
                self.program.instructions.push(Instruction::PushConst(idx as u16));
            }
            serde_json::Value::String(s) => {
                let val = Value::String(s.clone());
                let idx = self.add_constant(val);
                self.program.instructions.push(Instruction::PushConst(idx as u16));
            }
            serde_json::Value::Bool(b) => {
                let val = Value::Bool(*b);
                let idx = self.add_constant(val);
                self.program.instructions.push(Instruction::PushConst(idx as u16));
            }
            serde_json::Value::Object(obj) => {
                if let Some(type_str) = obj.get("type").and_then(|v| v.as_str()) {
                     let type_id = get_block_type_id(type_str);
                     
                     if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                         for p in params {
                             self.compile_value_json(p);
                         }
                     }
                     
                     self.program.instructions.push(Instruction::Exec(type_id));
                }
            }
            _ => {
                 let idx = self.add_constant(Value::Null);
                 self.program.instructions.push(Instruction::PushConst(idx as u16));
            }
        }
    }
    
    fn compile_param(&mut self, block: &Block, index: usize) {
        if let Some(params) = &block.params {
            if let Some(p) = params.get(index) {
                self.compile_value_json(p);
            } else {
                 let idx = self.add_constant(Value::Null);
                 self.program.instructions.push(Instruction::PushConst(idx as u16));
            }
        } else {
             let idx = self.add_constant(Value::Null);
             self.program.instructions.push(Instruction::PushConst(idx as u16));
        }
    }

    fn add_constant(&mut self, value: Value) -> usize {
        let idx = self.program.constants.len();
        self.program.constants.push(value);
        idx
    }
}
