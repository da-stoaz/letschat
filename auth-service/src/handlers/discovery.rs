use axum::{Json, extract::State};
use serde::Serialize;

use crate::AppState;

#[derive(Serialize)]
pub(crate) struct WellKnown {
    spacetimedb: String,
    auth: String,
    livekit: String,
    database: String,
}

pub(crate) async fn well_known(State(state): State<AppState>) -> Json<WellKnown> {
    Json(WellKnown {
        spacetimedb: state.discovery_spacetimedb_uri,
        auth: state.discovery_auth_url,
        livekit: state.discovery_livekit_url,
        database: state.discovery_database,
    })
}