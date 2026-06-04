use spacetimedb::{ReducerContext, Table};

use crate::helpers::{
    assert_or_err, has_member_role, is_banned, is_system_admin, member_key, require_member_role,
    require_owner, voice_key,
};
use crate::schema::*;

#[spacetimedb::reducer]
pub fn create_server(ctx: &ReducerContext, name: String) -> Result<(), String> {
    assert_or_err(
        (2..=100).contains(&name.len()),
        "server name must be 2-100 chars",
    )?;

    // Instance-wide policy gate. The `SystemSettings` row is seeded by the
    // `init` lifecycle reducer; defaults to `Anyone` so the existing
    // behaviour is preserved until an operator flips it to `AdminsOnly`.
    let policy = ctx
        .db
        .system_settings()
        .id()
        .find(1u8)
        .map(|s| s.space_create_policy)
        .unwrap_or(SpaceCreatePolicy::Anyone);
    if matches!(policy, SpaceCreatePolicy::AdminsOnly) {
        assert_or_err(
            is_system_admin(ctx, ctx.sender()),
            "only instance admins can create spaces under the current policy",
        )?;
    }

    let server_row = ctx.db.server().insert(Server {
        id: 0,
        name,
        owner_identity: ctx.sender(),
        invite_policy: InvitePolicy::ModeratorsOnly,
        icon_url: None,
        created_at: ctx.timestamp,
        is_discoverable: false,
        description: None,
        tags: None,
    });

    let server_id = server_row.id;

    ctx.db.server_member().insert(ServerMember {
        member_key: member_key(server_id, ctx.sender()),
        server_id,
        user_identity: ctx.sender(),
        role: Role::Owner,
        joined_at: ctx.timestamp,
        timeout_until: None,
    });

    ctx.db.channel().insert(Channel {
        id: 0,
        server_id,
        name: "general".to_string(),
        kind: ChannelKind::Text,
        position: 0,
        section: None,
        moderator_only: false,
    });

    ctx.db.channel().insert(Channel {
        id: 0,
        server_id,
        name: "General".to_string(),
        kind: ChannelKind::Voice,
        position: 0,
        section: None,
        moderator_only: false,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn rename_server(ctx: &ReducerContext, server_id: u64, new_name: String) -> Result<(), String> {
    assert_or_err(
        (2..=100).contains(&new_name.len()),
        "server name must be 2-100 chars",
    )?;
    require_owner(ctx, server_id, ctx.sender())?;

    let mut server_row = ctx
        .db
        .server()
        .id()
        .find(server_id)
        .ok_or_else(|| "server not found".to_string())?;
    server_row.name = new_name;
    ctx.db.server().id().update(server_row);
    Ok(())
}

#[spacetimedb::reducer]
pub fn set_server_invite_policy(
    ctx: &ReducerContext,
    server_id: u64,
    invite_policy: InvitePolicy,
) -> Result<(), String> {
    require_owner(ctx, server_id, ctx.sender())?;

    let mut server_row = ctx
        .db
        .server()
        .id()
        .find(server_id)
        .ok_or_else(|| "server not found".to_string())?;
    server_row.invite_policy = invite_policy;
    ctx.db.server().id().update(server_row);
    Ok(())
}

/// Owner-only: toggle a space's discoverability and set its blurb. The
/// description is trimmed and capped at 280 chars; an empty/whitespace blurb is
/// stored as `None`.
#[spacetimedb::reducer]
pub fn set_server_discovery(
    ctx: &ReducerContext,
    server_id: u64,
    is_discoverable: bool,
    description: Option<String>,
) -> Result<(), String> {
    require_owner(ctx, server_id, ctx.sender())?;

    let normalized_description = description
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if let Some(desc) = normalized_description.as_ref() {
        assert_or_err(
            desc.chars().count() <= 280,
            "description must be at most 280 chars",
        )?;
    }
    // Per-owner discoverable-space quota deferred (plan 1.5 phase 3) — revisit
    // if discovery spam appears.

    let mut server_row = ctx
        .db
        .server()
        .id()
        .find(server_id)
        .ok_or_else(|| "server not found".to_string())?;
    server_row.is_discoverable = is_discoverable;
    server_row.description = normalized_description;
    ctx.db.server().id().update(server_row);
    Ok(())
}

/// Owner-only: set a space's topic tags (≤5, each lowercased and ≤24 chars,
/// de-duplicated). Used to filter the Discover surface.
#[spacetimedb::reducer]
pub fn set_server_tags(
    ctx: &ReducerContext,
    server_id: u64,
    tags: Vec<String>,
) -> Result<(), String> {
    require_owner(ctx, server_id, ctx.sender())?;

    let mut normalized: Vec<String> = Vec::new();
    for raw in tags {
        let tag = raw.trim().to_lowercase();
        if tag.is_empty() {
            continue;
        }
        assert_or_err(
            tag.chars().count() <= 24,
            "each tag must be at most 24 characters",
        )?;
        if !normalized.contains(&tag) {
            normalized.push(tag);
        }
    }
    assert_or_err(normalized.len() <= 5, "a space can have at most 5 tags")?;

    let mut server_row = ctx
        .db
        .server()
        .id()
        .find(server_id)
        .ok_or_else(|| "server not found".to_string())?;
    server_row.tags = if normalized.is_empty() { None } else { Some(normalized) };
    ctx.db.server().id().update(server_row);
    Ok(())
}

/// One-click join for a space surfaced on Discover. Only valid for a space that
/// is discoverable AND has an `Everyone` invite policy; `ModeratorsOnly` spaces
/// must still be invited (the client shows a stub for those). Rejects callers
/// who are already members or are banned.
#[spacetimedb::reducer]
pub fn join_discoverable_server(ctx: &ReducerContext, server_id: u64) -> Result<(), String> {
    let caller = ctx.sender();

    let server_row = ctx
        .db
        .server()
        .id()
        .find(server_id)
        .ok_or_else(|| "server not found".to_string())?;

    assert_or_err(server_row.is_discoverable, "this space is not discoverable")?;
    assert_or_err(
        matches!(server_row.invite_policy, InvitePolicy::Everyone),
        "this space requires an invite from a moderator",
    )?;
    assert_or_err(
        has_member_role(ctx, server_id, caller).is_none(),
        "you are already a member of this space",
    )?;
    assert_or_err(
        !is_banned(ctx, server_id, caller),
        "you are banned from this space",
    )?;

    ctx.db.server_member().insert(ServerMember {
        member_key: member_key(server_id, caller),
        server_id,
        user_identity: caller,
        role: Role::Member,
        joined_at: ctx.timestamp,
        timeout_until: None,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn set_server_icon(
    ctx: &ReducerContext,
    server_id: u64,
    icon_url: Option<String>,
) -> Result<(), String> {
    require_owner(ctx, server_id, ctx.sender())?;

    let normalized_icon_url = icon_url
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if let Some(url) = normalized_icon_url.as_ref() {
        assert_or_err(
            url.len() <= 2048,
            "server icon url must be at most 2048 chars",
        )?;
    }

    let mut server_row = ctx
        .db
        .server()
        .id()
        .find(server_id)
        .ok_or_else(|| "server not found".to_string())?;
    server_row.icon_url = normalized_icon_url;
    ctx.db.server().id().update(server_row);
    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_server(ctx: &ReducerContext, server_id: u64) -> Result<(), String> {
    require_owner(ctx, server_id, ctx.sender())?;

    let channel_ids: Vec<u64> = ctx
        .db
        .channel()
        .iter()
        .filter(|c| c.server_id == server_id)
        .map(|c| c.id)
        .collect();

    for channel_id in &channel_ids {
        let messages: Vec<Message> = ctx
            .db
            .message()
            .iter()
            .filter(|m| m.channel_id == *channel_id)
            .collect();
        for msg in messages {
            ctx.db.message().id().delete(msg.id);
        }

        let participants: Vec<VoiceParticipant> = ctx
            .db
            .voice_participant()
            .iter()
            .filter(|v| v.channel_id == *channel_id)
            .collect();
        for vp in participants {
            ctx.db.voice_participant().voice_key().delete(&vp.voice_key);
        }
    }

    let members: Vec<ServerMember> = ctx
        .db
        .server_member()
        .iter()
        .filter(|m| m.server_id == server_id)
        .collect();
    for member in members {
        ctx.db
            .server_member()
            .member_key()
            .delete(&member.member_key);
    }

    let bans: Vec<Ban> = ctx
        .db
        .ban()
        .iter()
        .filter(|b| b.server_id == server_id)
        .collect();
    for ban_row in bans {
        ctx.db.ban().ban_key().delete(&ban_row.ban_key);
    }

    let invites: Vec<Invite> = ctx
        .db
        .invite()
        .iter()
        .filter(|i| i.server_id == server_id)
        .collect();
    for invite_row in invites {
        ctx.db.invite().token().delete(&invite_row.token);
    }

    let join_requests: Vec<JoinRequest> = ctx
        .db
        .join_request()
        .iter()
        .filter(|r| r.server_id == server_id)
        .collect();
    for request in join_requests {
        ctx.db.join_request().request_key().delete(&request.request_key);
    }

    for channel_id in channel_ids {
        ctx.db.channel().id().delete(channel_id);
    }

    ctx.db.server().id().delete(server_id);
    Ok(())
}

#[spacetimedb::reducer]
pub fn leave_server(ctx: &ReducerContext, server_id: u64) -> Result<(), String> {
    let role = require_member_role(ctx, server_id, ctx.sender())?;
    assert_or_err(
        role != Role::Owner,
        "owner must transfer ownership before leaving",
    )?;

    ctx.db
        .server_member()
        .member_key()
        .delete(member_key(server_id, ctx.sender()));

    let channel_ids: Vec<u64> = ctx
        .db
        .channel()
        .iter()
        .filter(|c| c.server_id == server_id)
        .map(|c| c.id)
        .collect();

    for channel_id in channel_ids {
        ctx.db
            .voice_participant()
            .voice_key()
            .delete(voice_key(channel_id, ctx.sender()));
    }

    Ok(())
}
