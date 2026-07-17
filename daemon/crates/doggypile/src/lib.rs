//! doggypile daemon library entry point. The `doggypile` binary calls
//! [`run`] with their CLI display name.

mod agent_manifest;
mod agents;
mod cli;
mod config;
mod daemon;
mod framing;
mod host;
mod ipc;
mod paths;
mod protocol;
mod service;
mod state;
mod stream;
#[cfg(test)]
mod test_support;
mod web_assets;

use std::sync::OnceLock;

use clap::{CommandFactory, FromArgMatches, Parser, Subcommand};
use tracing_subscriber::EnvFilter;

/// Branding + OS-identity supplied by the binary that drives this library.
/// Defaults to doggypile's CLI display name and OS identity. Tests fall
/// through to [`App::DEFAULT`] so existing assertions keep working.
#[derive(Clone, Copy, Debug)]
pub struct App {
    /// Argv[0]-style program name. Surfaced in `--help` output and in
    /// user-facing error/status strings via [`binary_name`].
    pub binary_name: &'static str,
    /// Reverse-DNS top-level qualifier (e.g. `com`).
    pub qualifier: &'static str,
    /// Reverse-DNS organization fragment as it should appear in
    /// `directories::ProjectDirs` paths (case-sensitive on macOS, e.g.
    /// `sigkitten`).
    pub organization: &'static str,
    /// Application slug (lowercase recommended). Used for state/log dir
    /// names, systemd unit, Windows .lnk, etc.
    pub application: &'static str,
    /// Reverse-DNS label used as the launchd Label, the plist filename
    /// stem, and `service::service_label()` (e.g. `dev.doggypile.doggypile`).
    pub label: &'static str,
    /// SemVer of the *binary* (e.g. `doggypile` 0.2.1),
    /// not of this library. Reported by the daemon over IPC so a freshly
    /// installed CLI can detect a stale long-running daemon and respawn
    /// itself transparently. Binaries should pass `env!("CARGO_PKG_VERSION")`.
    pub version: &'static str,
}

impl App {
    /// Defaults the library reverts to when no `App` has been registered.
    pub const DEFAULT: App = App {
        binary_name: "doggypile",
        qualifier: "dev",
        organization: "doggypile",
        application: "doggypile",
        label: "dev.doggypile.doggypile",
        version: env!("CARGO_PKG_VERSION"),
    };

    /// Build a tokio runtime, parse CLI args using `self.binary_name` as
    /// the program name, and dispatch to the matching subcommand.
    pub fn run(self) -> anyhow::Result<()> {
        let _ = APP.set(self);
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()?;
        runtime.block_on(async_main())
    }
}

static APP: OnceLock<App> = OnceLock::new();

/// Currently-registered [`App`], or [`App::DEFAULT`] if none.
pub(crate) fn app() -> &'static App {
    APP.get().unwrap_or(&App::DEFAULT)
}

/// Name the user invoked the binary with. Threaded into user-facing CLI
/// strings so error/help messages reference the right command.
pub fn binary_name() -> &'static str {
    app().binary_name
}

/// SemVer string of the binary that registered this `App`. Used by the
/// daemon to advertise its own version and by the CLI to compare against
/// it before mutating user-visible state.
pub fn binary_version() -> &'static str {
    app().version
}

/// Build identity for same-version stale-daemon detection. Includes the
/// package version plus the git SHA captured at compile time when available.
pub fn binary_build_id() -> String {
    let git = option_env!("DOGGYPILE_BUILD_GIT").unwrap_or("unknown");
    format!("{}+{}", binary_version(), git)
}

pub(crate) const HOST_CAP_INSTALL_AGENT: &str = "install_agent";
pub(crate) const HOST_CAPABILITIES: &[&str] = &[HOST_CAP_INSTALL_AGENT];

pub(crate) fn host_capabilities() -> Vec<String> {
    HOST_CAPABILITIES
        .iter()
        .map(|cap| (*cap).to_string())
        .collect()
}

#[derive(Parser)]
#[command(
    name = "doggypile",
    version,
    about = "doggypile — bridge a local codex agent to the doggypile PWA over iroh"
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Run the long-running daemon. Owns the iroh endpoint, the persistent
    /// identity, and the IPC control socket.
    Serve,
    /// Install the OS-appropriate autostart entry (launchd / systemd-user /
    /// Windows Startup folder). Does not require admin.
    Install,
    /// Remove the autostart entry.
    Uninstall,
    /// Print the running daemon's status (falls back to file-only when the
    /// daemon isn't running).
    Status(cli::status::StatusArgs),
    /// Display a pairing QR, or print the pairing URL/JSON for automation.
    Pair(cli::pair::PairArgs),
    /// Mint a fresh token. Node id is preserved.
    Rotate,
    /// Tail the daemon log files under `paths::log_dir()`.
    Logs(cli::logs::LogsArgs),
    /// Stop the running daemon.
    Stop,
    /// Reload `host.toml` live in the running daemon.
    Reload,
    /// Restart the daemon from this binary.
    Restart,
    /// Inspect agents.
    Agents(cli::agents::AgentsArgs),
    /// Connect to the daemon over iroh like a phone client and run JSON-RPC
    /// methods directly. Defaults to invoking `thread/list` on the chosen agent.
    Probe(cli::probe::ProbeArgs),
    /// Serve the embedded doggypile PWA from this binary.
    Web(cli::web::WebArgs),
    /// Restart any running daemon onto the version of *this* binary.
    Upgrade,
}

async fn async_main() -> anyhow::Result<()> {
    let matches = Cli::command().name(binary_name()).get_matches();
    let cli = Cli::from_arg_matches(&matches)?;
    match cli.command {
        None => {
            init_cli_logging();
            cli::onboarding::run().await
        }
        Some(Command::Serve) => daemon::run().await,
        Some(Command::Install) => {
            init_cli_logging();
            service::install()?;
            println!("installed.");
            Ok(())
        }
        Some(Command::Uninstall) => {
            init_cli_logging();
            service::uninstall()?;
            println!("uninstalled.");
            Ok(())
        }
        Some(Command::Status(args)) => {
            init_cli_logging();
            cli::status::run(args).await
        }
        Some(Command::Pair(args)) => {
            init_cli_logging();
            cli::pair::run(args).await
        }
        Some(Command::Rotate) => {
            init_cli_logging();
            cli::rotate::run().await
        }
        Some(Command::Logs(args)) => {
            init_cli_logging();
            cli::logs::run(args).await
        }
        Some(Command::Stop) => {
            init_cli_logging();
            cli::stop::run().await
        }
        Some(Command::Reload) => {
            init_cli_logging();
            cli::reload::run().await
        }
        Some(Command::Restart) => {
            init_cli_logging();
            cli::restart_daemon().await?;
            println!("daemon restarted.");
            Ok(())
        }
        Some(Command::Agents(args)) => {
            init_cli_logging();
            cli::agents::run(args).await
        }
        Some(Command::Probe(args)) => {
            init_cli_logging();
            cli::probe::run(args).await
        }
        Some(Command::Web(args)) => {
            init_cli_logging();
            cli::web::run(args).await
        }
        Some(Command::Upgrade) => {
            init_cli_logging();
            cli::upgrade::run().await
        }
    }
}

fn init_cli_logging() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| {
            EnvFilter::new("warn,doggypile=info,iroh=error,noq=error,noq_udp=error,quinn=error")
        }))
        .with_writer(std::io::stderr)
        .try_init();
}
