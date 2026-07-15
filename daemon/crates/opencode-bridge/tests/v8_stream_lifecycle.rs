//! T2 acceptance: the bridge dispatches `turn/start` via `prompt_async` and
//! lets SSE events drive the lifecycle. This test proves the async ack — the
//! `turn/start` response returns before opencode has emitted any items, and
//! `turn/completed` is gated on the SSE `session.idle` event rather than on
//! the upstream HTTP response.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use doggypile_bridge_core::framing::{read_json_line, write_json_line};
use doggypile_bridge_core::server::{serve_stream, serve_stream_with_session};
use doggypile_bridge_core::{JsonRpcRequest, JsonRpcVersion, RequestId, Session};
use doggypile_opencode_bridge::OpencodeBridge;
use doggypile_opencode_bridge::opencode_proc::OpencodeRuntime;
use serde_json::{Value, json};
use tokio::io::BufReader;

/// Channel through which the test injects SSE frames into the held-open
/// `GET /event` connection that the bridge's `SseConsumer` opened on startup.
type SseInjector = Arc<Mutex<Option<TcpStream>>>;

#[tokio::test]
async fn turn_start_acks_immediately_then_session_idle_completes_turn() {
    let seen = Arc::new(Mutex::new(Vec::<String>::new()));
    let sse_injector: SseInjector = Arc::new(Mutex::new(None));
    let base_url = start_fake_opencode(Arc::clone(&seen), Arc::clone(&sse_injector));
    let state_dir = tempfile::TempDir::new().unwrap();
    let bridge = Arc::new(
        OpencodeBridge::new_with_state_dir(
            OpencodeRuntime::external(base_url, "test-token".to_string()),
            state_dir.path().to_path_buf(),
        )
        .await
        .unwrap(),
    );

    let (client, server) = tokio::io::duplex(64 * 1024);
    let server_task = tokio::spawn(serve_stream(bridge, server));
    let (read, mut write) = tokio::io::split(client);
    let mut read = BufReader::new(read);

    // initialize → set up bridge state.
    send(
        &mut write,
        1,
        "initialize",
        json!({"clientInfo":{"name":"v8","version":"0"}}),
    )
    .await;
    let _ = read_until_response(&mut read, 1).await;

    // The codex client signals readiness via `initialized`; this is what
    // triggers `OpencodeBridge::spawn_event_pump` so SSE events from now on
    // route into this connection.
    send_notification(&mut write, "initialized", json!({})).await;

    // Wait until the SSE consumer has opened its `/event` connection — it's
    // started during `OpencodeBridge::new`, but the fake server stashes the
    // stream so we can inject. Loop briefly until populated.
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if sse_injector.lock().unwrap().is_some() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("SSE /event never opened");

    // thread/start
    send(
        &mut write,
        2,
        "thread/start",
        json!({"cwd":"/tmp/opencode-v8","model":"openai/gpt-test"}),
    )
    .await;
    let started = read_until_response(&mut read, 2).await;
    let thread_id = started["result"]["thread"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    // turn/start should return immediately with status:"inProgress".
    send(
        &mut write,
        3,
        "turn/start",
        json!({"threadId":thread_id,"input":[{"type":"text","text":"hi"}]}),
    )
    .await;
    let turn_started = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let value: Value = read_json_line(&mut read).await.unwrap().unwrap();
            // Drain notifications until we land on the response. The
            // notification we expect first is `turn/started` (emitted before
            // the prompt_async POST).
            if value.get("id").and_then(Value::as_i64) == Some(3) {
                return value;
            }
        }
    })
    .await
    .expect("turn/start response timed out");
    assert_eq!(turn_started["result"]["turn"]["status"], "inProgress");
    assert_eq!(
        turn_started["result"]["turn"]["items"]
            .as_array()
            .map(|a| a.len()),
        Some(0),
        "turn/start should ack with empty items; SSE drives the rest"
    );

    // Confirm prompt_async was the upstream call (not the legacy /message).
    let paths = seen.lock().unwrap().clone();
    assert!(
        paths
            .iter()
            .any(|p| p.starts_with("POST /session/ses_1/prompt_async")),
        "expected prompt_async in upstream calls: {paths:?}"
    );
    assert!(
        !paths
            .iter()
            .any(|p| p.starts_with("POST /session/ses_1/message")),
        "synchronous /message should no longer be used: {paths:?}"
    );

    // Inject `session.idle` via SSE; the bridge should emit `turn/completed`
    // on the codex side keyed off the active turn cached in `BridgeState`.
    inject_sse(
        &sse_injector,
        json!({"type":"session.idle","properties":{"sessionID":"ses_1"}}),
    );

    let turn_completed =
        read_until_notification(&mut read, "turn/completed", Duration::from_secs(3)).await;
    assert_eq!(turn_completed["params"]["threadId"], thread_id);
    assert_eq!(turn_completed["params"]["turn"]["status"], "completed");

    drop(write);
    server_task.abort();
}

#[tokio::test]
async fn reconnect_and_reinitialized_stream_emit_each_sse_delta_once() {
    let seen = Arc::new(Mutex::new(Vec::<String>::new()));
    let sse_injector: SseInjector = Arc::new(Mutex::new(None));
    let base_url = start_fake_opencode(Arc::clone(&seen), Arc::clone(&sse_injector));
    let state_dir = tempfile::TempDir::new().unwrap();
    let bridge = Arc::new(
        OpencodeBridge::new_with_state_dir(
            OpencodeRuntime::external(base_url, "test-token".to_string()),
            state_dir.path().to_path_buf(),
        )
        .await
        .unwrap(),
    );
    let session = Arc::new(Session::new(
        "opencode",
        "reconnect-test-node".into(),
        128,
        1 << 20,
    ));

    // Establish bridge and translation state on the first attachment.
    let (client, server) = tokio::io::duplex(64 * 1024);
    let first_server = tokio::spawn(serve_stream_with_session(
        Arc::clone(&bridge),
        server,
        Arc::clone(&session),
        None,
    ));
    let (read, mut write) = tokio::io::split(client);
    let mut read = BufReader::new(read);

    send(
        &mut write,
        1,
        "initialize",
        json!({"clientInfo":{"name":"v8-reconnect","version":"0"}}),
    )
    .await;
    let _ = read_until_response(&mut read, 1).await;
    send_notification(&mut write, "initialized", json!({})).await;

    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if sse_injector.lock().unwrap().is_some() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("SSE /event never opened");

    send(
        &mut write,
        2,
        "thread/start",
        json!({"cwd":"/tmp/opencode-v8-reconnect","model":"openai/gpt-test"}),
    )
    .await;
    let started = read_until_response(&mut read, 2).await;
    let thread_id = started["result"]["thread"]["id"].as_str().unwrap();
    send(
        &mut write,
        3,
        "turn/start",
        json!({"threadId":thread_id,"input":[{"type":"text","text":"hi"}]}),
    )
    .await;
    let _ = read_until_response(&mut read, 3).await;

    inject_sse(
        &sse_injector,
        json!({
            "type":"message.updated",
            "properties":{
                "sessionID":"ses_1",
                "info":{"id":"msg_reconnect","role":"assistant","time":{"created":1000}}
            }
        }),
    );
    let _ = read_until_notification(&mut read, "item/started", Duration::from_secs(3)).await;
    inject_sse(
        &sse_injector,
        json!({
            "type":"message.part.updated",
            "properties":{
                "sessionID":"ses_1",
                "part":{
                    "id":"part_reconnect",
                    "messageID":"msg_reconnect",
                    "sessionID":"ses_1",
                    "type":"text",
                    "text":""
                }
            }
        }),
    );
    inject_sse(
        &sse_injector,
        json!({
            "type":"message.part.delta",
            "properties":{
                "sessionID":"ses_1",
                "messageID":"msg_reconnect",
                "partID":"part_reconnect",
                "field":"text",
                "delta":"before reconnect"
            }
        }),
    );
    let before =
        read_until_notification(&mut read, "item/agentMessage/delta", Duration::from_secs(3)).await;
    assert_eq!(before["params"]["delta"], "before reconnect");

    // Fully detach the first stream while retaining the same durable Session.
    // The event pump must survive as the sole producer for its replay ring.
    let resume_cursor = session.peek_seq().0;
    drop(write);
    drop(read);
    tokio::time::timeout(Duration::from_secs(2), first_server)
        .await
        .expect("first attachment did not close")
        .expect("first attachment task panicked")
        .expect("first attachment failed");

    inject_sse(
        &sse_injector,
        json!({
            "type":"message.part.delta",
            "properties":{
                "sessionID":"ses_1",
                "messageID":"msg_reconnect",
                "partID":"part_reconnect",
                "field":"text",
                "delta":"buffered while detached"
            }
        }),
    );
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if session.peek_seq().0 == resume_cursor + 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("detached SSE event was not buffered in the replay ring");
    assert!(!session.is_attached());

    let (client, server) = tokio::io::duplex(64 * 1024);
    let second_server = tokio::spawn(serve_stream_with_session(
        Arc::clone(&bridge),
        server,
        Arc::clone(&session),
        Some(resume_cursor),
    ));
    let (read, mut write) = tokio::io::split(client);
    let mut read = BufReader::new(read);
    let replayed =
        read_until_notification(&mut read, "item/agentMessage/delta", Duration::from_secs(3)).await;
    assert_eq!(replayed["params"]["delta"], "buffered while detached");

    send(
        &mut write,
        4,
        "initialize",
        json!({"clientInfo":{"name":"v8-reconnect","version":"0"}}),
    )
    .await;
    let _ = read_until_response(&mut read, 4).await;

    // Real clients initialize again after reconnect. Sending it twice on the
    // same replacement stream also covers accidental duplicate readiness
    // notifications. Neither may add another SSE subscriber.
    send_notification(&mut write, "initialized", json!({})).await;
    send_notification(&mut write, "initialized", json!({})).await;
    send(&mut write, 5, "account/read", json!({})).await;
    let _ = read_until_response(&mut read, 5).await;

    let seq_before_delta = session.peek_seq().0;
    inject_sse(
        &sse_injector,
        json!({
            "type":"message.part.delta",
            "properties":{
                "sessionID":"ses_1",
                "messageID":"msg_reconnect",
                "partID":"part_reconnect",
                "field":"text",
                "delta":"exactly once"
            }
        }),
    );
    let delta =
        read_until_notification(&mut read, "item/agentMessage/delta", Duration::from_secs(3)).await;
    assert_eq!(delta["params"]["delta"], "exactly once");

    // A duplicate pump would enqueue and deliver the same delta a second
    // time, which is the user-visible "HeyHey" corruption this regresses.
    match tokio::time::timeout(
        Duration::from_millis(250),
        read_json_line::<Value, _>(&mut read),
    )
    .await
    {
        Err(_) => {}
        Ok(frame) => panic!("unexpected duplicate frame after reconnect: {frame:?}"),
    }
    assert_eq!(
        session.peek_seq().0,
        seq_before_delta + 1,
        "one SSE delta must enqueue exactly one codex notification"
    );

    drop(write);
    drop(read);
    second_server.abort();
}

#[tokio::test]
async fn two_client_sessions_share_one_router_without_double_mutating_message_text() {
    let seen = Arc::new(Mutex::new(Vec::<String>::new()));
    let sse_injector: SseInjector = Arc::new(Mutex::new(None));
    let base_url = start_fake_opencode(Arc::clone(&seen), Arc::clone(&sse_injector));
    let state_dir = tempfile::TempDir::new().unwrap();
    let bridge = Arc::new(
        OpencodeBridge::new_with_state_dir(
            OpencodeRuntime::external(base_url, "test-token".to_string()),
            state_dir.path().to_path_buf(),
        )
        .await
        .unwrap(),
    );
    assert_eq!(bridge.event_receiver_count(), 1);

    let session_a = Arc::new(Session::new(
        "opencode",
        "multi-client-z-owner".into(),
        128,
        1 << 20,
    ));
    let session_b = Arc::new(Session::new(
        "opencode",
        "multi-client-a-other".into(),
        128,
        1 << 20,
    ));

    let (client_a, server_a) = tokio::io::duplex(64 * 1024);
    let server_task_a = tokio::spawn(serve_stream_with_session(
        Arc::clone(&bridge),
        server_a,
        Arc::clone(&session_a),
        None,
    ));
    let (read_a, mut write_a) = tokio::io::split(client_a);
    let mut read_a = BufReader::new(read_a);

    let (client_b, server_b) = tokio::io::duplex(64 * 1024);
    let server_task_b = tokio::spawn(serve_stream_with_session(
        Arc::clone(&bridge),
        server_b,
        Arc::clone(&session_b),
        None,
    ));
    let (read_b, mut write_b) = tokio::io::split(client_b);
    let mut read_b = BufReader::new(read_b);

    send(
        &mut write_a,
        1,
        "initialize",
        json!({"clientInfo":{"name":"multi-a","version":"0"}}),
    )
    .await;
    let _ = read_until_response(&mut read_a, 1).await;
    send_notification(&mut write_a, "initialized", json!({})).await;
    send(&mut write_a, 10, "account/read", json!({})).await;
    let _ = read_until_response(&mut read_a, 10).await;

    send(
        &mut write_b,
        1,
        "initialize",
        json!({"clientInfo":{"name":"multi-b","version":"0"}}),
    )
    .await;
    let _ = read_until_response(&mut read_b, 1).await;
    send_notification(&mut write_b, "initialized", json!({})).await;
    send(&mut write_b, 10, "account/read", json!({})).await;
    let _ = read_until_response(&mut read_b, 10).await;
    assert_eq!(
        bridge.event_receiver_count(),
        1,
        "registering client sessions must not subscribe more SSE receivers"
    );

    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if sse_injector.lock().unwrap().is_some() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("SSE /event never opened");

    send(
        &mut write_a,
        2,
        "thread/start",
        json!({"cwd":"/tmp/opencode-v8-multi","model":"openai/gpt-test"}),
    )
    .await;
    let started = read_until_response(&mut read_a, 2).await;
    let thread_id = started["result"]["thread"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    send(
        &mut write_a,
        3,
        "turn/start",
        json!({"threadId":thread_id,"input":[{"type":"text","text":"hi"}]}),
    )
    .await;
    let _ = read_until_response(&mut read_a, 3).await;

    inject_sse(
        &sse_injector,
        json!({
            "type":"message.updated",
            "properties":{
                "sessionID":"ses_1",
                "info":{"id":"msg_multi","role":"assistant","time":{"created":1000}}
            }
        }),
    );
    let _ = read_until_notification(&mut read_a, "item/started", Duration::from_secs(3)).await;
    let _ = read_until_notification(&mut read_b, "item/started", Duration::from_secs(3)).await;

    inject_sse(
        &sse_injector,
        json!({
            "type":"message.part.updated",
            "properties":{
                "sessionID":"ses_1",
                "part":{
                    "id":"part_multi",
                    "messageID":"msg_multi",
                    "sessionID":"ses_1",
                    "type":"text",
                    "text":""
                }
            }
        }),
    );

    for expected in ["re", "connect", "-ok"] {
        inject_sse(
            &sse_injector,
            json!({
                "type":"message.part.delta",
                "properties":{
                    "sessionID":"ses_1",
                    "messageID":"msg_multi",
                    "partID":"part_multi",
                    "field":"text",
                    "delta":expected
                }
            }),
        );
        let delta_a = read_until_notification(
            &mut read_a,
            "item/agentMessage/delta",
            Duration::from_secs(3),
        )
        .await;
        let delta_b = read_until_notification(
            &mut read_b,
            "item/agentMessage/delta",
            Duration::from_secs(3),
        )
        .await;
        assert_eq!(delta_a["params"]["delta"], expected);
        assert_eq!(delta_b["params"]["delta"], expected);
    }

    inject_sse(
        &sse_injector,
        json!({
            "type":"message.updated",
            "properties":{
                "sessionID":"ses_1",
                "info":{
                    "id":"msg_multi",
                    "role":"assistant",
                    "time":{"created":1000,"completed":2000}
                }
            }
        }),
    );
    let completed_a =
        read_until_notification(&mut read_a, "item/completed", Duration::from_secs(3)).await;
    let completed_b =
        read_until_notification(&mut read_b, "item/completed", Duration::from_secs(3)).await;
    assert_eq!(completed_a["params"]["item"]["text"], "reconnect-ok");
    assert_eq!(completed_b["params"]["item"]["text"], "reconnect-ok");

    // The turn was started by session A. Even though B is attached and has a
    // lexicographically smaller node id, a permission arriving while A is
    // detached must queue on A and replay there after reattach.
    let owner_cursor = session_a.peek_seq().0;
    drop(write_a);
    drop(read_a);
    tokio::time::timeout(Duration::from_secs(2), server_task_a)
        .await
        .expect("owner attachment did not close")
        .expect("owner attachment task panicked")
        .expect("owner attachment failed");

    inject_sse(
        &sse_injector,
        json!({
            "type":"permission.asked",
            "properties":{
                "id":"perm_owner",
                "sessionID":"ses_1",
                "permission":"bash",
                "patterns":[],
                "metadata":{"command":"echo owner","cwd":"/tmp"},
                "always":[]
            }
        }),
    );
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if session_a.peek_seq().0 > owner_cursor {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("permission request was not buffered on detached turn owner");

    match tokio::time::timeout(
        Duration::from_millis(200),
        read_json_line::<Value, _>(&mut read_b),
    )
    .await
    {
        Err(_) => {}
        Ok(frame) => panic!("non-owner client unexpectedly received permission: {frame:?}"),
    }

    let (client_a, server_a) = tokio::io::duplex(64 * 1024);
    let replacement_task_a = tokio::spawn(serve_stream_with_session(
        Arc::clone(&bridge),
        server_a,
        Arc::clone(&session_a),
        Some(owner_cursor),
    ));
    let (read_a, mut write_a) = tokio::io::split(client_a);
    let mut read_a = BufReader::new(read_a);
    let approval = read_until_notification(
        &mut read_a,
        "item/commandExecution/requestApproval",
        Duration::from_secs(3),
    )
    .await;
    assert_eq!(approval["params"]["itemId"], "perm_owner");
    write_json_line(
        &mut write_a,
        &json!({
            "jsonrpc":"2.0",
            "id":approval["id"].clone(),
            "result":{"decision":"accept"}
        }),
    )
    .await
    .unwrap();

    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if seen
                .lock()
                .unwrap()
                .iter()
                .any(|path| path.starts_with("POST /permission/perm_owner/reply"))
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("owner approval was not forwarded upstream");
    assert_eq!(
        seen.lock()
            .unwrap()
            .iter()
            .filter(|path| path.starts_with("POST /permission/perm_owner/reply"))
            .count(),
        1,
        "one upstream permission must receive exactly one reply"
    );

    drop(write_a);
    drop(read_a);
    drop(write_b);
    drop(read_b);
    replacement_task_a.abort();
    server_task_b.abort();
}

fn inject_sse(injector: &SseInjector, event: Value) {
    let payload = format!("data: {}\n\n", serde_json::to_string(&event).unwrap());
    let mut guard = injector.lock().unwrap();
    if let Some(stream) = guard.as_mut() {
        let _ = stream.write_all(payload.as_bytes());
        let _ = stream.flush();
    }
}

async fn send<W: tokio::io::AsyncWrite + Unpin>(
    writer: &mut W,
    id: i64,
    method: &str,
    params: Value,
) {
    write_json_line(
        writer,
        &JsonRpcRequest {
            jsonrpc: JsonRpcVersion,
            id: RequestId::Integer(id),
            method: method.to_string(),
            params: Some(params),
        },
    )
    .await
    .unwrap();
}

async fn send_notification<W: tokio::io::AsyncWrite + Unpin>(
    writer: &mut W,
    method: &str,
    params: Value,
) {
    let frame = json!({"jsonrpc":"2.0","method":method,"params":params});
    let line = serde_json::to_vec(&frame).unwrap();
    use tokio::io::AsyncWriteExt;
    writer.write_all(&line).await.unwrap();
    writer.write_all(b"\n").await.unwrap();
    writer.flush().await.unwrap();
}

async fn read_until_response<R: tokio::io::AsyncBufRead + Unpin>(reader: &mut R, id: i64) -> Value {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let value: Value = read_json_line(reader).await.unwrap().unwrap();
            if value.get("id").and_then(Value::as_i64) == Some(id) {
                return value;
            }
        }
    })
    .await
    .unwrap()
}

async fn read_until_notification<R: tokio::io::AsyncBufRead + Unpin>(
    reader: &mut R,
    method: &str,
    timeout: Duration,
) -> Value {
    tokio::time::timeout(timeout, async {
        loop {
            let value: Value = read_json_line(reader).await.unwrap().unwrap();
            if value.get("method").and_then(Value::as_str) == Some(method) {
                return value;
            }
        }
    })
    .await
    .unwrap_or_else(|_| panic!("notification {method} not seen within {timeout:?}"))
}

fn start_fake_opencode(seen: Arc<Mutex<Vec<String>>>, injector: SseInjector) -> String {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let addr = listener.local_addr().unwrap();
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let seen = Arc::clone(&seen);
            let injector = Arc::clone(&injector);
            thread::spawn(move || handle_conn(stream, seen, injector));
        }
    });
    format!("http://{addr}")
}

fn handle_conn(mut stream: TcpStream, seen: Arc<Mutex<Vec<String>>>, injector: SseInjector) {
    let mut bytes = Vec::new();
    let mut buf = [0u8; 1024];
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let headers_end = loop {
        match stream.read(&mut buf) {
            Ok(0) => return,
            Ok(n) => {
                bytes.extend_from_slice(&buf[..n]);
                if let Some(pos) = find_subsequence(&bytes, b"\r\n\r\n") {
                    break pos + 4;
                }
            }
            Err(_) => return,
        }
    };
    let header_text = String::from_utf8_lossy(&bytes[..headers_end]);
    let content_length = header_text
        .lines()
        .find_map(|line| {
            line.strip_prefix("content-length:")
                .or_else(|| line.strip_prefix("Content-Length:"))
        })
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or(0);
    while bytes.len() < headers_end + content_length {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => bytes.extend_from_slice(&buf[..n]),
            Err(_) => break,
        }
    }
    let req = String::from_utf8_lossy(&bytes);
    let request_line = req.lines().next().unwrap_or("").to_string();
    seen.lock().unwrap().push(request_line.clone());
    let _ = stream.set_read_timeout(None);

    if request_line.starts_with("GET /event") {
        let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n";
        if stream.write_all(head.as_bytes()).is_err() {
            return;
        }
        let _ = stream.flush();
        // Hand the stream to the test for SSE injection.
        *injector.lock().unwrap() = Some(stream.try_clone().unwrap());
        // Park: keep the connection alive until torn down externally.
        thread::sleep(Duration::from_secs(60));
        return;
    }

    if request_line.starts_with("POST /session/ses_1/prompt_async") {
        let response = "HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n";
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();
        let _ = stream.shutdown(std::net::Shutdown::Both);
        return;
    }

    let body = if request_line.starts_with("POST /session?") {
        json!({
            "id":"ses_1",
            "directory":"/tmp/opencode-v8",
            "title":"V8",
            "time":{"created":1000,"updated":1000}
        })
    } else if request_line.starts_with("GET /provider?") {
        json!({"all":[],"default":[],"connected":[]})
    } else {
        json!({})
    };
    let body = serde_json::to_string(&body).unwrap();
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
    let _ = stream.shutdown(std::net::Shutdown::Both);
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}
