fn main() {
    // Tauri embeds the macOS development icon during code generation.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
