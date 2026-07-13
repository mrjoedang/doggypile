use clap::{ArgAction, Args};
use qrcodegen::{QrCode, QrCodeEcc};

use crate::cli;
use crate::daemon::control::Request;
use crate::protocol::PairPayload;

#[derive(Args, Debug)]
pub struct PairArgs {
    /// Render an ASCII QR code for the pair link.
    #[arg(long, default_value_t = true, action = ArgAction::SetTrue)]
    pub qr: bool,

    /// Do not render the ASCII QR code.
    #[arg(long, conflicts_with = "qr")]
    pub no_qr: bool,

    /// Print the raw doggypile pair payload JSON instead of the doggypile PWA link.
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

    let out = if args.raw {
        serde_json::to_string(&payload)?
    } else {
        let base = args
            .url
            .as_deref()
            .map(str::to_owned)
            .or_else(|| std::env::var("DOGGYPILE_WEB").ok())
            .unwrap_or_else(|| "https://mrjoedang.github.io/doggypile/".to_string());
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
    };
    println!("{out}");
    if args.qr && !args.no_qr {
        println!();
        print_qr(&out)?;
    }
    Ok(())
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

fn print_qr(data: &str) -> anyhow::Result<()> {
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
    let mut y = lo;
    while y < hi {
        let mut line = String::with_capacity((hi - lo) as usize);
        for x in lo..hi {
            let top = module(x, y);
            let bot = module(x, y + 1);
            line.push(match (top, bot) {
                (true, true) => '█',
                (true, false) => '▀',
                (false, true) => '▄',
                (false, false) => ' ',
            });
        }
        println!("{line}");
        y += 2;
    }
    Ok(())
}
