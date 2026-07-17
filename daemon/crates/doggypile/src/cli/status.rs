use std::fmt::Write as _;
use std::path::{MAIN_SEPARATOR, Path};
use std::sync::Arc;

use arc_swap::ArcSwap;
use clap::Args;

use crate::agents::AgentManager;
use crate::cli;
use crate::cli::presentation::{Theme, push_row, relay_summary, shorten_middle};
use crate::daemon::control::{Request, StatusInfo, token_fingerprint};
use crate::ipc;
use crate::paths;
use crate::protocol::AgentInfo;

#[derive(Args, Debug)]
pub struct StatusArgs {
    /// Emit machine-readable JSON instead of the human summary.
    #[arg(long)]
    pub json: bool,
}

pub async fn run(args: StatusArgs) -> anyhow::Result<()> {
    let running = ipc::is_daemon_running().await;
    let info = if running {
        let resp = cli::send(Request::Status).await?;
        cli::decode_data::<StatusInfo>(resp)?
    } else {
        offline_status().await?
    };

    if args.json {
        println!("{}", serde_json::to_string_pretty(&info)?);
        return Ok(());
    }

    print!("{}", render_human(&info, running, Theme::stdout()));
    Ok(())
}

fn render_human(info: &StatusInfo, running: bool, theme: Theme) -> String {
    let mut out = String::new();
    let state = if running { "running" } else { "offline" };
    let state_icon = if running {
        theme.green("●")
    } else {
        theme.yellow("○")
    };
    let _ = writeln!(
        out,
        "\n  {state_icon} {} {}\n",
        theme.bold(crate::binary_name()),
        theme.dim(format!("· {state}"))
    );

    let restart_reason = running.then(|| cli::daemon_restart_reason(info)).flatten();
    let daemon_icon = if running {
        theme.green("✓")
    } else {
        theme.dim("—")
    };
    let daemon_value = if running {
        format!("pid {} · up {}", info.pid, human_duration(info.uptime_secs))
    } else {
        "not running".to_string()
    };
    push_row(&mut out, &theme, daemon_icon, "Daemon", daemon_value);

    let version_icon = if restart_reason.is_some() {
        theme.yellow("!")
    } else {
        theme.dim("·")
    };
    push_row(
        &mut out,
        &theme,
        version_icon,
        "Version",
        version_summary(info),
    );
    push_row(
        &mut out,
        &theme,
        theme.dim("·"),
        "Node",
        shorten_middle(&info.node_id, 8),
    );
    push_row(
        &mut out,
        &theme,
        theme.dim("·"),
        "Relay",
        relay_summary(info.relay.as_deref()),
    );
    push_row(
        &mut out,
        &theme,
        theme.dim("·"),
        "Config",
        shorten_home(&info.config_path),
    );
    push_row(
        &mut out,
        &theme,
        theme.dim("·"),
        "Token",
        format!("{} · fingerprint", info.token_short),
    );

    let available: Vec<&str> = info
        .agents
        .iter()
        .filter(|agent| agent.available)
        .map(agent_label)
        .collect();
    let unavailable: Vec<&str> = info
        .agents
        .iter()
        .filter(|agent| !agent.available)
        .map(agent_label)
        .collect();
    let _ = writeln!(
        out,
        "\n  {} {}",
        theme.bold("Agents"),
        theme.dim(format!(
            "· {}/{} available",
            available.len(),
            info.agents.len()
        ))
    );
    if !available.is_empty() {
        push_row(
            &mut out,
            &theme,
            theme.green("✓"),
            "Available",
            available.join(" · "),
        );
    }
    if !unavailable.is_empty() {
        push_row(
            &mut out,
            &theme,
            theme.dim("—"),
            "Unavailable",
            unavailable.join(" · "),
        );
    }

    if let Some(reason) = restart_reason {
        let _ = writeln!(out, "\n  {} Daemon {reason}.", theme.yellow("!"));
        let _ = writeln!(
            out,
            "  Run {} to update it.",
            theme.cyan(format!("`{} upgrade`", crate::binary_name()))
        );
    } else if !running {
        let _ = writeln!(
            out,
            "\n  Run {} or {} to start it.",
            theme.cyan(format!("`{} serve`", crate::binary_name())),
            theme.cyan(format!("`{} install`", crate::binary_name()))
        );
    }
    let _ = writeln!(out);
    out
}
fn version_summary(info: &StatusInfo) -> String {
    let daemon_version = info.version.as_deref().unwrap_or("unknown");
    let cli_version = crate::binary_version();
    if daemon_version != cli_version {
        return format!("daemon {daemon_version} · CLI {cli_version}");
    }

    let mut parts = vec![daemon_version.to_string()];
    if info.build_id.as_deref() != Some(crate::binary_build_id().as_str()) {
        parts.push("different build".to_string());
    }
    if let Some(protocol) = info.protocol_version {
        parts.push(format!("protocol v{protocol}"));
    }
    parts.join(" · ")
}

fn human_duration(seconds: u64) -> String {
    let days = seconds / 86_400;
    let hours = (seconds % 86_400) / 3_600;
    let minutes = (seconds % 3_600) / 60;
    let seconds = seconds % 60;
    if days > 0 {
        format!("{days}d {hours}h")
    } else if hours > 0 {
        format!("{hours}h {minutes}m")
    } else if minutes > 0 {
        format!("{minutes}m {seconds}s")
    } else {
        format!("{seconds}s")
    }
}
fn shorten_home(value: &str) -> String {
    let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) else {
        return value.to_string();
    };
    let Ok(relative) = Path::new(value).strip_prefix(Path::new(&home)) else {
        return value.to_string();
    };
    if relative.as_os_str().is_empty() {
        "~".to_string()
    } else {
        format!("~{MAIN_SEPARATOR}{}", relative.display())
    }
}
fn agent_label(agent: &AgentInfo) -> &str {
    if agent.display_name.is_empty() {
        &agent.name
    } else {
        &agent.display_name
    }
}
/// Status when the daemon isn't running. Pid is 0 and uptime is 0 so the
/// human renderer can call out the offline state.
async fn offline_status() -> anyhow::Result<StatusInfo> {
    let cfg = crate::config::load_or_init().await?;
    let secret_key = crate::state::load_or_create_secret_key().await?;
    let agents_cfg = Arc::new(ArcSwap::from_pointee(cfg.clone()));
    let agents = AgentManager::new(Arc::clone(&agents_cfg)).await?;
    let agent_list: Vec<AgentInfo> = agents.list_agents().await;
    Ok(StatusInfo {
        pid: 0,
        node_id: secret_key.public().to_string(),
        token_short: token_fingerprint(&cfg.token),
        relay: cfg.relay.clone(),
        config_path: paths::host_config_file()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|_| "<unknown>".to_string()),
        uptime_secs: 0,
        agents: agent_list,
        version: Some(crate::binary_version().to_string()),
        build_id: Some(crate::binary_build_id()),
        protocol_version: Some(crate::protocol::PROTOCOL_VERSION),
        host_capabilities: Some(crate::host_capabilities()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::AgentWire;

    fn agent(name: &str, available: bool) -> AgentInfo {
        AgentInfo {
            name: name.to_lowercase(),
            display_name: name.to_string(),
            wire: AgentWire::Jsonl,
            available,
            presentation: None,
            capabilities: None,
        }
    }

    fn status() -> StatusInfo {
        StatusInfo {
            pid: 42,
            node_id: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0176543210".to_string(),
            token_short: "0123456789abcdef".to_string(),
            relay: Some("https://relay.example./".to_string()),
            config_path: "/tmp/doggypile/host.toml".to_string(),
            uptime_secs: 3_661,
            agents: vec![agent("Pi", true), agent("Codex", false)],
            version: Some(crate::binary_version().to_string()),
            build_id: Some(crate::binary_build_id()),
            protocol_version: Some(crate::protocol::PROTOCOL_VERSION),
            host_capabilities: Some(crate::host_capabilities()),
        }
    }

    #[test]
    fn human_status_is_compact_and_humanized() {
        let output = render_human(&status(), true, Theme::new(false));
        assert!(output.contains("doggypile · running"), "{output}");
        assert!(output.contains("pid 42 · up 1h 1m"), "{output}");
        assert!(output.contains("abcdef01…76543210"), "{output}");
        assert!(output.contains("relay.example"), "{output}");
        assert!(output.contains("1/2 available"), "{output}");
        assert!(output.contains("Pi"), "{output}");
        assert!(output.contains("Codex"), "{output}");
        assert!(!output.contains("wire="), "{output}");
        assert!(!output.contains(&status().node_id), "{output}");
    }

    #[test]
    fn stale_daemon_has_upgrade_hint() {
        let mut info = status();
        info.version = Some("0.1.0".to_string());
        let output = render_human(&info, true, Theme::new(false));
        assert!(output.contains("daemon 0.1.0 · CLI"), "{output}");
        assert!(output.contains("upgrade`"), "{output}");
    }

    #[test]
    fn offline_status_has_start_hint() {
        let output = render_human(&status(), false, Theme::new(false));
        assert!(output.contains("doggypile · offline"), "{output}");
        assert!(output.contains("Daemon       not running"), "{output}");
        assert!(output.contains("serve`"), "{output}");
        assert!(output.contains("install`"), "{output}");
    }

    #[test]
    fn duration_uses_two_most_relevant_units() {
        assert_eq!(human_duration(0), "0s");
        assert_eq!(human_duration(61), "1m 1s");
        assert_eq!(human_duration(3_661), "1h 1m");
        assert_eq!(human_duration(176_400), "2d 1h");
    }
}
