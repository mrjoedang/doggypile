use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=../../../.git/HEAD");
    println!("cargo:rerun-if-changed=../../../.git/index");
    println!("cargo:rerun-if-changed=../../../.git/refs/heads");
    println!("cargo:rerun-if-changed=../../../.git/packed-refs");
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=Cargo.toml");
    println!("cargo:rerun-if-changed=src");

    let sha = git_output_text(&["rev-parse", "--short=12", "HEAD"])
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| "unknown".to_string());

    let dirty_hash = dirty_tree_hash();
    let build_git = match dirty_hash {
        Some(hash) => format!("{sha}-dirty.{hash:016x}"),
        None => sha,
    };
    println!("cargo:rustc-env=DOGGYPILE_BUILD_GIT={build_git}");
}

fn dirty_tree_hash() -> Option<u64> {
    let mut bytes = Vec::new();
    bytes.extend(git_output(&["diff", "HEAD", "--binary"])?);
    bytes.extend(git_output(&[
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
    ])?);
    (!bytes.is_empty()).then(|| fnv1a64(&bytes))
}

fn git_output_text(args: &[&str]) -> Option<String> {
    String::from_utf8(git_output(args)?).ok()
}

fn git_output(args: &[&str]) -> Option<Vec<u8>> {
    let output = Command::new("git").args(args).output().ok()?;
    output.status.success().then_some(output.stdout)
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}
