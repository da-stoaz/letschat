use spacetimedb::{ReducerContext, Table};

use crate::helpers::{assert_or_err, member_key, require_member_role, require_owner, voice_key};
use crate::schema::*;

#[spacetimedb::reducer]
pub fn create_server(ctx: &ReducerContext, name: String) -> Result<(), String> {
    assert_or_err((2..=100).contains(&name.len()), "server name must be 2-100 chars")?;

    let server_row = ctx.db.server().insert(Server {
        id: 0,
        name,
        owner_identity: ctx.sender(),
        invite_policy: InvitePolicy::ModeratorsOnly,
        icon_url: None,
        created_at: ctx.timestamp,
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
        moderator_only: false,
    });

    ctx.db.channel().insert(Channel {
        id: 0,
        server_id,
        name: "General".to_string(),
        kind: ChannelKind::Voice,
        position: 0,
        moderator_only: false,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn rename_server(ctx: &ReducerContext, server_id: u64, new_name: String) -> Result<(), String> {
    assert_or_err((2..=100).contains(&new_name.len()), "server name must be 2-100 chars")?;
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
        ctx.db.server_member().member_key().delete(&member.member_key);
    }

    let bans: Vec<Ban> = ctx.db.ban().iter().filter(|b| b.server_id == server_id).collect();
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
