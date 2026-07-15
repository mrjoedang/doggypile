//! systemd user-unit install for Linux, with XDG-autostart `.desktop`
//! fallback when the systemd user manager is not reachable.

use std::path::Path;
use std::process::Command;

use std::os::unix::fs::FileTypeExt;

use anyhow::{Context, anyhow};

use crate::paths;
use crate::service::DAEMON_SUBCOMMAND;

pub(super) fn install() -> anyhow::Result<()> {
    let exe = std::env::current_exe().context("resolving current executable")?;
    let inherit_path = std::env::var("PATH").ok();
    let inherit_shell = std::env::var("SHELL").ok();

    if systemd_user_session_available() {
        let unit_path = paths::systemd_unit_path()?;
        let unit_name = systemd_unit_name(&unit_path)?;
        write_systemd_unit(
            &unit_path,
            &exe,
            inherit_path.as_deref(),
            inherit_shell.as_deref(),
        )?;
        run_systemctl(&["--user", "daemon-reload"])?;
        run_systemctl(&["--user", "enable", "--now", &unit_name])?;
        eprintln!(
            "Hint: to start the daemon at boot rather than at login, run:\n  \
             loginctl enable-linger $USER\n\
             (this needs sudo and is intentionally not run by `doggypile install`)"
        );
        return Ok(());
    }

    if has_xdg_session() {
        let desktop_path = paths::xdg_autostart_path()?;
        write_autostart_desktop(&desktop_path, &exe)?;
        eprintln!(
            "Installed XDG autostart entry at {}; the daemon will launch at next graphical login.",
            desktop_path.display()
        );
        return Ok(());
    }

    Err(anyhow!(
        "Linux init not supported (no reachable `systemd --user` session, no XDG graphical session). \
         Run `doggypile serve` manually under your init."
    ))
}

pub(super) fn uninstall() -> anyhow::Result<()> {
    let unit_path = paths::systemd_unit_path()?;
    if systemd_user_session_available() {
        if let Ok(unit_name) = systemd_unit_name(&unit_path) {
            let _ = run_systemctl(&["--user", "disable", "--now", &unit_name]);
        }
    }
    if unit_path.exists() {
        std::fs::remove_file(&unit_path)
            .with_context(|| format!("removing {}", unit_path.display()))?;
    }
    let desktop_path = paths::xdg_autostart_path()?;
    if desktop_path.exists() {
        std::fs::remove_file(&desktop_path)
            .with_context(|| format!("removing {}", desktop_path.display()))?;
    }
    if systemd_user_session_available() {
        let _ = run_systemctl(&["--user", "daemon-reload"]);
    }
    Ok(())
}

pub(super) fn is_installed() -> anyhow::Result<bool> {
    let unit_path = paths::systemd_unit_path()?;
    if unit_path.exists() && systemd_user_session_available() {
        let unit_name = systemd_unit_name(&unit_path)?;
        return Ok(systemd_unit_is_enabled(&unit_name));
    }
    Ok(paths::xdg_autostart_path()?.exists())
}

pub(super) fn write_systemd_unit(
    unit_path: &Path,
    exe: &Path,
    inherit_path: Option<&str>,
    inherit_shell: Option<&str>,
) -> anyhow::Result<()> {
    if let Some(parent) = unit_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating {}", parent.display()))?;
    }
    let body = render_systemd_unit(exe, inherit_path, inherit_shell);
    let tmp = unit_path.with_extension("service.tmp");
    std::fs::write(&tmp, body.as_bytes()).with_context(|| format!("writing {}", tmp.display()))?;
    std::fs::rename(&tmp, unit_path)
        .with_context(|| format!("renaming into {}", unit_path.display()))?;
    Ok(())
}

pub(super) fn write_autostart_desktop(desktop_path: &Path, exe: &Path) -> anyhow::Result<()> {
    if let Some(parent) = desktop_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating {}", parent.display()))?;
    }
    let body = render_autostart_desktop(exe);
    let tmp = desktop_path.with_extension("desktop.tmp");
    std::fs::write(&tmp, body.as_bytes()).with_context(|| format!("writing {}", tmp.display()))?;
    std::fs::rename(&tmp, desktop_path)
        .with_context(|| format!("renaming into {}", desktop_path.display()))?;
    Ok(())
}

fn render_systemd_unit(
    exe: &Path,
    inherit_path: Option<&str>,
    inherit_shell: Option<&str>,
) -> String {
    let exe = exe.to_string_lossy();
    // systemd `--user` units inherit `DefaultEnvironment=` from `manager.conf`,
    // not the user's interactive shell. Propagating PATH preserves the
    // expectation that `which("opencode")` / `which("pi")` resolves the
    // same way it does in the shell that ran `doggypile install`. SHELL is safe
    // to persist and lets the launch-environment resolver choose fish, zsh,
    // bash, or sh the same way the user does.
    let mut env_line = String::new();
    if let Some(path) = inherit_path {
        env_line.push_str(&format!("Environment=\"PATH={}\"\n", systemd_escape(path)));
    }
    if let Some(shell) = inherit_shell {
        env_line.push_str(&format!(
            "Environment=\"SHELL={}\"\n",
            systemd_escape(shell)
        ));
    }
    format!(
        "[Unit]\n\
         Description=doggypile bridge daemon\n\
         After=network-online.target\n\
         \n\
         [Service]\n\
         Type=simple\n\
         ExecStart={exe} {DAEMON_SUBCOMMAND}\n\
         {env_line}\
         Restart=on-failure\n\
         RestartSec=5\n\
         \n\
         [Install]\n\
         WantedBy=default.target\n"
    )
}

fn systemd_escape(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\\' => escaped.push_str("\\\\"),
            '"' => escaped.push_str("\\\""),
            '%' => escaped.push_str("%%"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            ch if ch.is_control() && (ch as u32) <= 0xff => {
                escaped.push_str(&format!("\\x{:02x}", ch as u32));
            }
            ch => escaped.push(ch),
        }
    }
    escaped
}

fn render_autostart_desktop(exe: &Path) -> String {
    let exe = exe.to_string_lossy();
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=doggypile\n\
         Exec={exe} {DAEMON_SUBCOMMAND}\n\
         Hidden=false\n\
         X-GNOME-Autostart-enabled=true\n\
         NoDisplay=true\n"
    )
}

fn systemd_user_session_available() -> bool {
    let runtime_dir = std::env::var_os("XDG_RUNTIME_DIR");
    if !systemd_runtime_facts_available(
        Path::new("/run/systemd/system"),
        runtime_dir.as_deref().map(Path::new),
    ) {
        return false;
    }

    Command::new("systemctl")
        .args(["--user", "show-environment"])
        .output()
        .map(|output| {
            output.status.success() && systemd_environment_output_is_valid(&output.stdout)
        })
        .unwrap_or(false)
}

fn systemd_runtime_facts_available(system_dir: &Path, runtime_dir: Option<&Path>) -> bool {
    system_dir.is_dir()
        && runtime_dir
            .and_then(|dir| std::fs::metadata(dir.join("systemd/private")).ok())
            .map(|metadata| metadata.file_type().is_socket())
            .unwrap_or(false)
}

fn systemd_environment_output_is_valid(stdout: &[u8]) -> bool {
    String::from_utf8_lossy(stdout).lines().any(|line| {
        let Some((name, _value)) = line.split_once('=') else {
            return false;
        };
        let mut chars = name.chars();
        matches!(chars.next(), Some('_' | 'A'..='Z' | 'a'..='z'))
            && chars.all(|ch| matches!(ch, '_' | 'A'..='Z' | 'a'..='z' | '0'..='9'))
    })
}

fn has_xdg_session() -> bool {
    std::env::var_os("XDG_CURRENT_DESKTOP")
        .map(|v| !v.is_empty())
        .unwrap_or(false)
        || std::env::var_os("XDG_SESSION_TYPE")
            .map(|v| !v.is_empty())
            .unwrap_or(false)
}

fn systemd_unit_name(unit_path: &Path) -> anyhow::Result<String> {
    unit_path
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
        .ok_or_else(|| anyhow!("invalid systemd unit path {}", unit_path.display()))
}

fn systemd_unit_is_enabled(unit_name: &str) -> bool {
    Command::new("systemctl")
        .args(["--user", "is-enabled", unit_name])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn run_systemctl(args: &[&str]) -> anyhow::Result<()> {
    let output = Command::new("systemctl")
        .args(args)
        .output()
        .with_context(|| format!("running systemctl {}", args.join(" ")))?;
    if !output.status.success() {
        let detail = concise_command_output(&output.stderr, &output.stdout);
        let mut message = format!(
            "systemctl {} failed (exit {:?})",
            args.join(" "),
            output.status.code()
        );
        if !detail.is_empty() {
            message.push_str(": ");
            message.push_str(&detail);
        }
        return Err(anyhow!(message));
    }
    Ok(())
}

fn concise_command_output(stderr: &[u8], stdout: &[u8]) -> String {
    let bytes = if stderr.iter().any(|b| !b.is_ascii_whitespace()) {
        stderr
    } else {
        stdout
    };
    let normalized = String::from_utf8_lossy(bytes)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let mut chars = normalized.chars();
    let detail: String = chars.by_ref().take(300).collect();
    if chars.next().is_some() {
        format!("{detail}…")
    } else {
        detail
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempHome;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;

    fn tempdir() -> PathBuf {
        let mut path = std::env::temp_dir();
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        path.push(format!(
            "doggypile-svc-linux-{}-{stamp}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).expect("temp dir");
        path
    }

    fn write_fake_systemctl(dir: &Path, log: &Path) -> PathBuf {
        let script = dir.join("systemctl");
        let body = format!(
            "#!/bin/sh\n\
             printf '%s\\n' \"$*\" >> \"{}\"\n\
             printf '%s\\n' '\"systemd\" is not running in this container'\n\
             exit 0\n",
            log.display()
        );
        std::fs::write(&script, body).expect("write fake systemctl");
        let mut perms = std::fs::metadata(&script)
            .expect("fake systemctl metadata")
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script, perms).expect("make fake systemctl executable");
        script
    }

    #[test]
    fn write_systemd_unit_contains_exec_start() {
        let tmp = tempdir();
        let unit = tmp.join("doggypile.service");
        let exe = PathBuf::from("/opt/doggypile/bin/doggypile");
        write_systemd_unit(&unit, &exe, None, None).expect("write unit");
        let body = std::fs::read_to_string(&unit).expect("read unit");
        assert!(body.contains(&format!(
            "ExecStart=/opt/doggypile/bin/doggypile {DAEMON_SUBCOMMAND}"
        )));
        assert!(body.contains("Restart=on-failure"));
        assert!(body.contains("WantedBy=default.target"));
        assert!(
            !body.contains("Environment=\"PATH="),
            "no inherit_path → no Environment line"
        );
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn write_systemd_unit_includes_environment_when_inherit_path_set() {
        let tmp = tempdir();
        let unit = tmp.join("doggypile.service");
        let exe = PathBuf::from("/opt/doggypile/bin/doggypile");
        write_systemd_unit(
            &unit,
            &exe,
            Some("/home/me/.local/bin:/usr/local/bin:/usr/bin"),
            Some("/usr/bin/fish"),
        )
        .expect("write unit");
        let body = std::fs::read_to_string(&unit).expect("read unit");
        assert!(body.contains("Environment=\"PATH=/home/me/.local/bin:/usr/local/bin:/usr/bin\""));
        assert!(body.contains("Environment=\"SHELL=/usr/bin/fish\""));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn systemd_escape_handles_special_environment_values() {
        let raw = "prefix:\\/home/claude/%h/bin:\"quoted\"\nnext\tend\x07";
        assert_eq!(
            systemd_escape(raw),
            "prefix:\\\\/home/claude/%%h/bin:\\\"quoted\\\"\\nnext\\tend\\x07"
        );
    }

    #[test]
    fn write_autostart_desktop_contains_exec() {
        let tmp = tempdir();
        let desktop = tmp.join("doggypile.desktop");
        let exe = PathBuf::from("/usr/bin/doggypile");
        write_autostart_desktop(&desktop, &exe).expect("write desktop");
        let body = std::fs::read_to_string(&desktop).expect("read desktop");
        assert!(body.contains(&format!("Exec=/usr/bin/doggypile {DAEMON_SUBCOMMAND}")));
        assert!(body.contains("[Desktop Entry]"));
        assert!(body.contains("Type=Application"));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn systemd_unit_name_uses_actual_packaged_unit_filename() {
        let unit = PathBuf::from("/home/me/.config/systemd/user/doggypile.service");
        assert_eq!(
            systemd_unit_name(&unit).expect("unit name"),
            "doggypile.service"
        );
    }

    #[test]
    fn systemd_runtime_facts_require_boot_and_user_manager_paths() {
        let tmp = tempdir();
        let system_dir = tmp.join("run/systemd/system");
        let runtime_dir = tmp.join("runtime");

        assert!(!systemd_runtime_facts_available(&system_dir, None));
        assert!(!systemd_runtime_facts_available(
            &system_dir,
            Some(&runtime_dir)
        ));

        std::fs::create_dir_all(&system_dir).expect("system directory");
        assert!(!systemd_runtime_facts_available(&system_dir, None));
        assert!(!systemd_runtime_facts_available(
            &system_dir,
            Some(&runtime_dir)
        ));

        let private = runtime_dir.join("systemd/private");
        std::fs::create_dir_all(private.parent().expect("private parent"))
            .expect("runtime systemd directory");
        std::fs::write(&private, b"").expect("regular private marker");
        assert!(
            !systemd_runtime_facts_available(&system_dir, Some(&runtime_dir)),
            "a regular file must not be mistaken for the user-manager socket"
        );
        std::fs::remove_file(&private).expect("remove regular private marker");
        let _private_socket = std::os::unix::net::UnixListener::bind(&private)
            .expect("bind private user-manager socket");
        assert!(systemd_runtime_facts_available(
            &system_dir,
            Some(&runtime_dir)
        ));

        std::fs::remove_dir_all(&system_dir).expect("remove system directory");
        assert!(!systemd_runtime_facts_available(
            &system_dir,
            Some(&runtime_dir)
        ));
    }

    #[test]
    fn systemd_environment_output_requires_an_assignment() {
        assert!(systemd_environment_output_is_valid(
            b"HOME=/home/joe\nPATH=/usr/bin:/bin\n"
        ));
        assert!(systemd_environment_output_is_valid(b"_=/usr/bin/env\n"));
        assert!(!systemd_environment_output_is_valid(b""));
        assert!(!systemd_environment_output_is_valid(
            b"\"systemd\" is not running in this container\n"
        ));
        assert!(!systemd_environment_output_is_valid(b"1INVALID=value\n"));
        assert!(!systemd_environment_output_is_valid(b"BAD-NAME=value\n"));
    }

    #[test]
    fn install_rejects_headless_sessions_without_touching_systemd() {
        let mut env = TempHome::new();
        let tmp = tempdir();
        let log = tmp.join("systemctl.log");
        let fake_bin = tmp.join("bin");
        std::fs::create_dir_all(&fake_bin).expect("fake bin dir");
        let _systemctl = write_fake_systemctl(&fake_bin, &log);

        let path = std::env::join_paths([fake_bin.as_os_str()]).expect("join PATH");
        env.override_env(&[
            ("PATH", path.to_str().expect("PATH utf-8")),
            (
                "XDG_RUNTIME_DIR",
                tmp.join("missing-runtime")
                    .to_str()
                    .expect("runtime path utf-8"),
            ),
            ("XDG_CURRENT_DESKTOP", ""),
            ("XDG_SESSION_TYPE", ""),
        ]);

        let err = install().expect_err("headless install should fail cleanly");
        let msg = err.to_string();
        assert!(
            msg.contains("Linux init not supported"),
            "unexpected error: {msg}"
        );

        assert!(
            !log.exists(),
            "systemctl shim must not be invoked without systemd runtime facts"
        );
    }

    #[test]
    fn is_installed_ignores_existing_unit_without_invoking_systemctl_without_runtime() {
        let mut home = TempHome::new();
        let tmp = tempdir();
        let log = tmp.join("systemctl.log");
        let fake_bin = tmp.join("bin");
        std::fs::create_dir_all(&fake_bin).expect("fake bin dir");
        let _systemctl = write_fake_systemctl(&fake_bin, &log);

        let path = std::env::join_paths([fake_bin.as_os_str()]).expect("join PATH");
        home.override_env(&[
            ("PATH", path.to_str().expect("PATH utf-8")),
            (
                "XDG_RUNTIME_DIR",
                tmp.join("missing-runtime")
                    .to_str()
                    .expect("runtime path utf-8"),
            ),
            ("XDG_CURRENT_DESKTOP", ""),
            ("XDG_SESSION_TYPE", ""),
        ]);

        let unit_path = paths::systemd_unit_path().expect("systemd unit path");
        if let Some(parent) = unit_path.parent() {
            std::fs::create_dir_all(parent).expect("create unit parent");
        }
        std::fs::write(&unit_path, b"[Unit]\nDescription=doggypile\n").expect("write unit");

        assert!(
            !is_installed().expect("check installed"),
            "an on-disk unit cannot supervise the daemon without its user manager"
        );
        assert!(
            !log.exists(),
            "systemctl shim must not be invoked without systemd runtime facts"
        );
    }

    #[test]
    fn run_systemctl_captures_failure_detail() {
        let mut env = TempHome::new();
        let tmp = tempdir();
        let fake_bin = tmp.join("bin");
        std::fs::create_dir_all(&fake_bin).expect("fake bin dir");
        let script = fake_bin.join("systemctl");
        std::fs::write(
            &script,
            "#!/bin/sh\nprintf 'manager unavailable\\nmore detail\\n' >&2\nexit 7\n",
        )
        .expect("write failing systemctl");
        let mut perms = std::fs::metadata(&script)
            .expect("failing systemctl metadata")
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script, perms).expect("make failing systemctl executable");

        let path = std::env::join_paths([fake_bin.as_os_str()]).expect("join PATH");
        env.override_env(&[("PATH", path.to_str().expect("PATH utf-8"))]);

        let err = run_systemctl(&["--user", "daemon-reload"])
            .expect_err("failing systemctl should return an error");
        let message = err.to_string();
        assert!(
            message.contains("exit Some(7)"),
            "unexpected error: {message}"
        );
        assert!(
            message.contains("manager unavailable more detail"),
            "captured stderr missing from error: {message}"
        );
    }
}
