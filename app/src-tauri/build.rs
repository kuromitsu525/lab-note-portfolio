fn main() {
    let target = std::env::var("TARGET").expect("TARGET is set by Cargo");
    let manifest_dir = std::path::PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by Cargo"),
    );
    let source = manifest_dir.join("../whisper.cpp/build-tauri/bin/whisper-server");
    let sidecar = manifest_dir.join(format!(
        "../whisper.cpp/build-tauri/bin/whisper-server-{target}{}",
        std::env::consts::EXE_SUFFIX
    ));

    println!("cargo:rerun-if-changed={}", source.display());
    if source.is_file() {
        std::fs::copy(&source, &sidecar).unwrap_or_else(|error| {
            panic!(
                "failed to prepare whisper-server sidecar ({} -> {}): {error}",
                source.display(),
                sidecar.display()
            )
        });
    }

    tauri_build::build()
}
