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
    cache_control: &'static str,
}

const NO_CACHE: &str = "no-cache";
const IMMUTABLE_CACHE: &str = "public, max-age=31536000, immutable";
#[cfg(test)]
const WASM_VERSION: &str = env!("DOGGYPILE_WASM_VERSION");
const VERSIONED_WASM_PREFIX: &str = concat!("/vendor/iroh/", env!("DOGGYPILE_WASM_VERSION"), "/");

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
            let (status, body, content_type, cache_control) = match asset {
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

fn asset_for(path: &str) -> Option<Asset> {
    let path = if path == "/" { "/index.html" } else { path };
    let ordinary_or_legacy = match path {
        "/index.html" => asset(
            include_bytes!("../../../../../web/index.html"),
            "text/html; charset=utf-8",
            NO_CACHE,
        ),
        "/app.js" => asset(
            include_bytes!("../../../../../web/app.js"),
            "text/javascript; charset=utf-8",
            NO_CACHE,
        ),
        "/rail.js" => asset(
            include_bytes!("../../../../../web/rail.js"),
            "text/javascript; charset=utf-8",
            NO_CACHE,
        ),
        "/styles.css" => asset(
            include_bytes!("../../../../../web/styles.css"),
            "text/css; charset=utf-8",
            NO_CACHE,
        ),
        "/transport.js" => asset(
            include_bytes!("../../../../../web/transport.js"),
            "text/javascript; charset=utf-8",
            NO_CACHE,
        ),
        "/rpc.js" => asset(
            include_bytes!("../../../../../web/rpc.js"),
            "text/javascript; charset=utf-8",
            NO_CACHE,
        ),
        "/projection.js" => asset(
            include_bytes!("../../../../../web/projection.js"),
            "text/javascript; charset=utf-8",
            NO_CACHE,
        ),
        "/markdown.js" => asset(
            include_bytes!("../../../../../web/markdown.js"),
            "text/javascript; charset=utf-8",
            NO_CACHE,
        ),
        "/manifest.webmanifest" => asset(
            include_bytes!("../../../../../web/manifest.webmanifest"),
            "application/manifest+json",
            NO_CACHE,
        ),
        "/icon.svg" => asset(
            include_bytes!("../../../../../web/icon.svg"),
            "image/svg+xml",
            NO_CACHE,
        ),
        "/vendor/iroh/current.txt" => asset(
            include_bytes!("../../../../../web/vendor/iroh/current.txt"),
            "text/plain; charset=utf-8",
            NO_CACHE,
        ),
        "/vendor/iroh/doggypile_transport.js" => asset(
            include_bytes!("../../../../../web/vendor/iroh/doggypile_transport.js"),
            "text/javascript; charset=utf-8",
            NO_CACHE,
        ),
        "/vendor/iroh/doggypile_transport.d.ts" => asset(
            include_bytes!("../../../../../web/vendor/iroh/doggypile_transport.d.ts"),
            "text/plain; charset=utf-8",
            NO_CACHE,
        ),
        "/vendor/iroh/doggypile_transport_bg.wasm" => asset(
            include_bytes!("../../../../../web/vendor/iroh/doggypile_transport_bg.wasm"),
            "application/wasm",
            NO_CACHE,
        ),
        "/vendor/iroh/doggypile_transport_bg.wasm.d.ts" => asset(
            include_bytes!("../../../../../web/vendor/iroh/doggypile_transport_bg.wasm.d.ts"),
            "text/plain; charset=utf-8",
            NO_CACHE,
        ),
        _ => None,
    };
    if ordinary_or_legacy.is_some() {
        return ordinary_or_legacy;
    }

    let filename = path.strip_prefix(VERSIONED_WASM_PREFIX)?;
    match filename {
        "doggypile_transport.js" => asset(
            include_bytes!(concat!(
                "../../../../../web/vendor/iroh/",
                env!("DOGGYPILE_WASM_VERSION"),
                "/doggypile_transport.js"
            )),
            "text/javascript; charset=utf-8",
            IMMUTABLE_CACHE,
        ),
        "doggypile_transport.d.ts" => asset(
            include_bytes!(concat!(
                "../../../../../web/vendor/iroh/",
                env!("DOGGYPILE_WASM_VERSION"),
                "/doggypile_transport.d.ts"
            )),
            "text/plain; charset=utf-8",
            IMMUTABLE_CACHE,
        ),
        "doggypile_transport_bg.wasm" => asset(
            include_bytes!(concat!(
                "../../../../../web/vendor/iroh/",
                env!("DOGGYPILE_WASM_VERSION"),
                "/doggypile_transport_bg.wasm"
            )),
            "application/wasm",
            IMMUTABLE_CACHE,
        ),
        "doggypile_transport_bg.wasm.d.ts" => asset(
            include_bytes!(concat!(
                "../../../../../web/vendor/iroh/",
                env!("DOGGYPILE_WASM_VERSION"),
                "/doggypile_transport_bg.wasm.d.ts"
            )),
            "text/plain; charset=utf-8",
            IMMUTABLE_CACHE,
        ),
        _ => None,
    }
}

fn asset(
    bytes: &'static [u8],
    content_type: &'static str,
    cache_control: &'static str,
) -> Option<Asset> {
    Some(Asset {
        bytes,
        content_type,
        cache_control,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versioned_wasm_assets_are_immutable() {
        for (filename, content_type) in [
            ("doggypile_transport.js", "text/javascript; charset=utf-8"),
            ("doggypile_transport.d.ts", "text/plain; charset=utf-8"),
            ("doggypile_transport_bg.wasm", "application/wasm"),
            (
                "doggypile_transport_bg.wasm.d.ts",
                "text/plain; charset=utf-8",
            ),
        ] {
            let path = format!("/vendor/iroh/{WASM_VERSION}/{filename}");
            let asset = asset_for(&path).expect("versioned WASM package asset");
            assert_eq!(asset.content_type, content_type);
            assert_eq!(asset.cache_control, IMMUTABLE_CACHE);
        }
    }

    #[test]
    fn mutable_and_legacy_assets_are_not_cached_immutably() {
        for path in [
            "/",
            "/rail.js",
            "/transport.js",
            "/vendor/iroh/current.txt",
            "/vendor/iroh/doggypile_transport.js",
            "/vendor/iroh/doggypile_transport_bg.wasm",
        ] {
            assert_eq!(asset_for(path).expect(path).cache_control, NO_CACHE);
        }
    }

    #[test]
    fn unknown_version_and_unknown_file_are_not_served() {
        assert!(asset_for("/vendor/iroh/0000000000000000000000000000000000000000000000000000000000000000/doggypile_transport.js").is_none());
        assert!(asset_for(&format!("/vendor/iroh/{WASM_VERSION}/unknown.js")).is_none());
    }
}
