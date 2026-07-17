//! Per-OS install / uninstall of an autostart entry for `doggypile serve`.
//!
//! All three platforms are first-class and **never require admin**:
//! - macOS: launchd user agent (`~/Library/LaunchAgents/dev.doggypile.doggypile.plist`).
//! - Linux: systemd user unit, with `~/.config/autostart/doggypile.desktop`
//!   as a fallback for desktops without a reachable systemd user manager.
//! - Windows: `.lnk` in the per-user Startup folder, written by the `mslnk`
//!   crate (no COM, no admin).

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

/// Reverse-DNS service label, matched by `paths::launchd_plist_path()` and
/// the systemd unit filename. Comes from the [`crate::App`] the binary
/// supplied at startup (e.g. `com.sigkitten.doggypile` for the shipped
/// doggypile wrapper, `dev.doggypile.doggypile` for the dev binary).
pub fn service_label() -> &'static str {
    crate::app().label
}

/// Subcommand the autostart entry invokes on the `doggypile` binary.
pub const DAEMON_SUBCOMMAND: &str = "serve";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum InstallOutcome {
    Installed,
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    SessionOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum LinuxInstallMode {
    Systemd,
    XdgAutostart,
    SessionOnly,
    Unsupported,
}

pub(super) fn linux_install_mode(
    systemd_available: bool,
    xdg_session: bool,
    containerized: bool,
) -> LinuxInstallMode {
    if systemd_available {
        LinuxInstallMode::Systemd
    } else if xdg_session {
        LinuxInstallMode::XdgAutostart
    } else if containerized {
        LinuxInstallMode::SessionOnly
    } else {
        LinuxInstallMode::Unsupported
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn container_without_user_init_uses_session_only_mode() {
        assert_eq!(
            linux_install_mode(false, false, true),
            LinuxInstallMode::SessionOnly
        );
    }

    #[test]
    fn real_init_wins_inside_container() {
        assert_eq!(
            linux_install_mode(true, false, true),
            LinuxInstallMode::Systemd
        );
        assert_eq!(
            linux_install_mode(false, true, true),
            LinuxInstallMode::XdgAutostart
        );
    }

    #[test]
    fn bare_metal_without_supported_init_remains_unsupported() {
        assert_eq!(
            linux_install_mode(false, false, false),
            LinuxInstallMode::Unsupported
        );
    }
}

/// Install persistent autostart when the OS exposes a supported user init.
/// Init-less containers return [`InstallOutcome::SessionOnly`]; callers must
/// start the daemon now and let the container lifecycle restart it later.
pub fn install() -> anyhow::Result<InstallOutcome> {
    #[cfg(target_os = "macos")]
    {
        macos::install()?;
        Ok(InstallOutcome::Installed)
    }
    #[cfg(target_os = "linux")]
    {
        linux::install()
    }
    #[cfg(target_os = "windows")]
    {
        windows::install()?;
        Ok(InstallOutcome::Installed)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        Err(anyhow::anyhow!(
            "doggypile install is not supported on this platform"
        ))
    }
}

/// Remove the autostart entry. Idempotent.
pub fn uninstall() -> anyhow::Result<()> {
    #[cfg(target_os = "macos")]
    {
        macos::uninstall()
    }
    #[cfg(target_os = "linux")]
    {
        linux::uninstall()
    }
    #[cfg(target_os = "windows")]
    {
        windows::uninstall()
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        Ok(())
    }
}

/// True if the OS-level autostart entry is active. On Linux, a systemd unit
/// file must also be enabled; a disabled unit sitting on disk will not restart
/// the daemon after `stop`.
pub fn is_installed() -> anyhow::Result<bool> {
    #[cfg(target_os = "macos")]
    {
        Ok(crate::paths::launchd_plist_path()?.exists())
    }
    #[cfg(target_os = "linux")]
    {
        linux::is_installed()
    }
    #[cfg(target_os = "windows")]
    {
        Ok(crate::paths::windows_startup_lnk_path()?.exists())
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        Ok(false)
    }
}
