use crate::{navigation, AppState};
use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager};

fn authorize_redirect(server: &str, token: &str, url: &url::Url) -> bool {
    if navigation::validate(url.as_str()).is_err() {
        return false;
    }
    let Ok(client) = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .redirect(reqwest::redirect::Policy::none())
        .build()
    else {
        return false;
    };
    let Ok(response) = client
        .post(format!("{server}/api/v1/auth/status"))
        .bearer_auth(token)
        .json(&serde_json::json!({"urls":[url.as_str()]}))
        .send()
    else {
        return false;
    };
    if !response.status().is_success() {
        return false;
    }
    response
        .json::<serde_json::Value>()
        .is_ok_and(|body| policy_allows(&body, &[url.to_string()]))
}

fn policy_allows(body: &serde_json::Value, urls: &[String]) -> bool {
    body["access"]["allowed"] == true
        && body["decisions"].as_array().is_some_and(|rows| {
            rows.len() == urls.len()
                && rows
                    .iter()
                    .zip(urls)
                    .all(|(row, url)| row["allowed"] == true && row["url"].as_str() == Some(url))
        })
}

#[cfg(test)]
mod tests {
    use super::policy_allows;
    #[test]
    fn policy_batch_requires_exact_ordered_authorizations() {
        let urls = vec!["https://example.test/".to_string()];
        let allowed = serde_json::json!({"access":{"allowed":true},"decisions":[{"allowed":true,"url":urls[0]}]});
        assert!(policy_allows(&allowed, &urls));
        assert!(!policy_allows(
            &allowed,
            &["https://other.test/".to_string()]
        ));
        assert!(!policy_allows(
            &serde_json::json!({"access":{"allowed":true},"decisions":[]}),
            &urls
        ));
        assert!(!policy_allows(
            &serde_json::json!({"access":{"allowed":false},"decisions":allowed["decisions"]}),
            &urls
        ));
    }
}

#[derive(serde::Deserialize)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

pub fn close_content(app: &tauri::AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with("content-") {
            let _ = window.close();
        }
    }
}

pub async fn monitor(app: tauri::AppHandle) {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .build()
    {
        Ok(v) => v,
        Err(_) => return,
    };
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(15)).await;
        let state = app.state::<AppState>();
        let generation = state.generation.load(Ordering::SeqCst);
        let token = state.auth_token.lock().await.clone();
        let Some(token) = token else { continue };
        let urls: Vec<String> = app
            .webview_windows()
            .iter()
            .filter(|(label, _)| label.starts_with("content-"))
            .filter_map(|(_, w)| w.url().ok().map(|v| v.to_string()))
            .take(20)
            .collect();
        if urls.is_empty() {
            continue;
        }
        let vpn_ok = crate::vpn::require_recent_peer().await.is_ok();
        let response = client
            .post(format!("{}/api/v1/auth/status", state.server_url))
            .bearer_auth(token)
            .json(&serde_json::json!({"urls":urls}))
            .send()
            .await;
        let allowed = match response {
            Ok(res) if res.status().is_success() => match res.json::<serde_json::Value>().await {
                Ok(body) => policy_allows(&body, &urls),
                Err(_) => false,
            },
            _ => false,
        };
        if !allowed || !vpn_ok {
            let _guard = state.auth_token.lock().await;
            if generation == state.generation.load(Ordering::SeqCst) {
                state.generation.fetch_add(1, Ordering::SeqCst);
                close_content(&app);
                let _=app.emit_to("main","browser-policy",serde_json::json!({"message":"Session, device or URL policy no longer authorizes content. Content was closed."}));
            }
        }
    }
}

#[tauri::command]
pub async fn open_content(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, AppState>,
    tab: String,
    url: String,
    bounds: Bounds,
) -> Result<(), String> {
    let Bounds {
        x,
        y,
        width,
        height,
    } = bounds;
    if window.label() != "main"
        || tab.len() > 64
        || !tab.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("Invalid caller or tab".into());
    }
    if [x, y, width, height].iter().any(|v| !v.is_finite())
        || !(100.0..=10000.0).contains(&width)
        || !(100.0..=10000.0).contains(&height)
    {
        return Err("Invalid viewport".into());
    }
    let target = navigation::validate(&url)?;
    crate::vpn::require_recent_peer().await?;
    let generation = state.generation.load(Ordering::SeqCst);
    let token = state
        .auth_token
        .lock()
        .await
        .clone()
        .filter(|t| !t.is_empty())
        .ok_or("Not authenticated")?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Policy client unavailable")?;
    let response = client
        .post(format!("{}/api/v1/proxy/navigate", state.server_url))
        .bearer_auth(&token)
        .json(&serde_json::json!({"url":target.as_str()}))
        .send()
        .await
        .map_err(|_| "Policy unavailable")?;
    if !response.status().is_success() {
        return Err("Session or URL policy denied navigation".into());
    }
    let decision: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "Invalid policy response")?;
    if decision["allowed"] != true || decision["url"].as_str() != Some(target.as_str()) {
        return Err("Policy denied navigation".into());
    }
    // Serialize creation with credential changes, including after the network await.
    let _guard = state.auth_token.lock().await;
    if generation != state.generation.load(Ordering::SeqCst) {
        return Err("Session changed".into());
    }
    let label = format!("content-{tab}");
    if let Some(old) = app.get_webview_window(&label) {
        old.navigate(target)
            .map_err(|_| "Could not navigate content")?;
        return Ok(());
    }
    if app
        .webview_windows()
        .keys()
        .filter(|label| label.starts_with("content-"))
        .count()
        >= 20
    {
        return Err("Close a tab before opening more content".into());
    }
    let nav_app = app.clone();
    let shortcut_app = app.clone();
    let shortcut_tab = tab.clone();
    let approved = target.clone();
    let first = std::sync::atomic::AtomicBool::new(true);
    let redirect_server = state.server_url.clone();
    let redirect_token = token.clone();
    let credential_generation = state.credential_generation.load(Ordering::SeqCst);
    let popup_app = app.clone();
    let popup_tab = tab.clone();
    let load_app = app.clone();
    let load_tab = tab.clone();
    let download_app = app.clone();
    let content=tauri::WebviewWindowBuilder::new(&app,label,tauri::WebviewUrl::External(target))
        .position(x,y).inner_size(width,height).decorations(false).skip_taskbar(true).visible(false).incognito(true).devtools(false)
        .initialization_script("document.addEventListener('keydown',e=>{if(!e.isTrusted||!(e.ctrlKey||e.metaKey))return;let a=e.key.toLowerCase()==='l'?'address':e.key.toLowerCase()==='t'?'new':e.key.toLowerCase()==='w'?'close':e.key==='Tab'?(e.shiftKey?'previous':'next'):null;if(a){e.preventDefault();location.href='rsx-internal://'+a;}},true);")
        .on_navigation(move |next| {
            if next.scheme()=="rsx-internal" && next.username().is_empty() && next.password().is_none() && next.query().is_none() && next.fragment().is_none() {
                if let Some(action)=next.host_str().filter(|a|["address","new","close","previous","next"].contains(a)) {
                    let _=shortcut_app.emit_to("main","browser-shortcut",serde_json::json!({"tab":shortcut_tab,"action":action}));
                    if let Some(main)=shortcut_app.get_webview_window("main"){let _=main.set_focus();}
                }
                return false;
            }
            if next==&approved && first.swap(false,Ordering::SeqCst) {
                return nav_app.state::<AppState>().credential_generation.load(Ordering::SeqCst)==credential_generation;
            }
            let permitted=nav_app.state::<AppState>().credential_generation.load(Ordering::SeqCst)==credential_generation && authorize_redirect(&redirect_server,&redirect_token,next);
            if !permitted { let _=nav_app.emit_to("main","browser-policy",serde_json::json!({"message":"Native navigation was denied or its policy deadline elapsed."})); }
            permitted
        })
        .on_new_window(move |next,_| {
            if navigation::validate(next.as_str()).is_ok() { let _=popup_app.emit_to("main","browser-popup",serde_json::json!({"tab":popup_tab,"url":next.as_str()})); }
            tauri::webview::NewWindowResponse::Deny
        })
        .on_download(move |_,event| { if let tauri::webview::DownloadEvent::Requested{url,..}=event {let _=download_app.emit_to("main","browser-download-blocked",serde_json::json!({"url":url.as_str()}));} false })
        .on_page_load(move |_,payload| { let _=load_app.emit_to("main","browser-page",serde_json::json!({"tab":load_tab,"url":payload.url().as_str(),"loading":matches!(payload.event(),tauri::webview::PageLoadEvent::Started)})); })
        .build().map_err(|_| "Native content creation failed")?;
    if generation != state.generation.load(Ordering::SeqCst) {
        let _ = content.close();
        return Err("Viewport or session changed".into());
    }
    Ok(())
}

#[tauri::command]
pub fn content_visibility(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    active: Option<String>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Untrusted caller".into());
    }
    for (label, content) in app.webview_windows() {
        if label.starts_with("content-") {
            if active
                .as_ref()
                .is_some_and(|id| label == format!("content-{id}"))
            {
                let _ = content.show();
            } else {
                let _ = content.hide();
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn close_content_tab(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, AppState>,
    tab: Option<String>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Untrusted caller".into());
    }
    let _guard = state.auth_token.lock().await;
    state.generation.fetch_add(1, Ordering::SeqCst);
    if let Some(id) = tab {
        if let Some(content) = app.get_webview_window(&format!("content-{id}")) {
            content.close().map_err(|_| "Close failed")?;
        }
    } else {
        close_content(&app);
    }
    Ok(())
}
