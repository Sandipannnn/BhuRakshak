"""BhuRakshak SMS and Email alert router."""

import json
import os
import re
import smtplib
import time
import urllib.error
import urllib.request
from email.message import EmailMessage
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr, Field


load_dotenv()


router = APIRouter(
    prefix="/alerts",
    tags=["alerts"]
)


# ============================================================
# REQUEST MODELS
# ============================================================

class SMSAlertRequest(BaseModel):
    numbers: List[str] = Field(
        ...,
        description="List of Indian mobile numbers."
    )

    message: Optional[str] = Field(
        None,
        description="SMS message text."
    )

    area: Optional[str] = Field(
        None,
        description="Geographic area."
    )

    location: Optional[str] = Field(
        None,
        description="Human-readable location."
    )

    weather: Optional[str] = Field(
        None,
        description="Brief weather information."
    )


class EmailAlertRequest(BaseModel):
    emails: List[EmailStr] = Field(
        ...,
        description="Email recipients."
    )

    subject: Optional[str] = Field(
        None,
        description="Email subject."
    )

    body: Optional[str] = Field(
        None,
        description="HTML email body."
    )

    area: Optional[str] = Field(
        None,
        description="Geographic area."
    )


class SMSAlertResponse(BaseModel):
    success: bool
    message: str
    request_id: Optional[str] = None
    recipients_count: int
    raw_response: Optional[dict] = None


class EmailAlertResponse(BaseModel):
    success: bool
    message: str
    recipients_count: int
    raw_response: Optional[dict] = None


# ============================================================
# PHONE NUMBER HELPERS
# ============================================================

def clean_phone_numbers(numbers: List[str]) -> str:
    """
    Convert Indian phone numbers to comma-separated
    10-digit numbers accepted by Fast2SMS.
    """

    cleaned = []

    for number in numbers:

        if not number:
            continue

        digits = re.sub(
            r"\D",
            "",
            str(number)
        )

        # +91XXXXXXXXXX / 91XXXXXXXXXX
        if (
            digits.startswith("91")
            and len(digits) == 12
        ):
            digits = digits[2:]

        # 0XXXXXXXXXX
        elif (
            digits.startswith("0")
            and len(digits) == 11
        ):
            digits = digits[1:]

        # Valid Indian mobile number
        if (
            len(digits) == 10
            and digits[0] in "6789"
        ):
            cleaned.append(digits)

    # Remove duplicates while preserving order
    cleaned = list(
        dict.fromkeys(cleaned)
    )

    return ",".join(cleaned)


# ============================================================
# EMAIL CONFIGURATION
# ============================================================

SMTP_HOST = os.getenv(
    "SMTP_HOST",
    "smtp.gmail.com"
)

try:
    SMTP_PORT = int(
        os.getenv(
            "SMTP_PORT",
            "465"
        )
    )
except ValueError:
    SMTP_PORT = 465


SMTP_USER = os.getenv(
    "SMTP_USER",
    ""
)

SMTP_PASSWORD = os.getenv(
    "SMTP_PASSWORD",
    ""
)

EMAIL_FROM = os.getenv(
    "EMAIL_FROM",
    SMTP_USER
)


def send_email_smtp(
    to_emails: List[str],
    subject: str,
    html_body: str
) -> dict:

    if not SMTP_USER or not SMTP_PASSWORD:
        return {
            "success": False,
            "detail":
                "SMTP credentials are not configured."
        }

    msg = EmailMessage()

    msg["Subject"] = subject
    msg["From"] = EMAIL_FROM
    msg["To"] = ", ".join(to_emails)

    msg.set_content(
        "This email requires an HTML-capable client."
    )

    msg.add_alternative(
        html_body,
        subtype="html"
    )

    try:

        if SMTP_PORT == 465:

            server = smtplib.SMTP_SSL(
                SMTP_HOST,
                SMTP_PORT,
                timeout=15
            )

        else:

            server = smtplib.SMTP(
                SMTP_HOST,
                SMTP_PORT,
                timeout=15
            )

            server.starttls()

        with server:

            server.login(
                SMTP_USER,
                SMTP_PASSWORD
            )

            server.send_message(msg)

        return {
            "success": True,
            "detail":
                "Email sent successfully."
        }

    except Exception as exc:

        return {
            "success": False,
            "detail":
                f"Failed to send email: {exc}"
        }


# ============================================================
# PHONE BOOK
# ============================================================

PHONE_BOOK_PATH = (
    Path(__file__).resolve().parents[3]
    / "data"
    / "phone_book.json"
)


def _ensure_phone_book_file():

    if not PHONE_BOOK_PATH.parent.exists():

        PHONE_BOOK_PATH.parent.mkdir(
            parents=True,
            exist_ok=True
        )

    if not PHONE_BOOK_PATH.is_file():

        PHONE_BOOK_PATH.write_text(
            json.dumps([]),
            encoding="utf-8"
        )


def load_phone_book() -> List[str]:

    _ensure_phone_book_file()

    try:

        data = json.loads(
            PHONE_BOOK_PATH.read_text(
                encoding="utf-8"
            )
        )

        if isinstance(data, list):
            return data

    except Exception:
        pass

    return []


def save_phone_book(
    numbers: List[str]
):

    _ensure_phone_book_file()

    PHONE_BOOK_PATH.write_text(
        json.dumps(
            numbers,
            indent=2
        ),
        encoding="utf-8"
    )


# ============================================================
# MULTILINGUAL TEMPLATES
# ============================================================

MULTILINGUAL_TEMPLATES = {

    "assam": {

        "en":
            "Alert notification from BhuRakshak: "
            "Landslide alert for Assam. "
            "Please stay safe.",

        "as":
            "অসমত ভূমিস্খলনৰ সতৰ্কতা। "
            "সুৰক্ষিত থাকক."
    },

    "westbengal": {

        "en":
            "Alert notification from BhuRakshak: "
            "Landslide alert for West Bengal. "
            "Please stay safe.",

        "bn":
            "পশ্চিমবঙ্গে ভূমিধসের সতর্কতা। "
            "নিরাপদে থাকুন."
    },

    "meghalaya": {

        "en":
            "Alert notification from BhuRakshak: "
            "Landslide alert for Meghalaya. "
            "Please stay safe.",

        "hi":
            "मेघालय में भूस्खलन चेतावनी। "
            "कृपया सुरक्षित रहें."
    }
}


def generate_multilingual_message(
    area: Optional[str]
) -> str:

    if not area:

        return (
            "BhuRakshak landslide alert. "
            "Please stay safe."
        )

    tpl = MULTILINGUAL_TEMPLATES.get(
        area.lower()
    )

    if not tpl:

        return (
            "BhuRakshak landslide alert. "
            "Please stay safe."
        )

    en_msg = tpl.get(
        "en",
        ""
    )

    local_msg = next(
        (
            value
            for key, value in tpl.items()
            if key != "en"
        ),
        ""
    )

    return (
        f"{en_msg} {local_msg}"
    ).strip()


# ============================================================
# EMAIL ALERT
# ============================================================

@router.post(
    "/email",
    response_model=EmailAlertResponse
)
def send_email_alert(
    payload: EmailAlertRequest
) -> EmailAlertResponse:

    if not payload.emails:

        raise HTTPException(
            status_code=400,
            detail="No email addresses provided."
        )

    cleaned = [
        str(email).strip()
        for email in payload.emails
        if str(email).strip()
    ]

    if not cleaned:

        raise HTTPException(
            status_code=400,
            detail="No valid email addresses provided."
        )

    subject = payload.subject

    if not subject:

        subject = (
            f"Landslide Alert - "
            f"{payload.area.title()}"
            if payload.area
            else "Landslide Alert"
        )

    body = payload.body

    if not body:

        msg = generate_multilingual_message(
            payload.area
        )

        body = f"<p>{msg}</p>"

    result = send_email_smtp(
        cleaned,
        subject,
        body
    )

    return EmailAlertResponse(

        success=result["success"],

        message=result["detail"],

        recipients_count=len(cleaned),

        raw_response=result
    )


# ============================================================
# FAST2SMS ALERT
# ============================================================

@router.post(
    "/sms",
    response_model=SMSAlertResponse
)
def send_fast2sms_alert(
    payload: SMSAlertRequest
) -> SMSAlertResponse:

    """
    Send an SMS through Fast2SMS.

    IMPORTANT:
    The API key is read ONLY from the backend environment:

        FAST2SMS_API_KEY

    It is never accepted from the browser.
    """

    # --------------------------------------------------------
    # 1. Read Fast2SMS API key from backend environment
    # --------------------------------------------------------

    api_key = os.getenv(
        "qRehVmownjt02T3vMuKEWUH5l4Os6D7ci1AkzP8NCxYFBbQyfIpnZryDboJGmL9Vf40XkPHR1eO8dvW3",
        ""
    ).strip()

    if not api_key:

        raise HTTPException(
            status_code=503,
            detail=(
                "Fast2SMS is not configured on the backend. "
                "Set FAST2SMS_API_KEY in the backend environment."
            )
        )

    # --------------------------------------------------------
    # 2. Get recipients
    # --------------------------------------------------------

    numbers = payload.numbers or []

    # If frontend sends an empty list,
    # use the saved phone book.
    if not numbers:

        numbers = load_phone_book()

    if not numbers:

        raise HTTPException(
            status_code=400,
            detail=(
                "No phone numbers were provided "
                "and the phone book is empty."
            )
        )

    # --------------------------------------------------------
    # 3. Clean and validate numbers
    # --------------------------------------------------------

    phone_str = clean_phone_numbers(
        numbers
    )

    if not phone_str:

        raise HTTPException(
            status_code=400,
            detail=(
                "No valid Indian 10-digit "
                "mobile numbers were found."
            )
        )

    recipient_count = len(
        phone_str.split(",")
    )

    # --------------------------------------------------------
    # 4. Build SMS message
    # --------------------------------------------------------

    message = (
        payload.message or ""
    ).strip()

    if not message:

        parts = [
            generate_multilingual_message(
                payload.area
            )
        ]

        if payload.location:

            parts.append(
                f"Location: {payload.location}"
            )

        if payload.weather:

            parts.append(
                f"Weather: {payload.weather}"
            )

        message = " | ".join(parts)

    if not message:

        raise HTTPException(
            status_code=400,
            detail="SMS message cannot be empty."
        )

    # --------------------------------------------------------
    # 5. Fast2SMS API
    # --------------------------------------------------------

    fast2sms_url = (
        "https://www.fast2sms.com/dev/bulkV2"
    )

    post_body = {

        "route": "q",

        "message": message,

        "numbers": phone_str,

        "sms_details": "1"
    }

    post_data = json.dumps(
        post_body,
        ensure_ascii=False
    ).encode("utf-8")

    request = urllib.request.Request(

        fast2sms_url,

        data=post_data,

        method="POST",

        headers={

            "Authorization": api_key,

            "Content-Type":
                "application/json",

            "Accept":
                "application/json",

            "User-Agent":
                "BhuRakshak-Disaster-Alert/1.0"
        }
    )

    # --------------------------------------------------------
    # 6. Send request
    # --------------------------------------------------------

    try:

        with urllib.request.urlopen(
            request,
            timeout=20
        ) as response:

            status_code = response.status

            response_body = (
                response
                .read()
                .decode(
                    "utf-8",
                    errors="replace"
                )
            )

        # Try to parse JSON
        try:

            data = json.loads(
                response_body
            )

        except json.JSONDecodeError:

            raise HTTPException(
                status_code=502,
                detail=(
                    "Fast2SMS returned an "
                    "invalid response."
                )
            )

        # Fast2SMS normally provides:
        # return: true/false
        is_success = bool(
            data.get(
                "return",
                False
            )
        )

        request_id = (
            data.get(
                "request_id"
            )
            or ""
        )

        messages = data.get(
            "message",
            []
        )

        if isinstance(
            messages,
            list
        ):

            message_text = " ".join(
                str(item)
                for item in messages
            )

        else:

            message_text = str(
                messages
            )

        if not message_text:

            message_text = (
                "Fast2SMS request processed."
            )

        # ----------------------------------------------------
        # 7. Fast2SMS rejected request
        # ----------------------------------------------------

        if not is_success:

            return SMSAlertResponse(

                success=False,

                message=message_text,

                request_id=request_id
                or None,

                recipients_count=
                    recipient_count,

                raw_response=data
            )

        # ----------------------------------------------------
        # 8. Successful request
        # ----------------------------------------------------

        return SMSAlertResponse(

            success=True,

            message=message_text,

            request_id=request_id
            or None,

            recipients_count=
                recipient_count,

            raw_response=data
        )

    # --------------------------------------------------------
    # Fast2SMS HTTP errors
    # --------------------------------------------------------

    except urllib.error.HTTPError as err:

        try:

            error_body = (
                err
                .read()
                .decode(
                    "utf-8",
                    errors="replace"
                )
            )

        except Exception:

            error_body = ""

        try:

            error_data = json.loads(
                error_body
            )

            error_message = (
                error_data.get(
                    "message"
                )
                or error_body
                or str(err)
            )

        except Exception:

            error_message = (
                error_body
                or str(err)
            )

        raise HTTPException(

            status_code=502,

            detail=(
                f"Fast2SMS API error "
                f"(HTTP {err.code}): "
                f"{error_message}"
            )
        )

    # --------------------------------------------------------
    # Network / timeout errors
    # --------------------------------------------------------

    except (
        urllib.error.URLError,
        TimeoutError
    ) as exc:

        raise HTTPException(

            status_code=502,

            detail=(
                "Could not connect to Fast2SMS: "
                f"{exc}"
            )
        )

    # --------------------------------------------------------
    # Unexpected errors
    # --------------------------------------------------------

    except HTTPException:

        raise

    except Exception as exc:

        raise HTTPException(

            status_code=500,

            detail=(
                "Failed to send SMS: "
                f"{exc}"
            )
        )


# ============================================================
# PHONE BOOK API
# ============================================================

class PhoneNumberAddRequest(BaseModel):

    number: str = Field(
        ...,
        description=(
            "Indian mobile number "
            "with or without +91."
        )
    )


@router.get(
    "/phonebook",
    response_model=List[str]
)
def get_phone_book() -> List[str]:

    return load_phone_book()


@router.post(
    "/phonebook",
    response_model=List[str]
)
def add_phone_number(
    request: PhoneNumberAddRequest
) -> List[str]:

    cleaned = clean_phone_numbers(
        [request.number]
    )

    if not cleaned:

        raise HTTPException(
            status_code=400,
            detail="Invalid Indian mobile number."
        )

    new_number = (
        cleaned.split(",")[0]
    )

    phone_book = load_phone_book()

    if new_number not in phone_book:

        phone_book.append(
            new_number
        )

        save_phone_book(
            phone_book
        )

    return phone_book