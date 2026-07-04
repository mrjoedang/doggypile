use std::net::SocketAddr;

use anyhow::Context;
use clap::Args;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[derive(Args, Debug)]
pub struct WebArgs {
    /// Interface to bind the embedded PWA server to.
    #[arg(long, default_value = "127.0.0.1")]
    pub host: String,

    /// Port to serve the embedded PWA on.
    #[arg(long, short, default_value_t = 8123)]
    pub port: u16,
}

struct Asset {
    bytes: &'static [u8],
    content_type: &'static str,
}

pub async fn run(args: WebArgs) -> anyhow::Result<()> {
    let addr: SocketAddr = format!("{}:{}", args.host, args.port)
        .parse()
        .with_context(|| format!("parsing bind address {}:{}", args.host, args.port))?;
    let listener = TcpListener::bind(addr)
        .await
        .with_context(|| format!("binding embedded web server on http://{addr}"))?;
    println!("serving embedded doggypile PWA at http://{addr}");

    loop {
        let (mut stream, _) = listener.accept().await?;
        tokio::spawn(async move {
            let mut buf = [0_u8; 8192];
            let n = match stream.read(&mut buf).await {
                Ok(0) | Err(_) => return,
                Ok(n) => n,
            };
            let req = String::from_utf8_lossy(&buf[..n]);
            let path = req
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .unwrap_or("/");
            let path = path.split('?').next().unwrap_or(path);
            let asset = asset_for(path);
            let (status, body, content_type) = match asset {
                Some(asset) => ("200 OK", asset.bytes, asset.content_type),
                None => ("404 Not Found", b"not found".as_slice(), "text/plain; charset=utf-8"),
            };
            let header = format!(
                "HTTP/1.1 {status}\r\ncontent-length: {}\r\ncontent-type: {content_type}\r\ncache-control: no-cache\r\naccess-control-allow-origin: *\r\nconnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(header.as_bytes()).await;
            let _ = stream.write_all(body).await;
        });
    }
}

fn asset_for(path: &str) -> Option<Asset> {
    let path = if path == "/" { "/index.html" } else { path };
    match path {
        "/index.html" => Some(Asset { bytes: include_bytes!("../../../../../web/index.html"), content_type: "text/html; charset=utf-8" }),
        "/app.js" => Some(Asset { bytes: include_bytes!("../../../../../web/app.js"), content_type: "text/javascript; charset=utf-8" }),
        "/styles.css" => Some(Asset { bytes: include_bytes!("../../../../../web/styles.css"), content_type: "text/css; charset=utf-8" }),
        "/transport.js" => Some(Asset { bytes: include_bytes!("../../../../../web/transport.js"), content_type: "text/javascript; charset=utf-8" }),
        "/rpc.js" => Some(Asset { bytes: include_bytes!("../../../../../web/rpc.js"), content_type: "text/javascript; charset=utf-8" }),
        "/projection.js" => Some(Asset { bytes: include_bytes!("../../../../../web/projection.js"), content_type: "text/javascript; charset=utf-8" }),
        "/markdown.js" => Some(Asset { bytes: include_bytes!("../../../../../web/markdown.js"), content_type: "text/javascript; charset=utf-8" }),
        "/manifest.webmanifest" => Some(Asset { bytes: include_bytes!("../../../../../web/manifest.webmanifest"), content_type: "application/manifest+json" }),
        "/icon.svg" => Some(Asset { bytes: include_bytes!("../../../../../web/icon.svg"), content_type: "image/svg+xml" }),
        "/vendor/iroh/doggypile_transport.js" => Some(Asset { bytes: include_bytes!("../../../../../web/vendor/iroh/doggypile_transport.js"), content_type: "text/javascript; charset=utf-8" }),
        "/vendor/iroh/doggypile_transport.d.ts" => Some(Asset { bytes: include_bytes!("../../../../../web/vendor/iroh/doggypile_transport.d.ts"), content_type: "text/plain; charset=utf-8" }),
        "/vendor/iroh/doggypile_transport_bg.wasm" => Some(Asset { bytes: include_bytes!("../../../../../web/vendor/iroh/doggypile_transport_bg.wasm"), content_type: "application/wasm" }),
        "/vendor/iroh/doggypile_transport_bg.wasm.d.ts" => Some(Asset { bytes: include_bytes!("../../../../../web/vendor/iroh/doggypile_transport_bg.wasm.d.ts"), content_type: "text/plain; charset=utf-8" }),
        _ => None,
    }
}
