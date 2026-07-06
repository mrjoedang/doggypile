//! `<binary> upgrade` — bounce any running daemon onto *this* binary's
//! version. Designed to be invoked as `npx <wrapper>@latest upgrade`: npm
//! fetches the new tarball, then this subcommand stops the stale daemon
//! and respawns it from the current executable so subsequent CLI calls
//! talk to the upgraded binary.

use crate::cli;
use crate::daemon::control::{Request, StatusInfo};
use crate::ipc;

pub async fn run() -> anyhow::Result<()> {
    let cli_name = crate::binary_name();
    let cli_build = crate::binary_build_id();

    let restart_reason = if ipc::is_daemon_running().await {
        match cli::send(Request::Status).await {
            Ok(resp) => match cli::decode_data::<StatusInfo>(resp) {
                Ok(status) => cli::daemon_restart_reason(&status),
                Err(_) => Some("returned unparseable status".to_string()),
            },
            Err(_) => Some("is unreachable".to_string()),
        }
    } else {
        println!("{cli_name}: no daemon running; starting build {cli_build}...");
        cli::restart_daemon().await?;
        println!("{cli_name}: daemon started at build {cli_build}.");
        return Ok(());
    };

    let Some(reason) = restart_reason else {
        println!("{cli_name}: already running build {cli_build}; nothing to do.");
        return Ok(());
    };

    println!("{cli_name}: daemon {reason}; restarting onto build {cli_build}...");
    cli::restart_daemon().await?;
    println!("{cli_name}: daemon now running build {cli_build}.");
    Ok(())
}
