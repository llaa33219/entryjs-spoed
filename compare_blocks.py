import re

def get_wasm_blocks(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Regex to capture keys in the phf_map
    # Matches: "block_name" => BlockTypeId::Variant
    pattern = r'"([a-zA-Z0-9_]+)"\s*=>\s*BlockTypeId::'
    blocks = set(re.findall(pattern, content))
    return blocks

def get_js_blocks(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    blocks = set()
    
    # We want to extract strings from the 'blocks' arrays in EntryStatic.getAllBlocks
    # Structure:
    # blocks: [
    #     'block1',
    #     'block2',
    # ]
    
    # Find the getAllBlocks function body or just scan the whole file for the pattern
    # The pattern is key 'blocks': [ ... ]
    
    # Let's match the blocks array content
    # This regex matches "blocks: [" followed by content until "]"
    # It captures the content inside [ ]
    blocks_array_pattern = r'blocks:\s*\[(.*?)\]'
    
    # re.DOTALL to make . match newlines
    arrays = re.findall(blocks_array_pattern, content, re.DOTALL)
    
    for array_content in arrays:
        # Extract single-quoted strings
        # We assume block names don't have escaped quotes for simplicity
        block_names = re.findall(r"'([a-zA-Z0-9_]+)'", array_content)
        for name in block_names:
            blocks.add(name)
            
    return blocks

wasm_path = 'wasm-engine/src/blocks.rs'
js_path = 'extern/util/static.js'

wasm_blocks = get_wasm_blocks(wasm_path)
js_blocks = get_js_blocks(js_path)

# Filter: Remove blocks ending with 'Button' (UI components)
js_blocks = {b for b in js_blocks if not b.endswith('Button')}

# Filter: Remove known non-block IDs if any (e.g., categories if they slipped in)
# The regex r"'([a-zA-Z0-9_]+)'" filters out CSS colors with # and paths with /

missing_in_wasm = js_blocks - wasm_blocks

print(f"Total WASM blocks: {len(wasm_blocks)}")
print(f"Total JS blocks: {len(js_blocks)}")
print(f"Missing in WASM: {len(missing_in_wasm)}")
print("\nMissing Blocks:")
for b in sorted(missing_in_wasm):
    print(f"- {b}")

