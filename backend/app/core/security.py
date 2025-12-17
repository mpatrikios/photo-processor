from datetime import datetime, timedelta
from typing import Optional, Any, Union
from jose import jwt, JWTError
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
import os

# Configuration
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "temporary_secret_key_please_change")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Check if a password matches the hash."""
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    """Hash a password for storage."""
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Generate a JWT token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

# --- Dependencies ---

async def get_current_user(token: str = Depends(oauth2_scheme)):
    """Decodes the token to get the user."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
        
    # Get the actual user from database using the user ID from token
    from database import SessionLocal
    from app.models.user import User
    
    db = SessionLocal()
    try:
        # username is actually the user ID in your JWT tokens
        user_db = db.query(User).filter(User.id == int(username)).first()
        if not user_db:
            raise credentials_exception
            
        # Return user data in dict format for compatibility
        user = {
            "username": str(user_db.id), 
            "email": user_db.email,
            "is_active": user_db.is_active
        }
        return user
    except ValueError:
        # If username is not a valid integer
        raise credentials_exception
    finally:
        db.close()

async def get_current_active_user(current_user = Depends(get_current_user)):
    """Verifies the user is active. This fixes your ImportError."""
    if isinstance(current_user, dict):
        if not current_user.get("is_active", True):
             raise HTTPException(status_code=400, detail="Inactive user")
    elif hasattr(current_user, "is_active") and not current_user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
        
    return current_user