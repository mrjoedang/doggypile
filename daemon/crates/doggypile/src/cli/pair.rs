use std::fmt::Write as _;

use clap::{ArgAction, Args};
use qrcodegen::{QrCode, QrCodeEcc};

use crate::cli;
use crate::cli::presentation::{Theme, push_row, relay_summary, stdout_is_terminal};
use crate::daemon::control::Request;
use crate::protocol::PairPayload;

#[derive(Args, Debug)]
pub struct PairArgs {
    /// Render an ASCII QR code (automatic in interactive terminals).
    #[arg(long, action = ArgAction::SetTrue)]
    pub qr: bool,

    /// Print only the pairing URL; useful for scripts and copy/paste.
    #[arg(long, conflicts_with = "qr")]
    pub no_qr: bool,

    /// Print only the raw doggypile pair payload JSON.
    #[arg(long)]
    pub raw: bool,

    /// Override the doggypile PWA base URL.
    #[arg(long)]
    pub url: Option<String>,
}

pub async fn run(args: PairArgs) -> anyhow::Result<()> {
    // ensure_current_daemon() handles every state: no daemon, stale
    // daemon, current daemon. After this call, a v<this binary> daemon
    // is up on the IPC socket — and crucially, that daemon is the only
    // path that has the iroh endpoint and can populate the `relay` field
    // in the pair payload. We deliberately don't fall back to a
    // daemon-less "build payload from disk" mode, because that mode can't
    // emit a relay URL and the resulting QR is undialable on networks
    // where pkarr/DNS publishing is broken.
    cli::ensure_current_daemon().await?;

    let resp = cli::send(Request::Pair).await?;
    let payload: PairPayload = cli::decode_data(resp)?;

    if args.raw {
        println!("{}", serde_json::to_string(&payload)?);
        return Ok(());
    }

    let base = args
        .url
        .as_deref()
        .map(str::to_owned)
        .or_else(|| std::env::var("DOGGYPILE_WEB").ok())
        .unwrap_or_else(|| "https://mrjoedang.github.io/doggypile/".to_string());
    let link = pair_link(&payload, &base);
    if !should_render_qr(&args, stdout_is_terminal()) {
        println!("{link}");
        return Ok(());
    }

    print!("{}", render_interactive(&payload, &link, Theme::stdout())?);
    Ok(())
}

fn should_render_qr(args: &PairArgs, terminal: bool) -> bool {
    !args.raw && !args.no_qr && (args.qr || terminal)
}

fn pair_link(payload: &PairPayload, base: &str) -> String {
    let base = base.trim_end_matches('#');
    let mut link = format!(
        "{base}#node={}&token={}",
        encode_fragment_value(&payload.node_id),
        encode_fragment_value(&payload.token)
    );
    if let Some(name) = payload.host_name.as_deref() {
        link.push_str(&format!("&name={}", encode_fragment_value(name)));
    }
    if let Some(relay) = payload.relay.as_deref() {
        link.push_str(&format!("&relay={}", encode_fragment_value(relay)));
    }
    for addr in &payload.direct_addrs {
        link.push_str(&format!("&addr={}", encode_fragment_value(addr)));
    }
    link
}

fn render_interactive(payload: &PairPayload, link: &str, theme: Theme) -> anyhow::Result<String> {
    let mut out = String::new();
    let _ = writeln!(
        out,
        "\n  {} {} {}\n",
        theme.green("●"),
        theme.bold(crate::binary_name()),
        theme.dim("· pair")
    );
    let _ = writeln!(out, "  Scan this code with your phone.\n");
    for line in render_qr(link)?.lines() {
        let _ = writeln!(out, "  {line}");
    }

    let host = payload.host_name.as_deref().unwrap_or("this machine");
    let _ = writeln!(out);
    push_row(
        &mut out,
        &theme,
        theme.green("✓"),
        "Ready",
        format!("pairing link for {host}"),
    );
    push_row(
        &mut out,
        &theme,
        theme.dim("·"),
        "Relay",
        relay_summary(payload.relay.as_deref()),
    );
    let direct = match payload.direct_addrs.len() {
        0 => "none advertised".to_string(),
        1 => "1 address".to_string(),
        count => format!("{count} addresses"),
    };
    push_row(&mut out, &theme, theme.dim("·"), "Direct", direct);
    let _ = writeln!(
        out,
        "\n  Print the URL with {}.\n",
        theme.cyan(format!("`{} pair --no-qr`", crate::binary_name()))
    );
    Ok(out)
}

fn encode_fragment_value(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char);
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn render_qr(data: &str) -> anyhow::Result<String> {
    // Low ECC over Medium: ~7% capacity loss vs ~15%, often shaves one
    // version off the matrix. The QR is rendered on a clean digital screen
    // for a phone camera at close range — there's no dirt/glare to recover
    // from, so the higher levels are wasted bits.
    let code = QrCode::encode_text(data, QrCodeEcc::Low)
        .map_err(|err| anyhow::anyhow!("encoding QR: {err:?}"))?;
    let size = code.size();
    let border = 2_i32;
    let lo = -border;
    let hi = size + border;

    // Render two QR rows per terminal row using upper/lower half-block
    // glyphs (U+2580 ▀, U+2584 ▄, U+2588 █). Halves the vertical size of
    // the rendered code; combined with one-cell-per-module width, the QR
    // ends up roughly square in normal terminal aspect ratios.
    let module = |x: i32, y: i32| -> bool {
        if y < 0 || y >= size {
            false
        } else {
            code.get_module(x, y)
        }
    };
    let mut out = String::new();
    let mut y = lo;
    while y < hi {
        for x in lo..hi {
            let top = module(x, y);
            let bot = module(x, y + 1);
            out.push(match (top, bot) {
                (true, true) => '█',
                (true, false) => '▀',
                (false, true) => '▄',
                (false, false) => ' ',
            });
        }
        out.push('\n');
        y += 2;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser as _;

    #[derive(clap::Parser)]
    struct TestCli {
        #[command(flatten)]
        pair: PairArgs,
    }

    fn payload() -> PairPayload {
        PairPayload {
            v: 1,
            node_id: "node id".to_string(),
            token: "secret token".to_string(),
            host_name: Some("dev-machine".to_string()),
            relay: Some("https://relay.example./".to_string()),
            direct_addrs: vec!["127.0.0.1:49700".to_string()],
        }
    }

    fn args() -> PairArgs {
        PairArgs {
            qr: false,
            no_qr: false,
            raw: false,
            url: None,
        }
    }

    #[test]
    fn cli_defaults_leave_qr_choice_to_terminal_detection() {
        let parsed = TestCli::try_parse_from(["test"]).unwrap().pair;
        assert!(!parsed.qr);
        assert!(!parsed.no_qr);
        assert!(!parsed.raw);
        assert!(TestCli::try_parse_from(["test", "--qr", "--no-qr"]).is_err());
    }

    #[test]
    fn pair_link_encodes_every_fragment_value() {
        let link = pair_link(&payload(), "https://example.test/");
        assert!(link.starts_with("https://example.test/#node=node%20id&token=secret%20token"));
        assert!(link.contains("&name=dev-machine"));
        assert!(link.contains("&relay=https%3A%2F%2Frelay.example.%2F"));
        assert!(link.contains("&addr=127.0.0.1%3A49700"));
    }

    #[test]
    fn qr_policy_keeps_redirects_and_machine_modes_clean() {
        let mut options = args();
        assert!(should_render_qr(&options, true));
        assert!(!should_render_qr(&options, false));

        options.qr = true;
        assert!(should_render_qr(&options, false));
        options.no_qr = true;
        assert!(!should_render_qr(&options, true));
        options.raw = true;
        assert!(!should_render_qr(&options, true));
    }

    #[test]
    fn interactive_summary_never_prints_pairing_credentials() {
        let payload = payload();
        let link = pair_link(&payload, "https://example.test/");
        let output = render_interactive(&payload, &link, Theme::new(false)).unwrap();
        assert!(output.contains("doggypile · pair"), "{output}");
        assert!(output.contains("Scan this code"), "{output}");
        assert!(output.contains("pairing link for dev-machine"), "{output}");
        assert!(output.contains("relay.example"), "{output}");
        assert!(output.contains("1 address"), "{output}");
        assert!(output.contains("pair --no-qr"), "{output}");
        assert!(!output.contains(&link), "{output}");
        assert!(!output.contains(&payload.token), "{output}");
    }

    #[test]
    fn qr_renderer_has_quiet_border_and_half_block_rows() {
        let qr = render_qr("hello").unwrap();
        let lines: Vec<&str> = qr.lines().collect();
        assert!(!lines.is_empty());
        assert!(lines[0].trim().is_empty());
        assert!(qr.contains(['█', '▀', '▄']));
    }
}
