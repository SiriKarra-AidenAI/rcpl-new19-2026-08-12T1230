"""Seed users and role -> screen access, mirroring src/mock/roles.ts and
src/components/shell/nav.ts. Keep the screen paths and MODULES_BY_ROLE lists in
sync with nav.ts by hand — this service and the frontend must agree on them.

This is an in-memory user store for a small deployment. Swap `USERS` for a real
table (with its own hashed-password column) if the user base grows past a
hand-maintained list.
"""
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ROLES = ["ase_asm", "asm", "rbl", "finance", "channel_dev", "mdm", "it", "leadership", "admin"]

# Screen paths, mirroring nav.ts NAV.
ALL_SCREENS = [
    "/dashboard", "/scouting", "/intake-inbox", "/document-authenticity", "/leads", "/new-application",
    "/approvals", "/onboarding", "/documents", "/communication", "/grievances",
    "/analytics", "/gtm-coverage", "/reports",
    "/partners", "/team", "/templates", "/settings", "/audit-log", "/my-settings",
]

# Which screens each role can see at all — mirrors MODULES_BY_ROLE in nav.ts. `/team` (Team &
# Assignment) is a SUPERVISOR-only surface: only the RBL and the platform admin can see it.
# The Workbasket lives inside `/leads` (a tab), so it has no screen path of its own.
MODULES_BY_ROLE = {
    "ase_asm": ["/dashboard", "/scouting", "/intake-inbox", "/document-authenticity", "/leads", "/approvals", "/communication", "/analytics", "/gtm-coverage", "/partners", "/audit-log", "/my-settings"],
    "asm": ["/dashboard", "/scouting", "/intake-inbox", "/document-authenticity", "/leads", "/new-application", "/approvals", "/onboarding", "/communication", "/analytics", "/gtm-coverage", "/partners", "/audit-log", "/my-settings"],
    # RBL = regional supervisor: owns Team & Assignment, hands out unpicked workbasket DBs from Leads.
    "rbl": ["/dashboard", "/leads", "/approvals", "/communication", "/analytics", "/gtm-coverage", "/partners", "/team", "/audit-log"],
    "finance": ["/dashboard", "/approvals", "/documents", "/communication", "/analytics", "/audit-log"],
    "channel_dev": ["/dashboard", "/scouting", "/intake-inbox", "/document-authenticity", "/leads", "/approvals", "/onboarding", "/documents", "/communication", "/grievances", "/analytics", "/gtm-coverage", "/partners", "/audit-log"],
    "mdm": ["/dashboard", "/approvals", "/documents", "/communication", "/partners", "/analytics", "/audit-log"],
    # IT creates the DB Code once a DB clears approval (Approvals' Onboarding tab) — mirrors nav.ts.
    "it": ["/dashboard", "/approvals", "/partners", "/audit-log"],
    "leadership": ["/dashboard", "/approvals", "/analytics", "/gtm-coverage", "/reports", "/partners", "/audit-log"],
    "admin": ["/dashboard", "/scouting", "/intake-inbox", "/document-authenticity", "/leads", "/new-application", "/approvals", "/onboarding", "/documents", "/communication", "/analytics", "/gtm-coverage", "/reports", "/partners", "/team", "/templates", "/settings", "/audit-log", "/my-settings"],
}

# Baseline "can act on it, not just view it" default per role — mirrors CAN_MANAGE_BY_ROLE.
CAN_MANAGE_BY_ROLE = {
    "ase_asm": False,
    "asm": True,
    "rbl": True,
    "finance": True,
    "channel_dev": True,
    "mdm": True,
    "it": True,
    "leadership": False,
    "admin": True,
}


def access_for_role(role: str) -> dict:
    allowed = set(MODULES_BY_ROLE.get(role, []))
    can_manage = CAN_MANAGE_BY_ROLE.get(role, False)
    return {
        path: {"view": path in allowed, "manage": path in allowed and can_manage}
        for path in ALL_SCREENS
    }


# Demo accounts, mirroring src/mock/roles.ts DEMO_USERS. Every account shares the
# same demo password below — rotate it (and give each user their own) before any
# real deployment. This is the login screen's server-side counterpart: instead of
# a no-password persona picker, real credentials now gate which role you get.
_DEMO_PASSWORD_HASH = pwd_context.hash("Rcpl@2026")

USERS = {
    "r.malhotra@rcpl.in": {
        "id": "u1", "name": "R. Malhotra", "email": "r.malhotra@rcpl.in",
        "role_code": "ase_asm", "region": "West", "state": "Maharashtra",
        "password_hash": _DEMO_PASSWORD_HASH,
    },
    "s.iyer@rcpl.in": {
        "id": "u2", "name": "S. Iyer", "email": "s.iyer@rcpl.in",
        "role_code": "finance", "region": "HQ", "state": None,
        "password_hash": _DEMO_PASSWORD_HASH,
    },
    "a.deshpande@rcpl.in": {
        "id": "u3", "name": "A. Deshpande", "email": "a.deshpande@rcpl.in",
        "role_code": "channel_dev", "region": "West", "state": "Gujarat",
        "password_hash": _DEMO_PASSWORD_HASH,
    },
    "p.nair@rcpl.in": {
        "id": "u4", "name": "P. Nair", "email": "p.nair@rcpl.in",
        "role_code": "mdm", "region": "HQ", "state": None,
        "password_hash": _DEMO_PASSWORD_HASH,
    },
    "k.subramaniam@rcpl.in": {
        "id": "u7", "name": "K. Subramaniam", "email": "k.subramaniam@rcpl.in",
        "role_code": "it", "region": "HQ", "state": None,
        "password_hash": _DEMO_PASSWORD_HASH,
    },
    "atishay.jain@rcpl.in": {
        "id": "u5", "name": "Atishay Jain", "email": "atishay.jain@rcpl.in",
        "role_code": "leadership", "region": "HQ", "state": None,
        "password_hash": _DEMO_PASSWORD_HASH,
    },
    "admin@rcpl.in": {
        "id": "u6", "name": "Platform Admin", "email": "admin@rcpl.in",
        "role_code": "admin", "region": "HQ", "state": None,
        "password_hash": _DEMO_PASSWORD_HASH,
    },
}

# Extra roster members — mirrors the frontend people roster in src/mock/team.ts (TEAM), so that
# anyone who can be ASSIGNED a case is also a real login account (same shared demo password).
# Inactive members (e.g. V. Rao, u2b) are intentionally omitted so a deactivated account can't
# sign in. Keep this list in sync with team.ts.
_EXTRA_ROSTER = [
    # id,        name,           email,                 role_code,     region,  state
    ("u-ase-2",  "K. Bhosale",   "k.bhosale@rcpl.in",   "ase_asm",     "West",  "Maharashtra"),
    ("u-ase-3",  "A. Joshi",     "a.joshi@rcpl.in",     "ase_asm",     "West",  "Maharashtra"),
    ("u-ase-4",  "N. Rao",       "n.rao@rcpl.in",       "ase_asm",     "South", "Karnataka"),
    ("u-asm-w",  "D. Kulkarni",  "d.kulkarni@rcpl.in",  "asm",         "West",  "Maharashtra"),
    ("u-asm-w2", "S. Patil",     "s.patil@rcpl.in",     "asm",         "West",  "Maharashtra"),
    ("u-asm-s",  "M. Reddy",     "m.reddy@rcpl.in",     "asm",         "South", "Karnataka"),
    ("u-sm-w",   "V. Menon",     "v.menon@rcpl.in",     "asm",         "West",  None),
    ("u-rbl",    "R. Krishnan",  "r.krishnan@rcpl.in",  "rbl",         "West",  None),
    ("u-fin-2",  "A. Banerjee",  "a.banerjee@rcpl.in",  "finance",     "HQ",    None),
    ("u-chan-2", "P. Gupta",     "p.gupta@rcpl.in",     "channel_dev", "HQ",    None),
    ("u4b",      "T. Sen",       "t.sen@rcpl.in",       "mdm",         "East",  None),
]
for _id, _name, _email, _role, _region, _state in _EXTRA_ROSTER:
    USERS[_email] = {
        "id": _id, "name": _name, "email": _email,
        "role_code": _role, "region": _region, "state": _state,
        "password_hash": _DEMO_PASSWORD_HASH,
    }


def get_user(email: str) -> dict | None:
    return USERS.get(email.strip().lower())


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def public_profile(user: dict) -> dict:
    """Fields safe to hand back to the client — never the password hash."""
    return {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "roleCode": user["role_code"],
        "region": user["region"],
        "state": user["state"],
        "access": access_for_role(user["role_code"]),
    }
