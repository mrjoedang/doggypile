//! Weak registry of durable client sessions subscribed to OpenCode events.
//!
//! OpenCode exposes one process-wide SSE stream. Its events must mutate the
//! bridge's shared translation state exactly once, then fan out the resulting
//! Codex notifications to every initialized client session.

use std::sync::{Arc, Mutex, Weak};

use doggypile_bridge_core::{Conn, NotificationSender, Session};
use serde_json::Value;

#[derive(Default)]
pub struct SessionSinks {
    sessions: Mutex<Vec<Weak<Session>>>,
}

impl SessionSinks {
    /// Register an initialized durable session. Registration is idempotent by
    /// Arc identity, and dead weak entries are pruned on every operation.
    pub fn register(&self, session: &Arc<Session>) {
        let mut sessions = self.sessions.lock().unwrap();
        sessions.retain(|candidate| candidate.upgrade().is_some());
        let weak = Arc::downgrade(session);
        if sessions.iter().any(|candidate| candidate.ptr_eq(&weak)) {
            return;
        }
        sessions.push(weak);
    }

    /// Fan an ordinary notification out to all live sessions. Detached
    /// sessions remain live in the daemon registry, so their `enqueue` calls
    /// continue filling the replay ring until they reattach or are reaped.
    pub fn send_notification(&self, method: impl AsRef<str>, params: Value) {
        let method = method.as_ref();
        for session in self.live_sessions() {
            let conn = Conn::from_session(session);
            let _ = conn
                .notifier()
                .send_notification(method.to_string(), params.clone());
        }
    }

    /// Choose exactly one client for an interactive server request.
    ///
    /// The turn owner wins even while detached, so its request is buffered
    /// for replay. Without an owner (external events), selection falls back
    /// to the lexicographically smallest attached durable `(node_id, agent)`
    /// key, then the smallest live detached key. This prevents multiple
    /// replies while preserving durable reconnect semantics.
    pub fn request_notifier(&self, owner_node_id: Option<&str>) -> Option<NotificationSender> {
        self.request_session(owner_node_id)
            .map(|session| Conn::from_session(session).notifier().clone())
    }

    fn request_session(&self, owner_node_id: Option<&str>) -> Option<Arc<Session>> {
        let live = self.live_sessions();
        if let Some(owner_node_id) = owner_node_id {
            if let Some(owner) = minimum_session(
                live.iter()
                    .filter(|session| session.node_id == owner_node_id && session.is_attached()),
            ) {
                return Some(owner);
            }
            if let Some(owner) = minimum_session(
                live.iter()
                    .filter(|session| session.node_id == owner_node_id),
            ) {
                return Some(owner);
            }
        }
        minimum_session(live.iter().filter(|session| session.is_attached()))
            .or_else(|| minimum_session(live.iter()))
    }

    fn live_sessions(&self) -> Vec<Arc<Session>> {
        let mut live = Vec::new();
        let mut sessions = self.sessions.lock().unwrap();
        sessions.retain(|candidate| match candidate.upgrade() {
            Some(session) => {
                live.push(session);
                true
            }
            None => false,
        });
        live
    }
}

fn minimum_session<'a>(sessions: impl Iterator<Item = &'a Arc<Session>>) -> Option<Arc<Session>> {
    sessions
        .min_by(|left, right| {
            left.node_id
                .cmp(&right.node_id)
                .then_with(|| left.agent.cmp(right.agent))
        })
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(node_id: &str) -> Arc<Session> {
        Arc::new(Session::new("opencode", node_id.to_string(), 16, 1 << 20))
    }

    #[test]
    fn registration_is_idempotent_and_does_not_retain_sessions() {
        let sinks = SessionSinks::default();
        let session = session("node-a");
        let weak = Arc::downgrade(&session);
        sinks.register(&session);
        sinks.register(&session);
        assert_eq!(sinks.live_sessions().len(), 1);

        drop(session);
        assert!(weak.upgrade().is_none());
        assert!(sinks.live_sessions().is_empty());
    }

    #[test]
    fn interactive_requests_choose_smallest_attached_node_id() {
        let sinks = SessionSinks::default();
        let later = session("node-z");
        let first = session("node-a");
        let _later_attachment = later.install_attachment(None);
        let _first_attachment = first.install_attachment(None);
        sinks.register(&later);
        sinks.register(&first);

        let selected = sinks.request_session(None).expect("an attached sink");
        assert!(Arc::ptr_eq(&selected, &first));
    }

    #[test]
    fn interactive_requests_fall_back_to_live_detached_session() {
        let sinks = SessionSinks::default();
        let detached = session("node-detached");
        sinks.register(&detached);

        let selected = sinks.request_session(None).expect("a live sink");
        assert!(Arc::ptr_eq(&selected, &detached));
    }

    #[test]
    fn turn_owner_wins_even_when_detached() {
        let sinks = SessionSinks::default();
        let other = session("node-a-attached");
        let owner = session("node-z-owner");
        let _other_attachment = other.install_attachment(None);
        sinks.register(&other);
        sinks.register(&owner);

        let selected = sinks
            .request_session(Some("node-z-owner"))
            .expect("owner sink");
        assert!(Arc::ptr_eq(&selected, &owner));
    }
}
