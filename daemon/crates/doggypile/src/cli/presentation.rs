//! Shared terminal presentation primitives for human-facing CLI commands.
//!
//! Machine-readable modes bypass this module entirely. Human renderers own
//! their wording and grouping while sharing color policy, aligned rows, and
//! compact endpoint formatting here.

use std::fmt::Write as _;
use std::io::IsTerminal;

pub(crate) fn stdout_is_terminal() -> bool {
    std::io::stdout().is_terminal()
}

pub(crate) struct Theme {
    color: bool,
}

impl Theme {
    pub(crate) fn stdout() -> Self {
        Self::new(
            stdout_is_terminal()
                && std::env::var_os("NO_COLOR").is_none()
                && std::env::var("FORCE_COLOR").as_deref() != Ok("0"),
        )
    }

    pub(crate) fn new(color: bool) -> Self {
        Self { color }
    }

    fn paint(&self, code: &str, text: impl AsRef<str>) -> String {
        let text = text.as_ref();
        if self.color {
            format!("\x1b[{code}m{text}\x1b[0m")
        } else {
            text.to_string()
        }
    }

    pub(crate) fn bold(&self, text: impl AsRef<str>) -> String {
        self.paint("1", text)
    }

    pub(crate) fn dim(&self, text: impl AsRef<str>) -> String {
        self.paint("2", text)
    }

    pub(crate) fn cyan(&self, text: impl AsRef<str>) -> String {
        self.paint("36", text)
    }

    pub(crate) fn green(&self, text: impl AsRef<str>) -> String {
        self.paint("32", text)
    }

    pub(crate) fn yellow(&self, text: impl AsRef<str>) -> String {
        self.paint("33", text)
    }
}

pub(crate) fn push_row(
    out: &mut String,
    theme: &Theme,
    icon: String,
    label: &str,
    value: impl AsRef<str>,
) {
    let label = format!("{label:<12}");
    let _ = writeln!(out, "  {icon}  {} {}", theme.dim(label), value.as_ref());
}

pub(crate) fn shorten_middle(value: &str, side: usize) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= side * 2 + 1 {
        return value.to_string();
    }
    let start: String = chars[..side].iter().collect();
    let end: String = chars[chars.len() - side..].iter().collect();
    format!("{start}…{end}")
}

pub(crate) fn relay_summary(relay: Option<&str>) -> String {
    let Some(relay) = relay else {
        return "iroh default".to_string();
    };
    relay
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .trim_end_matches('.')
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_theme_preserves_alignment_without_escape_codes() {
        let theme = Theme::new(false);
        let mut output = String::new();
        push_row(&mut output, &theme, theme.green("✓"), "Ready", "paired");
        assert_eq!(output, "  ✓  Ready        paired\n");
        assert!(!output.contains("\x1b["));
    }

    #[test]
    fn endpoint_helpers_keep_human_output_compact() {
        assert_eq!(shorten_middle("abcdefghijklmnop", 4), "abcd…mnop");
        assert_eq!(
            relay_summary(Some("https://relay.example./")),
            "relay.example"
        );
        assert_eq!(relay_summary(None), "iroh default");
    }
}
