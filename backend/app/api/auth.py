from fastapi import APIRouter, HTTPException, Depends, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr, validator
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime

from database import get_db
from app.services.auth_service import auth_service
from app.models.user import User

router = APIRouter()
security = HTTPBearer()

# Request/Response Models
class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    confirm_password: str

    @validator('confirm_password')
    def passwords_match(cls, v, values, **kwargs):
        if 'password' in values and v != values['password']:
            raise ValueError('Passwords do not match')
        return v

    @validator('full_name')
    def validate_full_name(cls, v):
        if len(v.strip()) < 2:
            raise ValueError('Full name must be at least 2 characters long')
        return v.strip()

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class LoginResponse(BaseModel):
    token: str
    user: dict
    message: str

class UserResponse(BaseModel):
    user: dict
    message: str

class MessageResponse(BaseModel):
    message: str

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    confirm_new_password: str

    @validator('confirm_new_password')
    def passwords_match(cls, v, values, **kwargs):
        if 'new_password' in values and v != values['new_password']:
            raise ValueError('New passwords do not match')
        return v

# Utility Functions
def get_client_info(request: Request) -> tuple[Optional[str], Optional[str]]:
    """Extract client IP and user agent from request."""
    # Try to get real IP from headers (for reverse proxy setups)
    ip_address = (
        request.headers.get("x-forwarded-for", "").split(",")[0].strip() or
        request.headers.get("x-real-ip") or
        request.client.host if request.client else None
    )
    user_agent = request.headers.get("user-agent")
    return ip_address, user_agent

def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    """
    Get the current authenticated user from JWT token.
    This is a FastAPI dependency that can be used in protected endpoints.
    """
    token = credentials.credentials
    user = auth_service.get_user_from_token(db, token)
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"}
        )
    
    return user

# Authentication Endpoints
@router.post("/register", response_model=LoginResponse)
async def register(
    request: RegisterRequest,
    http_request: Request,
    db: Session = Depends(get_db)
):
    """Register a new user account and return login token."""
    
    # Validate password strength
    is_valid, error_message = auth_service.validate_password_strength(request.password)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_message
        )
    
    try:
        # Create user
        user = auth_service.create_user(
            db=db,
            email=request.email,
            password=request.password,
            full_name=request.full_name
        )
        
        # Generate token and create session
        token = auth_service.create_access_token(user.id)
        ip_address, user_agent = get_client_info(http_request)
        
        auth_service.create_user_session(
            db=db,
            user=user,
            token=token,
            ip_address=ip_address,
            user_agent=user_agent
        )
        
        return LoginResponse(
            token=token,
            user=user.to_dict(),
            message=f"Account created successfully! Welcome, {user.full_name}!"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create account"
        )

@router.post("/login", response_model=LoginResponse)
async def login(
    request: LoginRequest,
    http_request: Request,
    db: Session = Depends(get_db)
):
    """Authenticate user and return login token."""
    
    # Authenticate user
    user = auth_service.authenticate_user(db, request.email, request.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    
    # Generate token and create session
    token = auth_service.create_access_token(user.id)
    ip_address, user_agent = get_client_info(http_request)
    
    auth_service.create_user_session(
        db=db,
        user=user,
        token=token,
        ip_address=ip_address,
        user_agent=user_agent
    )
    
    return LoginResponse(
        token=token,
        user=user.to_dict(),
        message=f"Welcome back, {user.full_name}!"
    )

@router.post("/logout", response_model=MessageResponse)
async def logout(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Logout current user session."""
    
    token = credentials.credentials
    success = auth_service.logout_user(db, token, current_user)
    
    if success:
        return MessageResponse(message="Successfully logged out")
    else:
        return MessageResponse(message="Already logged out")

@router.post("/logout-all", response_model=MessageResponse)
async def logout_all(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Logout from all user sessions."""
    
    count = auth_service.logout_all_sessions(db, current_user)
    
    return MessageResponse(
        message=f"Successfully logged out from {count} sessions"
    )

@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: User = Depends(get_current_user)
):
    """Get current user information."""
    
    return UserResponse(
        user=current_user.to_dict(),
        message="User information retrieved successfully"
    )

@router.post("/change-password", response_model=MessageResponse)
async def change_password(
    request: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Change user password."""
    
    # Validate new password strength
    is_valid, error_message = auth_service.validate_password_strength(request.new_password)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_message
        )
    
    try:
        auth_service.change_password(
            db=db,
            user=current_user,
            old_password=request.current_password,
            new_password=request.new_password
        )
        
        return MessageResponse(
            message="Password changed successfully. You have been logged out from other sessions."
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to change password"
        )

@router.get("/sessions")
async def get_user_sessions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all active sessions for the current user."""
    
    sessions = auth_service.get_user_sessions(db, current_user, active_only=True)
    
    return {
        "sessions": [session.to_dict() for session in sessions],
        "total_sessions": len(sessions)
    }

# Legacy compatibility endpoints (for gradual migration)
@router.post("/validate")
async def validate_token_legacy(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
):
    """
    Legacy endpoint for token validation.
    Used by existing frontend code during migration.
    """
    
    token = credentials.credentials
    user = auth_service.get_user_from_token(db, token)
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token"
        )
    
    return {
        "valid": True,
        "user": user.to_dict(),
        "expires_at": "Valid for 7 days"  # Legacy format
    }

# Admin/Debug endpoints
@router.get("/stats")
async def get_auth_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get authentication statistics."""
    
    # Clean up expired sessions
    cleaned_up = auth_service.cleanup_expired_sessions(db)
    
    # Get total users and sessions
    total_users = db.query(User).count()
    active_users = db.query(User).filter(User.is_active == True).count()
    from app.models.user import UserSession
    active_sessions = db.query(UserSession).filter(UserSession.is_active == True).count()
    
    return {
        "total_users": total_users,
        "active_users": active_users,
        "active_sessions": active_sessions,
        "expired_sessions_cleaned": cleaned_up,
        "database_status": "connected"
    }

@router.get("/test")
async def test_auth_route():
    """Test endpoint to verify auth routing is working."""
    return {
        "message": "Real authentication system is active",
        "endpoints": [
            "POST /register - Create new account",
            "POST /login - Login with email/password", 
            "POST /logout - Logout current session",
            "GET /me - Get current user info",
            "POST /change-password - Change password"
        ]
    }