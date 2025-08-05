from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import secrets
import hashlib
from datetime import datetime, timedelta

router = APIRouter()

# Simple in-memory session storage (use Redis or database in production)
active_sessions = {}

@router.get("/test")
async def test_auth_route():
    """Test endpoint to verify auth routing is working"""
    return {"message": "Auth routes are working", "demo_credentials": "admin/admin or user/password"}

class LoginRequest(BaseModel):
    username: str
    password: str

class LoginResponse(BaseModel):
    token: str
    message: str

class TokenValidation(BaseModel):
    token: str

# Demo credentials (use proper authentication in production)
DEMO_USERS = {
    "admin": "admin",  # In production, store hashed passwords
    "user": "password"
}

@router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    """Simple demo login endpoint"""
    username = request.username.lower()
    password = request.password
    
    # Check credentials
    if username not in DEMO_USERS or DEMO_USERS[username] != password:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    # Generate session token
    token = secrets.token_urlsafe(32)
    
    # Store session (expires in 24 hours)
    active_sessions[token] = {
        "username": username,
        "created_at": datetime.now(),
        "expires_at": datetime.now() + timedelta(hours=24)
    }
    
    return LoginResponse(
        token=token,
        message=f"Successfully logged in as {username}"
    )

@router.post("/logout")
async def logout(request: TokenValidation):
    """Logout and invalidate token"""
    token = request.token
    
    if token in active_sessions:
        del active_sessions[token]
        return {"message": "Successfully logged out"}
    
    return {"message": "Token not found or already expired"}

@router.post("/validate")
async def validate_token(request: TokenValidation):
    """Validate if token is still active"""
    token = request.token
    
    if token not in active_sessions:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    session = active_sessions[token]
    
    # Check if token is expired
    if datetime.now() > session["expires_at"]:
        del active_sessions[token]
        raise HTTPException(status_code=401, detail="Token expired")
    
    return {
        "valid": True,
        "username": session["username"],
        "expires_at": session["expires_at"].isoformat()
    }

@router.get("/validate/{token}")
async def validate_token_get(token: str):
    """GET endpoint for token validation - for debugging"""
    if token not in active_sessions:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    session = active_sessions[token]
    
    # Check if token is expired
    if datetime.now() > session["expires_at"]:
        del active_sessions[token]
        raise HTTPException(status_code=401, detail="Token expired")
    
    return {
        "valid": True,
        "username": session["username"],
        "expires_at": session["expires_at"].isoformat()
    }

@router.get("/session-info")
async def get_session_info():
    """Get information about active sessions (for debugging)"""
    # Clean up expired sessions
    current_time = datetime.now()
    expired_tokens = [
        token for token, session in active_sessions.items()
        if current_time > session["expires_at"]
    ]
    
    for token in expired_tokens:
        del active_sessions[token]
    
    return {
        "active_sessions": len(active_sessions),
        "sessions": [
            {
                "username": session["username"],
                "created_at": session["created_at"].isoformat(),
                "expires_at": session["expires_at"].isoformat()
            }
            for session in active_sessions.values()
        ]
    }