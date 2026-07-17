//! HTTP transport for the embedded PWA.
//!
//! Asset membership, bytes, MIME types, aliases, and cache policy belong to
//! `web_assets`; this module only parses a minimal HTTP request and writes its
//! catalog result to a TCP stream.

use std::net::SocketAddr;

use anyhow::Context;
use clap::Args;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::web_assets::{self, NO_CACHE};

#[derive(Args, Debug)]
pub struct WebArgs {
    /// Interface to bind the embedded PWA server to.
    #[arg(long, default_value = "127.0.0.1")]
    pub host: String,

    /// Port to serve the embedded PWA on.
    #[arg(long, short, default_value_t = 8123)]
    pub port: u16,
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
            let request = String::from_utf8_lossy(&buf[..n]);
            let path = request
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .unwrap_or("/");
            let path = path.split('?').next().unwrap_or(path);
            let (status, body, content_type, cache_control) = match web_assets::lookup(path) {
                Some(asset) => (
                    "200 OK",
                    asset.bytes,
                    asset.content_type,
                    asset.cache_control,
                ),
                None => (
                    "404 Not Found",
                    b"not found".as_slice(),
                    "text/plain; charset=utf-8",
                    NO_CACHE,
                ),
            };
            let header = format!(
                "HTTP/1.1 {status}\r\ncontent-length: {}\r\ncontent-type: {content_type}\r\ncache-control: {cache_control}\r\naccess-control-allow-origin: *\r\nconnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(header.as_bytes()).await;
            let _ = stream.write_all(body).await;
        });
    }
}
