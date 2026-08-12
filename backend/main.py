"""Small standalone backend for RCPL — authentication (login + JWTs, with a
server-side permission check per screen so a role can't see data it isn't
scoped to just because it knows the URL) plus the frontend's whole persisted
app-state ("session") storage, so all server-side memory for the app lives in
this one service instead of being split across it and the Node intake server.

Run locally:
    cd backend
    python -m venv .venv && .venv\\Scripts\\activate   (or `source .venv/bin/activate` on macOS/Linux)
    pip install -r requirements.txt
    copy .env.example .env   (then fill in a real JWT_SECRET)
    uvicorn main:app --reload --port 8788

Deploy: run behind a process manager, e.g.
    uvicorn main:app --host 0.0.0.0 --port 8788 --workers 2
and put it behind the same reverse proxy (nginx/etc.) as the rest of the app,
routed at e.g. /auth/* and /session. Never expose JWT_SECRET to the frontend.
Note: session_store.py writes a plain local JSON file with no file locking —
fine for --workers 1, but concurrent workers can race on writes. Keep this
service single-worker unless/until session storage moves to a real database.
"""
import os

from dotenv import load_dotenv

load_dotenv()

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware

import session_store
from email_service.intake_routes import router as intake_router
from email_service.intake_routes import start_background_poller
from auth_service.schemas import LoginRequest, MeResponse, TokenResponse
from auth_service.security import create_access_token, current_user, require_screen
from auth_service.users import ALL_SCREENS, get_user, public_profile, verify_password

app = FastAPI(title="RCPL Auth Service", version="1.0.0")

_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Email intake (ported from the old Node server/ — see intake_routes.py): /api/health,
# /api/extract, /api/intake, /api/inbox/status, /api/mail/reply, plus a background IMAP poller.
app.include_router(intake_router)


@app.on_event("startup")
def _start_intake_poller() -> None:
    start_background_poller()


@app.get("/health")
def health():
    return {"ok": True}


# Frontend app-state persistence (moved here from the Node server so all "memory" — auth and
# session storage — lives in one backend). Kept as a raw JSON passthrough, same contract as the
# Node version it replaces: GET 404s if nothing's been saved yet, POST accepts any JSON body,
# DELETE always succeeds even if there was nothing to clear.
@app.get("/session")
def get_session():
    raw = session_store.read()
    if raw is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return Response(content=raw, media_type="application/json")


@app.post("/session", status_code=status.HTTP_204_NO_CONTENT)
async def post_session(request: Request):
    body = await request.body()
    session_store.write(body.decode("utf-8"))


@app.delete("/session", status_code=status.HTTP_204_NO_CONTENT)
def delete_session():
    session_store.clear()


@app.post("/auth/login", response_model=TokenResponse)
def login(body: LoginRequest):
    user = get_user(body.email)
    # Same error for "no such user" and "wrong password" — don't let a caller
    # enumerate which emails exist in the system.
    if user is None or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    token = create_access_token(user["email"])
    return TokenResponse(access_token=token, user=public_profile(user))


@app.get("/auth/me", response_model=MeResponse)
def me(user: dict = Depends(current_user)):
    return MeResponse(user=public_profile(user))


@app.get("/auth/can/{screen_path:path}")
def can_access(screen_path: str, user: dict = Depends(current_user)):
    """Ask "can this logged-in user view/manage this screen?" — call this (or the
    require_screen dependency directly, if this service also fronts the data
    routes) before returning any screen's data, so access can't be bypassed by
    hitting the API directly instead of clicking through the sidebar."""
    path = f"/{screen_path}" if not screen_path.startswith("/") else screen_path
    if path not in ALL_SCREENS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown screen")
    perm = public_profile(user)["access"].get(path, {"view": False, "manage": False})
    return perm


# Example of protecting an admin-only route with the reusable dependency — mirrors
# how the Node intake server (or a gateway) should guard its own endpoints, e.g.
# Depends(require_screen('/settings', need_manage=True)) on user-management routes.
@app.get("/admin/ping")
def admin_ping(_user: dict = Depends(require_screen("/settings"))):
    return {"ok": True}
