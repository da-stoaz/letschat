use anyhow::Context;
use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString, rand_core::OsRng},
};

use crate::ApiError;

pub(crate) fn validate_username(username: &str) -> Result<(), ApiError> {
    let valid_len = (2..=32).contains(&username.len());
    let valid_chars = username
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '_');
    if !valid_len || !valid_chars {
        return Err(ApiError::BadRequest(
            "Username must be 2-32 characters using [a-z0-9_] only.".to_string(),
        ));
    }
    Ok(())
}

pub(crate) fn validate_password(password: &str) -> Result<(), ApiError> {
    if password.len() < 8 {
        return Err(ApiError::BadRequest(
            "Password must be at least 8 characters.".to_string(),
        ));
    }
    Ok(())
}

pub(crate) fn normalize_username(username: &str) -> String {
    username.trim().to_lowercase()
}

pub(crate) fn hash_password(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .context("failed to hash password")?
        .to_string();
    Ok(hash)
}

pub(crate) fn verify_password(password: &str, hash: &str) -> anyhow::Result<()> {
    let parsed_hash = PasswordHash::new(hash).context("invalid password hash")?;
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .context("password verification failed")
}
