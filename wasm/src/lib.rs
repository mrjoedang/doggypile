//! doggypile browser transport: dial an iroh endpoint by NodeId and expose a
//! bidirectional byte channel to JS. The browser is always the dialer; the
//! doggypile CLI is the listener that bridges this stream to codex.
//!
//! JS surface:
//!   const ch = await Channel.connect(nodeIdHex, alpnUint8);
//!   const readable = ch.readable();      // ReadableStream<Uint8Array> (recv)
//!   await ch.send(bytesUint8);           // write to the peer
//!   ch.close();                          // finish + tear down

use iroh::{Endpoint, EndpointAddr, EndpointId, RelayUrl, endpoint::presets};
use n0_future::{StreamExt, task};
use std::net::SocketAddr;
use std::str::FromStr;
use wasm_bindgen::prelude::*;
use wasm_streams::ReadableStream;
use wasm_streams::readable::sys::ReadableStream as JsReadableStream;

#[wasm_bindgen(start)]
fn start() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub struct Channel {
    // The endpoint owns the I/O driver; it must outlive the connection or all
    // stream traffic silently stops after the handshake.
    _endpoint: Endpoint,
    conn: iroh::endpoint::Connection,
    send_tx: async_channel::Sender<Vec<u8>>,
    readable: Option<JsReadableStream>,
}

#[wasm_bindgen]
impl Channel {
    /// Dial `node_id` (hex EndpointId) with the given ALPN and open a bi stream.
    /// `relay` is the optional relay URL from the pairing payload; passing it
    /// lets us reach a peer on a non-default relay (e.g. iroh-canary).
    /// `direct_addrs` are optional IP socket addresses from the host endpoint;
    /// iroh can use them for LAN/direct paths while retaining relay fallback.
    pub async fn connect(
        node_id: String,
        alpn: Vec<u8>,
        relay: Option<String>,
        direct_addrs: Vec<String>,
    ) -> Result<Channel, JsError> {
        let endpoint_id: EndpointId = node_id.parse().map_err(to_js)?;
        let endpoint = Endpoint::builder(presets::N0).bind().await.map_err(to_js)?;
        let mut addr = EndpointAddr::new(endpoint_id);
        if let Some(relay) = relay {
            addr = addr.with_relay_url(RelayUrl::from_str(&relay).map_err(to_js)?);
        }
        for direct_addr in direct_addrs {
            addr = addr.with_ip_addr(SocketAddr::from_str(&direct_addr).map_err(to_js)?);
        }
        let conn = endpoint.connect(addr, &alpn).await.map_err(to_js)?;
        let conn_for_channel = conn.clone();
        let (mut send, mut recv) = conn.open_bi().await.map_err(to_js)?;

        // Writer task: drains the send channel; keeps the connection alive.
        let (send_tx, send_rx) = async_channel::bounded::<Vec<u8>>(64);
        task::spawn(async move {
            let _conn = conn; // hold the connection open for the session
            while let Ok(buf) = send_rx.recv().await {
                if send.write_all(&buf).await.is_err() {
                    break;
                }
            }
            let _ = send.finish();
            _conn.closed().await;
        });

        // Reader task: pumps recv chunks into the JS ReadableStream.
        let (recv_tx, recv_rx) = async_channel::bounded::<Vec<u8>>(64);
        task::spawn(async move {
            loop {
                match recv.read_chunk(64 * 1024).await {
                    Ok(Some(bytes)) => {
                        if recv_tx.send(bytes.to_vec()).await.is_err() {
                            break;
                        }
                    }
                    _ => break,
                }
            }
        });

        let readable = ReadableStream::from_stream(
            recv_rx.map(|chunk| Ok(JsValue::from(js_sys::Uint8Array::from(chunk.as_slice())))),
        )
        .into_raw();

        Ok(Channel {
            _endpoint: endpoint,
            conn: conn_for_channel,
            send_tx,
            readable: Some(readable),
        })
    }

    /// Take the receive-side ReadableStream (call once).
    pub fn readable(&mut self) -> Result<JsReadableStream, JsError> {
        self.readable
            .take()
            .ok_or_else(|| JsError::new("readable() already taken"))
    }

    /// Queue bytes to send to the peer.
    pub async fn send(&self, data: Vec<u8>) -> Result<(), JsError> {
        self.send_tx.send(data).await.map_err(to_js)
    }

    /// Returns a small JSON summary of currently open iroh paths.
    pub fn path_summary(&self) -> String {
        let paths = self.conn.paths();
        let mut out = format!("{{\"paths\":{}", paths.len());
        let mut selected_kind = "unknown";
        let mut selected_addr = String::new();
        let mut selected_rtt_ms = None;
        for path in paths.iter() {
            if path.is_selected() {
                selected_kind = if path.is_ip() {
                    "direct"
                } else if path.is_relay() {
                    "relay"
                } else {
                    "custom"
                };
                selected_addr = path.remote_addr().to_string();
                selected_rtt_ms = Some(path.rtt().as_millis());
                break;
            }
        }
        out.push_str(&format!(",\"selected\":\"{selected_kind}\""));
        if !selected_addr.is_empty() {
            out.push_str(",\"addr\":\"");
            out.push_str(&json_escape(&selected_addr));
            out.push('"');
        }
        if let Some(rtt_ms) = selected_rtt_ms {
            out.push_str(&format!(",\"rtt_ms\":{rtt_ms}"));
        }
        out.push('}');
        out
    }

    /// Close the send side and tear down the connection.
    pub fn close(&self) {
        self.send_tx.close();
    }
}

fn json_escape(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

fn to_js(err: impl std::fmt::Display) -> JsError {
    JsError::new(&err.to_string())
}
