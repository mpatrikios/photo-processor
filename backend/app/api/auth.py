import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, validator
from sqlalchemy.orm import Session

from app.models.user import User
from app.services.auth_service import auth_service
from database import get_db

logger = logging.getLogger(__name__)

router = APIRouter()
security = HTTPBearer()


# Request/Response Models
class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str

    @validator("full_name")
    def validate_full_name(cls, v):
        if len(v.strip()) < 2:
            raise ValueError("Full name must be at least 2 characters long")
        return v.strip()


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    token: str
    refresh_token: str
    user: dict
    message: str
    expires_in: int


class UserResponse(BaseModel):
    user: dict
    message: str


class MessageResponse(BaseModel):
    message: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


# Utility Functions
def get_client_info(request: Request) -> tuple[Optional[str], Optional[str]]:
    """Extract client IP and user agent from request."""
    # Try to get real IP from headers (for reverse proxy setups)
    ip_address = (
        request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        or request.headers.get("x-real-ip")
        or request.client.host
        if request.client
        else None
    )
    user_agent = request.headers.get("user-agent")
    return ip_address, user_agent


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    """
    Get the current authenticated user from JWT token.
    This is a FastAPI dependency that can be used in protected endpoints.
    """
    if not credentials or not credentials.credentials:
        # No credentials provided
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No authorization token provided",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials.strip()
    # Authentication attempt

    user = auth_service.get_user_from_token(db, token)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


# Authentication Endpoints
@router.post("/register", response_model=LoginResponse)
async def register(
    request: RegisterRequest, http_request: Request, db: Session = Depends(get_db)
):
    """Register a new user account and return login token."""

    # Validate password strength
    is_valid, error_message = auth_service.validate_password_strength(request.password)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=error_message
        )

    try:
        # Create user
        user = auth_service.create_user(
            db=db,
            email=request.email,
            password=request.password,
            full_name=request.full_name,
        )

        # Generate token pair and create session
        token_data = auth_service.create_token_pair(user.id)
        ip_address, user_agent = get_client_info(http_request)

        auth_service.create_user_session(
            db=db, user=user, token=token_data["access_token"], ip_address=ip_address, user_agent=user_agent
        )

        return LoginResponse(
            token=token_data["access_token"],
            refresh_token=token_data["refresh_token"], 
            user=user.to_dict(),
            message=f"Account created successfully! Welcome, {user.full_name}!",
            expires_in=token_data["expires_in"]
        )

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create account",
        )


@router.post("/login", response_model=LoginResponse)
async def login(
    request: LoginRequest, http_request: Request, db: Session = Depends(get_db)
):
    """Authenticate user and return login token."""

    # Authenticate user
    user = auth_service.authenticate_user(db, request.email, request.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password"
        )

    # Generate token pair and create session
    token_data = auth_service.create_token_pair(user.id)
    ip_address, user_agent = get_client_info(http_request)

    auth_service.create_user_session(
        db=db, user=user, token=token_data["access_token"], ip_address=ip_address, user_agent=user_agent
    )

    return LoginResponse(
        token=token_data["access_token"],
        refresh_token=token_data["refresh_token"],
        user=user.to_dict(), 
        message=f"Welcome back, {user.full_name}!",
        expires_in=token_data["expires_in"]
    )


@router.post("/refresh", response_model=LoginResponse)
async def refresh_token(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
):
    """Refresh access token using refresh token."""
    
    refresh_token = credentials.credentials
    token_data = auth_service.verify_token(refresh_token)
    
    if not token_data or token_data.get("token_type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    user_id = token_data["user_id"]
    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )
    
    # Generate new token pair
    new_token_data = auth_service.create_token_pair(user.id)
    
    return LoginResponse(
        token=new_token_data["access_token"],
        refresh_token=new_token_data["refresh_token"],
        user=user.to_dict(),
        message="Token refreshed successfully",
        expires_in=new_token_data["expires_in"]
    )


@router.post("/logout", response_model=MessageResponse)
async def logout(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
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
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Logout from all user sessions."""

    count = auth_service.logout_all_sessions(db, current_user)

    return MessageResponse(message=f"Successfully logged out from {count} sessions")


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(current_user: User = Depends(get_current_user)):
    """Get current user information."""

    return UserResponse(
        user=current_user.to_dict(), message="User information retrieved successfully"
    )


@router.post("/change-password", response_model=MessageResponse)
async def change_password(
    request: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Change user password."""

    # Validate new password strength
    is_valid, error_message = auth_service.validate_password_strength(
        request.new_password
    )
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=error_message
        )

    try:
        auth_service.change_password(
            db=db,
            user=current_user,
            old_password=request.current_password,
            new_password=request.new_password,
        )

        return MessageResponse(
            message="Password changed successfully. You have been logged out from other sessions."
        )

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to change password",
        )


@router.get("/sessions")
async def get_user_sessions(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Get all active sessions for the current user."""

    sessions = auth_service.get_user_sessions(db, current_user, active_only=True)

    return {
        "sessions": [session.to_dict() for session in sessions],
        "total_sessions": len(sessions),
    }


# Legacy compatibility endpoints (for gradual migration)
@router.post("/validate")
async def validate_token_legacy(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
):
    """
    Legacy endpoint for token validation.
    Used by existing frontend code during migration.
    """

    token = credentials.credentials
    user = auth_service.get_user_from_token(db, token)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token"
        )

    return {
        "valid": True,
        "user": user.to_dict(),
        "expires_at": "Valid for 7 days",  # Legacy format
    }


# Admin/Debug endpoints
@router.get("/stats")
async def get_auth_stats(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Get authentication statistics."""

    # Clean up expired sessions
    cleaned_up = auth_service.cleanup_expired_sessions(db)

    # Get total users and sessions
    total_users = db.query(User).count()
    active_users = db.query(User).filter(User.is_active.is_(True)).count()
    from app.models.user import UserSession

    active_sessions = (
        db.query(UserSession).filter(UserSession.is_active.is_(True)).count()
    )

    return {
        "total_users": total_users,
        "active_users": active_users,
        "active_sessions": active_sessions,
        "expired_sessions_cleaned": cleaned_up,
        "database_status": "connected",
    }


# Password Reset Endpoints
class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str

    @validator("new_password")
    def validate_password_strength(cls, v):
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        if not any(c.isupper() for c in v):
            raise ValueError("Password must contain uppercase letter")
        if not any(c.islower() for c in v):
            raise ValueError("Password must contain lowercase letter")
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain a number")
        return v


@router.post("/password/reset-request", response_model=MessageResponse)
async def request_password_reset(
    request: PasswordResetRequest,
    http_request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Request a password reset link. Sends email with reset token.
    Rate limited to prevent abuse.
    """
    from app.core.security import limiter
    from slowapi import Limiter
    
    # Apply rate limiting: 3 requests per hour per email
    @limiter.limit("3/hour")
    async def _inner(req: Request):
        pass
    
    try:
        await _inner(http_request)
    except:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many password reset requests. Please try again later.",
        )

    # Get user by email
    user = db.query(User).filter(User.email == request.email).first()
    
    # Always return success to prevent email enumeration
    # But only send email if user exists
    if user:
        # Check for recent reset requests to prevent spam
        from app.models.user import PasswordResetToken
        from datetime import datetime, timedelta, timezone
        
        recent_token = (
            db.query(PasswordResetToken)
            .filter(
                PasswordResetToken.user_id == user.id,
                PasswordResetToken.created_at > datetime.now(timezone.utc) - timedelta(minutes=5)
            )
            .first()
        )
        
        if recent_token:
            # Don't create new token if one was created recently
            return MessageResponse(
                message="If the email exists, a password reset link has been sent.",
                success=True
            )
        
        # Create reset token
        reset_token = auth_service.create_password_reset_token(
            db=db,
            user=user,
            ip_address=get_client_info(http_request)[0],
            user_agent=get_client_info(http_request)[1]
        )
        
        # Send email in background
        from app.services.email_service import email_service
        
        background_tasks.add_task(
            email_service.send_password_reset_email,
            user_email=user.email,
            user_name=user.full_name,
            reset_token=reset_token,
            ip_address=get_client_info(http_request)[0]
        )
    
    return MessageResponse(
        message="If the email exists, a password reset link has been sent.",
        success=True
    )


@router.post("/password/reset-confirm", response_model=MessageResponse)
async def confirm_password_reset(
    request: PasswordResetConfirm,
    http_request: Request,
    db: Session = Depends(get_db),
):
    """
    Confirm password reset with token and set new password.
    Token must be valid and unused.
    """
    from app.models.user import PasswordResetToken
    
    # Verify token and get user
    user = auth_service.verify_password_reset_token(db, request.token)
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token"
        )
    
    # Set new password
    user.set_password(request.new_password)
    
    # Mark token as used
    token_entry = (
        db.query(PasswordResetToken)
        .filter(PasswordResetToken.token_hash == auth_service.hash_token(request.token))
        .first()
    )
    if token_entry:
        token_entry.mark_as_used()
    
    # Invalidate all existing sessions for security
    from app.models.user import UserSession
    
    db.query(UserSession).filter(
        UserSession.user_id == user.id,
        UserSession.is_active.is_(True)
    ).update({"is_active": False})
    
    db.commit()
    
    # Log password reset for audit
    logger.warning(
        f"Password reset completed for user {user.email} from IP {get_client_info(http_request)[0]}"
    )
    
    return MessageResponse(
        message="Password has been reset successfully. Please login with your new password.",
        success=True
    )


@router.post("/password/change", response_model=MessageResponse)
async def change_password(
    old_password: str = Body(...),
    new_password: str = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Change password for authenticated user.
    Requires current password verification.
    """
    # Verify old password
    if not current_user.verify_password(old_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Current password is incorrect"
        )
    
    # Validate new password strength
    if len(new_password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 8 characters"
        )
    
    # Set new password
    current_user.set_password(new_password)
    db.commit()
    
    return MessageResponse(
        message="Password changed successfully",
        success=True
    )


# Admin authentication dependency
async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """
    Dependency to require admin privileges.
    For now, treats the first user as admin. In production, add proper role system.
    """
    # Simple admin check - first user is admin (ID = 1)
    # In production, implement proper role-based access control
    if current_user.id != 1:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required"
        )
    return current_user
