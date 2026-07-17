//! Thin client subcommands that talk to the running daemon over the IPC
//! control socket. Each subcommand opens a fresh connection, writes a single
//! length-prefixed JSON request, reads a single response, and exits.

use std::time::{Duration, Instant};

use anyhow::{Context, anyhow};

use crate::daemon::control::{Request, Response, StatusInfo};
use crate::framing::{read_json_frame, write_json_frame};
use crate::ipc;

pub mod agents;
pub mod logs;
pub mod onboarding;
pub mod pair;
pub(crate) mod presentation;
pub mod probe;
pub mod reload;
pub mod rotate;
pub mod status;
pub mod stop;
pub mod upgrade;
pub mod web;

/// Send a single request to the daemon and read back the response.
/// Errors with a friendly hint if the daemon is not running.
pub async fn send(req: Request) -> anyhow::Result<Response> {
    let mut stream = ipc::connect().await.with_context(|| {
        let name = crate::binary_name();
        format!("daemon not running. start it with `{name} serve` or `{name} install`.")
    })?;
    write_json_frame(&mut stream, &req)
        .await
        .context("writing control request")?;
    let resp: Response = read_json_frame(&mut stream)
        .await
        .context("reading control response")?;
    Ok(resp)
}

/// Decode the typed payload from a successful response. Bails with the
/// daemon-supplied error message when `ok` is false.
pub fn decode_data<T: serde::de::DeserializeOwned>(resp: Response) -> anyhow::Result<T> {
    if !resp.ok {
        return Err(anyhow!(resp.error.unwrap_or_else(|| "daemon error".into())));
    }
    let data = resp
        .data
        .ok_or_else(|| anyhow!("daemon returned empty data"))?;
    Ok(serde_json::from_value(data)?)
}

/// Bail when the daemon returned `ok=false`.
pub fn require_ok(resp: &Response) -> anyhow::Result<()> {
    if !resp.ok {
        return Err(anyhow!(
            resp.error.clone().unwrap_or_else(|| "daemon error".into())
        ));
    }
    Ok(())
}

/// Make sure a daemon of *this* binary's version is running and reachable
/// on the IPC socket. Handles every state the user might be in:
///
/// - no daemon at all              → spawn detached
/// - daemon up, version matches    → no-op
/// - daemon up, version mismatch   → gracefully restart onto current_exe
/// - daemon up, version unknown    → assume stale, restart
/// - autostart installed but wedged (launchd throttle, stale plist path) →
///   fall through to manual spawn
///
/// Called at the top of subcommands that mutate user-visible state
/// (`pair`, `rotate`) and at the top of the bare-invocation onboarding
/// flow, so users never have to know whether a daemon is up, fresh, or
/// stale — `npx kittylitter` Just Works regardless of prior state.
pub async fn ensure_current_daemon() -> anyhow::Result<()> {
    if !ipc::is_daemon_running().await {
        // Nothing listening — nothing to compare versions against. Just
        // start one. restart_daemon() handles the autostart-rewrite +
        // detached-spawn dance.
        return restart_daemon().await;
    }

    // Something is listening. Ask its version/build/protocol identity. If the
    // IPC handshake fails (socket exists but daemon is wedged), treat it as
    // stale and bounce.
    let restart_reason = match send(Request::Status).await {
        Ok(resp) => match decode_data::<StatusInfo>(resp) {
            Ok(status) => daemon_restart_reason(&status),
            Err(_) => Some("returned unparseable status".to_string()),
        },
        Err(_) => Some("is unreachable".to_string()),
    };

    let Some(reason) = restart_reason else {
        return Ok(());
    };

    eprintln!(
        "note: daemon {reason}; restarting {cli} daemon onto current build {build}...",
        cli = crate::binary_name(),
        build = crate::binary_build_id()
    );
    restart_daemon().await
}

fn daemon_restart_reason(status: &StatusInfo) -> Option<String> {
    let current_version = crate::binary_version();
    let daemon_version = status.version.as_deref().unwrap_or("<unknown>");
    if daemon_version != current_version {
        return Some(format!(
            "is v{daemon_version} but current {} is v{current_version}",
            crate::binary_name()
        ));
    }

    let current_build = crate::binary_build_id();
    let daemon_build = status.build_id.as_deref().unwrap_or("<unknown>");
    if daemon_build != current_build {
        return Some(format!(
            "build id is {daemon_build} but current build is {current_build}"
        ));
    }

    let current_protocol = crate::protocol::PROTOCOL_VERSION;
    let daemon_protocol = status.protocol_version.unwrap_or(0);
    if daemon_protocol != current_protocol {
        return Some(format!(
            "protocol is v{daemon_protocol} but current protocol is v{current_protocol}"
        ));
    }

    let caps = status.host_capabilities.as_deref().unwrap_or(&[]);
    for required in crate::HOST_CAPABILITIES {
        if !caps.iter().any(|cap| cap == required) {
            return Some(format!("is missing `{required}` host capability"));
        }
    }

    None
}

/// Stop any running daemon and start a fresh one from `current_exe`.
/// Public so the explicit `upgrade` subcommand can reuse the same path.
///
/// If an OS-level autostart supervisor is installed (launchd / systemd-user
/// / Windows Startup `.lnk` / XDG `.desktop`), this also rewrites that
/// entry so the supervisor stops pointing at a stale path. macOS launchd
/// and Linux systemd-user re-kickstart the daemon on their own once the
/// pointer is rewritten; Windows and XDG-fallback Linux don't, so we fall
/// back to spawning ourselves. The single-instance file lock in
/// `daemon::run` is the safety net against accidentally spawning two
/// daemons if a supervisor races us.
pub async fn restart_daemon() -> anyhow::Result<()> {
    if ipc::is_daemon_running().await {
        let _ = send(Request::Stop).await;
        wait_until(Duration::from_secs(10), || async {
            !ipc::is_daemon_running().await
        })
        .await
        .context("old daemon did not exit within 10s")?;
    }

    let supervisor = crate::service::is_installed().unwrap_or(false);
    let supervisor_rearmed = if supervisor {
        // Re-bind the supervisor entry to current_exe. Best-effort: if the
        // user's launchd/systemd state is wedged we still want to spawn the
        // new daemon ourselves below, not bail.
        match crate::service::install() {
            Ok(()) => true,
            Err(error) => {
                eprintln!(
                    "warning: re-installing autostart entry failed: {error:#}; falling back to manual respawn"
                );
                false
            }
        }
    } else {
        false
    };

    // Give a successfully re-armed launchd/systemd supervisor a moment to
    // bring the daemon back up via the rewritten unit. When there is no
    // supervisor or re-installing it failed, spawn immediately.
    let supervisor_started = if let Some(timeout) = supervisor_wait_timeout(supervisor_rearmed) {
        wait_until(timeout, || async { ipc::is_daemon_running().await })
            .await
            .is_ok()
    } else {
        false
    };

    if !supervisor_started {
        spawn_serve_detached().context("spawning new daemon")?;
        wait_until(Duration::from_secs(15), || async {
            ipc::is_daemon_running().await
        })
        .await
        .context("new daemon did not come up within 15s")?;
    }

    Ok(())
}

fn supervisor_wait_timeout(supervisor_rearmed: bool) -> Option<Duration> {
    supervisor_rearmed.then_some(Duration::from_secs(5))
}

/// Spawn `current_exe serve` as a session-detached background process so
/// it survives the parent CLI exit and any controlling-terminal hangup
/// signal (Unix SIGHUP / Windows console-close).
fn spawn_serve_detached() -> anyhow::Result<()> {
    let exe = std::env::current_exe().context("locating current executable")?;
    let mut cmd = std::process::Command::new(&exe);
    cmd.arg("serve")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Detach from the controlling terminal: setsid() makes the child a
        // new session leader so a closing terminal can't SIGHUP it.
        unsafe {
            cmd.pre_exec(|| {
                if libc::setsid() < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // DETACHED_PROCESS: child has no console (we already redirect
        // std{in,out,err} to null and the daemon writes to file logs, so
        // no console is needed).
        // CREATE_NEW_PROCESS_GROUP: child becomes its own process-group
        // leader so a Ctrl+C / Ctrl+Break in the parent's console doesn't
        // propagate to it.
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }

    cmd.spawn().context("spawning daemon child")?;
    Ok(())
}

/// Poll `cond` every 100ms until it returns true or `deadline` elapses.
/// Returns `Ok(())` on success, `Err` with a context-friendly message
/// once the deadline trips.
async fn wait_until<F, Fut>(deadline: Duration, mut cond: F) -> anyhow::Result<()>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = bool>,
{
    let start = Instant::now();
    loop {
        if cond().await {
            return Ok(());
        }
        if start.elapsed() >= deadline {
            return Err(anyhow!("timed out waiting for daemon state"));
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn current_status() -> StatusInfo {
        StatusInfo {
            pid: 1,
            node_id: "node".to_string(),
            token_short: "token".to_string(),
            relay: None,
            config_path: "host.toml".to_string(),
            uptime_secs: 1,
            agents: Vec::new(),
            version: Some(crate::binary_version().to_string()),
            build_id: Some(crate::binary_build_id()),
            protocol_version: Some(crate::protocol::PROTOCOL_VERSION),
            host_capabilities: Some(crate::host_capabilities()),
        }
    }

    #[test]
    fn current_daemon_identity_does_not_restart() {
        assert!(daemon_restart_reason(&current_status()).is_none());
    }

    #[test]
    fn same_version_different_build_restarts() {
        let mut status = current_status();
        status.build_id = Some("0.1.1+old".to_string());
        let reason = daemon_restart_reason(&status).unwrap();
        assert!(reason.contains("build id"));
    }

    #[test]
    fn missing_install_capability_restarts() {
        let mut status = current_status();
        status.host_capabilities = Some(Vec::new());
        let reason = daemon_restart_reason(&status).unwrap();
        assert!(reason.contains("install_agent"));
    }

    #[test]
    fn older_status_without_build_identity_restarts() {
        let mut status = current_status();
        status.build_id = None;
        let reason = daemon_restart_reason(&status).unwrap();
        assert!(reason.contains("build id"));
    }

    #[test]
    fn supervisor_wait_requires_successful_rearm() {
        assert_eq!(supervisor_wait_timeout(false), None);
        assert_eq!(supervisor_wait_timeout(true), Some(Duration::from_secs(5)));
    }
}
