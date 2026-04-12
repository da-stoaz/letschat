use axum::Json;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub(crate) struct HealthResponse {
    status: &'static str,
}

pub(crate) async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}
