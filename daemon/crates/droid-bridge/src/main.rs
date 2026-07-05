use std::sync::Arc;

use doggypile_bridge_core::server::{ServerOptions, serve_stdio, serve_unix};
use doggypile_droid_bridge::DroidBridge;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "doggypile_droid_bridge=info".into()),
        )
        .with_writer(std::io::stderr)
        .init();

    let socket = std::env::args()
        .skip(1)
        .find_map(|arg| arg.strip_prefix("--socket=").map(ToOwned::to_owned))
        .or_else(|| std::env::var("DOGGYPILE_BRIDGE_SOCKET").ok());

    let bridge = DroidBridge::builder().from_env().build().await?;
    if let Some(socket_path) = socket {
        serve_unix(
            bridge,
            ServerOptions {
                socket_path: socket_path.into(),
                unlink_stale: true,
            },
        )
        .await
    } else {
        serve_stdio(Arc::clone(&bridge)).await
    }
}
