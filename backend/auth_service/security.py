import os
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from auth_service.users import get_user, public_profile

JWT_SECRET = os.environ.get("JWT_SECRET", "")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.environ.get("JWT_EXPIRE_MINUTES", "480"))

if not JWT_SECRET:
    raise RuntimeError(
        "JWT_SECRET is not set — copy auth-service/.env.example to .env and fill in a real secret."
    )

_bearer = HTTPBearer(auto_error=False)


def create_access_token(email: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": email, "iat": now, "exp": now + timedelta(minutes=JWT_EXPIRE_MINUTES)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    """Decode the bearer token and return the matching user record — the dependency
    every protected route (in this service or a gateway in front of the Node server)
    should use, so an expired/forged/missing token never reaches business logic."""
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = get_user(payload.get("sub", ""))
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User no longer exists")
    return user


def require_role(*allowed_roles: str):
    """Route dependency that 403s unless the caller's role is one of allowed_roles —
    e.g. Depends(require_role('admin')) on an admin-only endpoint."""
    def _check(user: dict = Depends(current_user)) -> dict:
        if user["role_code"] not in allowed_roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role can't access this")
        return user
    return _check


def require_screen(screen_path: str, need_manage: bool = False):
    """Route dependency that 403s unless the caller's role has view (or manage)
    access to screen_path — the same per-screen permission the frontend sidebar
    already hides/shows, now enforced server-side so it can't be bypassed by
    calling the API directly."""
    def _check(user: dict = Depends(current_user)) -> dict:
        perm = public_profile(user)["access"].get(screen_path, {"view": False, "manage": False})
        if not perm["view"] or (need_manage and not perm["manage"]):
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"No access to {screen_path}")
        return user
    return _check
