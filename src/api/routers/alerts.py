"""Fast2SMS alert router for real-time emergency SMS dispatch."""

import os
import smtplib
from email.message import EmailMessage
import re
import urllib.request
import json
import time
from pathlib import Path
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr, Field
from dotenv import load_dotenv

load_dotenv()

router = APIRouter(prefix="/alerts", tags=["alerts"])


class SMSAlertRequest(BaseModel):
    numbers: List[str] = Field(..., description="List of 10-digit Indian phone numbers or with +91")
    message: Optional[str] = Field(None, description="Alert text message content. If omitted, a multilingual template will be generated based on the area.")
    area: Optional[str] = Field(None, description="Geographic area identifier (e.g., 'assam', 'westbengal') used to select language template.")
    api_key: Optional[str] = Field(None, description="Fast2SMS authorization API key")
    location: Optional[str] = Field(None, description="Human‑readable location description (e.g., 'Guwahati, Assam').")
    weather: Optional[str] = Field(None, description="Brief weather info (e.g., 'Heavy rain, 85 mm/hr').")

class EmailAlertRequest(BaseModel):
    emails: List[EmailStr] = Field(..., description="List of email addresses to send the alert to.")
    subject: Optional[str] = Field(None, description="Email subject line. If omitted, a default subject will be generated.")
    body: Optional[str] = Field(None, description="HTML body of the email. If omitted, a default template will be generated.")
    area: Optional[str] = Field(None, description="Geographic area identifier for multilingual subject/template.")


class SMSAlertResponse(BaseModel):
    success: bool
    message: str
    request_id: Optional[str] = None
    recipients_count: int
    raw_response: Optional[dict] = None


def clean_phone_numbers(numbers: List[str]) -> str:
    cleaned = []
    for n in numbers:
        # Strip whitespace, dashes, parentheses, and country code prefixes
        digits = re.sub(r"\D", "", n)
        if digits.startswith("91") and len(digits) == 12:
            digits = digits[2:]
        elif digits.startswith("0") and len(digits) == 11:
            digits = digits[1:]
        if len(digits) == 10:
            cleaned.append(digits)
    return ",".join(cleaned)


# ---- Phone book persistence helpers ----

# Email SMTP configuration (environment variables)
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "465"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
EMAIL_FROM = os.getenv("EMAIL_FROM", SMTP_USER)

def send_email_smtp(to_emails: List[str], subject: str, html_body: str) -> dict:
    """Send an email via SMTP.
    Returns a dict with 'success' (bool) and 'detail' (str)."""
    if not SMTP_USER or not SMTP_PASSWORD:
        return {"success": False, "detail": "SMTP credentials not configured in environment variables."}
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = EMAIL_FROM
    msg["To"] = ", ".join(to_emails)
    msg.set_content("This email requires an HTML-capable client.")
    msg.add_alternative(html_body, subtype="html")
    try:
        # Use SSL for the standard 465 port; for other ports (e.g., Elastic Email 2525) use STARTTLS.
        if SMTP_PORT == 465:
            server = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT)
        else:
            server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
            server.starttls()
        with server:
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(msg)
        return {"success": True, "detail": "Email sent successfully."}
    except Exception as e:
        return {"success": False, "detail": f"Failed to send email: {e}"}

PHONE_BOOK_PATH = Path(__file__).resolve().parents[3] / "data" / "phone_book.json"

def _ensure_phone_book_file():
    """Create the phone book file with an empty list if it does not exist."""
    if not PHONE_BOOK_PATH.parent.exists():
        PHONE_BOOK_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not PHONE_BOOK_PATH.is_file():
        PHONE_BOOK_PATH.write_text(json.dumps([]))

def load_phone_book() -> List[str]:
    """Load stored phone numbers from the JSON file."""
    _ensure_phone_book_file()
    try:
        data = json.loads(PHONE_BOOK_PATH.read_text())
        return data if isinstance(data, list) else []
    except Exception:
        return []

def save_phone_book(numbers: List[str]):
    """Save the list of phone numbers to the JSON file."""
    _ensure_phone_book_file()
    PHONE_BOOK_PATH.write_text(json.dumps(numbers, indent=2))

# Multilingual alert templates per area
MULTILINGUAL_TEMPLATES = {
    "assam": {
        "en": "Alert notification from BhuRakshak: Landslide alert for Assam. Please stay safe.",
        "as": "Alert notification from BhuRakshak: অসমত ভূমি সড়কসন। সুৰক্ষিত থাকক।",
    },
    "westbengal": {
        "en": "Alert notification from BhuRakshak: Landslide alert for West Bengal. Please stay safe.",
        "bn": "Alert notification from BhuRakshak: পশ্চিমবঙ্গে ভূমিধসের সতর্কতা। নিরাপদে থাকুন।",
    },
    "meghalaya": {
        "en": "Alert notification from BhuRakshak: Landslide alert for Meghalaya. Please stay safe.",
        "hi": "Alert notification from BhuRakshak: मेघालय में भूस्खलन चेतावनी। कृपया सुरक्षित रहें।"
    },
}

def generate_multilingual_message(area: Optional[str]) -> str:
    """Return an English + local language alert for the given area.
    If area is missing or unknown, falls back to a generic English message.
    """
    if not area:
        return "Landslide alert. Please stay safe."
    tpl = MULTILINGUAL_TEMPLATES.get(area.lower())
    if not tpl:
        return "Landslide alert. Please stay safe."
    en_msg = tpl.get("en", "")
    # pick first non‑English message if available
    local_msg = next((v for k, v in tpl.items() if k != "en"), "")
    return f"{en_msg} {local_msg}".strip()


class EmailAlertResponse(BaseModel):
    success: bool
    message: str
    recipients_count: int
    raw_response: Optional[dict] = None


@router.post("/email", response_model=EmailAlertResponse)
def send_email_alert(payload: EmailAlertRequest) -> EmailAlertResponse:
    """Send an email alert to a list of recipients."""
    if not payload.emails:
        raise HTTPException(status_code=400, detail="No email addresses provided.")
    cleaned = [e.strip() for e in payload.emails if e.strip()]
    if not cleaned:
        raise HTTPException(status_code=400, detail="No valid email addresses provided.")

    subject = payload.subject
    if not subject:
        subject = f"Landslide Alert - {payload.area.title()}" if payload.area else "Landslide Alert"

    body = payload.body
    if not body:
        msg = generate_multilingual_message(payload.area)
        body = f"<p>{msg}</p>"

    result = send_email_smtp(cleaned, subject, body)
    return EmailAlertResponse(
        success=result["success"],
        message=result["detail"],
        recipients_count=len(cleaned),
        raw_response=result
    )


@router.post("/sms", response_model=SMSAlertResponse)
def send_fast2sms_alert(payload: SMSAlertRequest) -> SMSAlertResponse:
    key = (payload.api_key or os.environ.get("FAST2SMS_API_KEY", "")).strip()
    demo_mode = False
    if not key:
        print("[WARN] No Fast2SMS API Key provided. Running SMS alert in DEMO mode.")
        demo_mode = True
    # If no numbers supplied, fall back to stored phone book
    if not payload.numbers:
        stored_numbers = load_phone_book()
        if not stored_numbers:
            raise HTTPException(status_code=400, detail="No phone numbers provided and phone book is empty.")
        payload.numbers = stored_numbers

    phone_str = clean_phone_numbers(payload.numbers)
    if not phone_str:
        raise HTTPException(
            status_code=400,
            detail="No valid 10-digit phone numbers found in recipients list."
        )

    # Generate message if not provided, based on area
    if not payload.message:
        # Use area to select a multilingual template
        generated_msg = generate_multilingual_message(payload.area)
        parts = [generated_msg]
        if payload.location:
            parts.append(f"Location: {payload.location}")
        if payload.weather:
            parts.append(f"Weather: {payload.weather}")
        payload.message = " | ".join(parts)
    if demo_mode:
        print(f"\n[DEMO SMS] To: {phone_str}\nMessage: {payload.message}\n")
        return SMSAlertResponse(
            success=True,
            message="[DEMO] SMS simulated successfully.",
            request_id=f"demo_{int(time.time())}",
            recipients_count=len(phone_str.split(",")),
            raw_response={"status": "mocked"}
        )

    # Fast2SMS bulkV2 Quick SMS payload
    fast2sms_url = "https://www.fast2sms.com/dev/bulkV2"
    post_data = json.dumps({
        "route": "q",
        "message": payload.message,
        "language": "english",
        "flash": 0,
        "numbers": phone_str
    }).encode("utf-8")

    req = urllib.request.Request(
        fast2sms_url,
        data=post_data,
        headers={
            "authorization": key,
            "Content-Type": "application/json",
            "User-Agent": "BhuRakshak-Disaster-Alert/1.0"
        }
    )

    try:
        with urllib.request.urlopen(req, timeout=12) as response:
            res_body = response.read().decode("utf-8")
            data = json.loads(res_body)

            is_return = data.get("return", False)
            request_id = data.get("request_id", "")
            msgs = data.get("message", ["SMS request submitted."])
            msg_str = " ".join(msgs) if isinstance(msgs, list) else str(msgs)

            return SMSAlertResponse(
                success=is_return,
                message=msg_str,
                request_id=request_id,
                recipients_count=len(phone_str.split(",")),
                raw_response=data
            )
    except urllib.error.HTTPError as err:
        err_body = err.read().decode("utf-8")
        try:
            err_data = json.loads(err_body)
            detail = err_data.get("message", err_body)
        except Exception:
            detail = err_body or str(err)
        raise HTTPException(status_code=err.code, detail=f"Fast2SMS API Error: {detail}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to communicate with Fast2SMS: {str(exc)}")
# ----- Phone Book API -----

class PhoneNumberAddRequest(BaseModel):
    number: str = Field(..., description="Phone number to add (10-digit Indian number, with or without +91)")

@router.get("/phonebook", response_model=List[str])
def get_phone_book() -> List[str]:
    """Return stored phone numbers."""
    return load_phone_book()

@router.post("/phonebook", response_model=List[str])
def add_phone_number(request: PhoneNumberAddRequest) -> List[str]:
    """Add a phone number to the persisted phone book.
    Duplicate numbers are ignored.
    """
    cleaned = clean_phone_numbers([request.number])
    if not cleaned:
        raise HTTPException(status_code=400, detail="Invalid phone number format.")
    new_number = cleaned.split(",")[0]
    phone_book = load_phone_book()
    if new_number not in phone_book:
        phone_book.append(new_number)
        save_phone_book(phone_book)
    return phone_book
