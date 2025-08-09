from datetime import datetime, timedelta
from typing import Optional, Union
import os
from jose import JWTError, jwt
from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from app.models.user import User, UserSession
from app.models.usage import UsageLog, ActionType, UserQuota
import secrets
import hashlib

class AuthService:
    """
    Service for handling authentication, JWT tokens, and user management.
    """
    
    def __init__(self):
        # JWT Configuration
        self.SECRET_KEY = os.getenv("JWT_SECRET_KEY", self._generate_secret_key())
        self.ALGORITHM = "HS256"
        self.ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days
        
        # Ensure we have a secret key
        if not os.getenv("JWT_SECRET_KEY"):
            print(f"⚠️  Warning: Using generated JWT secret key. Set JWT_SECRET_KEY environment variable for production.")
    
    def _generate_secret_key(self) -> str:
        """
        Generate a secure secret key for JWT tokens.
        """
        return secrets.token_urlsafe(32)

    def create_access_token(self, user_id: int, expires_delta: Optional[timedelta] = None) -> str:
        """
        Create a JWT access token for a user.
        """
        if expires_delta:
            expire = datetime.utcnow() + expires_delta
        else:
            expire = datetime.utcnow() + timedelta(minutes=self.ACCESS_TOKEN_EXPIRE_MINUTES)
        
        to_encode = {
            "sub": str(user_id),  # Subject (user ID)
            "exp": expire,        # Expiration time
            "iat": datetime.utcnow(),  # Issued at time
            "type": "access"      # Token type
        }
        
        encoded_jwt = jwt.encode(to_encode, self.SECRET_KEY, algorithm=self.ALGORITHM)
        return encoded_jwt

    def verify_token(self, token: str) -> Optional[dict]:
        """
        Verify and decode a JWT token.
        Returns the payload if valid, None if invalid.
        """
        try:
            payload = jwt.decode(token, self.SECRET_KEY, algorithms=[self.ALGORITHM])
            user_id: str = payload.get("sub")
            if user_id is None:
                return None
            return {"user_id": int(user_id), "payload": payload}
        except JWTError:
            return None

    def hash_token(self, token: str) -> str:
        """
        Create a hash of the token for secure storage.
        """
        return hashlib.sha256(token.encode()).hexdigest()

    def create_user(self, db: Session, email: str, password: str, full_name: str) -> User:
        """
        Create a new user account.
        """
        # Check if user already exists
        existing_user = db.query(User).filter(User.email == email.lower()).first()
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email address is already registered"
            )
        
        # Create new user
        user = User(
            email=email.lower().strip(),
            full_name=full_name.strip()
        )
        user.set_password(password)
        
        db.add(user)
        db.commit()
        db.refresh(user)
        
        # Create user quota
        current_month = datetime.utcnow().strftime("%Y-%m")
        quota = UserQuota(
            user_id=user.id,
            current_month=current_month
        )
        db.add(quota)
        
        # Log registration
        usage_log = UsageLog(
            user_id=user.id,
            action_type=ActionType.REGISTER,
            success=True
        )
        db.add(usage_log)
        
        db.commit()
        
        return user

    def authenticate_user(self, db: Session, email: str, password: str) -> Optional[User]:
        """
        Authenticate a user with email and password.
        Returns the user if authentication successful, None otherwise.
        """
        user = db.query(User).filter(User.email == email.lower()).first()
        if not user or not user.is_active:
            return None
        
        if not user.verify_password(password):
            return None
        
        return user

    def create_user_session(
        self, 
        db: Session, 
        user: User, 
        token: str,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None
    ) -> UserSession:
        """
        Create a new user session in the database.
        """
        # Update user's last login time
        user.update_login_time()
        
        # Create session record
        session = UserSession(
            user_id=user.id,
            token_hash=self.hash_token(token),
            expires_at=datetime.utcnow() + timedelta(minutes=self.ACCESS_TOKEN_EXPIRE_MINUTES),
            ip_address=ip_address,
            user_agent=user_agent
        )
        
        db.add(session)
        
        # Log login
        usage_log = UsageLog(
            user_id=user.id,
            action_type=ActionType.LOGIN,
            ip_address=ip_address,
            user_agent=user_agent,
            success=True
        )
        db.add(usage_log)
        
        db.commit()
        db.refresh(session)
        
        return session

    def get_user_from_token(self, db: Session, token: str) -> Optional[User]:
        """
        Get user from a valid JWT token.
        """
        token_data = self.verify_token(token)
        if not token_data:
            return None
        
        user_id = token_data["user_id"]
        user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
        
        if not user:
            return None
        
        # Check if session exists and is active
        token_hash = self.hash_token(token)
        session = db.query(UserSession).filter(
            UserSession.token_hash == token_hash,
            UserSession.is_active == True
        ).first()
        
        if not session or session.is_expired():
            return None
        
        # Update session last used time
        session.update_last_used()
        db.commit()
        
        return user

    def logout_user(self, db: Session, token: str, user: User) -> bool:
        """
        Logout a user by deactivating their session.
        """
        token_hash = self.hash_token(token)
        session = db.query(UserSession).filter(
            UserSession.token_hash == token_hash,
            UserSession.user_id == user.id
        ).first()
        
        if session:
            session.deactivate()
            
            # Log logout
            usage_log = UsageLog(
                user_id=user.id,
                action_type=ActionType.LOGOUT,
                success=True
            )
            db.add(usage_log)
            
            db.commit()
            return True
        
        return False

    def logout_all_sessions(self, db: Session, user: User) -> int:
        """
        Logout user from all sessions.
        Returns the number of sessions deactivated.
        """
        sessions = db.query(UserSession).filter(
            UserSession.user_id == user.id,
            UserSession.is_active == True
        ).all()
        
        count = 0
        for session in sessions:
            session.deactivate()
            count += 1
        
        if count > 0:
            usage_log = UsageLog(
                user_id=user.id,
                action_type=ActionType.LOGOUT,
                details=f"Logged out from {count} sessions",
                success=True
            )
            db.add(usage_log)
            db.commit()
        
        return count

    def cleanup_expired_sessions(self, db: Session) -> int:
        """
        Clean up expired sessions from the database.
        Returns the number of sessions cleaned up.
        """
        expired_sessions = db.query(UserSession).filter(
            UserSession.expires_at < datetime.utcnow()
        ).all()
        
        count = len(expired_sessions)
        
        for session in expired_sessions:
            session.deactivate()
        
        if count > 0:
            db.commit()
        
        return count

    def get_user_sessions(self, db: Session, user: User, active_only: bool = True) -> list[UserSession]:
        """
        Get all sessions for a user.
        """
        query = db.query(UserSession).filter(UserSession.user_id == user.id)
        
        if active_only:
            query = query.filter(UserSession.is_active == True)
        
        return query.order_by(UserSession.created_at.desc()).all()

    def change_password(self, db: Session, user: User, old_password: str, new_password: str) -> bool:
        """
        Change a user's password.
        """
        if not user.verify_password(old_password):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current password is incorrect"
            )
        
        # Set new password
        user.set_password(new_password)
        
        # Logout from all other sessions for security
        self.logout_all_sessions(db, user)
        
        db.commit()
        return True

    def validate_password_strength(self, password: str) -> tuple[bool, str]:
        """
        Validate password strength.
        Returns (is_valid, error_message).
        """
        if len(password) < 8:
            return False, "Password must be at least 8 characters long"
        
        if not any(c.isupper() for c in password):
            return False, "Password must contain at least one uppercase letter"
        
        if not any(c.islower() for c in password):
            return False, "Password must contain at least one lowercase letter"
        
        if not any(c.isdigit() for c in password):
            return False, "Password must contain at least one number"
        
        return True, ""

# Global instance
auth_service = AuthService()