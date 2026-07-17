//! Embedded production PWA catalog.
//!
//! This module owns the runtime lookup interface and all HTTP metadata policy.
//! The build script owns recursive discovery and production exclusions. Callers
//! provide a URL path and receive an immutable embedded body plus MIME/cache
//! metadata. Routes are exact, query-free, rooted paths; `/` aliases
//! `/index.html`. Only the current content-addressed WASM directory is packaged.
//!
//! This module does not parse HTTP, bind sockets, or choose response status and
//! transport headers. It also does not provide SPA fallback routing.

pub(crate) const NO_CACHE: &str = "no-cache";
const IMMUTABLE_CACHE: &str = "public, max-age=31536000, immutable";
#[cfg(test)]
const WASM_VERSION: &str = env!("DOGGYPILE_WASM_VERSION");
const VERSIONED_WASM_PREFIX: &str = concat!("/vendor/iroh/", env!("DOGGYPILE_WASM_VERSION"), "/");

static CATALOG: &[(&str, &'static [u8])] =
    include!(concat!(env!("OUT_DIR"), "/web_assets_catalog.rs"));

#[derive(Clone, Copy, Debug)]
pub(crate) struct Asset {
    pub(crate) bytes: &'static [u8],
    pub(crate) content_type: &'static str,
    pub(crate) cache_control: &'static str,
}

pub(crate) fn lookup(path: &str) -> Option<Asset> {
    let path = if path == "/" { "/index.html" } else { path };
    let (_, bytes) = CATALOG
        .binary_search_by_key(&path, |(route, _)| *route)
        .ok()
        .map(|index| CATALOG[index])?;
    Some(Asset {
        bytes,
        content_type: mime_for(path),
        cache_control: if path.starts_with(VERSIONED_WASM_PREFIX) {
            IMMUTABLE_CACHE
        } else {
            NO_CACHE
        },
    })
}

fn mime_for(path: &str) -> &'static str {
    if path.ends_with(".wasm") {
        "application/wasm"
    } else if path.ends_with(".js") {
        "text/javascript; charset=utf-8"
    } else if path.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if path.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if path.ends_with(".svg") {
        "image/svg+xml"
    } else if path.ends_with(".webmanifest") {
        "application/manifest+json"
    } else if path.ends_with(".json") {
        "application/json"
    } else if path.ends_with(".txt") || path.ends_with(".d.ts") {
        "text/plain; charset=utf-8"
    } else {
        "application/octet-stream"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{BTreeSet, VecDeque};

    #[test]
    fn root_alias_mime_and_cache_policy_are_owned_here() {
        assert_eq!(
            lookup("/").unwrap().bytes,
            lookup("/index.html").unwrap().bytes
        );
        for (path, mime) in [
            ("/index.html", "text/html; charset=utf-8"),
            ("/app.js", "text/javascript; charset=utf-8"),
            ("/styles.css", "text/css; charset=utf-8"),
            ("/icon.svg", "image/svg+xml"),
            ("/manifest.webmanifest", "application/manifest+json"),
            (
                "/vendor/iroh/doggypile_transport_bg.wasm",
                "application/wasm",
            ),
        ] {
            let asset = lookup(path).unwrap_or_else(|| panic!("missing {path}"));
            assert_eq!(asset.content_type, mime, "{path}");
            assert_eq!(asset.cache_control, NO_CACHE, "{path}");
        }
        let versioned = format!("/vendor/iroh/{WASM_VERSION}/doggypile_transport_bg.wasm");
        assert_eq!(lookup(&versioned).unwrap().cache_control, IMMUTABLE_CACHE);
    }

    #[test]
    fn all_current_modules_and_their_production_imports_are_served() {
        let routes: BTreeSet<_> = CATALOG.iter().map(|(route, _)| *route).collect();
        let mut pending: VecDeque<_> = routes
            .iter()
            .filter(|route| route.ends_with(".js") && !route.contains(".d.ts"))
            .copied()
            .collect();
        let mut checked = BTreeSet::new();
        while let Some(route) = pending.pop_front() {
            if !checked.insert(route) {
                continue;
            }
            let source =
                std::str::from_utf8(lookup(route).unwrap().bytes).expect("JavaScript is UTF-8");
            for specifier in local_imports(source) {
                if specifier == "./mock.js" {
                    continue;
                } // explicitly optional development adapter
                let resolved = resolve(route, specifier);
                assert!(
                    routes.contains(resolved.as_str()),
                    "{route} imports missing {resolved}"
                );
                if resolved.ends_with(".js") {
                    pending.push_back(routes.get(resolved.as_str()).copied().unwrap());
                }
            }
        }
        for module in [
            "connections.js",
            "devices.js",
            "platform.js",
            "state.js",
            "tab-store.js",
            "thread-cache.js",
            "utils.js",
            "view-primitives.js",
        ] {
            assert!(
                routes.contains(format!("/{module}").as_str()),
                "missing current module {module}"
            );
        }
    }

    #[test]
    fn development_backups_and_unknown_versions_are_absent() {
        for route in [
            "/mock.js",
            "/app.js.bak",
            "/test/fixture.js",
            "/backup/app.js",
        ] {
            assert!(lookup(route).is_none(), "packaged {route}");
        }
        assert!(lookup("/vendor/iroh/0000000000000000000000000000000000000000000000000000000000000000/doggypile_transport.js").is_none());
        assert!(
            CATALOG
                .iter()
                .all(|(route, _)| !route.ends_with(".bak") && !route.ends_with(".backup"))
        );
    }

    fn local_imports(source: &str) -> Vec<&str> {
        source
            .lines()
            .filter(|line| {
                line.contains("import ")
                    || line.contains("import(")
                    || line.contains(" from ")
                    || line.contains("new URL(")
            })
            .flat_map(|line| line.split(['\'', '"']))
            .filter(|part| part.starts_with("./") || part.starts_with("../"))
            .collect()
    }

    fn resolve(importer: &str, specifier: &str) -> String {
        let mut parts: Vec<_> = importer
            .rsplit_once('/')
            .unwrap()
            .0
            .split('/')
            .filter(|part| !part.is_empty())
            .collect();
        for part in specifier.split('?').next().unwrap_or(specifier).split('/') {
            match part {
                "." => {}
                ".." => {
                    parts.pop();
                }
                other => parts.push(other),
            }
        }
        format!("/{}", parts.join("/"))
    }
}
