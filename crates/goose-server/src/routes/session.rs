use super::utils::verify_secret_key;
use chrono::{DateTime, Datelike};
use std::collections::HashMap;
use std::sync::Arc;

use crate::state::AppState;
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, put},
    Json, Router,
};
use goose::message::Message;
use goose::session;
use goose::session::info::{get_valid_sorted_sessions, SessionInfo, SortOrder};
use goose::session::SessionMetadata;
use serde::{Deserialize, Serialize};
use tracing::{error, info};
use utoipa::ToSchema;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionListResponse {
    /// List of available session information objects
    sessions: Vec<SessionInfo>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionHistoryResponse {
    /// Unique identifier for the session
    session_id: String,
    /// Session metadata containing creation time and other details
    metadata: SessionMetadata,
    /// List of messages in the session conversation
    messages: Vec<Message>,
}

#[derive(Serialize, ToSchema, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionInsights {
    /// Total number of sessions
    total_sessions: usize,
    /// Most active working directories with session counts
    most_active_dirs: Vec<(String, usize)>,
    /// Average session duration in minutes
    avg_session_duration: f64,
    /// Total tokens used across all sessions
    total_tokens: i64,
    /// Activity trend for the last 7 days
    recent_activity: Vec<(String, usize)>,
}

#[derive(Serialize, ToSchema, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ActivityHeatmapCell {
    pub week: usize,
    pub day: usize,
    pub count: usize,
}

#[utoipa::path(
    get,
    path = "/sessions",
    responses(
        (status = 200, description = "List of available sessions retrieved successfully", body = SessionListResponse),
        (status = 401, description = "Unauthorized - Invalid or missing API key"),
        (status = 500, description = "Internal server error")
    ),
    security(
        ("api_key" = [])
    ),
    tag = "Session Management"
)]
// List all available sessions
async fn list_sessions(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<SessionListResponse>, StatusCode> {
    verify_secret_key(&headers, &state)?;

    let sessions = get_valid_sorted_sessions(SortOrder::Descending)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(SessionListResponse { sessions }))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}",
    params(
        ("session_id" = String, Path, description = "Unique identifier for the session")
    ),
    responses(
        (status = 200, description = "Session history retrieved successfully", body = SessionHistoryResponse),
        (status = 401, description = "Unauthorized - Invalid or missing API key"),
        (status = 404, description = "Session not found"),
        (status = 500, description = "Internal server error")
    ),
    security(
        ("api_key" = [])
    ),
    tag = "Session Management"
)]
// Get a specific session's history
async fn get_session_history(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
) -> Result<Json<SessionHistoryResponse>, StatusCode> {
    verify_secret_key(&headers, &state)?;

    let session_path = match session::get_path(session::Identifier::Name(session_id.clone())) {
        Ok(path) => path,
        Err(_) => return Err(StatusCode::BAD_REQUEST),
    };

    let metadata = session::read_metadata(&session_path).map_err(|_| StatusCode::NOT_FOUND)?;

    let messages = match session::read_messages(&session_path) {
        Ok(messages) => messages,
        Err(e) => {
            tracing::error!("Failed to read session messages: {:?}", e);
            return Err(StatusCode::NOT_FOUND);
        }
    };

    Ok(Json(SessionHistoryResponse {
        session_id,
        metadata,
        messages,
    }))
}

#[utoipa::path(
    get,
    path = "/sessions/insights",
    responses(
        (status = 200, description = "Session insights retrieved successfully", body = SessionInsights),
        (status = 401, description = "Unauthorized - Invalid or missing API key"),
        (status = 500, description = "Internal server error")
    ),
    security(
        ("api_key" = [])
    ),
    tag = "Session Management"
)]
async fn get_session_insights(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<SessionInsights>, StatusCode> {
    info!("Received request for session insights");

    verify_secret_key(&headers, &state)?;

    let sessions = get_valid_sorted_sessions(SortOrder::Descending).map_err(|e| {
        error!("Failed to get session info: {:?}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Filter out sessions without descriptions
    let sessions: Vec<SessionInfo> = sessions
        .into_iter()
        .filter(|session| !session.metadata.description.is_empty())
        .collect();

    info!("Found {} sessions with descriptions", sessions.len());

    // Calculate insights
    let total_sessions = sessions.len();

    // Debug: Log if we have very few sessions, which might indicate filtering issues
    if total_sessions == 0 {
        info!("Warning: No sessions found with descriptions");
    }

    // Track directory usage
    let mut dir_counts: HashMap<String, usize> = HashMap::new();
    let mut total_duration = 0.0;
    let mut total_tokens = 0;
    let mut activity_by_date: HashMap<String, usize> = HashMap::new();

    for session in &sessions {
        // Track directory usage
        let dir = session.metadata.working_dir.to_string_lossy().to_string();
        *dir_counts.entry(dir).or_insert(0) += 1;

        // Track tokens - only add positive values to prevent negative totals
        if let Some(tokens) = session.metadata.accumulated_total_tokens {
            match tokens.cmp(&0) {
                std::cmp::Ordering::Greater => {
                    total_tokens += tokens as i64;
                }
                std::cmp::Ordering::Less => {
                    // Log negative token values for debugging
                    info!(
                        "Warning: Session {} has negative accumulated_total_tokens: {}",
                        session.id, tokens
                    );
                }
                std::cmp::Ordering::Equal => {
                    // Zero tokens, no action needed
                }
            }
        }

        // Track activity by date
        if let Ok(date) = DateTime::parse_from_str(&session.modified, "%Y-%m-%d %H:%M:%S UTC") {
            let date_str = date.format("%Y-%m-%d").to_string();
            *activity_by_date.entry(date_str).or_insert(0) += 1;
        }

        // Calculate session duration from messages
        let session_path = session::get_path(session::Identifier::Name(session.id.clone()));
        if let Ok(session_path) = session_path {
            if let Ok(messages) = session::read_messages(&session_path) {
                if let (Some(first), Some(last)) = (messages.first(), messages.last()) {
                    let duration = (last.created - first.created) as f64 / 60.0; // Convert to minutes
                    total_duration += duration;
                }
            }
        }
    }

    // Get top 3 most active directories
    let mut dir_vec: Vec<(String, usize)> = dir_counts.into_iter().collect();
    dir_vec.sort_by(|a, b| b.1.cmp(&a.1));
    let most_active_dirs = dir_vec.into_iter().take(3).collect();

    // Calculate average session duration
    let avg_session_duration = if total_sessions > 0 {
        total_duration / total_sessions as f64
    } else {
        0.0
    };

    // Get last 7 days of activity
    let mut activity_vec: Vec<(String, usize)> = activity_by_date.into_iter().collect();
    activity_vec.sort_by(|a, b| b.0.cmp(&a.0)); // Sort by date descending
    let recent_activity = activity_vec.into_iter().take(7).collect();

    let insights = SessionInsights {
        total_sessions,
        most_active_dirs,
        avg_session_duration,
        total_tokens,
        recent_activity,
    };

    info!("Returning insights: {:?}", insights);
    Ok(Json(insights))
}

#[utoipa::path(
    get,
    path = "/sessions/activity-heatmap",
    responses(
        (status = 200, description = "Activity heatmap data", body = [ActivityHeatmapCell]),
        (status = 401, description = "Unauthorized - Invalid or missing API key"),
        (status = 500, description = "Internal server error")
    ),
    security(("api_key" = [])),
    tag = "Session Management"
)]
async fn get_activity_heatmap(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<ActivityHeatmapCell>>, StatusCode> {
    verify_secret_key(&headers, &state)?;

    let sessions = get_valid_sorted_sessions(SortOrder::Descending)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Only sessions with a description
    let sessions: Vec<SessionInfo> = sessions
        .into_iter()
        .filter(|session| !session.metadata.description.is_empty())
        .collect();

    // Map: (week, day) -> count
    let mut heatmap: std::collections::HashMap<(usize, usize), usize> =
        std::collections::HashMap::new();

    for session in &sessions {
        if let Ok(date) =
            chrono::NaiveDateTime::parse_from_str(&session.modified, "%Y-%m-%d %H:%M:%S UTC")
        {
            let date = date.date();
            let week = date.iso_week().week() as usize - 1; // 0-based week
            let day = date.weekday().num_days_from_sunday() as usize; // 0=Sun, 6=Sat
            *heatmap.entry((week, day)).or_insert(0) += 1;
        }
    }

    let mut result = Vec::new();
    for ((week, day), count) in heatmap {
        result.push(ActivityHeatmapCell { week, day, count });
    }

    Ok(Json(result))
}

#[derive(Deserialize, ToSchema)]
pub struct UpdateSessionTitleRequest {
    pub title: String,
}

#[utoipa::path(
    put,
    path = "/sessions/{session_id}/title",
    request_body = UpdateSessionTitleRequest,
    responses(
        (status = 200, description = "Session title updated successfully"),
        (status = 404, description = "Session not found"),
        (status = 401, description = "Unauthorized")
    ),
    security(
        ("api_key" = [])
    ),
    tag = "Session Management"
)]
async fn update_session_title(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
    Json(payload): Json<UpdateSessionTitleRequest>,
) -> Result<StatusCode, StatusCode> {
    verify_secret_key(&headers, &state)?;

    let session_path = session::get_path(session::Identifier::Name(session_id))
        .map_err(|_| StatusCode::NOT_FOUND)?;

    // Check if session file actually exists
    if !session_path.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    let mut metadata = session::read_metadata(&session_path)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Update title and mark as customized
    metadata.description = payload.title;
    metadata.is_title_customized = true;

    // Update metadata synchronously for reliable operation
    session::update_metadata(&session_path, &metadata)
        .await
        .map_err(|e| {
            tracing::error!("Failed to update session metadata: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(StatusCode::OK)
}

// Configure routes for this module
pub fn routes(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/sessions", get(list_sessions))
        .route("/sessions/{session_id}", get(get_session_history))
        .route("/sessions/{session_id}/title", put(update_session_title))
        .route("/sessions/insights", get(get_session_insights))
        .route("/sessions/activity-heatmap", get(get_activity_heatmap))
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use goose::message::Message;
    use goose::session;
    use serde_json::json;
    use tower::ServiceExt;

    async fn create_test_app() -> Router {
        let agent = Arc::new(goose::agents::Agent::new());
        let state = AppState::new(agent, "test-secret".to_string()).await;
        routes(state)
    }

    async fn create_test_session(session_id: &str) -> std::path::PathBuf {
        let session_path = session::get_path(session::Identifier::Name(session_id.to_string()))
            .expect("Failed to get session path");

        let messages = vec![Message::user().with_text("Test message")];
        session::persist_messages(&session_path, &messages, None, None)
            .await
            .expect("Failed to persist test messages");

        session_path
    }

    #[tokio::test]
    async fn test_update_session_title_success() {
        let app = create_test_app().await;
        let session_id = "test-session-123";
        let session_path = create_test_session(session_id).await;

        let request = Request::builder()
            .uri(&format!("/sessions/{}/title", session_id))
            .method("PUT")
            .header("content-type", "application/json")
            .header("x-secret-key", "test-secret")
            .body(Body::from(
                json!({
                    "title": "My Custom Session Title"
                })
                .to_string(),
            ))
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        // Verify the title was actually updated
        let metadata = session::read_metadata(&session_path).unwrap();
        assert_eq!(metadata.description, "My Custom Session Title");
        assert_eq!(metadata.is_title_customized, true);
    }

    #[tokio::test]
    async fn test_update_session_title_unauthorized() {
        let app = create_test_app().await;
        let session_id = "test-session-456";

        let request = Request::builder()
            .uri(&format!("/sessions/{}/title", session_id))
            .method("PUT")
            .header("content-type", "application/json")
            // Missing x-secret-key header
            .body(Body::from(
                json!({
                    "title": "Should Fail"
                })
                .to_string(),
            ))
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_update_session_title_wrong_secret() {
        let app = create_test_app().await;
        let session_id = "test-session-789";

        let request = Request::builder()
            .uri(&format!("/sessions/{}/title", session_id))
            .method("PUT")
            .header("content-type", "application/json")
            .header("x-secret-key", "wrong-secret")
            .body(Body::from(
                json!({
                    "title": "Should Fail"
                })
                .to_string(),
            ))
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_update_session_title_not_found() {
        let app = create_test_app().await;
        let session_id = format!("nonexistent-session-{}", chrono::Utc::now().timestamp_micros());

        let request = Request::builder()
            .uri(&format!("/sessions/{}/title", session_id))
            .method("PUT")
            .header("content-type", "application/json")
            .header("x-secret-key", "test-secret")
            .body(Body::from(
                json!({
                    "title": "Should Fail"
                })
                .to_string(),
            ))
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_update_session_title_empty_body() {
        let app = create_test_app().await;
        let session_id = "test-session-empty";
        let _session_path = create_test_session(session_id).await;

        let request = Request::builder()
            .uri(&format!("/sessions/{}/title", session_id))
            .method("PUT")
            .header("content-type", "application/json")
            .header("x-secret-key", "test-secret")
            .body(Body::from("{}"))
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        // Should fail due to missing title field
        assert_ne!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_update_session_title_preserves_existing_metadata() {
        let app = create_test_app().await;
        let session_id = "test-session-preserve";
        let session_path = create_test_session(session_id).await;

        // Set some initial metadata
        let mut initial_metadata = session::read_metadata(&session_path).unwrap();
        initial_metadata.message_count = 5;
        initial_metadata.total_tokens = Some(100);
        session::update_metadata(&session_path, &initial_metadata)
            .await
            .unwrap();

        let request = Request::builder()
            .uri(&format!("/sessions/{}/title", session_id))
            .method("PUT")
            .header("content-type", "application/json")
            .header("x-secret-key", "test-secret")
            .body(Body::from(
                json!({
                    "title": "New Title"
                })
                .to_string(),
            ))
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        // Verify other metadata was preserved
        let updated_metadata = session::read_metadata(&session_path).unwrap();
        assert_eq!(updated_metadata.description, "New Title");
        assert_eq!(updated_metadata.is_title_customized, true);
        assert_eq!(updated_metadata.message_count, 5);
        assert_eq!(updated_metadata.total_tokens, Some(100));
    }
}
