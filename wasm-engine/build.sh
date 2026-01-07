#!/bin/bash

# Build WASM engine
echo "Building Entry WASM Engine..."

# Build with wasm-pack
~/.cargo/bin/wasm-pack build --release --target web --out-dir ../player/wasm

echo "Build complete! Output in player/wasm/"
