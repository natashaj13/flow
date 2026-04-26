import os
import sys
import json
import asyncio
import shutil
import socket
from pathlib import Path
from datetime import datetime, timezone
from uuid import uuid4

if sys.version_info >= (3, 14):
    project_python = Path(__file__).resolve().with_name(".venv312") / "bin" / "python"
    fallback_python = str(project_python) if project_python.exists() else (shutil.which("python3.12") or "/opt/homebrew/bin/python3.12")
    if Path(fallback_python).exists():
        os.execv(fallback_python, [fallback_python, __file__, *sys.argv[1:]])

import httpx

from openai import OpenAI
from uagents import Context, Protocol, Agent, Model
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    TextContent,
    chat_protocol_spec,
)

def load_env_file(env_path: Path) -> None:
    if not env_path.exists():
        return

    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


load_env_file(Path(__file__).with_name(".env"))

# ── Config ────────────────────────────────────────────────────────────────────

api_key = os.getenv("ASI_API_KEY")
if not api_key:
    raise SystemExit("Set ASI_API_KEY in fetch/.env before running agent.py")

# Tag all team members register their agents with on Agentverse
TEAM_TAG = os.getenv("FLOW_TEAM_TAG", "flow-dev-team")

# Optional: Agentverse API key for dynamic discovery
AGENTVERSE_API_KEY = os.getenv("AGENTVERSE_API_KEY", "")

subject_matter = (
    "software development context — including interpreting git history, open files, "
    "browser research tabs, and active work areas — to write concise, actionable "
    "handoff notes that tell a teammate exactly what someone was working on and "
    "what they would need to pick it up"
)

HANDOFF_PREFIX = "[FLOW_HANDOFF]"

try:
    asyncio.get_event_loop()
except RuntimeError:
    asyncio.set_event_loop(asyncio.new_event_loop())

client = OpenAI(
    base_url='https://api.asi1.ai/v1',
    api_key=api_key,
)

agent = Agent(
    name="ASI-agent",
    seed="blahblahfo3r9742938423849234234%&JD@",
    port=8001,
    mailbox=True,
    publish_agent_details=True,
    network="testnet",
)
print(f"Your agent's address is: {agent.address}")

# ── REST models ───────────────────────────────────────────────────────────────

class BriefingRequest(Model):
    summary: str   # Gemini-generated briefing text
    snapshot: str  # raw capsule JSON as a string

class BriefingResponse(Model):
    status: str
    teammates_notified: int
    message: str

# ── Discovery helpers ─────────────────────────────────────────────────────────

def _load_team_json() -> list[str]:
    """Fallback: read teammate addresses from fetch/team.json."""
    team_file = Path(__file__).with_name("team.json")
    if not team_file.exists():
        return []
    try:
        raw = team_file.read_text()
        # Allow simple // comment lines in team.json to avoid silent failures.
        cleaned = "\n".join(line.split("//", 1)[0] for line in raw.splitlines())
        members = json.loads(cleaned)
        return [m["address"] for m in members if m.get("address") and m["address"].startswith("agent1q")]
    except Exception as exc:
        print(f"[ASI-agent] Failed to parse {team_file}: {exc}", file=sys.stderr)
        return []


def _normalize_addresses(addresses: list[str], own_address: str) -> list[str]:
    unique = []
    seen = set()
    for address in addresses:
        if not address or not address.startswith("agent1q"):
            continue
        if address == own_address or address in seen:
            continue
        seen.add(address)
        unique.append(address)
    return unique

async def _discover_via_agentverse(own_address: str) -> list[str]:
    """Search Agentverse for agents tagged with FLOW_TEAM_TAG."""
    if not AGENTVERSE_API_KEY:
        return []
    try:
        async with httpx.AsyncClient(timeout=10.0) as http:
            resp = await http.get(
                "https://agentverse.ai/v1/agents",
                params={"search": TEAM_TAG, "limit": 20},
                headers={"Authorization": f"Bearer {AGENTVERSE_API_KEY}"},
            )
            if resp.status_code == 200:
                data = resp.json()
                agents = data if isinstance(data, list) else data.get("agents", [])
                return [
                    a["address"] for a in agents
                    if a.get("address") and a["address"] != own_address
                ]
    except Exception:
        pass
    return []

# ── /brief REST endpoint — called by CLI after Gemini briefing ────────────────

@agent.on_rest_post("/brief", BriefingRequest, BriefingResponse)
async def handle_briefing(ctx: Context, req: BriefingRequest) -> BriefingResponse:
    ctx.logger.info("Received briefing from CLI — discovering teammates...")

    own_address = str(agent.address)

    # 1. Discover teammates: Agentverse first, team.json fallback
    addresses = await _discover_via_agentverse(own_address)
    if not addresses:
        addresses = _load_team_json()

    addresses = _normalize_addresses(addresses, own_address)
    ctx.logger.info(f"Addresses loaded: {addresses}")

    if not addresses:
        ctx.logger.warning("No addresses found in team.json and Agentverse discovery returned nothing.")
        return BriefingResponse(status="no_addresses", teammates_notified=0, message="no_addresses")

    # # 2. Ask ASI:One to format the briefing as a third-person handoff note
    # handoff = req.summary  # fallback if LLM call fails
    # try:
    #     r = client.chat.completions.create(
    #         model="asi1",
    #         messages=[
    #             {
    #                 "role": "system",
    #                 "content": (
    #                     "You translate a developer session briefing into a clear, "
    #                     "third-person handoff note for a teammate. "
    #                     "Write 2–3 sentences: what the developer was working on, "
    #                     "where they left off, and what context a teammate needs to "
    #                     "understand the current state. Name specific files, functions, "
    #                     "or features. Start with: 'Your teammate was...'"
    #                 ),
    #             },
    #             {"role": "user", "content": req.summary},
    #         ],
    #         max_tokens=256,
    #     )
    #     handoff = r.choices[0].message.content.strip()
    #     ctx.logger.info(f"Handoff note: {handoff[:80]}...")
    # except Exception:
    #     ctx.logger.exception("ASI:One formatting failed — sending raw briefing")

    # 2. Build a readable context message from the full snapshot
    parts = []

    try:
        snap = json.loads(req.snapshot)

        # Open files from VS Code
        open_files = (
            snap.get("vscode", {}).get("openFiles")
            or snap.get("vscode", {}).get("files")
            or []
        )
        if open_files:
            parts.append("Files open in VS Code:\n" + "\n".join(f"  {f}" for f in open_files))

        # Browser tabs
        raw_browser = snap.get("browser") or snap.get("chrome")
        tabs = raw_browser if isinstance(raw_browser, list) else (raw_browser or {}).get("urls", [])
        if tabs:
            parts.append("Chrome tabs:\n" + "\n".join(f"  {t}" for t in tabs))

        # Working directory
        cwd = snap.get("cwd") or snap.get("vscode", {}).get("projectRoot")
        if cwd:
            parts.append(f"Working directory: {cwd}")

    except Exception:
        ctx.logger.exception("Could not parse snapshot — falling back to summary only")

    # Always include the AI summary at the top
    message = f"--- Flow Handoff ---\n\n{req.summary}"
    if parts:
        message += "\n\n" + "\n\n".join(parts)

    # 3. Send to each confirmed address
    notified = 0
    send_errors = []
    for address in addresses:
        ctx.logger.info(f"Sending to: {address}")
        try:
            await ctx.send(
                address,
                ChatMessage(
                    timestamp=datetime.now(timezone.utc),
                    msg_id=uuid4(),
                    content=[
                        TextContent(type="text", text=message),
                        EndSessionContent(type="end-session"),
                    ],
                ),
            )
            notified += 1
            ctx.logger.info(f"Sent to {address}")
        except Exception as e:
            send_errors.append(str(e))
            ctx.logger.exception(f"Failed to send to {address}")

    if send_errors:
        ctx.logger.error(f"Send errors: {send_errors}")

    return BriefingResponse(
        status="ok" if notified > 0 else "send_failed",
        teammates_notified=notified,
        message="ok" if notified > 0 else f"send_failed: {'; '.join(send_errors)}",
    )

# ── Chat Protocol — handles messages from ASI:One / agentverse UI ─────────────

protocol = Protocol(spec=chat_protocol_spec)

@protocol.on_message(ChatMessage)
async def handle_message(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(
        sender,
        ChatAcknowledgement(timestamp=datetime.now(), acknowledged_msg_id=msg.msg_id),
    )

    # If the message signals end-of-session, don't reply — it's a one-way notification.
    if any(isinstance(item, EndSessionContent) for item in msg.content):
        ctx.logger.info(f"Received end-session message from {sender}; not replying.")
        return

    text = ''.join(item.text for item in msg.content if isinstance(item, TextContent))

    response = 'Something went wrong and I am unable to respond right now.'
    try:
        r = client.chat.completions.create(
            model="asi1",
            messages=[
                {
                    "role": "system",
                    "content": (
                        f"You are a helpful assistant specialised in {subject_matter}. "
                        "If the user asks about anything outside this domain, politely decline."
                    ),
                },
                {"role": "user", "content": text},
            ],
            max_tokens=2048,
        )
        response = r.choices[0].message.content.strip()
    except Exception:
        ctx.logger.exception('Error querying ASI:One')

    await ctx.send(sender, ChatMessage(
        timestamp=datetime.now(timezone.utc),
        msg_id=uuid4(),
        content=[
            TextContent(type="text", text=response),
            EndSessionContent(type="end-session"),
        ],
    ))

@protocol.on_message(ChatAcknowledgement)
async def handle_ack(_ctx: Context, _sender: str, _msg: ChatAcknowledgement):
    pass

agent.include(protocol, publish_manifest=True)


def _is_port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1", port)) == 0

if __name__ == "__main__":
    if _is_port_in_use(8001):
        raise SystemExit(
            "Port 8001 is already in use. Stop the existing agent first "
            "(e.g. `lsof -ti :8001 | xargs kill`) or run only one agent instance."
        )
    agent.run()
